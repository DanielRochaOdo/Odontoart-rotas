import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type SyncKey = "visits" | "aceite_digital" | "clientes" | "profiles";

type SyncStateRow = {
  table_name: SyncKey;
  last_updated_at: string;
  last_id: string;
};

type SyncResult = {
  table: SyncKey;
  rowsRead: number;
  rowsWritten: number;
  lastUpdatedAt: string;
  lastId: string;
};

type DeleteReconcileResult = {
  rowsRead: number;
  rowsApplied: number;
  lastUpdatedAt: string;
  lastId: string;
};

type SyncConfig = {
  key: SyncKey;
  sourceTable: string;
  sourceColumns: string;
  targetTable: string;
  onConflict: string;
  idColumn: string;
  defaultBatchSize: number;
  mapRow?: (row: Record<string, unknown>) => Record<string, unknown>;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRIMARY_URL = Deno.env.get("PRIMARY_SUPABASE_URL")?.trim() ?? "";
const PRIMARY_SERVICE_ROLE_KEY = Deno.env.get("PRIMARY_SERVICE_ROLE_KEY")?.trim() ?? "";
const DASH_URL = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
const DASH_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET")?.trim() ?? "";
const SAFETY_LAG_SECONDS_RAW = Deno.env.get("DASH_SYNC_SAFETY_LAG_SECONDS")?.trim() ?? "";
const DASH_SYNC_TABLES_RAW = Deno.env.get("DASH_SYNC_TABLES")?.trim() ?? "";

const missingEnv: string[] = [];
if (!CRON_SECRET) missingEnv.push("CRON_SECRET");
if (!PRIMARY_URL) missingEnv.push("PRIMARY_SUPABASE_URL");
if (!PRIMARY_SERVICE_ROLE_KEY) missingEnv.push("PRIMARY_SERVICE_ROLE_KEY");
if (!DASH_URL) missingEnv.push("SUPABASE_URL");
if (!DASH_SERVICE_ROLE_KEY) missingEnv.push("SUPABASE_SERVICE_ROLE_KEY");
if (!SAFETY_LAG_SECONDS_RAW) missingEnv.push("DASH_SYNC_SAFETY_LAG_SECONDS");
if (!DASH_SYNC_TABLES_RAW) missingEnv.push("DASH_SYNC_TABLES");
if (missingEnv.length > 0) {
  throw new Error(`Missing required env vars: ${missingEnv.join(", ")}`);
}

const primary = createClient(PRIMARY_URL, PRIMARY_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const dash = createClient(DASH_URL, DASH_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EPOCH = "1970-01-01T00:00:00Z";
const MODE = "incremental";
const DEFAULT_BATCH = Number(Deno.env.get("DASH_SYNC_BATCH_SIZE") ?? "1000");
const SAFETY_LAG_SECONDS = Number(SAFETY_LAG_SECONDS_RAW);
const LOCK_TTL_SECONDS = Number(Deno.env.get("DASH_SYNC_LOCK_TTL_SECONDS") ?? "600");
const TABLES_FILTER = new Set(
  DASH_SYNC_TABLES_RAW
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean),
);
if (!Number.isFinite(SAFETY_LAG_SECONDS) || SAFETY_LAG_SECONDS < 0) {
  throw new Error("Invalid DASH_SYNC_SAFETY_LAG_SECONDS");
}

const TABLES: SyncConfig[] = [
  {
    key: "visits",
    sourceTable: "visits",
    sourceColumns:
      "id, cliente_id, visit_date, perfil_visita, visit_type, supervisor_reason, register_mode, completed_at, no_visit_reason, assigned_to_user_id, assigned_to_name, completed_vidas, deleted_at, created_at, updated_at",
    targetTable: "dash_visits",
    onConflict: "id",
    idColumn: "id",
    defaultBatchSize: 1000,
  },
  {
    key: "aceite_digital",
    sourceTable: "aceite_digital",
    sourceColumns: "id, entry_date, vendor_user_id, vendor_name, vidas, deleted_at, created_at, updated_at",
    targetTable: "dash_aceite_digital",
    onConflict: "source_id",
    idColumn: "id",
    defaultBatchSize: 1000,
    mapRow: (row) => ({
      source_id: row.id ?? null,
      entry_date: row.entry_date ?? null,
      vendor_user_id: row.vendor_user_id ?? null,
      vendor_name: row.vendor_name ?? null,
      vidas: row.vidas ?? null,
      deleted_at: row.deleted_at ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
    }),
  },
  {
    key: "clientes",
    sourceTable: "clientes",
    sourceColumns:
      "id, codigo, empresa, nome_fantasia, data_da_ultima_visita, cidade, bairro, uf, situacao, vendedor, categoria, grupo, deleted_at, created_at, updated_at",
    targetTable: "dash_clientes",
    onConflict: "id",
    idColumn: "id",
    defaultBatchSize: 1000,
  },
  {
    key: "profiles",
    sourceTable: "profiles",
    sourceColumns: "id, user_id, supervisor_id, role, display_name, nome, deleted_at, created_at, updated_at",
    targetTable: "dash_profiles",
    onConflict: "id",
    idColumn: "id",
    defaultBatchSize: 500,
  },
];

const DELETE_RECONCILE_KEY = "audit_logs_delete_reconcile";
const DELETE_TARGETS: Record<string, { targetTable: string; targetColumn: string }> = {
  visits: { targetTable: "dash_visits", targetColumn: "id" },
  aceite_digital: { targetTable: "dash_aceite_digital", targetColumn: "source_id" },
  clientes: { targetTable: "dash_clientes", targetColumn: "id" },
  profiles: { targetTable: "dash_profiles", targetColumn: "id" },
};

const nowIso = () => new Date().toISOString();
const toTextId = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const pickCursorTimestamp = (row: Record<string, unknown>) => {
  if (typeof row.updated_at === "string" && row.updated_at.length > 0) return row.updated_at;
  if (typeof row.created_at === "string" && row.created_at.length > 0) return row.created_at;
  return EPOCH;
};
const pickCutoff = () => new Date(Date.now() - SAFETY_LAG_SECONDS * 1000).toISOString();
const normalizeError = (error: unknown) => {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack ?? null };
  }
  if (error && typeof error === "object") {
    const asRecord = error as Record<string, unknown>;
    const message = typeof asRecord.message === "string"
      ? asRecord.message
      : typeof asRecord.error === "string"
        ? asRecord.error
        : JSON.stringify(asRecord);
    return { message, stack: null };
  }
  return { message: String(error), stack: null };
};
const extractBearerToken = (authorizationHeader: string) => {
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
};
const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
const listTablesToSync = () => (TABLES_FILTER.size === 0 ? TABLES : TABLES.filter((table) => TABLES_FILTER.has(table.key)));

const tryAcquireLock = async (ownerId: string) => {
  const { data, error } = await dash.rpc("dashboard_acquire_sync_lock", {
    p_lock_name: "dashboard_sync",
    p_owner_id: ownerId,
    p_ttl_seconds: LOCK_TTL_SECONDS,
  });
  if (error) throw error;
  return data === true;
};

const heartbeatLock = async (ownerId: string) => {
  const { data, error } = await dash.rpc("dashboard_heartbeat_sync_lock", {
    p_lock_name: "dashboard_sync",
    p_owner_id: ownerId,
    p_ttl_seconds: LOCK_TTL_SECONDS,
  });
  if (error) throw error;
  return data === true;
};

const releaseLock = async (ownerId: string) => {
  try {
    const { error } = await dash.rpc("dashboard_release_sync_lock", {
      p_lock_name: "dashboard_sync",
      p_owner_id: ownerId,
    });
    if (error) {
      console.error("[sync-dashboard] release_lock_failed", { step: "release_lock", message: error.message });
    }
  } catch (error) {
    console.error("[sync-dashboard] release_lock_exception", {
      step: "release_lock",
      message: error instanceof Error ? error.message : "Unknown release lock error",
    });
  }
};

const ensureSyncState = async (key: SyncKey) => {
  const { data, error } = await dash
    .from("dashboard_sync_state")
    .select("table_name,last_updated_at,last_id")
    .eq("table_name", key)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as SyncStateRow;

  const { error: insertError } = await dash.from("dashboard_sync_state").insert({
    table_name: key,
    last_updated_at: EPOCH,
    last_id: "",
    status: "idle",
    updated_at: nowIso(),
  });
  if (insertError) throw insertError;
  return { table_name: key, last_updated_at: EPOCH, last_id: "" } as SyncStateRow;
};

const ensureGenericSyncState = async (tableName: string) => {
  const { data, error } = await dash
    .from("dashboard_sync_state")
    .select("table_name,last_updated_at,last_id")
    .eq("table_name", tableName)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as { table_name: string; last_updated_at: string; last_id: string };

  const { error: insertError } = await dash.from("dashboard_sync_state").insert({
    table_name: tableName,
    last_updated_at: EPOCH,
    last_id: "",
    status: "idle",
    updated_at: nowIso(),
  });
  if (insertError) throw insertError;
  return { table_name: tableName, last_updated_at: EPOCH, last_id: "" };
};

const markTableRunning = async (key: SyncKey) => {
  const { error } = await dash
    .from("dashboard_sync_state")
    .update({
      status: "running",
      started_at: nowIso(),
      finished_at: null,
      last_error: null,
      updated_at: nowIso(),
    })
    .eq("table_name", key);
  if (error) throw error;
};

const markTableFinished = async (
  key: SyncKey,
  payload: {
    status: "idle" | "failed";
    lastUpdatedAt?: string;
    lastId?: string;
    rowsRead: number;
    rowsWritten: number;
    durationMs: number;
    errorMessage?: string;
  },
) => {
  const values: Record<string, unknown> = {
    status: payload.status,
    finished_at: nowIso(),
    rows_read: payload.rowsRead,
    rows_written: payload.rowsWritten,
    duration_ms: payload.durationMs,
    last_error: payload.errorMessage ?? null,
    updated_at: nowIso(),
  };
  if (payload.lastUpdatedAt) values.last_updated_at = payload.lastUpdatedAt;
  if (payload.lastId !== undefined) values.last_id = payload.lastId;

  const { error } = await dash.from("dashboard_sync_state").update(values).eq("table_name", key);
  if (error) throw error;
};

const createRun = async () => {
  const { data, error } = await dash
    .from("dashboard_sync_runs")
    .insert({
      mode: MODE,
      status: "running",
      source_project: PRIMARY_URL,
      target_project: DASH_URL,
      started_at: nowIso(),
      tables_synced: [],
      total_rows_read: 0,
      total_rows_written: 0,
      rows_deleted_reconciled: 0,
    })
    .select("id")
    .single();
  if (error) throw error;
  return Number(data.id);
};

const updateRun = async (
  runId: number,
  payload: {
    status: "ok" | "failed";
    totalRowsRead: number;
    totalRowsWritten: number;
    rowsDeletedReconciled: number;
    tablesSynced: Array<Record<string, unknown>>;
    startedAt: number;
    errorMessage?: string;
  },
) => {
  const finishedAt = Date.now();
  const { error } = await dash
    .from("dashboard_sync_runs")
    .update({
      status: payload.status,
      finished_at: new Date(finishedAt).toISOString(),
      duration_ms: finishedAt - payload.startedAt,
      total_rows_read: payload.totalRowsRead,
      total_rows_written: payload.totalRowsWritten,
      rows_deleted_reconciled: payload.rowsDeletedReconciled,
      tables_synced: payload.tablesSynced,
      error_message: payload.errorMessage ?? null,
    })
    .eq("id", runId);
  if (error) throw error;
};

const reconcilePhysicalDeletes = async (cutoff: string, lockOwnerId: string): Promise<DeleteReconcileResult> => {
  const state = await ensureGenericSyncState(DELETE_RECONCILE_KEY);
  let cursorTs = state.last_updated_at;
  let cursorId = state.last_id;
  let rowsRead = 0;
  let rowsApplied = 0;
  const batchSize = Number(Deno.env.get("DASH_SYNC_BATCH_DELETE_RECONCILE") ?? "500");

  while (true) {
    const cursorOr = `and(created_at.eq.${cursorTs},id.gt.${cursorId}),created_at.gt.${cursorTs}`;
    let query = primary
      .from("audit_logs")
      .select("id, table_name, record_id, action, created_at")
      .eq("action", "DELETE")
      .in("table_name", Object.keys(DELETE_TARGETS))
      .not("record_id", "is", null)
      .or(cursorOr)
      .lte("created_at", cutoff)
      .order("created_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true, nullsFirst: false })
      .limit(batchSize);

    if (cursorTs === EPOCH && cursorId === "") {
      query = primary
        .from("audit_logs")
        .select("id, table_name, record_id, action, created_at")
        .eq("action", "DELETE")
        .in("table_name", Object.keys(DELETE_TARGETS))
        .not("record_id", "is", null)
        .lte("created_at", cutoff)
        .order("created_at", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true, nullsFirst: false })
        .limit(batchSize);
    }

    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    if (batch.length === 0) break;

    rowsRead += batch.length;
    const deletedAt = nowIso();
    for (const row of batch) {
      const tableName = String(row.table_name ?? "");
      const recordId = String(row.record_id ?? "");
      const target = DELETE_TARGETS[tableName];
      if (!target || !recordId) continue;
      const { error: updateError } = await dash
        .from(target.targetTable)
        .update({ deleted_at: deletedAt, updated_at: deletedAt })
        .eq(target.targetColumn, recordId);
      if (updateError) throw updateError;
      rowsApplied += 1;
    }

    const last = batch[batch.length - 1];
    cursorTs = String(last.created_at ?? cursorTs);
    cursorId = String(last.id ?? cursorId);
    const { error: stateError } = await dash
      .from("dashboard_sync_state")
      .update({
        table_name: DELETE_RECONCILE_KEY,
        status: "idle",
        last_updated_at: cursorTs,
        last_id: cursorId,
        rows_read: rowsRead,
        rows_written: rowsApplied,
        finished_at: nowIso(),
        last_error: null,
        updated_at: nowIso(),
      })
      .eq("table_name", DELETE_RECONCILE_KEY);
    if (stateError) throw stateError;

    const lockOk = await heartbeatLock(lockOwnerId);
    if (!lockOk) throw new Error("sync lock lost during delete reconciliation");
    if (batch.length < batchSize) break;
  }

  return { rowsRead, rowsApplied, lastUpdatedAt: cursorTs, lastId: cursorId };
};

const syncOneTable = async (table: SyncConfig, cutoff: string, lockOwnerId: string): Promise<SyncResult> => {
  await ensureSyncState(table.key);
  await markTableRunning(table.key);

  const tableStart = Date.now();
  let rowsRead = 0;
  let rowsWritten = 0;

  try {
    const state = await ensureSyncState(table.key);
    let cursorTs = state.last_updated_at;
    let cursorId = state.last_id;
    const batchSize = Number(Deno.env.get(`DASH_SYNC_BATCH_${table.key.toUpperCase()}`) ?? String(table.defaultBatchSize ?? DEFAULT_BATCH));

    while (true) {
      const cursorOr = `and(updated_at.eq.${cursorTs},${table.idColumn}.gt.${cursorId}),updated_at.gt.${cursorTs}`;
      let query = primary
        .from(table.sourceTable)
        .select(table.sourceColumns)
        .or(cursorOr)
        .lte("updated_at", cutoff)
        .order("updated_at", { ascending: true, nullsFirst: false })
        .order(table.idColumn, { ascending: true, nullsFirst: false })
        .limit(batchSize);

      if (cursorTs === EPOCH && cursorId === "") {
        query = primary
          .from(table.sourceTable)
          .select(table.sourceColumns)
          .lte("updated_at", cutoff)
          .order("updated_at", { ascending: true, nullsFirst: false })
          .order(table.idColumn, { ascending: true, nullsFirst: false })
          .limit(batchSize);
      }

      const { data, error } = await query;
      if (error) throw error;
      const batch = (data ?? []) as Record<string, unknown>[];
      if (batch.length === 0) break;

      rowsRead += batch.length;
      const payload = table.mapRow ? batch.map((row) => table.mapRow!(row)) : batch;
      const { error: upsertError } = await dash.from(table.targetTable).upsert(payload, { onConflict: table.onConflict });
      if (upsertError) throw upsertError;
      rowsWritten += payload.length;

      const lastRow = batch[batch.length - 1];
      cursorTs = pickCursorTimestamp(lastRow);
      cursorId = toTextId(lastRow[table.idColumn]);

      await markTableFinished(table.key, {
        status: "idle",
        lastUpdatedAt: cursorTs,
        lastId: cursorId,
        rowsRead,
        rowsWritten,
        durationMs: Date.now() - tableStart,
      });

      const lockOk = await heartbeatLock(lockOwnerId);
      if (!lockOk) throw new Error("sync lock lost during execution");
      if (batch.length < batchSize) break;
    }

    await markTableFinished(table.key, {
      status: "idle",
      lastUpdatedAt: cursorTs,
      lastId: cursorId,
      rowsRead,
      rowsWritten,
      durationMs: Date.now() - tableStart,
    });

    return { table: table.key, rowsRead, rowsWritten, lastUpdatedAt: cursorTs, lastId: cursorId };
  } catch (error) {
    await markTableFinished(table.key, {
      status: "failed",
      rowsRead,
      rowsWritten,
      durationMs: Date.now() - tableStart,
      errorMessage: error instanceof Error ? error.message : "Unknown sync error",
    });
    throw error;
  }
};

serve(async (req) => {
  let step = "init";
  let table: string | null = null;
  let lockOwnerId: string | null = null;

  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse(405, { status: "error", error_message: "Method not allowed" });

    step = "auth";
    const token = extractBearerToken(req.headers.get("Authorization") ?? "");
    if (!token || token !== CRON_SECRET) return jsonResponse(401, { status: "unauthorized", error_message: "Unauthorized" });

    const startedAtIso = nowIso();
    const startedAtMs = Date.now();
    lockOwnerId = crypto.randomUUID();
    const tables = listTablesToSync();

    let runId: number | null = null;
    let totalRowsRead = 0;
    let totalRowsWritten = 0;
    let rowsDeletedReconciled = 0;
    const tableSummaries: Array<Record<string, unknown>> = [];

    step = "acquire_lock";
    const locked = await tryAcquireLock(lockOwnerId);
    if (!locked) {
      return new Response(
        JSON.stringify({
          status: "already_running",
          started_at: startedAtIso,
          finished_at: nowIso(),
          total_rows_read: 0,
          total_rows_written: 0,
          rows_deleted_reconciled: 0,
          error_message: null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    try {
      step = "create_run";
      runId = await createRun();
      const cutoff = pickCutoff();

      for (const syncTable of tables) {
        step = "sync_table";
        table = syncTable.key;
        const result = await syncOneTable(syncTable, cutoff, lockOwnerId);
        totalRowsRead += result.rowsRead;
        totalRowsWritten += result.rowsWritten;
        tableSummaries.push({
          table: result.table,
          rows_read: result.rowsRead,
          rows_written: result.rowsWritten,
          last_updated_at: result.lastUpdatedAt,
          last_id: result.lastId,
        });
      }

      step = "reconcile_deletes";
      table = DELETE_RECONCILE_KEY;
      const deleteReconcile = await reconcilePhysicalDeletes(cutoff, lockOwnerId);
      totalRowsRead += deleteReconcile.rowsRead;
      rowsDeletedReconciled += deleteReconcile.rowsApplied;
      tableSummaries.push({
        table: DELETE_RECONCILE_KEY,
        rows_read: deleteReconcile.rowsRead,
        rows_deleted_reconciled: deleteReconcile.rowsApplied,
        last_updated_at: deleteReconcile.lastUpdatedAt,
        last_id: deleteReconcile.lastId,
      });

      step = "update_run_ok";
      await updateRun(runId, {
        status: "ok",
        totalRowsRead,
        totalRowsWritten,
        rowsDeletedReconciled,
        tablesSynced: tableSummaries,
        startedAt: startedAtMs,
      });

      return new Response(
        JSON.stringify({
          status: "ok",
          started_at: String(startedAtIso),
          finished_at: String(nowIso()),
          total_rows_read: Number(totalRowsRead),
          total_rows_written: Number(totalRowsWritten),
          rows_deleted_reconciled: Number(rowsDeletedReconciled),
          error_message: null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      const normalized = normalizeError(error);
      const errorMessage = normalized.message;
      const stack = normalized.stack ?? undefined;
      console.error("[sync-dashboard] sync_failed", { step, table, message: errorMessage, stack });

      if (runId !== null) {
        try {
          step = "update_run_failed";
          await updateRun(runId, {
            status: "failed",
            totalRowsRead,
            totalRowsWritten,
            rowsDeletedReconciled,
            tablesSynced: tableSummaries,
            startedAt: startedAtMs,
            errorMessage,
          });
        } catch (updateRunError) {
          console.error("[sync-dashboard] update_run_failed_exception", {
            step,
            table,
            message: normalizeError(updateRunError).message,
          });
        }
      }

      return jsonResponse(500, {
        status: "failed",
        error_message: errorMessage,
        step,
        table,
      });
    } finally {
      if (lockOwnerId) await releaseLock(lockOwnerId);
    }
  } catch (error) {
    const normalized = normalizeError(error);
    const errorMessage = normalized.message;
    const stack = normalized.stack ?? undefined;
    console.error("[sync-dashboard] handler_failed", { step, table, message: errorMessage, stack });

    if (lockOwnerId) await releaseLock(lockOwnerId);

    return jsonResponse(500, {
      status: "failed",
      error_message: errorMessage,
      step,
      table,
    });
  }
});
