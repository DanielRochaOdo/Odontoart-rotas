import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

type SyncKey = "visits" | "aceite_digital" | "clientes" | "profiles";
type SyncMode = "incremental" | "backfill";

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

const PRIMARY_URL =
  process.env.PRIMARY_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL;
const PRIMARY_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DASH_URL = process.env.DASHBOARD_URL ?? process.env.VITE_DASHBOARD_URL;
const DASH_SERVICE_ROLE_KEY =
  process.env.DASHBOARD_SERVICE_ROLE_KEY ?? process.env.SUPABASE_DASHBOARD_SERVICE_ROLE_KEY;

if (!PRIMARY_URL || !PRIMARY_SERVICE_ROLE_KEY || !DASH_URL || !DASH_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing env vars. Required: PRIMARY_SUPABASE_URL (or SUPABASE_URL / VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_URL (or VITE_DASHBOARD_URL), DASHBOARD_SERVICE_ROLE_KEY (or SUPABASE_DASHBOARD_SERVICE_ROLE_KEY)",
  );
}

const primary = createClient(PRIMARY_URL, PRIMARY_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const dash = createClient(DASH_URL, DASH_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EPOCH = "1970-01-01T00:00:00Z";
const DEFAULT_BATCH = Number(process.env.DASH_SYNC_BATCH_SIZE ?? 1000);
const SAFETY_LAG_SECONDS = Number(process.env.DASH_SYNC_SAFETY_LAG_SECONDS ?? 60);
const LOCK_TTL_SECONDS = Number(process.env.DASH_SYNC_LOCK_TTL_SECONDS ?? 600);
const MODE = (process.env.DASH_SYNC_MODE ?? "incremental") as SyncMode;
const FORCE_FROM = process.env.DASH_SYNC_FORCE_FROM ?? null;
const TABLES_FILTER = new Set(
  (process.env.DASH_SYNC_TABLES ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean),
);

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

const escapeValue = (value: string) => value.replace(/,/g, "\\,").replace(/\)/g, "\\)");

const toTextId = (value: unknown) => {
  if (value === null || value === undefined) return "";
  return String(value);
};

const pickCursorTimestamp = (row: Record<string, unknown>) => {
  const updatedAt = row.updated_at;
  const createdAt = row.created_at;
  if (typeof updatedAt === "string" && updatedAt.length > 0) return updatedAt;
  if (typeof createdAt === "string" && createdAt.length > 0) return createdAt;
  return EPOCH;
};

const pickCutoff = () => {
  const cutoff = new Date(Date.now() - SAFETY_LAG_SECONDS * 1000);
  return cutoff.toISOString();
};

const log = (message: string, data?: Record<string, unknown>) => {
  if (!data) {
    console.info(`[sync-dashboard] ${message}`);
    return;
  }
  console.info(`[sync-dashboard] ${message} ${JSON.stringify(data)}`);
};

const listTablesToSync = () => {
  if (TABLES_FILTER.size === 0) return TABLES;
  return TABLES.filter((table) => TABLES_FILTER.has(table.key));
};

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
  const { error } = await dash.rpc("dashboard_release_sync_lock", {
    p_lock_name: "dashboard_sync",
    p_owner_id: ownerId,
  });
  if (error) {
    console.warn("[sync-dashboard] lock release failed", error.message);
  }
};

const ensureSyncState = async (key: SyncKey) => {
  const { data, error } = await dash
    .from("dashboard_sync_state")
    .select("table_name,last_updated_at,last_id")
    .eq("table_name", key)
    .maybeSingle();
  if (error) throw error;

  if (data) {
    return data as SyncStateRow;
  }

  const fallback = {
    table_name: key,
    last_updated_at: EPOCH,
    last_id: "",
    status: "idle",
    updated_at: nowIso(),
  };

  const { error: insertError } = await dash.from("dashboard_sync_state").insert(fallback);
  if (insertError) throw insertError;

  return {
    table_name: key,
    last_updated_at: EPOCH,
    last_id: "",
  } as SyncStateRow;
};

const ensureGenericSyncState = async (tableName: string) => {
  const { data, error } = await dash
    .from("dashboard_sync_state")
    .select("table_name,last_updated_at,last_id")
    .eq("table_name", tableName)
    .maybeSingle();
  if (error) throw error;

  if (data) {
    return data as { table_name: string; last_updated_at: string; last_id: string };
  }

  const fallback = {
    table_name: tableName,
    last_updated_at: EPOCH,
    last_id: "",
    status: "idle",
    updated_at: nowIso(),
  };

  const { error: insertError } = await dash.from("dashboard_sync_state").insert(fallback);
  if (insertError) throw insertError;

  return {
    table_name: tableName,
    last_updated_at: EPOCH,
    last_id: "",
  };
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

const createRun = async (mode: SyncMode) => {
  const payload = {
    mode,
    status: "running",
    source_project: PRIMARY_URL,
    target_project: DASH_URL,
    started_at: nowIso(),
    tables_synced: [],
    total_rows_read: 0,
    total_rows_written: 0,
    rows_deleted_reconciled: 0,
  };

  const { data, error } = await dash
    .from("dashboard_sync_runs")
    .insert(payload)
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
  const batchSize = Number(process.env.DASH_SYNC_BATCH_DELETE_RECONCILE ?? 500);

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

const syncOneTable = async (table: SyncConfig, mode: SyncMode, cutoff: string, lockOwnerId: string): Promise<SyncResult> => {
  await ensureSyncState(table.key);
  await markTableRunning(table.key);

  const tableStart = Date.now();
  let rowsRead = 0;
  let rowsWritten = 0;

  try {
    const state = await ensureSyncState(table.key);
    let cursorTs = mode === "backfill" ? FORCE_FROM ?? EPOCH : state.last_updated_at;
    let cursorId = mode === "backfill" ? "" : state.last_id;

    const batchSize = Number(process.env[`DASH_SYNC_BATCH_${table.key.toUpperCase()}`] ?? table.defaultBatchSize ?? DEFAULT_BATCH);

    while (true) {
      const compositeCursor = `${cursorTs},${escapeValue(cursorId)}`;
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
      if (!lockOk) {
        throw new Error("sync lock lost during execution");
      }

      log(`table batch synced`, {
        table: table.key,
        batch: batch.length,
        rowsRead,
        rowsWritten,
        cursorTs,
        cursorId,
        cutoff,
        compositeCursor,
      });

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

    return {
      table: table.key,
      rowsRead,
      rowsWritten,
      lastUpdatedAt: cursorTs,
      lastId: cursorId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown sync error";

    await markTableFinished(table.key, {
      status: "failed",
      rowsRead,
      rowsWritten,
      durationMs: Date.now() - tableStart,
      errorMessage,
    });

    throw error;
  }
};

const run = async () => {
  const start = Date.now();
  const lockOwnerId = randomUUID();
  const tables = listTablesToSync();

  log("starting", {
    mode: MODE,
    tables: tables.map((table) => table.key),
    defaultBatch: DEFAULT_BATCH,
    safetyLagSeconds: SAFETY_LAG_SECONDS,
    lockTtlSeconds: LOCK_TTL_SECONDS,
    lockOwnerId,
    forceFrom: FORCE_FROM,
  });

  const locked = await tryAcquireLock(lockOwnerId);
  if (!locked) {
    log("another sync is already running, aborting");
    return;
  }

  let runId: number | null = null;
  let totalRowsRead = 0;
  let totalRowsWritten = 0;
  let rowsDeletedReconciled = 0;
  const tableSummaries: Array<Record<string, unknown>> = [];

  try {
    runId = await createRun(MODE);
    const cutoff = pickCutoff();

    for (const table of tables) {
      const result = await syncOneTable(table, MODE, cutoff, lockOwnerId);
      totalRowsRead += result.rowsRead;
      totalRowsWritten += result.rowsWritten;
      tableSummaries.push({
        table: result.table,
        rows_read: result.rowsRead,
        rows_written: result.rowsWritten,
        last_updated_at: result.lastUpdatedAt,
        last_id: result.lastId,
      });

      log("table done", {
        table: result.table,
        rowsRead: result.rowsRead,
        rowsWritten: result.rowsWritten,
        lastUpdatedAt: result.lastUpdatedAt,
        lastId: result.lastId,
      });
    }

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

    log("delete reconciliation done", {
      rowsRead: deleteReconcile.rowsRead,
      rowsDeletedReconciled: deleteReconcile.rowsApplied,
      lastUpdatedAt: deleteReconcile.lastUpdatedAt,
      lastId: deleteReconcile.lastId,
    });

    if (runId !== null) {
      await updateRun(runId, {
        status: "ok",
        totalRowsRead,
        totalRowsWritten,
        rowsDeletedReconciled,
        tablesSynced: tableSummaries,
        startedAt: start,
      });
    }

    log("done", {
      durationMs: Date.now() - start,
      totalRowsRead,
      totalRowsWritten,
      rowsDeletedReconciled,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown sync error";

    if (runId !== null) {
      await updateRun(runId, {
        status: "failed",
        totalRowsRead,
        totalRowsWritten,
        rowsDeletedReconciled,
        tablesSynced: tableSummaries,
        startedAt: start,
        errorMessage,
      });
    }

    console.error("[sync-dashboard] failed", error);
    process.exitCode = 1;
  } finally {
    await releaseLock(lockOwnerId);
  }
};

run();
