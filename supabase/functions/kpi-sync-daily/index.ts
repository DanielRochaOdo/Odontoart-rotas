import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kpi-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ODONTOART_MOVIMENTACAO_URL = "https://odontoart.s4e.com.br/v2/api/contratos/movimentacao-vidas";
const ODONTOART_EMPRESAS_URL = "https://odontoart.s4e.com.br/api/empresa/BuscaEmpresas";
const ODONTOART_TIMEOUT_MS = 15000;
const KPI_WORKER_COUNT = 2;
const KPI_CLAIM_SIZE = 1;
const KPI_REQUEST_CONCURRENCY = 1;
const KPI_PROGRESS_UPDATE_EVERY = 10;
const KPI_MONTH_REQUEST_CONCURRENCY = 5;
const KPI_MAX_ATTEMPTS = 3;
const KPI_ITEM_MAX_ATTEMPTS = 3;
const KPI_WORKER_TIME_BUDGET_MS = 40000;
const KPI_RETRY_TIMEOUT_SECONDS = 120;
const STALE_RUNNING_LIMIT_MS = 15 * 60 * 1000;

const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
const odontoartToken = Deno.env.get("ODONTOART_TOKEN")?.trim() || Deno.env.get("VITE_ODONTOART_TOKEN")?.trim() || "";
const internalSecret = Deno.env.get("KPI_INTERNAL_SECRET")?.trim() || Deno.env.get("X_KPI_INTERNAL_SECRET")?.trim() || "";
const internalWorkerToken = internalSecret || serviceRoleKey;

if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

type KpiStatus = "so_perda" | "queda" | "crescimento" | "so_ganho" | "neutro";
type RunStatus = "running" | "success" | "failed";
type ItemStatus = "pending" | "processing" | "retrying" | "completed" | "failed" | "stopped";

type KpiSyncRequestBody = {
  source?: string;
  triggered_by?: string;
  mode?: "continue" | "stop";
  sync_run_id?: string;
  worker_id?: string;
  data_inicio?: string;
  data_fim?: string;
};

type SyncRunRow = {
  id: string;
  status: RunStatus;
  total_codes: number | null;
  processed_codes: number | null;
  changed_codes: number | null;
  failed_codes: number | null;
  started_at: string;
  last_progress_at: string | null;
  current_code: string | null;
  current_stage: string | null;
  current_code_started_at: string | null;
  current_attempt: number | null;
  source: string;
  period_start_date: string | null;
  period_end_date: string | null;
};

type RunItemRow = {
  id: string;
  run_id: string;
  codigo: string;
  status: ItemStatus;
  attempts: number;
  worker_id: string | null;
  claimed_at: string | null;
  heartbeat_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  next_retry_at: string | null;
  last_error: string | null;
  error_code: string | null;
  previous_value: unknown | null;
  received_value: unknown | null;
  changed: boolean;
  kpi_status: string | null;
  kpi_error: string | null;
  duration_ms: number | null;
};

type FetchErpResult = { httpStatus: number; payload: unknown };
type ErpRecord = Record<string, unknown>;

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const authorizeKpiManager = async (req: Request) => {
  const authorization = req.headers.get("authorization")?.trim() ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!token) return jsonResponse(401, { error: "Sessao autenticada obrigatoria." });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse(401, { error: "Sessao invalida." });
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, is_inactive, force_reauth_after")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (profileError) return jsonResponse(500, { error: "Nao foi possivel validar o perfil." });
  if (!profile) return jsonResponse(403, { error: "Perfil nao encontrado." });
  const managerProfile = profile as { role: string; is_inactive: boolean | null; force_reauth_after: string | null };
  if (managerProfile.is_inactive) return jsonResponse(403, { error: "Usuario inativo." });
  if (!["SUPERVISOR", "ASSISTENTE"].includes(String(managerProfile.role))) {
    return jsonResponse(403, { error: "Acesso restrito a supervisao e assistencia." });
  }
  if (managerProfile.force_reauth_after) {
    try {
      const encodedPayloadRaw = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "";
      const encodedPayload = encodedPayloadRaw + "=".repeat((4 - encodedPayloadRaw.length % 4) % 4);
      const claims = JSON.parse(atob(encodedPayload)) as { iat?: number };
      const issuedAt = typeof claims.iat === "number" ? claims.iat * 1000 : null;
      const forcedAt = new Date(managerProfile.force_reauth_after).getTime();
      if (issuedAt === null || (Number.isFinite(forcedAt) && issuedAt < forcedAt)) {
        return jsonResponse(401, { error: "Sessao antiga. Faca login novamente." });
      }
    } catch {
      return jsonResponse(401, { error: "Nao foi possivel validar a sessao." });
    }
  }
  return null;
};

const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeCode = (value: unknown) => String(value ?? "").replace(/\.0+$/, "").trim();

const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const getDefaultDateRange = () => {
  const now = new Date();
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return { dataInicio: start.toISOString().slice(0, 10), dataFim: end.toISOString().slice(0, 10) };
};

const resolveDateRange = (body: KpiSyncRequestBody) => {
  const defaults = getDefaultDateRange();
  const dataInicio = body.data_inicio?.trim() || defaults.dataInicio;
  const dataFim = body.data_fim?.trim() || defaults.dataFim;
  if (!isIsoDate(dataInicio) || !isIsoDate(dataFim)) throw new Error("Informe datas validas no formato AAAA-MM-DD.");
  if (dataInicio > dataFim) throw new Error("A data inicial deve ser anterior ou igual a data final.");
  const days = (Date.parse(`${dataFim}T00:00:00Z`) - Date.parse(`${dataInicio}T00:00:00Z`)) / 86400000 + 1;
  if (days > 366) throw new Error("O periodo consultado nao pode ultrapassar 366 dias.");
  return { dataInicio, dataFim };
};

const parseBody = async (req: Request): Promise<KpiSyncRequestBody> => {
  try {
    const body = (await req.clone().json()) as KpiSyncRequestBody;
    return {
      source: typeof body.source === "string" ? body.source : undefined,
      triggered_by: typeof body.triggered_by === "string" ? body.triggered_by : undefined,
      mode: body.mode === "continue" || body.mode === "stop" ? body.mode : undefined,
      sync_run_id: typeof body.sync_run_id === "string" ? body.sync_run_id : undefined,
      worker_id: typeof body.worker_id === "string" ? body.worker_id : undefined,
      data_inicio: typeof body.data_inicio === "string" ? body.data_inicio : undefined,
      data_fim: typeof body.data_fim === "string" ? body.data_fim : undefined,
    };
  } catch {
    return {};
  }
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) => {
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs) as unknown as number;
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

const previewPayload = (payload: unknown) => {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === "string") return payload.slice(0, 500);
  try {
    return JSON.stringify(payload).slice(0, 500);
  } catch {
    return "[unserializable-payload]";
  }
};

const parseMovementCount = (value: unknown) => {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const extractMovementTotals = (payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const total = (payload as ErpRecord).total;
  if (!total || typeof total !== "object" || Array.isArray(total)) return null;
  const entries = parseMovementCount((total as ErpRecord).entradas);
  const exits = parseMovementCount((total as ErpRecord).saidas);
  if (entries === null || exits === null) return null;
  return { entries, exits };
};

const fetchOdontoartPayload = async (codigo: string, dataInicio: string, dataFim: string): Promise<FetchErpResult> => {
  const search = new URLSearchParams({
    data_inicio: dataInicio,
    data_fim: dataFim,
    codigo_empresa: codigo,
    token: odontoartToken,
  });
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= KPI_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    try {
      const response = await withTimeout(
        fetch(`${ODONTOART_MOVIMENTACAO_URL}?${search.toString()}`, {
          method: "GET",
          headers: { Accept: "application/json", "Cache-Control": "no-store" },
          signal: controller.signal,
        }),
        ODONTOART_TIMEOUT_MS,
        `Timeout ao consultar ERP (${ODONTOART_TIMEOUT_MS}ms).`,
      );
      const text = await withTimeout(response.text(), ODONTOART_TIMEOUT_MS, `Timeout ao ler resposta do ERP (${ODONTOART_TIMEOUT_MS}ms).`);
      let payload: unknown = null;
      if (text.trim().length > 0) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }
      if (!response.ok) throw new Error(`Falha ao consultar ERP (${response.status}).`);
      return { httpStatus: response.status, payload };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Erro de comunicacao com ERP.");
      controller.abort();
      if (attempt < KPI_MAX_ATTEMPTS) await sleep(250 * attempt);
    }
  }
  throw lastError ?? new Error("Erro de comunicacao com ERP.");
};

const fetchOdontoartAssociatedTotal = async (codigo: string): Promise<number | null> => {
  const search = new URLSearchParams({ token: odontoartToken, empresaId: codigo });
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= KPI_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    try {
      const response = await withTimeout(
        fetch(`${ODONTOART_EMPRESAS_URL}?${search.toString()}`, {
          method: "GET",
          headers: { Accept: "application/json", "Cache-Control": "no-store" },
          signal: controller.signal,
        }),
        ODONTOART_TIMEOUT_MS,
        `Timeout ao consultar total atual de vidas (${ODONTOART_TIMEOUT_MS}ms).`,
      );
      const text = await withTimeout(response.text(), ODONTOART_TIMEOUT_MS, "Timeout ao ler total atual de vidas.");
      if (!response.ok) throw new Error(`Falha ao consultar cadastro ERP (${response.status}).`);
      const payload = JSON.parse(text) as ErpRecord;
      const records = Array.isArray(payload.dados) ? payload.dados as ErpRecord[] : [];
      const record = records.find((item) => normalizeCode(item.Id) === codigo);
      if (!record) throw new Error("Empresa ausente ou codigo divergente na resposta de BuscaEmpresas.");
      const rawTotal = record.AssociadoTotal;
      if (rawTotal === null || rawTotal === undefined || (typeof rawTotal === "string" && rawTotal.trim() === "")) {
        throw new Error("AssociadoTotal ausente ou invalido no cadastro ERP.");
      }
      const total = typeof rawTotal === "number" ? rawTotal : Number(String(rawTotal ?? "").trim());
      if (!Number.isSafeInteger(total) || total < 0) throw new Error("AssociadoTotal ausente ou invalido no cadastro ERP.");
      return total;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Falha ao consultar AssociadoTotal.");
      controller.abort();
      if (attempt < KPI_MAX_ATTEMPTS) await sleep(250 * attempt);
    }
  }
  throw lastError ?? new Error("Falha ao consultar AssociadoTotal.");
};

const splitPeriodByCompetence = (dataInicio: string, dataFim: string) => {
  const result: Array<{ competencia: string; dataInicio: string; dataFim: string }> = [];
  const start = new Date(`${dataInicio}T00:00:00.000Z`);
  const end = new Date(`${dataFim}T00:00:00.000Z`);
  for (let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); cursor <= end; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) {
    const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const sliceStart = monthStart < start ? start : monthStart;
    const sliceEnd = monthEnd > end ? end : monthEnd;
    result.push({
      competencia: monthStart.toISOString().slice(0, 10),
      dataInicio: sliceStart.toISOString().slice(0, 10),
      dataFim: sliceEnd.toISOString().slice(0, 10),
    });
  }
  return result;
};

const resolveKpiStatus = (entradas: number, saidas: number): KpiStatus => {
  if (entradas === 0 && saidas === 0) return "neutro";
  if (entradas === 0 && saidas > 0) return "so_perda";
  if (entradas > 0 && saidas === 0) return "so_ganho";
  if (entradas > saidas) return "crescimento";
  if (saidas > entradas) return "queda";
  return "neutro";
};

const resolveCategoryFromStatus = (status: KpiStatus) => {
  switch (status) {
    case "so_perda":
      return "So perda";
    case "queda":
      return "Queda";
    case "crescimento":
      return "Crescimento";
    case "so_ganho":
      return "So ganho";
    default:
      return "Neutro";
  }
};

const loadCompanyData = async (codes: string[]) => {
  if (codes.length === 0) return new Map<string, { name: string }>();
  const { data, error } = await supabase.from("clientes").select("codigo, empresa").in("codigo", codes);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => {
    const item = row as { codigo: string | null; empresa: string | null };
    return [normalizeCode(item.codigo), { name: item.empresa?.trim() ?? "" }] as const;
  }));
};

const acquireDailyLock = async () => {
  const now = new Date();
  const { data: existing, error } = await supabase
    .from("kpi_sync_locks")
    .select("lock_name, acquired_at")
    .eq("lock_name", "kpi_daily")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) {
    const acquiredAt = new Date(String((existing as { acquired_at: string }).acquired_at ?? "")).getTime();
    if (!(Number.isFinite(acquiredAt) && now.getTime() - acquiredAt > STALE_RUNNING_LIMIT_MS)) {
      throw new Error("Ja existe uma execucao KPI diaria em andamento.");
    }
  }
  const { error: upsertError } = await supabase.from("kpi_sync_locks").upsert({
    lock_name: "kpi_daily",
    acquired_at: now.toISOString(),
    acquired_by: "kpi-sync-daily",
  });
  if (upsertError) throw new Error(upsertError.message);
};

const touchDailyLock = async () => {
  const { error } = await supabase.from("kpi_sync_locks").upsert({
    lock_name: "kpi_daily",
    acquired_at: new Date().toISOString(),
    acquired_by: "kpi-sync-daily",
  });
  if (error) throw new Error(error.message);
};

const releaseDailyLock = async () => {
  const { error } = await supabase.from("kpi_sync_locks").delete().eq("lock_name", "kpi_daily");
  if (error) throw new Error(error.message);
};

const safeReleaseDailyLock = async () => {
  await releaseDailyLock().catch(() => undefined);
};

const getFunctionEndpoint = () => `${supabaseUrl.replace(/\/$/, "")}/functions/v1/kpi-sync-daily`;

const triggerWorkerInvocation = async (syncRunId: string, workerId: string) => {
  const promise = fetch(getFunctionEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kpi-internal-secret": internalWorkerToken,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ mode: "continue", sync_run_id: syncRunId, worker_id: workerId }),
  }).then(async (response) => {
    if (response.ok) return;
    const responseText = await response.text().catch(() => "");
    console.error("[kpi-sync-daily] worker_trigger_rejected", {
      syncRunId,
      workerId,
      httpStatus: response.status,
      response: responseText.slice(0, 500),
    });
  }).catch((error) => {
    console.error("[kpi-sync-daily] worker_trigger_failed", { syncRunId, workerId, error: error instanceof Error ? error.message : String(error) });
  });

  const edgeRuntime = (globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise);
    return;
  }
  void promise;
};

const createRun = async (source: string, totalCodes: number, dataInicio: string, dataFim: string) => {
  const snapshotAt = nowIso();
  const { data, error } = await supabase
    .from("kpi_sync_runs")
    .insert({
      source,
      status: "running",
      started_at: snapshotAt,
      last_progress_at: snapshotAt,
      current_code: null,
      current_stage: "queued",
      current_code_started_at: null,
      current_attempt: null,
      total_codes: totalCodes,
      processed_codes: 0,
      changed_codes: 0,
      failed_codes: 0,
      period_start_date: dataInicio,
      period_end_date: dataFim,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
};

const findRunningSyncRun = async (): Promise<SyncRunRow | null> => {
  const { data, error } = await supabase
    .from("kpi_sync_runs")
    .select("id, status, total_codes, processed_codes, changed_codes, failed_codes, started_at, last_progress_at, current_code, current_stage, current_code_started_at, current_attempt, source, period_start_date, period_end_date")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as SyncRunRow | null;
};

const loadProcessedCodesForRun = async (syncRunId: string) => {
  const processed = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("kpi_sync_run_items")
      .select("codigo")
      .eq("run_id", syncRunId)
      .in("status", ["completed", "failed", "stopped"])
      .order("created_at", { ascending: true })
      .order("codigo", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    rows.forEach((item) => {
      const codigo = normalizeCode((item as { codigo: string | null }).codigo);
      if (codigo) processed.add(codigo);
    });
    if (rows.length < 1000) break;
  }
  return processed;
};

type RunProgress = {
  processed: number;
  remaining: number;
  failed: number;
  changed: number;
  finished: boolean;
  status: RunStatus;
};

const updateRunProgressFromItems = async (syncRunId: string, finalize = false): Promise<RunProgress> => {
  const { data, error } = await supabase.rpc("kpi_refresh_run_progress", {
    p_run_id: syncRunId,
    p_finalize: finalize,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Progresso KPI nao retornado pelo banco.");
  return data as RunProgress;
};

const claimNextItems = async (syncRunId: string, workerId: string) => {
  const { data, error } = await supabase.rpc("kpi_claim_next_run_items", {
    p_run_id: syncRunId,
    p_worker_id: workerId,
    p_claim_size: KPI_CLAIM_SIZE,
    p_retry_timeout_seconds: KPI_RETRY_TIMEOUT_SECONDS,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; codigo: string; attempts: number }>;
};

const finalizeItem = async (
  itemId: string,
  workerId: string,
  payload: {
    status: ItemStatus;
    changed?: boolean;
    kpiStatus?: string | null;
    kpiError?: string | null;
    errorCode?: string | null;
    lastError?: string | null;
    previousValue?: unknown | null;
    receivedValue?: unknown | null;
    durationMs?: number | null;
  },
) => {
  const { error } = await supabase.rpc("kpi_finalize_run_item", {
    p_item_id: itemId,
    p_worker_id: workerId,
    p_status: payload.status,
    p_changed: payload.changed ?? false,
    p_kpi_status: payload.kpiStatus ?? null,
    p_kpi_error: payload.kpiError ?? null,
    p_error_code: payload.errorCode ?? null,
    p_last_error: payload.lastError ?? null,
    p_previous_value: payload.previousValue ?? null,
    p_received_value: payload.receivedValue ?? null,
    p_duration_ms: payload.durationMs ?? null,
  });
  if (error) throw new Error(error.message);
};

const processSingleCode = async (params: {
  syncRunId: string;
  workerId: string;
  item: { id: string; codigo: string; attempts: number };
  dataInicio: string;
  dataFim: string;
  empresaNome: string | null;
}) => {
  const { syncRunId, workerId, item, dataInicio, dataFim, empresaNome: clientCompanyName } = params;
  const startedAt = Date.now();
  let heartbeatInFlight = false;
  const heartbeatTimer = setInterval(async () => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    try {
      const { error } = await supabase.rpc("kpi_touch_run_item", { p_item_id: item.id, p_worker_id: workerId });
      if (error) console.warn("[kpi-sync-daily] item_heartbeat_failed", { runId: syncRunId, code: item.codigo, error: error.message });
    } catch (error) {
      console.warn("[kpi-sync-daily] item_heartbeat_failed", { runId: syncRunId, code: item.codigo, error: error instanceof Error ? error.message : String(error) });
    } finally {
      heartbeatInFlight = false;
    }
  }, 30000);

  try {
    const competenceRanges = splitPeriodByCompetence(dataInicio, dataFim);
    const associatedTotalPromise = fetchOdontoartAssociatedTotal(item.codigo)
      .then((total) => ({ total, error: null as string | null }))
      .catch((error) => ({
        total: null,
        error: error instanceof Error ? error.message : "Falha ao consultar AssociadoTotal.",
      }));
    const movements = [] as Array<{ competencia: string; entradas: number; saidas: number; categoria: string }>;
    for (let offset = 0; offset < competenceRanges.length; offset += KPI_MONTH_REQUEST_CONCURRENCY) {
      const batch = competenceRanges.slice(offset, offset + KPI_MONTH_REQUEST_CONCURRENCY);
      const batchMovements = await Promise.all(batch.map(async (range) => {
        const { httpStatus, payload } = await fetchOdontoartPayload(item.codigo, range.dataInicio, range.dataFim);
        const emptyPayload = payload === null || payload === undefined || payload === "" || (Array.isArray(payload) && payload.length === 0);
        if (emptyPayload) throw new Error(`Payload vazio para a competencia ${range.competencia} (HTTP ${httpStatus}).`);
        const totals = extractMovementTotals(payload);
        if (!totals) throw new Error(`Totais de entradas e saidas ausentes ou invalidos para ${range.competencia}.`);
        return {
          competencia: range.competencia,
          entradas: totals.entries,
          saidas: totals.exits,
          categoria: resolveCategoryFromStatus(resolveKpiStatus(totals.entries, totals.exits)),
        };
      }));
      movements.push(...batchMovements);
    }

    const associatedResult = await associatedTotalPromise;
    const associatedTotal = associatedResult.total;
    if (associatedResult.error) {
      const { error: logError } = await supabase.from("kpi_sync_run_errors").insert({
        sync_run_id: syncRunId,
        codigo: item.codigo,
        stage: "fetch_associado_total",
        error_message: associatedResult.error,
        http_status: null,
        payload_preview: null,
      });
      if (logError) console.warn("[kpi-sync-daily] failed_to_log_associado_total_error", logError.message);
    }
    const allEntries = movements.reduce((sum, row) => sum + row.entradas, 0);
    const allExits = movements.reduce((sum, row) => sum + row.saidas, 0);
    const category = resolveCategoryFromStatus(resolveKpiStatus(allEntries, allExits));
    const { error: persistError } = await supabase.rpc("kpi_persist_monthly_movements", {
      p_sync_run_id: syncRunId,
      p_codigo: item.codigo,
      p_empresa: clientCompanyName || item.codigo,
      p_associado_total: associatedTotal,
      p_categoria: category,
      p_movimentos: movements,
    });
    if (persistError) throw new Error(`Falha ao persistir historico KPI: ${persistError.message}`);
    const changed = allEntries > 0 || allExits > 0;

    await finalizeItem(item.id, workerId, {
      status: "completed",
      changed,
      kpiStatus: "ok",
      receivedValue: { code: item.codigo, entries: allEntries, exits: allExits, associado_total: associatedTotal, competencias: movements.length },
      previousValue: null,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao consultar ERP.";
    const shouldRetry = item.attempts < KPI_ITEM_MAX_ATTEMPTS;
    if (!shouldRetry) {
      await supabase.from("kpi_sync_run_errors").insert({
        sync_run_id: syncRunId,
        codigo: item.codigo,
        stage: "fetch_erp",
        error_message: message,
        http_status: null,
        payload_preview: null,
      });
    }
    await finalizeItem(item.id, workerId, {
      status: shouldRetry ? "retrying" : "failed",
      changed: false,
      errorCode: "fetch_erp",
      lastError: message,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    clearInterval(heartbeatTimer);
  }
};

const startDailySync = async (req: Request, body: KpiSyncRequestBody) => {
  const source = body.source?.trim() || req.headers.get("x-kpi-source")?.trim() || "api_daily";
  let dataInicio: string;
  let dataFim: string;
  try {
    ({ dataInicio, dataFim } = resolveDateRange(body));
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : "Periodo de consulta invalido." });
  }
  if (!odontoartToken) return jsonResponse(400, { error: "ODONTOART_TOKEN nao configurado." });

  await acquireDailyLock();
  let syncRunId: string | null = null;
  try {
    const runningRun = await findRunningSyncRun();
    if (runningRun) {
      return jsonResponse(202, {
        sync_run_id: runningRun.id,
        status: "running",
        total_codes: Number(runningRun.total_codes ?? 0),
        processed_codes: Number(runningRun.processed_codes ?? 0),
        remaining_codes: Math.max(0, Number(runningRun.total_codes ?? 0) - Number(runningRun.processed_codes ?? 0)),
        current_stage: runningRun.current_stage,
      });
    }

    syncRunId = await createRun(source, 0, dataInicio, dataFim);
    const { data: totalCodesValue, error: prepareError } = await supabase.rpc("kpi_seed_run_items", {
      p_run_id: syncRunId,
    });
    if (prepareError) throw new Error(prepareError.message);
    const totalCodes = Number(totalCodesValue ?? 0);
    const { error: updateRunError } = await supabase.from("kpi_sync_runs").update({
      total_codes: totalCodes,
      processed_codes: 0,
      changed_codes: 0,
      failed_codes: 0,
      remaining_codes: totalCodes,
      current_stage: "queued",
      last_progress_at: nowIso(),
    }).eq("id", syncRunId);
    if (updateRunError) throw new Error(updateRunError.message);

    await Promise.all(
      Array.from({ length: KPI_WORKER_COUNT }, (_, index) => triggerWorkerInvocation(syncRunId, `worker-${index + 1}`)),
    );

    return jsonResponse(202, {
      success: true,
      sync_run_id: syncRunId,
      status: "running",
      total_codes: totalCodes,
      worker_count: KPI_WORKER_COUNT,
      request_concurrency: KPI_REQUEST_CONCURRENCY,
      data_inicio: dataInicio,
      data_fim: dataFim,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na sincronizacao diaria KPI.";
    if (syncRunId) {
      await supabase.from("kpi_sync_runs").update({
        status: "failed",
        finished_at: nowIso(),
        error_message: message,
        current_stage: null,
      }).eq("id", syncRunId);
    }
    return jsonResponse(400, { error: message, sync_run_id: syncRunId });
  } finally {
    await safeReleaseDailyLock();
  }
};

const continueDailySync = async (req: Request, body: KpiSyncRequestBody) => {
  const syncRunId = body.sync_run_id?.trim() || "";
  const workerId = body.worker_id?.trim() || crypto.randomUUID();
  if (!syncRunId) return jsonResponse(400, { error: "sync_run_id ausente." });
  const secret = req.headers.get("x-kpi-internal-secret")?.trim() || "";
  if (!internalWorkerToken || secret !== internalWorkerToken) {
    const authorizationError = await authorizeKpiManager(req);
    if (authorizationError) return authorizationError;
  }

  try {
    const { data: runRow, error: runError } = await supabase
      .from("kpi_sync_runs")
      .select("id, status, total_codes, processed_codes, changed_codes, failed_codes, source, current_stage, period_start_date, period_end_date")
      .eq("id", syncRunId)
      .maybeSingle();
    if (runError) throw new Error(runError.message);
    if (!runRow) return jsonResponse(404, { error: "Run nao encontrado." });
    if ((runRow as SyncRunRow).status !== "running") {
      return jsonResponse(200, { sync_run_id: syncRunId, status: (runRow as SyncRunRow).status });
    }

    await touchDailyLock();
    const dataInicio = String((runRow as SyncRunRow).period_start_date ?? getDefaultDateRange().dataInicio);
    const dataFim = String((runRow as SyncRunRow).period_end_date ?? getDefaultDateRange().dataFim);
    const startedAt = Date.now();

    let processedInLoop = 0;
    while (Date.now() - startedAt < KPI_WORKER_TIME_BUDGET_MS) {
      const claims = await claimNextItems(syncRunId, workerId);
      if (claims.length === 0) break;
      processedInLoop += claims.length;
      const companyData = await loadCompanyData(claims.map((item) => item.codigo));
      const queue = [...claims];

      while (queue.length > 0) {
        const chunk = queue.splice(0, KPI_REQUEST_CONCURRENCY);
        await Promise.allSettled(chunk.map((item) => processSingleCode({
          syncRunId,
          workerId,
          item,
          dataInicio,
          dataFim,
          empresaNome: companyData.get(item.codigo)?.name || null,
        })));
      }

      if (processedInLoop % KPI_PROGRESS_UPDATE_EVERY === 0) {
        const progress = await updateRunProgressFromItems(syncRunId);
        if (progress.remaining === 0) break;
      }
      await sleep(25);
    }

    const progress = await updateRunProgressFromItems(syncRunId, true);
    if (!progress.finished) {
      await supabase.from("kpi_sync_runs").update({
        current_stage: "queued_next_chunk",
        current_code: null,
        current_code_started_at: null,
        current_attempt: null,
        last_progress_at: nowIso(),
      }).eq("id", syncRunId);
      await triggerWorkerInvocation(syncRunId, workerId);
      return jsonResponse(202, {
        sync_run_id: syncRunId,
        status: "running",
        current_stage: "queued_next_chunk",
        processed_in_chunk: processedInLoop,
      });
    }

    await safeReleaseDailyLock();
    return jsonResponse(200, { sync_run_id: syncRunId, status: progress.status });
  } catch (error) {
    await Promise.resolve(supabase.from("kpi_sync_runs").update({
      status: "failed",
      finished_at: nowIso(),
      error_message: error instanceof Error ? error.message : "Falha no worker KPI.",
      current_code: null,
      current_stage: null,
      current_code_started_at: null,
      current_attempt: null,
    }).eq("id", syncRunId)).catch(() => undefined);
    return jsonResponse(400, { error: error instanceof Error ? error.message : "Falha no worker KPI.", sync_run_id: syncRunId });
  } finally {
    await safeReleaseDailyLock();
  }
};

const stopDailySync = async (body: KpiSyncRequestBody) => {
  const syncRunId = body.sync_run_id?.trim() || "";
  const { data: runRow, error } = await supabase.from("kpi_sync_runs").select("id").eq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!runRow && !syncRunId) return jsonResponse(200, { status: "idle" });
  const targetId = syncRunId || String((runRow as { id: string }).id);
  await supabase.from("kpi_sync_runs").update({
    status: "failed",
    finished_at: nowIso(),
    error_message: "Sincronizacao interrompida manualmente.",
    current_code: null,
    current_stage: null,
    current_code_started_at: null,
    current_attempt: null,
  }).eq("id", targetId);
  await supabase.from("kpi_sync_run_items").update({ status: "stopped", finished_at: nowIso(), updated_at: nowIso() }).eq("run_id", targetId).in("status", ["pending", "retrying", "processing"]);
  await safeReleaseDailyLock();
  return jsonResponse(200, { sync_run_id: targetId, status: "failed" });
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Metodo nao permitido." });

  const body = await parseBody(req);
  if (body.mode !== "stop" && (body.mode === "continue" || body.sync_run_id)) return await continueDailySync(req, body);
  const authorizationError = await authorizeKpiManager(req);
  if (authorizationError) return authorizationError;
  if (body.mode === "stop") return await stopDailySync(body);
  return await startDailySync(req, body);
});
