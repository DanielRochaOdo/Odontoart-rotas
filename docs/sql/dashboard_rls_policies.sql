-- Dashboard project access policies (anon-safe read surface)

alter table public.dash_visits enable row level security;
alter table public.dash_aceite_digital enable row level security;
alter table public.dash_clientes enable row level security;
alter table public.dash_profiles enable row level security;

alter table public.dashboard_sync_runs enable row level security;
alter table public.dashboard_sync_state enable row level security;
alter table public.dashboard_sync_lock enable row level security;

-- Remove old broad policies if they exist

drop policy if exists "dash_visits_read_all" on public.dash_visits;
drop policy if exists "dash_aceite_read_all" on public.dash_aceite_digital;
drop policy if exists "dash_clientes_read_all" on public.dash_clientes;
drop policy if exists "dash_profiles_read_all" on public.dash_profiles;

drop policy if exists "dashboard_sync_runs_deny_anon" on public.dashboard_sync_runs;
drop policy if exists "dashboard_sync_state_deny_anon" on public.dashboard_sync_state;
drop policy if exists "dashboard_sync_lock_deny_anon" on public.dashboard_sync_lock;

-- Read policies for frontend-facing tables
create policy "dash_visits_read_all" on public.dash_visits
for select
using (true);

create policy "dash_aceite_read_all" on public.dash_aceite_digital
for select
using (true);

create policy "dash_clientes_read_all" on public.dash_clientes
for select
using (true);

create policy "dash_profiles_read_all" on public.dash_profiles
for select
using (true);

-- Block anon/app reads on operational sync tables
create policy "dashboard_sync_runs_deny_anon" on public.dashboard_sync_runs
for select
using (false);

create policy "dashboard_sync_state_deny_anon" on public.dashboard_sync_state
for select
using (false);

create policy "dashboard_sync_lock_deny_anon" on public.dashboard_sync_lock
for select
using (false);
