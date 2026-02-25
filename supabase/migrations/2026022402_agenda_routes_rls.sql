create extension if not exists "pgcrypto";

-- Helpers
drop function if exists public.current_profile_role();
create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid();
$$;

grant execute on function public.current_profile_role() to authenticated;

drop function if exists public.is_vendedor();
create or replace function public.is_vendedor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_profile_role() = 'VENDEDOR';
$$;

grant execute on function public.is_vendedor() to authenticated;

drop function if exists public.is_supervisor();
create or replace function public.is_supervisor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_profile_role() = 'SUPERVISOR';
$$;

grant execute on function public.is_supervisor() to authenticated;

drop function if exists public.is_assistente();
create or replace function public.is_assistente()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_profile_role() = 'ASSISTENTE';
$$;

grant execute on function public.is_assistente() to authenticated;

create or replace function public.current_display_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select display_name from public.profiles where user_id = auth.uid();
$$;

grant execute on function public.current_display_name() to authenticated;

-- Agenda
create table if not exists public.agenda (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  data_da_ultima_visita timestamptz null,
  consultor text null,
  cod_1 text null,
  empresa text null,
  perfil_visita text null,
  corte numeric null,
  venc numeric null,
  valor numeric null,
  tit text null,
  endereco text null,
  bairro text null,
  cidade text null,
  uf text null,
  supervisor text null,
  vendedor text null,
  cod_2 text null,
  nome_fantasia text null,
  grupo text null,
  situacao text null,
  obs_contrato_1 text null,
  obs_contrato_2 text null,
  dedupe_key text null,
  raw_row jsonb null,
  created_at timestamptz default now()
);

create unique index if not exists agenda_dedupe_key_unique on public.agenda(dedupe_key);
create index if not exists agenda_vendedor_idx on public.agenda(vendedor);
create index if not exists agenda_consultor_idx on public.agenda(consultor);
create index if not exists agenda_data_visita_idx on public.agenda(data_da_ultima_visita);
-- Routes
create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  name text not null,
  assigned_to_user_id uuid null references auth.users(id) on delete set null,
  date date null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists routes_assigned_idx on public.routes(assigned_to_user_id);

create table if not exists public.route_stops (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  route_id uuid references public.routes(id) on delete cascade,
  agenda_id uuid references public.agenda(id) on delete set null,
  stop_order int,
  notes text null
);

create index if not exists route_stops_route_idx on public.route_stops(route_id);
create index if not exists route_stops_agenda_idx on public.route_stops(agenda_id);

create table if not exists public.agenda_headers_map (
  id uuid primary key default gen_random_uuid(),
  original_header text not null,
  db_column text not null,
  occurrence int not null,
  created_at timestamptz default now()
);

-- RLS profiles
alter table public.profiles enable row level security;

create policy "Profiles can read own" on public.profiles
  for select
  using (user_id = auth.uid());

create policy "Supervisor or assistente can read all profiles" on public.profiles
  for select
  using (is_supervisor() or is_assistente());

create policy "Supervisor or assistente can update profiles" on public.profiles
  for update
  using (is_supervisor() or is_assistente());

-- RLS agenda
alter table public.agenda enable row level security;

create policy "Supervisor or assistente full access on agenda" on public.agenda
  for all
  using (is_supervisor() or is_assistente())
  with check (is_supervisor() or is_assistente());

create policy "Vendedor read own agenda" on public.agenda
  for select
  using (
    is_vendedor()
    and (
      vendedor = current_display_name()
      or consultor = current_display_name()
    )
    and (
      data_da_ultima_visita is null
      or data_da_ultima_visita::date <= (now() at time zone 'America/Fortaleza')::date
    )
  );

-- RLS routes
alter table public.routes enable row level security;

create policy "Supervisor or assistente full access on routes" on public.routes
  for all
  using (is_supervisor() or is_assistente())
  with check (is_supervisor() or is_assistente());

create policy "Vendedor can read assigned routes" on public.routes
  for select
  using (assigned_to_user_id = auth.uid());

-- RLS route_stops
alter table public.route_stops enable row level security;

create policy "Supervisor or assistente full access on route_stops" on public.route_stops
  for all
  using (is_supervisor() or is_assistente())
  with check (is_supervisor() or is_assistente());

create policy "Vendedor can read own route stops" on public.route_stops
  for select
  using (
    exists (
      select 1
      from public.routes r
      where r.id = route_stops.route_id
        and r.assigned_to_user_id = auth.uid()
    )
  );
