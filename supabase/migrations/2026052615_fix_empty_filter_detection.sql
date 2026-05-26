-- Reinforce empty-filter detection for Rotas RPC.
-- Treats default UI payload as effectively empty, including optional default situacao values.

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
  raw_columns as (
    select coalesce(f->'columns', '{}'::jsonb) as c
    from root
  ),
  situacao_values as (
    select coalesce(array_agg(value), '{}'::text[]) as values
    from raw_columns
    left join lateral jsonb_array_elements_text(coalesce(c->'situacao', '[]'::jsonb)) as s(value) on true
  ),
  non_situacao_has_any as (
    select exists (
      select 1
      from raw_columns
      cross join lateral jsonb_each(c) as e(k, v)
      where k <> 'situacao'
        and jsonb_typeof(v) = 'array'
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
    and not (select has_any from non_situacao_has_any)
    and (
      cardinality((select values from situacao_values)) = 0
      or (
        cardinality((select values from situacao_values)) <= 2
        and not exists (
          select 1
          from unnest((select values from situacao_values)) as v(value)
          where upper(btrim(value)) not in ('ATIVO')
        )
      )
    )
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

-- Rollback
-- Re-apply previous definition from 2026052614_rpc_perf_hotfix.sql.
