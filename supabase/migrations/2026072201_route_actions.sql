create table if not exists public.route_actions (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  notes text not null,
  active boolean not null default true,
  created_by uuid null default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint route_actions_date_range_check check (end_date >= start_date),
  constraint route_actions_notes_nonempty_check check (length(btrim(notes)) > 0)
);

create index if not exists route_actions_period_idx
  on public.route_actions (start_date, end_date)
  where active = true;

create table if not exists public.route_action_completions (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.route_actions(id) on delete cascade,
  route_date date not null,
  vendor_user_id uuid not null references auth.users(id) on delete cascade,
  vendor_name text null,
  company_name text null,
  completed boolean not null default true,
  reason text null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint route_action_completion_unique
    unique (action_id, route_date, vendor_user_id),
  constraint route_action_completion_reason_check
    check (completed or length(btrim(coalesce(reason, ''))) > 0)
);

create index if not exists route_action_completions_vendor_idx
  on public.route_action_completions (vendor_user_id, route_date);
create index if not exists route_action_completions_action_idx
  on public.route_action_completions (action_id, route_date);

alter table public.route_actions enable row level security;
alter table public.route_action_completions enable row level security;

drop policy if exists "Managers can read route actions" on public.route_actions;
create policy "Managers can read route actions" on public.route_actions
  for select to authenticated
  using (is_supervisor() or is_assistente());

drop policy if exists "Vendedor can read active route actions" on public.route_actions;
create policy "Vendedor can read active route actions" on public.route_actions
  for select to authenticated
  using (is_vendedor() and active);

drop policy if exists "Managers can manage route actions" on public.route_actions;
create policy "Managers can manage route actions" on public.route_actions
  for all to authenticated
  using (is_supervisor() or is_assistente())
  with check (is_supervisor() or is_assistente());

drop policy if exists "Managers can read route action completions" on public.route_action_completions;
create policy "Managers can read route action completions" on public.route_action_completions
  for select to authenticated
  using (is_supervisor() or is_assistente());

drop policy if exists "Vendedor can read own route action completions" on public.route_action_completions;
create policy "Vendedor can read own route action completions" on public.route_action_completions
  for select to authenticated
  using (is_vendedor() and vendor_user_id = auth.uid());

drop policy if exists "Vendedor can register own route action completion" on public.route_action_completions;
create policy "Vendedor can register own route action completion" on public.route_action_completions
  for insert to authenticated
  with check (is_vendedor() and vendor_user_id = auth.uid());

drop policy if exists "Vendedor can update own route action completion" on public.route_action_completions;
create policy "Vendedor can update own route action completion" on public.route_action_completions
  for update to authenticated
  using (is_vendedor() and vendor_user_id = auth.uid())
  with check (is_vendedor() and vendor_user_id = auth.uid());
