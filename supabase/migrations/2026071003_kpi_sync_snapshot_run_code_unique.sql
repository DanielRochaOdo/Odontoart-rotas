create unique index if not exists kpi_sync_snapshots_run_codigo_key
  on public.kpi_sync_snapshots(sync_run_id, codigo);
