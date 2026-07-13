import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ODONTOART_EMPRESA_URL = "https://odontoart.s4e.com.br/api/empresa/BuscaEmpresas";
const ODONTOART_TIMEOUT_MS = 6000;
const ODONTOART_MAX_ATTEMPTS = 2;
const KPI_BATCH_SIZE = 50;
const KPI_PROGRESS_FLUSH_EVERY = 10;
const PROCESSED_CODES_PAGE_SIZE = 1000;
const STALE_RUNNING_LIMIT_MS = 15 * 60 * 1000;

const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
const odontoartToken = Deno.env.get("ODONTOART_TOKEN")?.trim() || Deno.env.get("VITE_ODONTOART_TOKEN")?.trim() || "";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

type KpiStatus = "inativo" | "so_perda" | "queda" | "crescimento" | "so_venda" | "neutro";

type SyncResult = {
  code: string;
  vidasQtde: number;
  empresa: string | null;
};

type KpiSnapshotInsertRow = {
  sync_run_id: string;
  source: "api_daily" | "manual_sync" | "manual_test" | "manual_initial_load";
  period_days: number;
  codigo: string;
  empresa: string | null;
  categoria: "Neutro";
  vidas_qtde: number;
  status: KpiStatus;
  snapshot_at: string;
  snapshot_date: string;
  previous_vidas_qtde: number | null;
  delta: number;
  vendas_qtde: number;
  cancelamentos_qtde: number;
  synced_by_user_id: null;
};

type KpiSyncRunErrorInsertRow = {
  sync_run_id: string;
  codigo: string;
  stage: string;
  error_message: string;
  http_status: number | null;
  payload_preview: string | null;
};

type RunProgressUpdate = {
  total_codes?: number;
  processed_codes?: number;
  changed_codes?: number;
  failed_codes?: number;
  current_code?: string | null;
  current_stage?: string | null;
  current_code_started_at?: string | null;
  current_attempt?: number | null;
  last_progress_at?: string | null;
};

type KpiSyncRequestBody = {
  source?: string;
  triggered_by?: string;
  limit?: number;
};

type FetchErpResult = {
  httpStatus: number;
  payload: unknown;
};

type ErpRecord = Record<string, unknown>;

type ExtractedEmpresa =
  | {
      empresa: ErpRecord;
      hasDadosArray: boolean;
      dadosLength: number;
      empresaKeys: string[];
      hasAssociadoTitular: boolean;
    }
  | null;

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const normalizeCode = (value: unknown) => String(value ?? "").replace(/\.0+$/, "").trim();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const withHardTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) => {
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

const updateRunState = async (syncRunId: string, payload: RunProgressUpdate) => {
  const { error } = await supabase.from("kpi_sync_runs").update(payload).eq("id", syncRunId);
  if (error) throw new Error(error.message);
};

const buildCodigoCandidates = (rawCodigo: string) => {
  const trimmed = rawCodigo.trim();
  const numeric = /^\d+$/.test(trimmed);
  return Array.from(new Set([trimmed, numeric ? trimmed.replace(/^0+/, "") : "", numeric ? String(Number(trimmed)) : ""].filter(Boolean)));
};

const extractEmpresaFromPayload = (payload: unknown): ExtractedEmpresa => {
  if (Array.isArray(payload)) {
    const first = payload[0];
    if (!first || typeof first !== "object") return null;
    const empresa = first as ErpRecord;
    return {
      empresa,
      hasDadosArray: false,
      dadosLength: payload.length,
      empresaKeys: Object.keys(empresa),
      hasAssociadoTitular: readRecordValueByKeyInsensitive(empresa, "AssociadoTitular") !== undefined,
    };
  }

  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const dados = record.dados;
  if (Array.isArray(dados)) {
    const first = dados[0];
    if (!first || typeof first !== "object") return null;
    const empresa = first as ErpRecord;
    return {
      empresa,
      hasDadosArray: true,
      dadosLength: dados.length,
      empresaKeys: Object.keys(empresa),
      hasAssociadoTitular: readRecordValueByKeyInsensitive(empresa, "AssociadoTitular") !== undefined,
    };
  }

  if (dados && typeof dados === "object") {
    const empresa = dados as ErpRecord;
    return {
      empresa,
      hasDadosArray: false,
      dadosLength: 1,
      empresaKeys: Object.keys(empresa),
      hasAssociadoTitular: readRecordValueByKeyInsensitive(empresa, "AssociadoTitular") !== undefined,
    };
  }

  return null;
};

const readRecordValueByKeyInsensitive = (record: ErpRecord, key: string) => {
  if (key in record) return record[key];
  const foundKey = Object.keys(record).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return foundKey ? record[foundKey] : undefined;
};

const parseAssociadoTitular = (empresa: ErpRecord) => {
  const direct = readRecordValueByKeyInsensitive(empresa, "AssociadoTitular");
  const parsed =
    typeof direct === "number"
      ? direct
      : typeof direct === "string"
        ? Number(
            direct
              .trim()
              .replace(/\./g, "")
              .replace(",", "."),
          )
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

const previewPayload = (payload: unknown) => {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === "string") return payload.slice(0, 500);
  try {
    return JSON.stringify(payload).slice(0, 500);
  } catch {
    return "[unserializable-payload]";
  }
};

const fetchOdontoartPayload = async (codigo: string): Promise<FetchErpResult> => {
  const candidates = buildCodigoCandidates(codigo);
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    for (let attempt = 1; attempt <= ODONTOART_MAX_ATTEMPTS; attempt += 1) {
      const search = new URLSearchParams({ token: odontoartToken, empresaId: candidate });
      const controller = new AbortController();

      try {
        console.info("[kpi-sync-daily] fetch_erp", { code: codigo, candidate, attempt });
        const response = await withHardTimeout(
          fetch(`${ODONTOART_EMPRESA_URL}?${search.toString()}`, {
            method: "GET",
            headers: { Accept: "application/json", "Cache-Control": "no-store" },
            signal: controller.signal,
          }),
          ODONTOART_TIMEOUT_MS,
          `Timeout ao consultar ERP (${ODONTOART_TIMEOUT_MS}ms).`,
        );

        const text = await withHardTimeout(
          response.text(),
          ODONTOART_TIMEOUT_MS,
          `Timeout ao ler resposta do ERP (${ODONTOART_TIMEOUT_MS}ms).`,
        );

        let payload: unknown = null;
        if (text.trim().length > 0) {
          try {
            payload = JSON.parse(text);
          } catch {
            payload = text;
          }
        }

        console.info("[kpi-sync-daily] erp_response", {
          code: codigo,
          httpStatus: response.status,
          emptyPayload: payload === null || payload === "" || (Array.isArray(payload) && payload.length === 0),
        });

        if (!response.ok) {
          throw new Error(`Falha ao consultar ERP (${response.status}).`);
        }

        return { httpStatus: response.status, payload };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Erro de comunicacao com ERP.");
        controller.abort();
        const retryable = /Timeout|AbortError|network|fetch|failed/i.test(`${lastError.name} ${lastError.message}`);
        if (!retryable || attempt >= ODONTOART_MAX_ATTEMPTS) break;
        await sleep(250 * attempt);
      }
    }
  }

  throw lastError ?? new Error("Erro de comunicacao com ERP.");
};

const buildManualLog = async (action: string, status: "success" | "error", details: Record<string, unknown>) => {
  const { error } = await supabase.from("erp_sync_manual_logs").insert({
    action,
    status,
    details,
    user_id: null,
  });
  if (error) throw new Error(error.message);
};

const recordRunError = async (row: KpiSyncRunErrorInsertRow) => {
  const { error } = await supabase.from("kpi_sync_run_errors").insert(row);
  if (error) throw new Error(error.message);
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
    const batch = (data ?? [])
      .map((row) => normalizeCode((row as { codigo: string | null }).codigo))
      .filter(Boolean);
    codes.push(...batch);
    if (batch.length < 1000) break;
  }
  return Array.from(new Set(codes)).sort((a, b) => a.localeCompare(b));
};

const releaseStaleRuns = async () => {
  const staleThreshold = new Date(Date.now() - STALE_RUNNING_LIMIT_MS).toISOString();
  const { data, error } = await supabase
    .from("kpi_sync_runs")
    .select("id, started_at, last_progress_at, processed_codes")
    .eq("status", "running")
    .lt("last_progress_at", staleThreshold);
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const runId = String((row as { id: string }).id ?? "").trim();
    if (!runId) continue;
    const { error: updateError } = await supabase
      .from("kpi_sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: "Execucao antiga liberada antes do novo agendamento.",
      })
      .eq("id", runId);
    if (updateError) throw new Error(updateError.message);
  }
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
    if (Number.isFinite(acquiredAt) && now.getTime() - acquiredAt > STALE_RUNNING_LIMIT_MS) {
      await releaseStaleRuns();
      const { error: deleteError } = await supabase.from("kpi_sync_locks").delete().eq("lock_name", "kpi_daily");
      if (deleteError) throw new Error(deleteError.message);
    } else {
      throw new Error("Ja existe uma execucao KPI diaria em andamento.");
    }
  }

  const { error: insertError } = await supabase.from("kpi_sync_locks").insert({
    lock_name: "kpi_daily",
    acquired_at: now.toISOString(),
    acquired_by: "kpi-sync-daily",
  });
  if (insertError) throw new Error("Ja existe uma execucao KPI diaria em andamento.");
};

const releaseDailyLock = async () => {
  const { error } = await supabase.from("kpi_sync_locks").delete().eq("lock_name", "kpi_daily");
  if (error) throw new Error(error.message);
};

const getPreviousByCode = async (periodDays: number) => {
  const { data, error } = await supabase
    .from("kpi_sync_snapshots")
    .select("codigo, vidas_qtde, snapshot_at, sync_run_id, source")
    .eq("period_days", periodDays)
    .not("sync_run_id", "is", null)
    .in("source", ["api_daily", "manual_sync", "manual_upload"])
    .order("snapshot_at", { ascending: false });
  if (error) throw new Error(error.message);

  const previousByCode = new Map<string, number>();
  (data ?? []).forEach((item) => {
    const codigo = normalizeCode((item as { codigo: string | null }).codigo);
    if (!codigo || previousByCode.has(codigo)) return;
    const vidasQtde = Number((item as { vidas_qtde: number | null }).vidas_qtde);
    if (!Number.isFinite(vidasQtde)) return;
    previousByCode.set(codigo, vidasQtde);
  });
  return previousByCode;
};

const getSnapshotDeltaPayload = (current: number | null, previous: number | null) => {
  const currentValue = Number(current ?? 0);
  const previousValue = Number(previous ?? 0);
  const delta = currentValue - previousValue;
  return {
    previous_vidas_qtde: previous,
    delta,
    vendas_qtde: delta > 0 ? delta : 0,
    cancelamentos_qtde: delta < 0 ? Math.abs(delta) : 0,
  };
};

const resolveKpiStatus = (vendas: number, cancelamentos: number): KpiStatus => {
  if (vendas === 0 && cancelamentos === 0) return "inativo";
  if (vendas === 0 && cancelamentos > 0) return "so_perda";
  if (vendas > 0 && cancelamentos === 0) return "so_venda";
  if (vendas > cancelamentos) return "crescimento";
  if (cancelamentos > vendas) return "queda";
  return "neutro";
};

const buildStatusFromDelta = (vendas: number, cancelamentos: number): KpiStatus =>
  resolveKpiStatus(vendas, cancelamentos);

const buildSnapshotRow = (
  syncRunId: string,
  snapshotAt: string,
  snapshotDate: string,
  periodDays: number,
  source: KpiSnapshotInsertRow["source"],
  row: SyncResult,
  previous: number,
): KpiSnapshotInsertRow => {
  const deltaPayload = getSnapshotDeltaPayload(row.vidasQtde, previous);
  return {
    sync_run_id: syncRunId,
    source,
    period_days: periodDays,
    codigo: row.code,
    empresa: row.empresa,
    categoria: "Neutro",
    vidas_qtde: row.vidasQtde,
    status: buildStatusFromDelta(deltaPayload.vendas_qtde, deltaPayload.cancelamentos_qtde),
    snapshot_at: snapshotAt,
    snapshot_date: snapshotDate,
    previous_vidas_qtde: previous,
    delta: deltaPayload.delta,
    vendas_qtde: deltaPayload.vendas_qtde,
    cancelamentos_qtde: deltaPayload.cancelamentos_qtde,
    synced_by_user_id: null,
  };
};

const buildFirstLoadSnapshotRow = (
  syncRunId: string,
  snapshotAt: string,
  snapshotDate: string,
  periodDays: number,
  source: KpiSnapshotInsertRow["source"],
  row: SyncResult,
): KpiSnapshotInsertRow => ({
  sync_run_id: syncRunId,
  source,
  period_days: periodDays,
  codigo: row.code,
  empresa: row.empresa,
  categoria: "Neutro",
  vidas_qtde: row.vidasQtde,
  status: "inativo",
  snapshot_at: snapshotAt,
  snapshot_date: snapshotDate,
  previous_vidas_qtde: row.vidasQtde,
  delta: 0,
  vendas_qtde: 0,
  cancelamentos_qtde: 0,
  synced_by_user_id: null,
});

const upsertClientesForCode = async (code: string, vidasQtde: number) => {
  const { error } = await supabase
    .from("clientes")
    .update({ vidas_qtde: vidasQtde })
    .eq("codigo", code);
  if (error) throw new Error(error.message);
};

const markRunFinished = async (
  syncRunId: string,
  status: "success" | "failed",
  payload: Record<string, unknown>,
) => {
  const { error } = await supabase
    .from("kpi_sync_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      ...payload,
    })
    .eq("id", syncRunId);
  if (error) throw new Error(error.message);
};

const updateRunProgress = async (
  syncRunId: string,
  payload: Record<string, unknown>,
) => {
  const { error } = await supabase
    .from("kpi_sync_runs")
    .update(payload)
    .eq("id", syncRunId);

  if (error) {
    throw new Error(
      `Falha ao atualizar progresso do run ${syncRunId}: ${error.message}`,
    );
  }
};

const updateRunLastProgress = async (syncRunId: string) => {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("kpi_sync_runs")
    .update({ last_progress_at: now })
    .eq("id", syncRunId);
  if (error) throw new Error(error.message);
};

const findRunningSyncRun = async () => {
  const { data, error } = await supabase
    .from("kpi_sync_runs")
    .select("id, total_codes, processed_codes, changed_codes, failed_codes, started_at, last_progress_at")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as
    | {
        id: string;
        total_codes: number | null;
        processed_codes: number | null;
        changed_codes: number | null;
        failed_codes: number | null;
        started_at: string;
        last_progress_at: string | null;
      }
    | null;
};

const loadProcessedCodesForRun = async (syncRunId: string) => {
  const loadCodesForRun = async (table: "kpi_sync_snapshots" | "kpi_sync_run_errors") => {
    const result = new Set<string>();

    for (let offset = 0; ; offset += PROCESSED_CODES_PAGE_SIZE) {
      const { data, error } = await supabase
        .from(table)
        .select("codigo")
        .eq("sync_run_id", syncRunId)
        .order("codigo", { ascending: true })
        .range(offset, offset + PROCESSED_CODES_PAGE_SIZE - 1);
      if (error) throw new Error(`Falha ao carregar codigos de ${table}: ${error.message}`);

      const rows = data ?? [];
      rows.forEach((item) => {
        const codigo = normalizeCode((item as { codigo: string | null }).codigo);
        if (codigo) result.add(codigo);
      });

      if (rows.length < PROCESSED_CODES_PAGE_SIZE) break;
    }

    return result;
  };

  const [snapshotCodes, errorCodes] = await Promise.all([
    loadCodesForRun("kpi_sync_snapshots"),
    loadCodesForRun("kpi_sync_run_errors"),
  ]);

  const processed = new Set<string>(snapshotCodes);
  for (const codigo of errorCodes) {
    processed.add(codigo);
  }
  return processed;
};

const parseRequestBody = async (req: Request): Promise<KpiSyncRequestBody> => {
  try {
    const body = (await req.json()) as KpiSyncRequestBody;
    return {
      source: typeof body.source === "string" ? body.source : undefined,
      triggered_by: typeof body.triggered_by === "string" ? body.triggered_by : undefined,
      limit: typeof body.limit === "number" && Number.isFinite(body.limit) ? Math.max(1, Math.floor(body.limit)) : undefined,
    };
  } catch (error) {
    if (error instanceof SyntaxError) return {};
    throw error;
  }
};

const runDailySync = async (req: Request) => {
  const body = await parseRequestBody(req);
  const headerSource = req.headers.get("x-kpi-source")?.trim() || "";
  const source = body.source?.trim() || headerSource || "api_daily";
  const triggeredBy = body.triggered_by?.trim() || "cron";
  const limit = typeof body.limit === "number" ? Math.min(50, body.limit) : undefined;
  const snapshotAt = new Date().toISOString();
  const snapshotDate = snapshotAt.slice(0, 10);
  const periodDays = 30;
  let syncRunId = "";
  let totalCodes = 0;
  let processedCodes = 0;
  let changedCodes = 0;
  let failedCodes = 0;
  const sampleErrors: Array<Record<string, unknown>> = [];
  const successRows: SyncResult[] = [];
  const stageLimitLabel = typeof limit === "number" ? limit : null;

  if (!odontoartToken) {
    throw new Error("ODONTOART_TOKEN nao configurado.");
  }

  console.info("[kpi-sync-daily] start", { source, triggeredBy, limit: stageLimitLabel });

  await acquireDailyLock();

  try {
    await releaseStaleRuns();

    const runningRun = await findRunningSyncRun();
    if (runningRun) {
      syncRunId = runningRun.id;
      totalCodes = Number(runningRun.total_codes ?? 0);
      processedCodes = Number(runningRun.processed_codes ?? 0);
      changedCodes = Number(runningRun.changed_codes ?? 0);
      failedCodes = Number(runningRun.failed_codes ?? 0);
    } else {
    const { data: runData, error: runError } = await supabase
        .from("kpi_sync_runs")
        .insert({
          source,
          status: "running",
          started_at: snapshotAt,
          last_progress_at: snapshotAt,
          current_code: null,
          total_codes: 0,
          processed_codes: 0,
          changed_codes: 0,
          failed_codes: 0,
        })
        .select("id")
        .single();
      if (runError) throw new Error(runError.message);
      syncRunId = String((runData as { id: string }).id);
    }

    const codes = await loadDistinctCodes();
    totalCodes = codes.length;
    const processedCodesSet = await loadProcessedCodesForRun(syncRunId);
    const pendingCodes = codes.filter((code) => !processedCodesSet.has(code));
    // `limit` is only for manual throttling; the daily cron must process all pendings by default.
    const codesToProcess = typeof limit === "number" ? pendingCodes.slice(0, limit) : pendingCodes;

    await updateRunProgress(syncRunId, {
      total_codes: totalCodes,
      processed_codes: processedCodes,
      changed_codes: changedCodes,
      failed_codes: failedCodes,
    });
    await updateRunLastProgress(syncRunId);

    if (totalCodes === 0) {
      await markRunFinished(syncRunId, "success", {
        processed_codes: 0,
        changed_codes: 0,
        failed_codes: 0,
      });
      await buildManualLog("kpi-daily", "success", {
        sync_run_id: syncRunId,
        total_codes: 0,
        processed_codes: 0,
        changed_codes: 0,
        failed_codes: 0,
      });
      return jsonResponse(200, {
        sync_run_id: syncRunId,
        total_codes: 0,
        processed_codes: 0,
        success_codes: 0,
        failed_codes: 0,
        sample_errors: [],
      });
    }

    const previousByCode = await getPreviousByCode(periodDays);
    const batchCount = Math.ceil(codesToProcess.length / KPI_BATCH_SIZE);
    let processedSinceFlush = 0;

    const flushProgress = async () => {
      await updateRunState(syncRunId, {
        total_codes: totalCodes,
        processed_codes: processedCodes,
        changed_codes: changedCodes,
        failed_codes: failedCodes,
        current_code: null,
        current_stage: "progress_flush",
        current_code_started_at: null,
        current_attempt: null,
      });
      await updateRunLastProgress(syncRunId);
      processedSinceFlush = 0;
    };

    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      const batch = codesToProcess.slice(batchIndex * KPI_BATCH_SIZE, (batchIndex + 1) * KPI_BATCH_SIZE);
      const batchProcessed: SyncResult[] = [];
      const batchSnapshots: KpiSnapshotInsertRow[] = [];
      let batchFailures = 0;

      for (const code of batch) {
        const codeStartedAt = new Date().toISOString();
        try {
          await updateRunState(syncRunId, {
            current_code: code,
            current_stage: "fetch_erp",
            current_code_started_at: codeStartedAt,
            current_attempt: 1,
          });
          await updateRunLastProgress(syncRunId);
          console.info("[kpi-sync-daily] codigo_consultado", { syncRunId, code, stage: "fetch_erp" });
          const { httpStatus, payload } = await fetchOdontoartPayload(code);
          await updateRunState(syncRunId, {
            current_code: code,
            current_stage: "parse_payload",
            current_code_started_at: codeStartedAt,
            current_attempt: ODONTOART_MAX_ATTEMPTS,
          });
          const emptyPayload = payload === null || payload === undefined || payload === "" || (Array.isArray(payload) && payload.length === 0);
          if (emptyPayload) {
            console.info("[kpi-sync-daily] payload_vazio", { code, httpStatus });
            batchFailures += 1;
            failedCodes += 1;
            await recordRunError({
              sync_run_id: syncRunId,
              codigo: code,
              stage: "empty_payload",
              error_message: "Payload vazio retornado pela API do ERP.",
              http_status: httpStatus,
              payload_preview: previewPayload(payload),
            });
            sampleErrors.push({ codigo: code, stage: "empty_payload", error_message: "Payload vazio retornado pela API do ERP.", http_status: httpStatus });
            continue;
          }

          const extracted = extractEmpresaFromPayload(payload);
          await updateRunState(syncRunId, {
            current_code: code,
            current_stage: "validate_contract",
            current_code_started_at: codeStartedAt,
            current_attempt: ODONTOART_MAX_ATTEMPTS,
          });
          console.info("[kpi-sync-daily] payload_contract", {
            code,
            has_dados_array: extracted?.hasDadosArray ?? false,
            dados_length: extracted?.dadosLength ?? 0,
            empresa_keys: extracted?.empresaKeys ?? [],
            has_associado_titular: extracted?.hasAssociadoTitular ?? false,
          });

          if (!extracted) {
            batchFailures += 1;
            failedCodes += 1;
            await recordRunError({
              sync_run_id: syncRunId,
              codigo: code,
              stage: "missing_empresa",
              error_message: "Empresa ausente no payload do ERP.",
              http_status: httpStatus,
              payload_preview: previewPayload(payload),
            });
            sampleErrors.push({ codigo: code, stage: "missing_empresa", error_message: "Empresa ausente no payload do ERP.", http_status: httpStatus });
            continue;
          }

          const empresa = extracted.empresa;
          const empresaNome = parseEmpresaName(empresa);
          await updateRunState(syncRunId, {
            current_code: code,
            current_stage: "extract_fields",
            current_code_started_at: codeStartedAt,
            current_attempt: ODONTOART_MAX_ATTEMPTS,
          });
          if (!empresaNome) {
            console.info("[kpi-sync-daily] missing_empresa", { code, httpStatus });
            batchFailures += 1;
            failedCodes += 1;
            await recordRunError({
              sync_run_id: syncRunId,
              codigo: code,
              stage: "missing_empresa",
              error_message: "Empresa ausente no payload do ERP.",
              http_status: httpStatus,
              payload_preview: previewPayload(payload),
            });
            sampleErrors.push({ codigo: code, stage: "missing_empresa", error_message: "Empresa ausente no payload do ERP.", http_status: httpStatus });
            continue;
          }

          const associadoTitularRaw = readRecordValueByKeyInsensitive(empresa, "AssociadoTitular");
          await updateRunState(syncRunId, {
            current_code: code,
            current_stage: "validate_associado_titular",
            current_code_started_at: codeStartedAt,
            current_attempt: ODONTOART_MAX_ATTEMPTS,
          });
          if (associadoTitularRaw === undefined || associadoTitularRaw === null || String(associadoTitularRaw).trim() === "") {
            console.info("[kpi-sync-daily] missing_associado_titular", { code, httpStatus });
            batchFailures += 1;
            failedCodes += 1;
            await recordRunError({
              sync_run_id: syncRunId,
              codigo: code,
              stage: "missing_associado_titular",
              error_message: "AssociadoTitular ausente no payload do ERP.",
              http_status: httpStatus,
              payload_preview: previewPayload(payload),
            });
            sampleErrors.push({ codigo: code, stage: "missing_associado_titular", error_message: "AssociadoTitular ausente no payload do ERP.", http_status: httpStatus });
            continue;
          }

          const vidasQtde = parseAssociadoTitular(empresa);
          if (vidasQtde === null) {
            console.info("[kpi-sync-daily] invalid_associado_titular", { code, httpStatus, associadoTitularRaw });
            batchFailures += 1;
            failedCodes += 1;
            await recordRunError({
              sync_run_id: syncRunId,
              codigo: code,
              stage: "invalid_associado_titular",
              error_message: "AssociadoTitular invalido no payload do ERP.",
              http_status: httpStatus,
              payload_preview: previewPayload(payload),
            });
            sampleErrors.push({ codigo: code, stage: "invalid_associado_titular", error_message: "AssociadoTitular invalido no payload do ERP.", http_status: httpStatus });
            continue;
          }

          const result: SyncResult = { code, vidasQtde, empresa: empresaNome };
          await updateRunState(syncRunId, {
            current_code: code,
            current_stage: "prepare_snapshot",
            current_code_started_at: codeStartedAt,
            current_attempt: ODONTOART_MAX_ATTEMPTS,
          });
          batchProcessed.push(result);
          if (previousByCode.has(code)) {
            batchSnapshots.push(
              buildSnapshotRow(
                syncRunId,
                snapshotAt,
                snapshotDate,
                periodDays,
                source as KpiSnapshotInsertRow["source"],
                result,
                previousByCode.get(code) ?? 0,
              ),
            );
          } else {
            batchSnapshots.push(
              buildFirstLoadSnapshotRow(
                syncRunId,
                snapshotAt,
                snapshotDate,
                periodDays,
                source as KpiSnapshotInsertRow["source"],
                result,
              ),
            );
          }
        } catch (error) {
          batchFailures += 1;
          failedCodes += 1;
          const message = error instanceof Error ? error.message : "Erro ao consultar ERP.";
          await recordRunError({
            sync_run_id: syncRunId,
            codigo: code,
            stage: "fetch_erp",
            error_message: message,
            http_status: null,
            payload_preview: null,
          });
          sampleErrors.push({ codigo: code, stage: "fetch_erp", error_message: message });
        }

        processedSinceFlush += 1;
        if (processedSinceFlush >= KPI_PROGRESS_FLUSH_EVERY) {
          await flushProgress();
        }
      }

      if (batchIndex === 0 && batchFailures === batch.length) {
        await markRunFinished(syncRunId, "failed", {
          processed_codes: processedCodes,
          changed_codes: changedCodes,
          failed_codes: failedCodes,
          current_code: null,
          current_stage: null,
          current_code_started_at: null,
          current_attempt: null,
          error_message: "Primeiro lote falhou 100%. Verifique token, API ERP ou contrato do AssociadoTitular.",
        });
        await buildManualLog("kpi-daily", "error", {
          sync_run_id: syncRunId,
          total_codes: totalCodes,
          processed_codes: processedCodes,
          changed_codes: changedCodes,
          failed_codes: failedCodes,
          error: "Primeiro lote falhou 100%. Verifique token, API ERP ou contrato do AssociadoTitular.",
        });
        return jsonResponse(400, {
          sync_run_id: syncRunId,
          total_codes: totalCodes,
          processed_codes: processedCodes,
          success_codes: successRows.length,
          failed_codes: failedCodes,
          sample_errors: sampleErrors.slice(0, 10),
          error: "Primeiro lote falhou 100%. Verifique token, API ERP ou contrato do AssociadoTitular.",
        });
      }

      for (const result of batchProcessed) {
        try {
          await upsertClientesForCode(result.code, result.vidasQtde);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Erro ao atualizar clientes.";
          batchFailures += 1;
          failedCodes += 1;
          await recordRunError({
            sync_run_id: syncRunId,
            codigo: result.code,
            stage: "update_clientes",
            error_message: message,
            http_status: null,
            payload_preview: null,
          });
          sampleErrors.push({ codigo: result.code, stage: "update_clientes", error_message: message });
        }
      }

      if (batchSnapshots.length > 0) {
        const existingKeys = new Set<string>();
        const { data: existingSnapshots, error: existingError } = await supabase
          .from("kpi_sync_snapshots")
          .select("codigo")
          .eq("sync_run_id", syncRunId)
          .in(
            "codigo",
            batchSnapshots.map((row) => row.codigo),
          );
        if (existingError) throw new Error(existingError.message);
        (existingSnapshots ?? []).forEach((item) => {
          const codigo = normalizeCode((item as { codigo: string | null }).codigo);
          if (codigo) existingKeys.add(codigo);
        });

        const insertableSnapshots = batchSnapshots.filter((row) => !existingKeys.has(row.codigo));
        if (insertableSnapshots.length > 0) {
          const { error: insertError } = await supabase.from("kpi_sync_snapshots").insert(insertableSnapshots);
          if (insertError) {
            for (const row of insertableSnapshots) {
              await recordRunError({
                sync_run_id: syncRunId,
                codigo: row.codigo,
                stage: "insert_snapshot",
                error_message: insertError.message,
                http_status: null,
                payload_preview: null,
              });
              sampleErrors.push({ codigo: row.codigo, stage: "insert_snapshot", error_message: insertError.message });
            }
            throw new Error(insertError.message);
          }
        }
      }

      changedCodes += batchSnapshots.filter((row) => row.delta !== 0).length;
      successRows.push(...batchProcessed);

      const persistedCodes = await loadProcessedCodesForRun(syncRunId);
      processedCodes = Math.min(totalCodes, persistedCodes.size);
      const remainingCodes = codes.filter((code) => !persistedCodes.has(code));

      await flushProgress();

      console.info("[kpi-sync-daily] batch_progress", {
        syncRunId,
        batchIndex: batchIndex + 1,
        batchCount,
        processedCodes,
        failedCodes,
      });

      if (remainingCodes.length === 0) break;
    }

    const finalProcessedCodes = await loadProcessedCodesForRun(syncRunId);
    processedCodes = Math.min(totalCodes, finalProcessedCodes.size);
    const remainingCodes = codes.filter((code) => !finalProcessedCodes.has(code));
    if (remainingCodes.length === 0) {
      await markRunFinished(syncRunId, "success", {
        total_codes: totalCodes,
        processed_codes: processedCodes,
        changed_codes: changedCodes,
        failed_codes: failedCodes,
        current_code: null,
        current_stage: null,
        current_code_started_at: null,
        current_attempt: null,
      });
    }

    await buildManualLog("kpi-daily", "success", {
      sync_run_id: syncRunId,
      source,
      triggered_by: triggeredBy,
      total_codes: totalCodes,
      processed_codes: processedCodes,
      changed_codes: changedCodes,
      failed_codes: failedCodes,
      sample_errors: sampleErrors.slice(0, 20),
    });

    return jsonResponse(200, {
      sync_run_id: syncRunId,
      total_codes: totalCodes,
      processed_codes: processedCodes,
      success_codes: successRows.length,
      failed_codes: failedCodes,
      remaining_codes: remainingCodes.length,
      sample_errors: sampleErrors.slice(0, 10),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na sincronizacao diaria KPI.";
    if (syncRunId) {
      await updateRunProgress(syncRunId, {
        total_codes: totalCodes,
        processed_codes: processedCodes,
        changed_codes: changedCodes,
        failed_codes: failedCodes,
      });
      await updateRunState(syncRunId, {
        current_code: null,
        current_stage: null,
        current_code_started_at: null,
        current_attempt: null,
      });
      await updateRunLastProgress(syncRunId);
      await buildManualLog("kpi-daily", "error", {
        sync_run_id: syncRunId,
        error: message,
        processed_codes: processedCodes,
        changed_codes: changedCodes,
        failed_codes: failedCodes,
      });
    }
    return jsonResponse(400, { error: message, sync_run_id: syncRunId || null });
  } finally {
    await releaseDailyLock();
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Metodo nao permitido." });

  try {
    return await runDailySync(req);
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : "Falha na sincronizacao diaria KPI." });
  }
});
