create extension if not exists unaccent;

create or replace function public.normalize_upper(input text)
returns text
language sql
immutable
as $$
  select nullif(
    upper(
      regexp_replace(
        unaccent(trim(input)),
        '\s+',
        ' ',
        'g'
      )
    ),
    ''
  );
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
