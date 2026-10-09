import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Isolated, in-memory PostgreSQL. Never connects to Supabase or loads .env.
const db = new PGlite();
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table clientes (codigo text, vidas_qtde numeric, categoria text);
    create table kpi_sync_runs (
      id uuid primary key, status text, processed_codes integer default 0,
      remaining_codes integer default 0, failed_codes integer default 0, changed_codes integer default 0,
      last_progress_at timestamptz, finished_at timestamptz, current_code text,
      current_stage text, current_code_started_at timestamptz, current_attempt integer
    );
    create table kpi_sync_run_items (run_id uuid, status text, changed boolean);
    create table kpi_sync_snapshots (codigo text, vidas_qtde numeric);
    insert into kpi_sync_snapshots values ('a', 10), ('a', 20);
    create table writes (relation text);
    create function count_writes() returns trigger language plpgsql as $$
      begin insert into writes values (TG_TABLE_NAME); return NEW; end;
    $$;
    create trigger clientes_writes after update on clientes for each row execute function count_writes();
    create trigger run_writes after update on kpi_sync_runs for each row execute function count_writes();
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
  `);
  const migration = await readFile(new URL("../supabase/migrations/2026100901_reduce_kpi_io.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration); // Safe to reapply the function definitions.
  await db.exec(`insert into clientes values ('a', 10, 'ATIVA'), ('a', 10, 'ATIVA'), ('b', null, null)`);
  const update = async (codigo: string, vidas: number | null, categoria: string | null) => {
    const { rows } = await db.query<{ updated: number }>("select kpi_update_cliente_if_changed($1, $2, $3) as updated", [codigo, vidas, categoria]);
    return rows[0].updated;
  };
  assert.equal(await update("a", 10, "ATIVA"), 0);
  assert.equal(await update("a", 10, "INATIVA"), 2, "Category-only changes must update every matching code");
  assert.equal(await update("a", 20, "INATIVA"), 2);
  assert.equal(await update("a", 20, "INATIVA"), 0);
  assert.equal(await update("b", null, null), 0);
  assert.equal(await update("b", 0, "ATIVA"), 1, "NULL differs from zero");
  assert.equal(await update("missing", 1, "ATIVA"), 0);
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from writes where relation = 'clientes'")).rows[0].n, 5);

  const runId = "00000000-0000-0000-0000-000000000001";
  await db.query("insert into kpi_sync_runs (id,status) values ($1,'running')", [runId]);
  await db.query(`insert into kpi_sync_run_items select $1::uuid, 'completed', true from generate_series(1, 1005)`, [runId]);
  await db.query(`insert into kpi_sync_run_items values ($1,'failed',false),($1,'stopped',false),($1,'retrying',false),($1,'processing',false),($1,'pending',false)`, [runId]);
  type Progress = { processed: number; remaining: number; failed: number; changed: number; finished: boolean; status: string };
  const progress = async (finalize: boolean) => (await db.query<{ value: Progress }>("select kpi_refresh_run_progress($1,$2) value", [runId, finalize])).rows[0].value;
  assert.deepEqual(await progress(true), { processed: 1007, remaining: 3, failed: 1, changed: 1005, finished: false, status: "running" });
  await progress(false);
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from writes where relation = 'kpi_sync_runs'")).rows[0].n, 1, "Unchanged progress must not rewrite the run");
  await db.exec("update kpi_sync_run_items set status = 'completed' where status in ('pending','processing','retrying')");
  assert.deepEqual(await progress(true), { processed: 1010, remaining: 0, failed: 1, changed: 1005, finished: true, status: "success" });
  await progress(true);
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from writes where relation = 'kpi_sync_runs'")).rows[0].n, 2);
  await db.exec("update kpi_sync_runs set status = 'failed'");
  assert.equal((await progress(true)).status, "failed", "A stopped/failed run must not become success");
  await assert.rejects(db.query("select kpi_refresh_run_progress('00000000-0000-0000-0000-000000000002')"), /not found/);
  await db.exec("set role authenticated");
  await assert.rejects(update("a", 999, "ATIVA"), /permission denied/);
  await assert.rejects(progress(false), /permission denied/);
  await db.exec("reset role; set role service_role");
  assert.equal(await update("a", 20, "INATIVA"), 0);
  assert.equal((await progress(false)).status, "failed");
  await db.exec("reset role");
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from clientes")).rows[0].n, 3);
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from kpi_sync_snapshots")).rows[0].n, 2, "History must remain intact");

  // Aggregate equivalence: dates, sellers with/without IDs, ignored values and deleted visits.
  await db.exec(`
    create table dash_visits (visit_date date, assigned_to_user_id uuid, assigned_to_name text, completed_vidas numeric, deleted_at timestamptz);
    create view v_dash_visits_active as select * from dash_visits where deleted_at is null;
    grant select on v_dash_visits_active to authenticated;
    insert into dash_visits values
      ('2026-01-01', '${runId}', 'Ana', 3, null),
      ('2026-01-31', '${runId}', 'Ana', 4, null),
      ('2026-02-01', '${runId}', 'Ana', 2, null),
      ('2026-01-15', null, 'Ana', 5, null),
      ('2026-01-16', null, null, 6, null),
      ('2026-01-17', null, null, -9, null),
      ('2026-01-18', null, null, 0, null),
      ('2026-01-19', null, null, null, null),
      (null, null, null, 99, null),
      ('2026-01-20', null, null, 99, now());
  `);
  await db.exec(await readFile(new URL("../docs/sql/dashboard_monthly_lives.sql", import.meta.url), "utf8"));
  const { rows: months } = await db.query<{ month: string; vidas: string }>("select to_char(visit_date,'YYYY-MM') as month, sum(completed_vidas)::text vidas from v_dash_visits_monthly_lives group by 1 order by 1");
  assert.deepEqual(months, [{ month: "2026-01", vidas: "18" }, { month: "2026-02", vidas: "2" }]);
  const { rows: grants } = await db.query<{ allowed: boolean }>("select has_table_privilege('anon','v_dash_visits_monthly_lives','SELECT') allowed");
  assert.equal(grants[0].allowed, false, "Do not grant access to a role without source access");
  await db.exec("set role authenticated");
  assert.equal((await db.query("select * from v_dash_visits_monthly_lives")).rows.length, 4);
  console.log("OK: SQL conditional writes, NULLs, 1,010 items, idempotent progress, terminal states, privileges, history preservation, monthly aggregation.");
} finally {
  await db.close();
}
