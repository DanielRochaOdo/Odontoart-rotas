create or replace function public.normalize_upper(input text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(trim(input), '\s+', ' ', 'g')), '');
$$;

create or replace function public.normalize_agenda_text()
returns trigger
language plpgsql
as $$
begin
  new.cod_1 = public.normalize_upper(new.cod_1);
  new.empresa = public.normalize_upper(new.empresa);
  new.perfil_visita = public.normalize_upper(new.perfil_visita);
  new.tit = public.normalize_upper(new.tit);
  new.endereco = public.normalize_upper(new.endereco);
  new.bairro = public.normalize_upper(new.bairro);
  new.cidade = public.normalize_upper(new.cidade);
  new.uf = public.normalize_upper(new.uf);
  new.supervisor = public.normalize_upper(new.supervisor);
  new.vendedor = public.normalize_upper(new.vendedor);
  new.cod_2 = public.normalize_upper(new.cod_2);
  new.nome_fantasia = public.normalize_upper(new.nome_fantasia);
  new.grupo = public.normalize_upper(new.grupo);
  new.situacao = public.normalize_upper(new.situacao);
  new.obs_contrato_1 = public.normalize_upper(new.obs_contrato_1);
  new.obs_contrato_2 = public.normalize_upper(new.obs_contrato_2);
  new.visit_assigned_to = public.normalize_upper(new.visit_assigned_to);
  return new;
end;
$$;

drop trigger if exists normalize_agenda_text on public.agenda;
create trigger normalize_agenda_text
before insert or update on public.agenda
for each row execute function public.normalize_agenda_text();

create or replace function public.normalize_clientes_text()
returns trigger
language plpgsql
as $$
begin
  new.codigo = public.normalize_upper(new.codigo);
  new.empresa = public.normalize_upper(new.empresa);
  new.nome_fantasia = public.normalize_upper(new.nome_fantasia);
  new.perfil_visita = public.normalize_upper(new.perfil_visita);
  new.endereco = public.normalize_upper(new.endereco);
  new.bairro = public.normalize_upper(new.bairro);
  new.cidade = public.normalize_upper(new.cidade);
  new.uf = public.normalize_upper(new.uf);
  new.situacao = public.normalize_upper(new.situacao);
  return new;
end;
$$;

drop trigger if exists normalize_clientes_text on public.clientes;
create trigger normalize_clientes_text
before insert or update on public.clientes
for each row execute function public.normalize_clientes_text();

create or replace function public.normalize_profiles_text()
returns trigger
language plpgsql
as $$
begin
  new.display_name = public.normalize_upper(new.display_name);
  return new;
end;
$$;

drop trigger if exists normalize_profiles_text on public.profiles;
create trigger normalize_profiles_text
before insert or update on public.profiles
for each row execute function public.normalize_profiles_text();

create or replace function public.normalize_routes_text()
returns trigger
language plpgsql
as $$
begin
  new.name = public.normalize_upper(new.name);
  return new;
end;
$$;

drop trigger if exists normalize_routes_text on public.routes;
create trigger normalize_routes_text
before insert or update on public.routes
for each row execute function public.normalize_routes_text();

create or replace function public.normalize_route_stops_text()
returns trigger
language plpgsql
as $$
begin
  new.notes = public.normalize_upper(new.notes);
  return new;
end;
$$;

drop trigger if exists normalize_route_stops_text on public.route_stops;
create trigger normalize_route_stops_text
before insert or update on public.route_stops
for each row execute function public.normalize_route_stops_text();

create or replace function public.normalize_visits_text()
returns trigger
language plpgsql
as $$
begin
  new.assigned_to_name = public.normalize_upper(new.assigned_to_name);
  new.perfil_visita = public.normalize_upper(new.perfil_visita);
  new.no_visit_reason = public.normalize_upper(new.no_visit_reason);
  return new;
end;
$$;

drop trigger if exists normalize_visits_text on public.visits;
create trigger normalize_visits_text
before insert or update on public.visits
for each row execute function public.normalize_visits_text();

create or replace function public.current_display_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.normalize_upper(display_name) from public.profiles where user_id = auth.uid();
$$;

update public.agenda
set
  cod_1 = public.normalize_upper(cod_1),
  empresa = public.normalize_upper(empresa),
  perfil_visita = public.normalize_upper(perfil_visita),
  tit = public.normalize_upper(tit),
  endereco = public.normalize_upper(endereco),
  bairro = public.normalize_upper(bairro),
  cidade = public.normalize_upper(cidade),
  uf = public.normalize_upper(uf),
  supervisor = public.normalize_upper(supervisor),
  vendedor = public.normalize_upper(vendedor),
  cod_2 = public.normalize_upper(cod_2),
  nome_fantasia = public.normalize_upper(nome_fantasia),
  grupo = public.normalize_upper(grupo),
  situacao = public.normalize_upper(situacao),
  obs_contrato_1 = public.normalize_upper(obs_contrato_1),
  obs_contrato_2 = public.normalize_upper(obs_contrato_2),
  visit_assigned_to = public.normalize_upper(visit_assigned_to);

update public.clientes
set
  codigo = public.normalize_upper(codigo),
  empresa = public.normalize_upper(empresa),
  nome_fantasia = public.normalize_upper(nome_fantasia),
  perfil_visita = public.normalize_upper(perfil_visita),
  endereco = public.normalize_upper(endereco),
  bairro = public.normalize_upper(bairro),
  cidade = public.normalize_upper(cidade),
  uf = public.normalize_upper(uf),
  situacao = public.normalize_upper(situacao);

update public.profiles
set display_name = public.normalize_upper(display_name);

update public.routes
set name = public.normalize_upper(name);

update public.route_stops
set notes = public.normalize_upper(notes);

update public.visits
set
  assigned_to_name = public.normalize_upper(assigned_to_name),
  perfil_visita = public.normalize_upper(perfil_visita),
  no_visit_reason = public.normalize_upper(no_visit_reason);
