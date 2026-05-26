-- Hotfix: RPC performance/timeout for empty-filter startup paths.
-- Preserves RLS/auth by keeping SECURITY INVOKER.

create or replace function public._rotas_filters_is_effectively_empty_v1(
  p_filters jsonb,
  p_company_name text,
  p_company_code text
)
returns boolean
language sql
immutable
as $$
  with root as (
    select coalesce(p_filters, '{}'::jsonb) as f
  ),
  columns_obj as (
    select coalesce(f->'columns', '{}'::jsonb) as c
    from root
  ),
  columns_has_any as (
    select exists (
      select 1
      from columns_obj
      cross join lateral jsonb_each(c) as e(k, v)
      where jsonb_typeof(v) = 'array'
        and jsonb_array_length(v) > 0
    ) as has_any
  ),
  date_obj as (
    select coalesce((select f #> '{dateRanges,data_da_ultima_visita}' from root), '{}'::jsonb) as d
  ),
  vidas_obj as (
    select coalesce((select f #> '{ranges,vidas_ultima_visita}' from root), '{}'::jsonb) as r
  )
  select
    nullif(btrim(coalesce((select f->>'global' from root), '')), '') is null
    and not (select has_any from columns_has_any)
    and nullif(btrim(coalesce((select d->>'from' from date_obj), '')), '') is null
    and nullif(btrim(coalesce((select d->>'to' from date_obj), '')), '') is null
    and nullif(btrim(coalesce((select d->>'month' from date_obj), '')), '') is null
    and nullif(btrim(coalesce((select d->>'year' from date_obj), '')), '') is null
    and coalesce((select (d->>'invert')::boolean from date_obj), false) = false
    and nullif(btrim(coalesce((select r->>'from' from vidas_obj), '')), '') is null
    and nullif(btrim(coalesce((select r->>'to' from vidas_obj), '')), '') is null
    and nullif(btrim(coalesce(p_company_name, '')), '') is null
    and nullif(btrim(coalesce(p_company_code, '')), '') is null;
$$;

create or replace function public.get_rotas_agenda_first_page_v2(
  p_page_size integer default 25,
  p_page_offset integer default 0,
  p_filters jsonb default '{}'::jsonb,
  p_company_name text default null,
  p_company_code text default null
)
returns table (
  id uuid,
  data_da_ultima_visita timestamptz,
  visit_completed_vidas integer,
  cod_1 text,
  empresa text,
  pessoa text,
  contato text,
  perfil_visita text,
  corte numeric,
  venc numeric,
  valor numeric,
  endereco text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  supervisor text,
  vendedor text,
  nome_fantasia text,
  grupo text,
  situacao text,
  categoria text,
  visit_generated_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_page_size integer := greatest(1, coalesce(p_page_size, 25));
  v_page_offset integer := greatest(0, coalesce(p_page_offset, 0));
  v_empty_filters boolean;
begin
  v_empty_filters := public._rotas_filters_is_effectively_empty_v1(
    p_filters,
    p_company_name,
    p_company_code
  );

  if v_empty_filters then
    return query
    select
      c.id,
      c.data_da_ultima_visita,
      c.visit_completed_vidas,
      c.codigo as cod_1,
      c.empresa,
      c.pessoa,
      c.contato,
      c.perfil_visita,
      c.corte,
      c.venc,
      c.valor,
      c.endereco,
      c.complemento,
      c.bairro,
      c.cidade,
      c.uf,
      c.supervisor,
      c.vendedor,
      c.nome_fantasia,
      c.grupo,
      c.situacao,
      c.categoria,
      c.visit_generated_at,
      c.created_at
    from public.clientes c
    where c.situacao in ('Ativo', 'ATIVO')
      and not exists (
        select 1
        from public.queue_release_controls q
        where q.empresa_id = c.id
          and (
            (q.state = 'BLOCKED_MANUAL' and (q.manual_block_until is null or q.manual_block_until > now()))
            or (q.state <> 'RELEASED_MANUAL' and q.eligible_at > now())
          )
      )
    order by c.visit_generated_at desc nulls last, c.data_da_ultima_visita desc nulls last, c.id asc
    offset v_page_offset
    limit v_page_size;
    return;
  end if;

  return query
  select *
  from public.get_rotas_agenda_filtered_v2(p_filters, p_company_name, p_company_code)
  order by visit_generated_at desc nulls last, data_da_ultima_visita desc nulls last, id asc
  offset v_page_offset
  limit v_page_size;
end;
$$;

create or replace function public.get_rotas_agenda_count_v1(
  p_filters jsonb default '{}'::jsonb,
  p_company_name text default null,
  p_company_code text default null
)
returns bigint
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_empty_filters boolean;
  v_total bigint;
begin
  v_empty_filters := public._rotas_filters_is_effectively_empty_v1(
    p_filters,
    p_company_name,
    p_company_code
  );

  if v_empty_filters then
    select count(*)::bigint
    into v_total
    from public.clientes c
    where c.situacao in ('Ativo', 'ATIVO')
      and not exists (
        select 1
        from public.queue_release_controls q
        where q.empresa_id = c.id
          and (
            (q.state = 'BLOCKED_MANUAL' and (q.manual_block_until is null or q.manual_block_until > now()))
            or (q.state <> 'RELEASED_MANUAL' and q.eligible_at > now())
          )
      );

    return coalesce(v_total, 0);
  end if;

  select count(*)::bigint
  into v_total
  from public.get_rotas_agenda_filtered_v2(p_filters, p_company_name, p_company_code);

  return coalesce(v_total, 0);
end;
$$;

create or replace function public.get_empresas_first_page_v1(
  p_page_size integer default 50,
  p_page_offset integer default 0,
  p_search text default null,
  p_search_mode text default 'codigo',
  p_situacao text default null
)
returns table (
  id uuid,
  codigo text,
  empresa text,
  pessoa text,
  contato text,
  grupo text,
  perfil_visita text,
  situacao text,
  cep text,
  cidade text,
  uf text,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_page_size integer := greatest(1, coalesce(p_page_size, 50));
  v_page_offset integer := greatest(0, coalesce(p_page_offset, 0));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_mode text := lower(coalesce(nullif(btrim(p_search_mode), ''), 'codigo'));
  v_situacao text := nullif(btrim(coalesce(p_situacao, '')), '');
begin
  if v_search is null then
    return query
    select
      c.id, c.codigo, c.empresa, c.pessoa, c.contato, c.grupo, c.perfil_visita, c.situacao, c.cep, c.cidade, c.uf, c.created_at
    from public.clientes c
    where (v_situacao is null or c.situacao = v_situacao)
    order by c.empresa asc nulls last, c.id asc
    offset v_page_offset
    limit v_page_size;
    return;
  end if;

  if v_mode = 'codigo' then
    return query
    select
      c.id, c.codigo, c.empresa, c.pessoa, c.contato, c.grupo, c.perfil_visita, c.situacao, c.cep, c.cidade, c.uf, c.created_at
    from public.clientes c
    where (v_situacao is null or c.situacao = v_situacao)
      and c.codigo = v_search
    order by c.empresa asc nulls last, c.id asc
    offset v_page_offset
    limit v_page_size;
    return;
  end if;

  if v_mode = 'empresa' then
    return query
    select
      c.id, c.codigo, c.empresa, c.pessoa, c.contato, c.grupo, c.perfil_visita, c.situacao, c.cep, c.cidade, c.uf, c.created_at
    from public.clientes c
    where (v_situacao is null or c.situacao = v_situacao)
      and c.empresa ilike ('%' || v_search || '%')
    order by c.empresa asc nulls last, c.id asc
    offset v_page_offset
    limit v_page_size;
    return;
  end if;

  return query
  select
    c.id, c.codigo, c.empresa, c.pessoa, c.contato, c.grupo, c.perfil_visita, c.situacao, c.cep, c.cidade, c.uf, c.created_at
  from public.clientes c
  where (v_situacao is null or c.situacao = v_situacao)
    and (
      c.codigo ilike ('%' || v_search || '%')
      or c.cep ilike ('%' || v_search || '%')
      or c.empresa ilike ('%' || v_search || '%')
      or c.nome_fantasia ilike ('%' || v_search || '%')
      or c.pessoa ilike ('%' || v_search || '%')
      or c.contato ilike ('%' || v_search || '%')
      or c.grupo ilike ('%' || v_search || '%')
      or c.obs_comercial ilike ('%' || v_search || '%')
      or c.obs ilike ('%' || v_search || '%')
      or c.situacao ilike ('%' || v_search || '%')
      or c.cidade ilike ('%' || v_search || '%')
      or c.uf ilike ('%' || v_search || '%')
      or c.bairro ilike ('%' || v_search || '%')
    )
  order by c.empresa asc nulls last, c.id asc
  offset v_page_offset
  limit v_page_size;
end;
$$;

create or replace function public.get_empresas_count_v1(
  p_search text default null,
  p_search_mode text default 'codigo',
  p_situacao text default null
)
returns bigint
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_mode text := lower(coalesce(nullif(btrim(p_search_mode), ''), 'codigo'));
  v_situacao text := nullif(btrim(coalesce(p_situacao, '')), '');
  v_total bigint;
begin
  if v_search is null then
    select count(*)::bigint
    into v_total
    from public.clientes c
    where (v_situacao is null or c.situacao = v_situacao);
    return coalesce(v_total, 0);
  end if;

  if v_mode = 'codigo' then
    select count(*)::bigint
    into v_total
    from public.clientes c
    where (v_situacao is null or c.situacao = v_situacao)
      and c.codigo = v_search;
    return coalesce(v_total, 0);
  end if;

  if v_mode = 'empresa' then
    select count(*)::bigint
    into v_total
    from public.clientes c
    where (v_situacao is null or c.situacao = v_situacao)
      and c.empresa ilike ('%' || v_search || '%');
    return coalesce(v_total, 0);
  end if;

  select count(*)::bigint
  into v_total
  from public.clientes c
  where (v_situacao is null or c.situacao = v_situacao)
    and (
      c.codigo ilike ('%' || v_search || '%')
      or c.cep ilike ('%' || v_search || '%')
      or c.empresa ilike ('%' || v_search || '%')
      or c.nome_fantasia ilike ('%' || v_search || '%')
      or c.pessoa ilike ('%' || v_search || '%')
      or c.contato ilike ('%' || v_search || '%')
      or c.grupo ilike ('%' || v_search || '%')
      or c.obs_comercial ilike ('%' || v_search || '%')
      or c.obs ilike ('%' || v_search || '%')
      or c.situacao ilike ('%' || v_search || '%')
      or c.cidade ilike ('%' || v_search || '%')
      or c.uf ilike ('%' || v_search || '%')
      or c.bairro ilike ('%' || v_search || '%')
    );

  return coalesce(v_total, 0);
end;
$$;

-- Optional supporting index for anti-join on queue_release_controls by empresa/state.
create index if not exists queue_release_controls_empresa_state_idx
  on public.queue_release_controls (empresa_id, state, eligible_at, manual_block_until);

-- Rollback
-- drop index if exists public.queue_release_controls_empresa_state_idx;
-- drop function if exists public.get_empresas_count_v1(text, text, text);
-- drop function if exists public.get_empresas_first_page_v1(integer, integer, text, text, text);
-- drop function if exists public.get_rotas_agenda_count_v1(jsonb, text, text);
-- drop function if exists public.get_rotas_agenda_first_page_v2(integer, integer, jsonb, text, text);
-- drop function if exists public._rotas_filters_is_effectively_empty_v1(jsonb, text, text);
