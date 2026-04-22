create table if not exists public.route_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  event_type text not null check (event_type in ('TREINAMENTO', 'REUNIAO')),
  event_time time without time zone null,
  notes text null,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists route_events_event_date_idx on public.route_events (event_date);
create index if not exists route_events_created_at_idx on public.route_events (created_at desc);

alter table public.route_events enable row level security;

drop policy if exists route_events_select_policy on public.route_events;
create policy route_events_select_policy
  on public.route_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('SUPERVISOR', 'ASSISTENTE')
    )
  );

drop policy if exists route_events_insert_policy on public.route_events;
create policy route_events_insert_policy
  on public.route_events
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('SUPERVISOR', 'ASSISTENTE')
    )
  );

drop policy if exists route_events_update_policy on public.route_events;
create policy route_events_update_policy
  on public.route_events
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('SUPERVISOR', 'ASSISTENTE')
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('SUPERVISOR', 'ASSISTENTE')
    )
  );

drop policy if exists route_events_delete_policy on public.route_events;
create policy route_events_delete_policy
  on public.route_events
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('SUPERVISOR', 'ASSISTENTE')
    )
  );

