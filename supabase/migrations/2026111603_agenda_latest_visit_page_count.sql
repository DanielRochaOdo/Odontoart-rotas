-- Support the route-presence ordering without fetching every candidate visit.
create index if not exists visits_agenda_upcoming_route_cliente_date_idx
  on public.visits (cliente_id, visit_date)
  where route_id is not null and completed_at is null;

-- Return only the requested page and its exact count. Candidate IDs stay inside
-- Postgres, avoiding hundreds of browser requests for broad month/category filters.
create or replace function public.get_rotas_agenda_latest_visit_page_v1(
  p_filters jsonb default '{}'::jsonb,
  p_company_name text default null,
  p_company_code text default null,
  p_company_address text default null,
  p_from date default null,
  p_to date default null,
  p_invert boolean default false,
  p_page_size integer default 25,
  p_page_offset integer default 0
)
returns table (rows jsonb, total_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
with matching_ids as materialized (
  select matches.id
  from public.get_rotas_agenda_latest_visit_ids_v2(
    coalesce(p_filters, '{}'::jsonb),
    p_company_name,
    p_company_code,
    p_company_address,
    p_from,
    p_to,
    p_invert
  ) as matches
),
page_rows as materialized (
  select
    c.id,
    c.data_da_ultima_visita,
    c.visit_completed_vidas,
    c.codigo as cod_1,
    c.empresa,
    c.cep,
    c.pessoa,
    c.contato,
    c.perfil_visita,
    c.corte,
    c.venc,
    c.valor,
    c.reajuste_pct,
    c.vidas_qtde,
    c.endereco,
    c.complemento,
    c.bairro,
    c.cidade,
    c.uf,
    c.supervisor,
    c.vendedor,
    c.nome_fantasia,
    c.grupo,
    c.obs_comercial,
    c.situacao,
    c.categoria,
    c.regra_visita_observacao,
    c.visit_generated_at,
    c.created_at,
    exists (
      select 1
      from public.visits upcoming
      where upcoming.cliente_id = c.id
        and upcoming.route_id is not null
        and upcoming.completed_at is null
        and upcoming.visit_date >= (now() at time zone 'America/Fortaleza')::date
    ) as has_upcoming_route
  from matching_ids matches
  join public.clientes c on c.id = matches.id
  order by
    has_upcoming_route desc,
    (c.data_da_ultima_visita is null) desc,
    c.data_da_ultima_visita asc nulls last,
    c.id asc
  limit least(greatest(coalesce(p_page_size, 25), 1), 200)
  offset greatest(coalesce(p_page_offset, 0), 0)
)
select
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'data_da_ultima_visita', p.data_da_ultima_visita,
          'visit_completed_vidas', p.visit_completed_vidas,
          'cod_1', p.cod_1,
          'empresa', p.empresa,
          'cep', p.cep,
          'pessoa', p.pessoa,
          'contato', p.contato,
          'perfil_visita', p.perfil_visita,
          'corte', p.corte,
          'venc', p.venc,
          'valor', p.valor,
          'reajuste_pct', p.reajuste_pct,
          'vidas_qtde', p.vidas_qtde,
          'endereco', p.endereco,
          'complemento', p.complemento,
          'bairro', p.bairro,
          'cidade', p.cidade,
          'uf', p.uf,
          'supervisor', p.supervisor,
          'vendedor', p.vendedor,
          'nome_fantasia', p.nome_fantasia,
          'grupo', p.grupo,
          'obs_comercial', p.obs_comercial,
          'situacao', p.situacao,
          'categoria', p.categoria,
          'regra_visita_observacao', p.regra_visita_observacao,
          'visit_generated_at', p.visit_generated_at,
          'created_at', p.created_at,
          'has_upcoming_route', p.has_upcoming_route
        )
        order by
          p.has_upcoming_route desc,
          (p.data_da_ultima_visita is null) desc,
          p.data_da_ultima_visita asc nulls last,
          p.id asc
      )
      from page_rows p
    ),
    '[]'::jsonb
  ) as rows,
  (select count(*)::bigint from matching_ids) as total_count;
$$;

revoke all on function public.get_rotas_agenda_latest_visit_page_v1(
  jsonb, text, text, text, date, date, boolean, integer, integer
) from public, anon;
grant execute on function public.get_rotas_agenda_latest_visit_page_v1(
  jsonb, text, text, text, date, date, boolean, integer, integer
) to authenticated;
