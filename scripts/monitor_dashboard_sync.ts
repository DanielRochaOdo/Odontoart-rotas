import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type RunRow = {
  id: number;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  total_rows_read: number | null;
  total_rows_written: number | null;
  rows_deleted_reconciled: number | null;
  error_message: string | null;
};

type StateRow = {
  table_name: string;
  status: string | null;
  last_updated_at: string | null;
  last_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  rows_read: number | null;
  rows_written: number | null;
  last_error: string | null;
};

type LockRow = {
  lock_name: string;
  owner_id: string | null;
  acquired_at: string | null;
  heartbeat_at: string | null;
  locked_until: string | null;
};

type Severity = "OK" | "ATENCAO" | "FALHA";

const DASHBOARD_URL = process.env.DASHBOARD_URL;
const DASHBOARD_SERVICE_ROLE_KEY = process.env.DASHBOARD_SERVICE_ROLE_KEY;
const MAX_SUCCESS_AGE_MINUTES = Number(process.env.DASH_MONITOR_MAX_SUCCESS_AGE_MINUTES ?? 15);
const MAX_RUNNING_STATE_MINUTES = Number(process.env.DASH_MONITOR_MAX_RUNNING_STATE_MINUTES ?? 20);

if (!DASHBOARD_URL || !DASHBOARD_SERVICE_ROLE_KEY) {
  console.error("FALHA: Missing env vars DASHBOARD_URL and/or DASHBOARD_SERVICE_ROLE_KEY");
  process.exit(2);
}

const dash = createClient(DASHBOARD_URL, DASHBOARD_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const now = new Date();
const issues: Array<{ severity: Exclude<Severity, "OK">; message: string }> = [];

const addIssue = (severity: Exclude<Severity, "OK">, message: string) => {
  issues.push({ severity, message });
};

const minutesBetween = (fromIso: string, to: Date) => {
  const from = new Date(fromIso);
  return (to.getTime() - from.getTime()) / 60000;
};

const renderSeverity = (): Severity => {
  if (issues.some((x) => x.severity === "FALHA")) return "FALHA";
  if (issues.some((x) => x.severity === "ATENCAO")) return "ATENCAO";
  return "OK";
};

const run = async () => {
  const { data: runsData, error: runsError } = await dash
    .from("dashboard_sync_runs")
    .select(
      "id,status,started_at,finished_at,total_rows_read,total_rows_written,rows_deleted_reconciled,error_message",
    )
    .order("id", { ascending: false })
    .limit(5);
  if (runsError) throw new Error(`dashboard_sync_runs query failed: ${runsError.message}`);

  const runs = (runsData ?? []) as RunRow[];
  const latest3 = runs.slice(0, 3);
  if (latest3.length === 0) {
    addIssue("FALHA", "Sem execucoes em dashboard_sync_runs");
  } else {
    const allFailed = latest3.every((row) => (row.status ?? "").toLowerCase() !== "ok");
    if (allFailed) addIssue("FALHA", "As ultimas 3 execucoes nao estao com status ok");

    const withErrorMessage = latest3.filter((row) => (row.error_message ?? "").trim().length > 0);
    if (withErrorMessage.length > 0) {
      addIssue("ATENCAO", "Uma ou mais das ultimas 3 execucoes possuem error_message preenchido");
    }
  }

  const { data: lastSuccessData, error: lastSuccessError } = await dash
    .from("dashboard_sync_runs")
    .select("finished_at")
    .eq("status", "ok")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastSuccessError) throw new Error(`last success query failed: ${lastSuccessError.message}`);

  const lastSuccessAt = (lastSuccessData?.finished_at ?? null) as string | null;
  if (!lastSuccessAt) {
    addIssue("FALHA", "Nao existe execucao com status ok em dashboard_sync_runs");
  } else {
    const ageMin = minutesBetween(lastSuccessAt, now);
    if (ageMin > MAX_SUCCESS_AGE_MINUTES) {
      addIssue("FALHA", `Ultimo sucesso tem ${ageMin.toFixed(1)} min (> ${MAX_SUCCESS_AGE_MINUTES} min)`);
    }
  }

  const { data: statesData, error: statesError } = await dash
    .from("dashboard_sync_state")
    .select("table_name,status,last_updated_at,last_id,started_at,finished_at,rows_read,rows_written,last_error")
    .order("table_name", { ascending: true });
  if (statesError) throw new Error(`dashboard_sync_state query failed: ${statesError.message}`);

  const states = (statesData ?? []) as StateRow[];
  for (const state of states) {
    if ((state.last_error ?? "").trim().length > 0) {
      addIssue("ATENCAO", `Tabela ${state.table_name} possui last_error preenchido`);
    }
    if ((state.status ?? "").toLowerCase() !== "idle" && state.started_at) {
      const runningAge = minutesBetween(state.started_at, now);
      if (runningAge > MAX_RUNNING_STATE_MINUTES) {
        addIssue(
          "ATENCAO",
          `Tabela ${state.table_name} com status ${state.status} ha ${runningAge.toFixed(1)} min`,
        );
      }
    }
  }

  const { data: lockData, error: lockError } = await dash
    .from("dashboard_sync_lock")
    .select("lock_name,owner_id,acquired_at,heartbeat_at,locked_until")
    .order("lock_name", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (lockError) throw new Error(`dashboard_sync_lock query failed: ${lockError.message}`);

  const lock = (lockData ?? null) as LockRow | null;
  if (!lock) {
    addIssue("ATENCAO", "Tabela dashboard_sync_lock sem linha de lock");
  } else if (lock.owner_id) {
    const lockedUntil = lock.locked_until ? new Date(lock.locked_until) : null;
    if (!lockedUntil || Number.isNaN(lockedUntil.getTime())) {
      addIssue("ATENCAO", "Lock com owner_id preenchido e locked_until invalido");
    } else if (lockedUntil.getTime() > now.getTime()) {
      addIssue("ATENCAO", "Lock ativo no momento (owner_id preenchido e locked_until no futuro)");
    } else {
      addIssue("FALHA", "Lock preso/expirado (owner_id preenchido com locked_until no passado)");
    }
  }

  const overall = renderSeverity();

  console.log("=== Monitor Dashboard Sync ===");
  console.log(`Status geral: ${overall}`);
  console.log(`Ultimo sucesso: ${lastSuccessAt ?? "N/A"}`);
  console.log("");

  console.log("Ultimas execucoes (top 5):");
  runs.forEach((row) => {
    console.log(
      `- #${row.id} status=${row.status} read=${row.total_rows_read ?? 0} written=${row.total_rows_written ?? 0} deleted_reconciled=${row.rows_deleted_reconciled ?? 0} started=${row.started_at ?? "N/A"} finished=${row.finished_at ?? "N/A"} error=${row.error_message ?? "-"}`,
    );
  });
  console.log("");

  console.log("Estado por tabela:");
  states.forEach((row) => {
    console.log(
      `- ${row.table_name}: status=${row.status} last_error=${row.last_error ?? "-"} rows_read=${row.rows_read ?? 0} rows_written=${row.rows_written ?? 0} started=${row.started_at ?? "N/A"} finished=${row.finished_at ?? "N/A"}`,
    );
  });
  console.log("");

  console.log("Lock:");
  if (!lock) {
    console.log("- sem registro em dashboard_sync_lock");
  } else {
    console.log(
      `- ${lock.lock_name}: owner_id=${lock.owner_id ?? "null"} heartbeat_at=${lock.heartbeat_at ?? "null"} locked_until=${lock.locked_until ?? "null"}`,
    );
  }
  console.log("");

  if (issues.length === 0) {
    console.log("Recomendacao: Operacao normal. Manter monitoramento.");
  } else {
    console.log("Alertas:");
    issues.forEach((issue) => console.log(`- [${issue.severity}] ${issue.message}`));
    if (overall === "FALHA") {
      console.log("Recomendacao: Pausar agendamento e investigar imediatamente.");
    } else {
      console.log("Recomendacao: Investigar alertas e acompanhar proximas execucoes.");
    }
  }

  if (overall === "OK") process.exit(0);
  if (overall === "ATENCAO") process.exit(1);
  process.exit(2);
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FALHA: ${message}`);
  process.exit(2);
});
