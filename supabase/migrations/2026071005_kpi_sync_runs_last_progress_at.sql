alter table public.kpi_sync_runs
  add column if not exists last_progress_at timestamptz;

update public.kpi_sync_runs
set last_progress_at = coalesce(last_progress_at, started_at, now())
where last_progress_at is null;
