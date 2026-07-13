create table if not exists public.kpi_sync_locks (
  lock_name text primary key,
  acquired_at timestamptz not null default now(),
  acquired_by text null
);

alter table public.kpi_sync_locks enable row level security;

drop policy if exists "Supervisor or assistente full access on kpi_sync_locks" on public.kpi_sync_locks;
create policy "Supervisor or assistente full access on kpi_sync_locks"
  on public.kpi_sync_locks
  for all
  using (public.is_supervisor() or public.is_assistente())
  with check (public.is_supervisor() or public.is_assistente());

insert into public.kpi_sync_locks (lock_name)
values ('kpi_daily')
on conflict (lock_name) do nothing;
