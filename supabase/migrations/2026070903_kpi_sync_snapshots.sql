create table if not exists public.kpi_sync_snapshots (
  id uuid primary key default gen_random_uuid(),
  synced_by_user_id uuid null references auth.users(id) on delete set null,
  period_days integer not null check (period_days in (1, 7, 15, 30)),
  codigo text not null,
  empresa text null,
  categoria text not null,
  vidas_qtde numeric null,
  status text not null check (status in ('ok', 'preenchido', 'em_branco')),
  created_at timestamptz not null default now()
);

create index if not exists kpi_sync_snapshots_created_at_idx
  on public.kpi_sync_snapshots(created_at desc);

create index if not exists kpi_sync_snapshots_period_idx
  on public.kpi_sync_snapshots(period_days, created_at desc);

create index if not exists kpi_sync_snapshots_codigo_idx
  on public.kpi_sync_snapshots(codigo);

alter table public.kpi_sync_snapshots enable row level security;

drop policy if exists "Supervisor or assistente full access on kpi_sync_snapshots" on public.kpi_sync_snapshots;
create policy "Supervisor or assistente full access on kpi_sync_snapshots"
  on public.kpi_sync_snapshots
  for all
  using (public.is_supervisor() or public.is_assistente())
  with check (public.is_supervisor() or public.is_assistente());
