create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  agenda_id uuid not null references public.agenda(id) on delete cascade,
  assigned_to_user_id uuid null references auth.users(id) on delete set null,
  assigned_to_name text null,
  visit_date date not null,
  perfil_visita text null,
  route_id uuid null references public.routes(id) on delete set null,
  completed_at timestamptz null,
  completed_vidas integer null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists visits_assigned_idx on public.visits(assigned_to_user_id);
create index if not exists visits_date_idx on public.visits(visit_date);
create index if not exists visits_agenda_idx on public.visits(agenda_id);
create unique index if not exists visits_unique_vendor_date
  on public.visits(agenda_id, assigned_to_user_id, visit_date);

insert into public.visits (
  agenda_id,
  assigned_to_user_id,
  assigned_to_name,
  visit_date,
  perfil_visita,
  route_id,
  completed_at,
  completed_vidas,
  created_by,
  created_at
)
select
  a.id,
  p.user_id,
  coalesce(a.visit_assigned_to, a.vendedor),
  coalesce(a.visit_generated_at::date, a.data_da_ultima_visita::date),
  a.perfil_visita,
  a.visit_route_id,
  a.visit_completed_at,
  a.visit_completed_vidas,
  null,
  coalesce(a.visit_generated_at, now())
from public.agenda a
left join public.profiles p
  on p.display_name = coalesce(a.visit_assigned_to, a.vendedor)
where a.visit_generated_at is not null
on conflict do nothing;

alter table public.visits enable row level security;

drop policy if exists "Supervisor or assistente full access on visits" on public.visits;
create policy "Supervisor or assistente full access on visits" on public.visits
  for all
  using (is_supervisor() or is_assistente())
  with check (is_supervisor() or is_assistente());

drop policy if exists "Vendedor can read own visits" on public.visits;
create policy "Vendedor can read own visits" on public.visits
  for select
  using (
    is_vendedor()
    and (
      assigned_to_user_id = auth.uid()
      or assigned_to_name = current_display_name()
    )
  );

drop policy if exists "Vendedor can update own visits" on public.visits;
create policy "Vendedor can update own visits" on public.visits
  for update
  using (
    is_vendedor()
    and (
      assigned_to_user_id = auth.uid()
      or assigned_to_name = current_display_name()
    )
  )
  with check (
    is_vendedor()
    and (
      assigned_to_user_id = auth.uid()
      or assigned_to_name = current_display_name()
    )
  );
