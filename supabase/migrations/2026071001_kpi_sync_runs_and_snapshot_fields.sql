create table if not exists public.kpi_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('api_daily', 'manual_upload', 'manual_sync')),
  status text not null check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  requested_by_user_id uuid null references auth.users(id) on delete set null,
  total_codes integer not null default 0,
  processed_codes integer not null default 0,
  changed_codes integer not null default 0,
  failed_codes integer not null default 0,
  error_message text null,
  created_at timestamptz not null default now()
);

create index if not exists kpi_sync_runs_status_idx
  on public.kpi_sync_runs(status, created_at desc);

create index if not exists kpi_sync_runs_source_idx
  on public.kpi_sync_runs(source, created_at desc);

alter table public.kpi_sync_runs enable row level security;

drop policy if exists "Supervisor or assistente full access on kpi_sync_runs" on public.kpi_sync_runs;
create policy "Supervisor or assistente full access on kpi_sync_runs"
  on public.kpi_sync_runs
  for all
  using (public.is_supervisor() or public.is_assistente())
  with check (public.is_supervisor() or public.is_assistente());

alter table public.kpi_sync_snapshots
  add column if not exists sync_run_id uuid null references public.kpi_sync_runs(id) on delete set null,
  add column if not exists source text null check (source in ('api_daily', 'manual_upload', 'manual_sync')),
  add column if not exists snapshot_at timestamptz not null default now(),
  add column if not exists snapshot_date date not null default current_date,
  add column if not exists previous_vidas_qtde numeric null,
  add column if not exists delta numeric not null default 0,
  add column if not exists vendas_qtde numeric not null default 0,
  add column if not exists cancelamentos_qtde numeric not null default 0;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'kpi_sync_snapshots_period_days_codigo_key'
  ) then
    alter table public.kpi_sync_snapshots drop constraint kpi_sync_snapshots_period_days_codigo_key;
  end if;
end $$;

with ranked_duplicates as (
  select
    id,
    row_number() over (
      partition by period_days, codigo, snapshot_at
      order by created_at desc, id desc
    ) as rn
  from public.kpi_sync_snapshots
)
delete from public.kpi_sync_snapshots s
using ranked_duplicates d
where s.id = d.id
  and d.rn > 1;

create unique index if not exists kpi_sync_snapshots_period_codigo_snapshot_idx
  on public.kpi_sync_snapshots(period_days, codigo, snapshot_at);

create index if not exists kpi_sync_snapshots_snapshot_date_idx
  on public.kpi_sync_snapshots(snapshot_date desc, codigo);

create index if not exists kpi_sync_snapshots_sync_run_idx
  on public.kpi_sync_snapshots(sync_run_id);
