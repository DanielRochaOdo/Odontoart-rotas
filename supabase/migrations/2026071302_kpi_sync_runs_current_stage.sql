alter table public.kpi_sync_runs
  add column if not exists current_stage text null,
  add column if not exists current_code_started_at timestamptz null,
  add column if not exists current_attempt integer null;
