import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kpi-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ODONTOART_EMPRESA_URL = "https://odontoart.s4e.com.br/api/empresa/BuscaEmpresas";
const ODONTOART_TIMEOUT_MS = 15000;
const KPI_WORKER_COUNT = 10;
const KPI_CLAIM_SIZE = 30;
const KPI_REQUEST_CONCURRENCY = 10;
const KPI_MAX_ATTEMPTS = 3;
const KPI_WORKER_TIME_BUDGET_MS = 40000;
const KPI_RETRY_TIMEOUT_SECONDS = 120;
const STALE_RUNNING_LIMIT_MS = 15 * 60 * 1000;

const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
const odontoartToken = Deno.env.get("ODONTOART_TOKEN")?.trim() || Deno.env.get("VITE_ODONTOART_TOKEN")?.trim() || "";
const internalSecret = Deno.env.get("KPI_INTERNAL_SECRET")?.trim() || Deno.env.get("X_KPI_INTERNAL_SECRET")?.trim() || "";
const internalWorkerToken = internalSecret || serviceRoleKey;
const gatewayAuthToken = anonKey || serviceRoleKey;

if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

type KpiStatus = "inativo" | "so_perda" | "queda" | "crescimento" | "so_venda" | "neutro";
type RunStatus = "running" | "success" | "failed";
type ItemStatus = "pending" | "processing" | "retrying" | "completed" | "failed" | "stopped";

type KpiSyncRequestBody = {
  source?: string;
  triggered_by?: string;
  mode?: "continue" | "stop";
  sync_run_id?: string;
  worker_id?: string;
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

const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeCode = (value: unknown) => String(value ?? "").replace(/\.0+$/, "").trim();

const parseBody = async (req: Request): Promise<KpiSyncRequestBody> => {
  try {
    const body = (await req.clone().json()) as KpiSyncRequestBody;
    return {
      source: typeof body.source === "string" ? body.source : undefined,
      triggered_by: typeof body.triggered_by === "string" ? body.triggered_by : undefined,
      mode: body.mode === "continue" || body.mode === "stop" ? body.mode : undefined,
      sync_run_id: typeof body.sync_run_id === "string" ? body.sync_run_id : undefined,
      worker_id: typeof body.worker_id === "string" ? body.worker_id : undefined,
    };
  } catch {
    return {};
  }
};

const readRecordValueByKeyInsensitive = (record: ErpRecord, key: string) => {
  if (key in record) return record[key];
  const foundKey = Object.keys(record).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return foundKey ? record[foundKey] : undefined;
};

const buildCodigoCandidates = (rawCodigo: string) => {
  const trimmed = rawCodigo.trim();
  const numeric = /^\d+$/.test(trimmed);
  return Array.from(new Set([trimmed, numeric ? trimmed.replace(/^0+/, "") : "", numeric ? String(Number(trimmed)) : ""].filter(Boolean)));
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

const parseAssociadoTitular = (empresa: ErpRecord) => {
  const direct = readRecordValueByKeyInsensitive(empresa, "AssociadoTitular");
  const parsed = typeof direct === "number"
    ? direct
    : typeof direct === "string"
      ? Number(direct.trim().replace(/\./g, "").replace(",", "."))
      : Number(direct);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const parseEmpresaName = (empresa: ErpRecord) => {
  const direct =
    readRecordValueByKeyInsensitive(empresa, "NomeFantasia") ??
    readRecordValueByKeyInsensitive(empresa, "NomeFantazia") ??
    readRecordValueByKeyInsensitive(empresa, "RazaoSocial");
  return typeof direct === "string" && direct.trim() ? direct.trim() : null;
};

const extractEmpresaFromPayload = (payload: unknown): ErpRecord | null => {
  if (Array.isArray(payload)) {
    const first = payload[0];
    return first && typeof first === "object" ? (first as ErpRecord) : null;
  }
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const dados = record.dados;
  if (Array.isArray(dados)) {
    const first = dados[0];
    return first && typeof first === "object" ? (first as ErpRecord) : null;
  }
  if (dados && typeof dados === "object") return dados as ErpRecord;
  return null;
};

const fetchOdontoartPayload = async (codigo: string): Promise<FetchErpResult> => {
  const candidates = buildCodigoCandidates(codigo);
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    for (let attempt = 1; attempt <= KPI_MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const search = new URLSearchParams({ token: odontoartToken, empresaId: candidate });
      try {
        const response = await withTimeout(
          fetch(`${ODONTOART_EMPRESA_URL}?${search.toString()}`, {
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
        break;
      }
    }
  }
  throw lastError ?? new Error("Erro de comunicacao com ERP.");
};

const resolveKpiStatus = (vendas: number, cancelamentos: number): KpiStatus => {
  if (vendas === 0 && cancelamentos === 0) return "inativo";
  if (vendas === 0 && cancelamentos > 0) return "so_perda";
  if (vendas > 0 && cancelamentos === 0) return "so_venda";
  if (vendas > cancelamentos) return "crescimento";
  if (cancelamentos > vendas) return "queda";
  return "neutro";
};

const resolveCategoryFromStatus = (status: KpiStatus) => {
  switch (status) {
    case "inativo":
      return "Inativo";
    case "so_perda":
      return "So perda";
    case "queda":
      return "Queda";
    case "crescimento":
      return "Crescimento";
    case "so_venda":
      return "So venda";
    default:
      return "Neutro";
  }
};

const resolveClienteCategoryFromStatus = (status: KpiStatus) => {
  switch (status) {
    case "inativo":
      return "Inativo";
    case "so_perda":
      return "So perda";
    case "queda":
      return "Queda";
    case "crescimento":
      return "Crescimento";
    case "so_venda":
      return "So venda";
    default:
      return "Neutro";
  }
};

const loadDistinctCodes = async () => {
  const codes: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("clientes")
      .select("codigo")
      .order("codigo", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []).map((row) => normalizeCode((row as { codigo: string | null }).codigo)).filter(Boolean);
    codes.push(...batch);
    if (batch.length < 1000) break;
  }
  return Array.from(new Set(codes)).sort((a, b) => a.localeCompare(b));
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
      Authorization: `Bearer ${gatewayAuthToken}`,
    },
    body: JSON.stringify({ mode: "continue", sync_run_id: syncRunId, worker_id: workerId }),
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

const insertRunItems = async (syncRunId: string, codes: string[]) => {
  const rows = codes.map((codigo) => ({ run_id: syncRunId, codigo, status: "pending" as const }));
  const { error } = await supabase.from("kpi_sync_run_items").upsert(rows, { onConflict: "run_id,codigo" });
  if (error) throw new Error(error.message);
};

const createRun = async (source: string, totalCodes: number) => {
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
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
};

const findRunningSyncRun = async (): Promise<SyncRunRow | null> => {
  const { data, error } = await supabase
    .from("kpi_sync_runs")
    .select("id, status, total_codes, processed_codes, changed_codes, failed_codes, started_at, last_progress_at, current_code, current_stage, current_code_started_at, current_attempt, source")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as SyncRunRow | null;
};

const loadProcessedCodesForRun = async (syncRunId: string) => {
  const loadForTable = async (table: "kpi_sync_snapshots" | "kpi_sync_run_errors") => {
    const result = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from(table)
        .select("codigo")
        .eq("sync_run_id", syncRunId)
        .order("codigo", { ascending: true })
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      rows.forEach((item) => {
        const codigo = normalizeCode((item as { codigo: string | null }).codigo);
        if (codigo) result.add(codigo);
      });
      if (rows.length < 1000) break;
    }
    return result;
  };
  const [snapshots, errors] = await Promise.all([loadForTable("kpi_sync_snapshots"), loadForTable("kpi_sync_run_errors")]);
  const processed = new Set<string>(snapshots);
  for (const codigo of errors) processed.add(codigo);
  return processed;
};

const getPreviousByCode = async (periodDays: number, currentSyncRunId: string) => {
  const rows: Array<{ codigo: string | null; vidas_qtde: number | null; snapshot_at: string; sync_run_id: string | null }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("kpi_sync_snapshots")
      .select("codigo, vidas_qtde, snapshot_at, sync_run_id")
      .eq("period_days", periodDays)
      .neq("sync_run_id", currentSyncRunId)
      .not("sync_run_id", "is", null)
      .in("source", ["api_daily", "manual_sync", "manual_upload"])
      .order("snapshot_at", { ascending: false })
      .order("codigo", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []).map((item) => ({
      codigo: (item as { codigo: string | null }).codigo,
      vidas_qtde: (item as { vidas_qtde: number | null }).vidas_qtde,
      snapshot_at: (item as { snapshot_at: string }).snapshot_at,
      sync_run_id: (item as { sync_run_id: string | null }).sync_run_id,
    }));
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  const previousByCode = new Map<string, number>();
  for (const row of rows) {
    const codigo = normalizeCode(row.codigo);
    if (!codigo || previousByCode.has(codigo)) continue;
    const value = Number(row.vidas_qtde);
    if (Number.isFinite(value)) previousByCode.set(codigo, value);
  }
  return previousByCode;
};

const updateRunProgressFromItems = async (syncRunId: string) => {
  const [{ count: completed }, { count: failed }, { count: stopped }, { count: processing }, { count: retrying }, { count: pending }] = await Promise.all([
    supabase.from("kpi_sync_run_items").select("id", { count: "exact", head: true }).eq("run_id", syncRunId).eq("status", "completed"),
    supabase.from("kpi_sync_run_items").select("id", { count: "exact", head: true }).eq("run_id", syncRunId).eq("status", "failed"),
    supabase.from("kpi_sync_run_items").select("id", { count: "exact", head: true }).eq("run_id", syncRunId).eq("status", "stopped"),
    supabase.from("kpi_sync_run_items").select("id", { count: "exact", head: true }).eq("run_id", syncRunId).eq("status", "processing"),
    supabase.from("kpi_sync_run_items").select("id", { count: "exact", head: true }).eq("run_id", syncRunId).eq("status", "retrying"),
    supabase.from("kpi_sync_run_items").select("id", { count: "exact", head: true }).eq("run_id", syncRunId).eq("status", "pending"),
  ]);

  const processed = (completed ?? 0) + (failed ?? 0) + (stopped ?? 0);
  const remaining = (pending ?? 0) + (processing ?? 0) + (retrying ?? 0);
  const changed = await supabase.from("kpi_sync_run_items").select("id", { count: "exact", head: true }).eq("run_id", syncRunId).eq("changed", true);
  const { error } = await supabase.from("kpi_sync_runs").update({
    processed_codes: processed,
    changed_codes: changed.count ?? 0,
    failed_codes: failed ?? 0,
    remaining_codes: remaining,
    last_progress_at: nowIso(),
  }).eq("id", syncRunId);
  if (error) throw new Error(error.message);
  return { processed, remaining, failed: failed ?? 0, changed: changed.count ?? 0 };
};

const claimNextItems = async (syncRunId: string, workerId: string) => {
  const { data, error } = await supabase.rpc("kpi_claim_next_run_items", {
    p_run_id: syncRunId,
    p_worker_id: workerId,
    p_claim_size: KPI_CLAIM_SIZE,
    p_retry_timeout_seconds: KPI_RETRY_TIMEOUT_SECONDS,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; codigo: string }>;
};

const touchItem = async (itemId: string, workerId: string) => {
  const { error } = await supabase.rpc("kpi_touch_run_item", { p_item_id: itemId, p_worker_id: workerId });
  if (error) throw new Error(error.message);
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

const buildSnapshotRow = (
  syncRunId: string,
  snapshotAt: string,
  snapshotDate: string,
  periodDays: number,
  source: string,
  code: string,
  empresa: string | null,
  vidasQtde: number,
  previous: number,
) => {
  const delta = vidasQtde - previous;
  const status = resolveKpiStatus(Math.max(0, delta), Math.max(0, -delta));
  return {
    sync_run_id: syncRunId,
    source,
    period_days: periodDays,
    codigo: code,
    empresa,
    categoria: resolveCategoryFromStatus(status),
    vidas_qtde: vidasQtde,
    status,
    snapshot_at: snapshotAt,
    snapshot_date: snapshotDate,
    previous_vidas_qtde: previous,
    delta,
    vendas_qtde: delta > 0 ? delta : 0,
    cancelamentos_qtde: delta < 0 ? Math.abs(delta) : 0,
    synced_by_user_id: null,
  };
};

const upsertClientesForCode = async (code: string, vidasQtde: number, status: KpiStatus) => {
  const { error } = await supabase
    .from("clientes")
    .update({
      vidas_qtde: vidasQtde,
      categoria: resolveClienteCategoryFromStatus(status),
    })
    .eq("codigo", code);
  if (error) throw new Error(error.message);
};

const processSingleCode = async (params: {
  syncRunId: string;
  workerId: string;
  item: { id: string; codigo: string };
  source: string;
  periodDays: number;
  snapshotAt: string;
  snapshotDate: string;
  previousByCode: Map<string, number>;
}) => {
  const { syncRunId, workerId, item, source, periodDays, snapshotAt, snapshotDate, previousByCode } = params;
  const startedAt = Date.now();
  await touchItem(item.id, workerId);

  try {
    const { httpStatus, payload } = await fetchOdontoartPayload(item.codigo);
    const emptyPayload = payload === null || payload === undefined || payload === "" || (Array.isArray(payload) && payload.length === 0);
    if (emptyPayload) {
      await supabase.from("kpi_sync_run_errors").insert({
        sync_run_id: syncRunId,
        codigo: item.codigo,
        stage: "empty_payload",
        error_message: "Payload vazio retornado pela API do ERP.",
        http_status: httpStatus,
        payload_preview: previewPayload(payload),
      });
      await finalizeItem(item.id, workerId, {
        status: "failed",
        changed: false,
        errorCode: "empty_payload",
        lastError: "Payload vazio retornado pela API do ERP.",
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const empresa = extractEmpresaFromPayload(payload);
    const empresaNome = empresa ? parseEmpresaName(empresa) : null;
    const associadoTitular = empresa ? parseAssociadoTitular(empresa) : null;
    if (!empresa || !empresaNome || associadoTitular === null) {
      const lastError = !empresa ? "Empresa ausente no payload do ERP." : !empresaNome ? "Nome da empresa ausente no payload do ERP." : "AssociadoTitular invalido no payload do ERP.";
      const stage = !empresa ? "missing_empresa" : !empresaNome ? "missing_empresa_name" : "invalid_associado_titular";
      await supabase.from("kpi_sync_run_errors").insert({
        sync_run_id: syncRunId,
        codigo: item.codigo,
        stage,
        error_message: lastError,
        http_status: httpStatus,
        payload_preview: previewPayload(payload),
      });
      await finalizeItem(item.id, workerId, {
        status: "failed",
        changed: false,
        errorCode: stage,
        lastError,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const previous = previousByCode.get(item.codigo) ?? associadoTitular;
    const changed = previous !== associadoTitular;
    const status = resolveKpiStatus(Math.max(0, associadoTitular - previous), Math.max(0, previous - associadoTitular));
    if (changed) {
      await upsertClientesForCode(item.codigo, associadoTitular, status);
      const snapshotRow = buildSnapshotRow(syncRunId, snapshotAt, snapshotDate, periodDays, source, item.codigo, empresaNome, associadoTitular, previous);
      const { error } = await supabase.from("kpi_sync_snapshots").upsert(snapshotRow, { onConflict: "sync_run_id,codigo" });
      if (error) throw new Error(error.message);
    } else {
      await upsertClientesForCode(item.codigo, associadoTitular, status);
      const snapshotRow = buildSnapshotRow(syncRunId, snapshotAt, snapshotDate, periodDays, source, item.codigo, empresaNome, associadoTitular, previous);
      const { error } = await supabase.from("kpi_sync_snapshots").upsert(snapshotRow, { onConflict: "sync_run_id,codigo" });
      if (error) throw new Error(error.message);
    }

    await finalizeItem(item.id, workerId, {
      status: "completed",
      changed,
      kpiStatus: "ok",
      receivedValue: { code: item.codigo, vidasQtde: associadoTitular, empresa: empresaNome },
      previousValue: { code: item.codigo, vidasQtde: previous },
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao consultar ERP.";
    await supabase.from("kpi_sync_run_errors").insert({
      sync_run_id: syncRunId,
      codigo: item.codigo,
      stage: "fetch_erp",
      error_message: message,
      http_status: null,
      payload_preview: null,
    });
    await finalizeItem(item.id, workerId, {
      status: "retrying",
      changed: false,
      errorCode: "fetch_erp",
      lastError: message,
      durationMs: Date.now() - startedAt,
    });
  }
};

const syncRunFinished = async (syncRunId: string) => {
  const { data, error } = await supabase
    .from("kpi_sync_run_items")
    .select("status")
    .eq("run_id", syncRunId);
  if (error) throw new Error(error.message);
  const statuses = (data ?? []).map((row) => String((row as { status: string }).status));
  const pending = statuses.some((s) => s === "pending" || s === "processing" || s === "retrying");
  return {
    finished: !pending,
    failedCount: statuses.filter((s) => s === "failed").length,
  };
};

const finalizeRunIfDone = async (syncRunId: string) => {
  const [{ count: failed }, { count: completed }, { count: changed }] = await Promise.all([
    supabase.from("kpi_sync_run_items").select("id", { count: "exact", head: true }).eq("run_id", syncRunId).eq("status", "failed"),
    supabase.from("kpi_sync_run_items").select("id", { count: "exact", head: true }).eq("run_id", syncRunId).eq("status", "completed"),
    supabase.from("kpi_sync_run_items").select("id", { count: "exact", head: true }).eq("run_id", syncRunId).eq("changed", true),
  ]);
  const { data: remainingRows, error } = await supabase
    .from("kpi_sync_run_items")
    .select("id")
    .eq("run_id", syncRunId)
    .in("status", ["pending", "processing", "retrying"]);
  if (error) throw new Error(error.message);
  const remaining = (remainingRows ?? []).length;
  if (remaining > 0) return false;
  const status: RunStatus = failed && failed > 0 ? "success" : "success";
  const { error: updateError } = await supabase.from("kpi_sync_runs").update({
    status,
    finished_at: nowIso(),
    processed_codes: (completed ?? 0) + (failed ?? 0),
    changed_codes: changed ?? 0,
    failed_codes: failed ?? 0,
    remaining_codes: 0,
    current_code: null,
    current_stage: null,
    current_code_started_at: null,
    current_attempt: null,
    last_progress_at: nowIso(),
  }).eq("id", syncRunId);
  if (updateError) throw new Error(updateError.message);
  return true;
};

const startDailySync = async (req: Request, body: KpiSyncRequestBody) => {
  const source = body.source?.trim() || req.headers.get("x-kpi-source")?.trim() || "api_daily";
  const triggeredBy = body.triggered_by?.trim() || "cron";
  if (!odontoartToken) return jsonResponse(400, { error: "ODONTOART_TOKEN nao configurado." });

  await acquireDailyLock();
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

    const codes = await loadDistinctCodes();
    const syncRunId = await createRun(source, codes.length);
    await insertRunItems(syncRunId, codes);
    await supabase.from("kpi_sync_runs").update({
      total_codes: codes.length,
      processed_codes: 0,
      changed_codes: 0,
      failed_codes: 0,
      remaining_codes: codes.length,
      current_stage: "queued",
      last_progress_at: nowIso(),
    }).eq("id", syncRunId);

    await Promise.all(
      Array.from({ length: KPI_WORKER_COUNT }, (_, index) => triggerWorkerInvocation(syncRunId, `worker-${index + 1}`)),
    );

    return jsonResponse(202, {
      success: true,
      run_id: syncRunId,
      status: "running",
      total_codes: codes.length,
      worker_count: KPI_WORKER_COUNT,
      request_concurrency: KPI_REQUEST_CONCURRENCY,
    });
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : "Falha na sincronizacao diaria KPI." });
  } finally {
    await safeReleaseDailyLock();
  }
};

const continueDailySync = async (req: Request, body: KpiSyncRequestBody) => {
  const syncRunId = body.sync_run_id?.trim() || "";
  const workerId = body.worker_id?.trim() || crypto.randomUUID();
  if (!syncRunId) return jsonResponse(400, { error: "sync_run_id ausente." });
  if (!internalWorkerToken) return jsonResponse(400, { error: "Token interno de worker nao configurado." });
  const secret = req.headers.get("x-kpi-internal-secret")?.trim() || "";
  if (secret !== internalWorkerToken) return jsonResponse(401, { error: "Acesso negado." });

  try {
    const { data: runRow, error: runError } = await supabase
      .from("kpi_sync_runs")
      .select("id, status, total_codes, processed_codes, changed_codes, failed_codes, source, current_stage")
      .eq("id", syncRunId)
      .maybeSingle();
    if (runError) throw new Error(runError.message);
    if (!runRow) return jsonResponse(404, { error: "Run nao encontrado." });
    if ((runRow as SyncRunRow).status !== "running") {
      return jsonResponse(200, { sync_run_id: syncRunId, status: (runRow as SyncRunRow).status });
    }

    await touchDailyLock();
    const previousByCode = await getPreviousByCode(30, syncRunId);
    const snapshotAt = nowIso();
    const snapshotDate = snapshotAt.slice(0, 10);
    const startedAt = Date.now();

    let processedInLoop = 0;
    while (Date.now() - startedAt < KPI_WORKER_TIME_BUDGET_MS) {
      const claims = await claimNextItems(syncRunId, workerId);
      if (claims.length === 0) break;
      processedInLoop += claims.length;
      const queue = [...claims];

      while (queue.length > 0) {
        const chunk = queue.splice(0, KPI_REQUEST_CONCURRENCY);
        await Promise.allSettled(chunk.map((item) => processSingleCode({
          syncRunId,
          workerId,
          item,
          source: String((runRow as SyncRunRow).source ?? "api_daily"),
          periodDays: 30,
          snapshotAt,
          snapshotDate,
          previousByCode,
        })));
      }

      const progress = await updateRunProgressFromItems(syncRunId);
      if (progress.remaining === 0) break;
      await sleep(25);
    }

    const finished = await finalizeRunIfDone(syncRunId);
    if (!finished) {
      await updateRunProgressFromItems(syncRunId);
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
    return jsonResponse(200, { sync_run_id: syncRunId, status: "success" });
  } catch (error) {
    await supabase.from("kpi_sync_runs").update({
      status: "failed",
      finished_at: nowIso(),
      error_message: error instanceof Error ? error.message : "Falha no worker KPI.",
      current_code: null,
      current_stage: null,
      current_code_started_at: null,
      current_attempt: null,
    }).eq("id", syncRunId).catch(() => undefined);
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
  if (body.mode === "stop") return await stopDailySync(body);
  if (body.mode === "continue" || body.sync_run_id) return await continueDailySync(req, body);
  return await startDailySync(req, body);
});
