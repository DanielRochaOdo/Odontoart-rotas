alter table public.kpi_sync_runs
  add column if not exists current_code text null;
