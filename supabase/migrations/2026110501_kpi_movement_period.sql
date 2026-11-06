alter table public.kpi_sync_runs
  add column if not exists period_start_date date,
  add column if not exists period_end_date date;

alter table public.kpi_sync_runs
  drop constraint if exists kpi_sync_runs_period_dates_check;

alter table public.kpi_sync_runs
  add constraint kpi_sync_runs_period_dates_check
  check (
    period_start_date is null
    or period_end_date is null
    or period_start_date <= period_end_date
  );

alter table public.kpi_sync_snapshots
  drop constraint if exists kpi_sync_snapshots_status_check;

alter table public.kpi_sync_snapshots
  add constraint kpi_sync_snapshots_status_check
  check (status in (
    'ok', 'preenchido', 'em_branco',
    'inativo', 'so_perda', 'so_venda', 'so_ganho', 'crescimento', 'queda', 'neutro'
  )) not valid;
