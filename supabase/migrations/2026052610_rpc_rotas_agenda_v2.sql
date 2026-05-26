-- Rotas/Agenda RPCs v2
-- Goals:
-- 1) remove huge id=not.in(...) from frontend critical path
-- 2) preserve RLS (security invoker)
-- 3) keep first-page and count using identical filters/exclusion logic

create or replace function public._jsonb_text_array_v2(p jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(trim(value)), '{}'::text[])
  from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) as t(value)
  where trim(value) <> '';
$$;

create or replace function public.get_rotas_agenda_filtered_v2(
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
language sql
stable
security invoker
set search_path = public
as $$
with f as (
  select
    nullif(btrim(coalesce(p_filters->>'global', '')), '') as global_term,
    coalesce(p_filters->'columns', '{}'::jsonb) as columns_json,
    coalesce(p_filters#>'{dateRanges,data_da_ultima_visita}', '{}'::jsonb) as date_json,
    coalesce(p_filters#>'{ranges,vidas_ultima_visita}', '{}'::jsonb) as vidas_json
),
typed as (
  select
    global_term,
    public._jsonb_text_array_v2(columns_json->'supervisor') as arr_supervisor,
    public._jsonb_text_array_v2(columns_json->'vendedor') as arr_vendedor,
    public._jsonb_text_array_v2(columns_json->'cod_1') as arr_codigo,
    public._jsonb_text_array_v2(columns_json->'bairro') as arr_bairro,
    public._jsonb_text_array_v2(columns_json->'cidade') as arr_cidade,
    public._jsonb_text_array_v2(columns_json->'uf') as arr_uf,
    public._jsonb_text_array_v2(columns_json->'grupo') as arr_grupo,
    public._jsonb_text_array_v2(columns_json->'perfil_visita') as arr_perfil,
    public._jsonb_text_array_v2(columns_json->'empresa_nome') as arr_empresa_nome,
    public._jsonb_text_array_v2(columns_json->'situacao') as arr_situacao,
    public._jsonb_text_array_v2(columns_json->'categoria') as arr_categoria,
    nullif(date_json->>'from', '')::date as date_from,
    nullif(date_json->>'to', '')::date as date_to,
    nullif(date_json->>'month', '')::integer as date_month,
    nullif(date_json->>'year', '')::integer as date_year,
    coalesce((date_json->>'invert')::boolean, false) as date_invert,
    nullif(vidas_json->>'from', '')::integer as vidas_from,
    nullif(vidas_json->>'to', '')::integer as vidas_to
  from f
),
normalized as (
  select
    global_term,
    arr_supervisor,
    arr_vendedor,
    arr_codigo,
    arr_bairro,
    arr_cidade,
    arr_uf,
    arr_grupo,
    arr_perfil,
    arr_empresa_nome,
    case
      when cardinality(arr_situacao) = 0 then array['Ativo', 'ATIVO']::text[]
      else arr_situacao
    end as arr_situacao,
    arr_categoria,
    date_from,
    date_to,
    date_month,
    date_year,
    date_invert,
    vidas_from,
    vidas_to,
    (
      date_month is not null
      or date_year is not null
      or date_from is not null
      or date_to is not null
    ) as has_date_filter
  from typed
),
date_bounds as (
  select
    *,
    case
      when date_month is not null or date_year is not null then
        make_date(
          coalesce(date_year, extract(year from current_date)::integer),
          coalesce(date_month, 1),
          1
        )
      else null
    end as month_start,
    case
      when date_month is not null or date_year is not null then
        case
          when date_month is null then
            make_date(coalesce(date_year, extract(year from current_date)::integer) + 1, 1, 1)
          else
            (
              make_date(
                coalesce(date_year, extract(year from current_date)::integer),
                date_month,
                1
              ) + interval '1 month'
            )::date
        end
      else null
    end as month_end_exclusive
  from normalized
)
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
cross join date_bounds b
where
  (p_company_code is null or p_company_code = '' or c.codigo = p_company_code)
  and (p_company_name is null or p_company_name = '' or c.empresa ilike ('%' || p_company_name || '%'))
  and (b.global_term is null or (
    c.empresa ilike ('%' || b.global_term || '%')
    or c.cidade ilike ('%' || b.global_term || '%')
    or c.uf ilike ('%' || b.global_term || '%')
    or c.vendedor ilike ('%' || b.global_term || '%')
    or c.supervisor ilike ('%' || b.global_term || '%')
    or c.situacao ilike ('%' || b.global_term || '%')
    or c.categoria ilike ('%' || b.global_term || '%')
    or c.grupo ilike ('%' || b.global_term || '%')
    or c.perfil_visita ilike ('%' || b.global_term || '%')
    or c.endereco ilike ('%' || b.global_term || '%')
    or c.bairro ilike ('%' || b.global_term || '%')
  ))
  and (cardinality(b.arr_supervisor) = 0 or c.supervisor = any(b.arr_supervisor))
  and (cardinality(b.arr_vendedor) = 0 or c.vendedor = any(b.arr_vendedor))
  and (cardinality(b.arr_codigo) = 0 or c.codigo = any(b.arr_codigo))
  and (cardinality(b.arr_bairro) = 0 or c.bairro = any(b.arr_bairro))
  and (cardinality(b.arr_cidade) = 0 or c.cidade = any(b.arr_cidade))
  and (cardinality(b.arr_uf) = 0 or c.uf = any(b.arr_uf))
  and (cardinality(b.arr_grupo) = 0 or c.grupo = any(b.arr_grupo))
  and (
    cardinality(b.arr_perfil) = 0
    or exists (
      select 1
      from unnest(b.arr_perfil) as p(value)
      where
        (
          upper(trim(p.value)) = 'ALMOCO' and c.perfil_visita ilike '%ALMO%'
        ) or (
          upper(trim(p.value)) = 'JANTAR' and c.perfil_visita ilike '%JANTAR%'
        ) or (
          upper(trim(p.value)) = 'HORARIO COMERCIAL' and c.perfil_visita ilike '%COMERCIAL%'
        ) or (
          upper(trim(p.value)) = 'HORARIO CUSTOMIZADO' and c.perfil_visita ilike '%CUSTOMIZADO%'
        ) or (
          upper(trim(p.value)) not in ('ALMOCO', 'JANTAR', 'HORARIO COMERCIAL', 'HORARIO CUSTOMIZADO')
          and c.perfil_visita = p.value
        )
    )
  )
  and (cardinality(b.arr_empresa_nome) = 0 or c.empresa = any(b.arr_empresa_nome))
  and (cardinality(b.arr_situacao) = 0 or c.situacao = any(b.arr_situacao))
  and (
    cardinality(b.arr_categoria) = 0
    or (
      'SEM CATEGORIA' = any(b.arr_categoria)
      and (
        c.categoria is null
        or btrim(c.categoria) = ''
        or c.categoria = any(array_remove(b.arr_categoria, 'SEM CATEGORIA'))
      )
    )
    or (
      not ('SEM CATEGORIA' = any(b.arr_categoria))
      and c.categoria = any(b.arr_categoria)
    )
  )
  and (
    not b.has_date_filter
    or (
      b.date_month is not null or b.date_year is not null
    ) and (
      (
        b.date_invert
        and c.data_da_ultima_visita::date >= b.month_start
        and c.data_da_ultima_visita::date < b.month_end_exclusive
      )
      or (
        not b.date_invert
        and (
          c.data_da_ultima_visita is null
          or c.data_da_ultima_visita::date < b.month_start
          or c.data_da_ultima_visita::date >= b.month_end_exclusive
        )
      )
    )
    or (
      b.date_month is null and b.date_year is null
      and (
        (
          b.date_invert
          and (b.date_from is null or c.data_da_ultima_visita::date >= b.date_from)
          and (b.date_to is null or c.data_da_ultima_visita::date <= b.date_to)
        )
        or (
          not b.date_invert
          and (
            c.data_da_ultima_visita is null
            or (b.date_from is not null and c.data_da_ultima_visita::date < b.date_from)
            or (b.date_to is not null and c.data_da_ultima_visita::date > b.date_to)
          )
        )
      )
    )
  )
  and (b.vidas_from is null or c.visit_completed_vidas >= b.vidas_from)
  and (b.vidas_to is null or c.visit_completed_vidas <= b.vidas_to)
  and not exists (
    select 1
    from public.queue_release_controls_view q
    where q.empresa_id = c.id
      and q.effective_state in ('PENDING_WAIT', 'BLOCKED_MANUAL')
  );
$$;

grant execute on function public.get_rotas_agenda_filtered_v2(jsonb, text, text) to authenticated;

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
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.get_rotas_agenda_filtered_v2(p_filters, p_company_name, p_company_code)
  order by visit_generated_at desc nulls last, data_da_ultima_visita desc nulls last, id asc
  offset greatest(0, p_page_offset)
  limit greatest(1, p_page_size);
$$;

grant execute on function public.get_rotas_agenda_first_page_v2(integer, integer, jsonb, text, text) to authenticated;

create or replace function public.get_rotas_agenda_count_v1(
  p_filters jsonb default '{}'::jsonb,
  p_company_name text default null,
  p_company_code text default null
)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::bigint
  from public.get_rotas_agenda_filtered_v2(p_filters, p_company_name, p_company_code);
$$;

grant execute on function public.get_rotas_agenda_count_v1(jsonb, text, text) to authenticated;

-- Rollback
-- drop function if exists public.get_rotas_agenda_count_v1(jsonb, text, text);
-- drop function if exists public.get_rotas_agenda_first_page_v2(integer, integer, jsonb, text, text);
-- drop function if exists public.get_rotas_agenda_filtered_v2(jsonb, text, text);
-- drop function if exists public._jsonb_text_array_v2(jsonb);
