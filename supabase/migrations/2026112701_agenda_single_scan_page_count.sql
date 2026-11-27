-- Return the common Agenda page and exact count from one materialized match set.
-- This avoids scanning the same eligible clients in two concurrent RPCs.
create or replace function public.get_rotas_agenda_page_and_count_v1(
  p_page_size integer default 25,
  p_page_offset integer default 0,
  p_filters jsonb default '{}'::jsonb,
  p_company_name text default null,
  p_company_code text default null
)
returns table (rows jsonb, total_count bigint)
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
    with matching as materialized (
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
        c.created_at,
        exists (
          select 1
          from public.visits v
          where v.cliente_id = c.id
            and v.route_id is not null
            and v.completed_at is null
            and v.visit_date >= (now() at time zone 'America/Fortaleza')::date
        ) as has_upcoming_route
      from public.clientes c
      where c.situacao in ('Ativo', 'ATIVO')
        and not exists (
          select 1
          from public.queue_release_controls q
          where q.empresa_id = c.id
            and (
              (q.state = 'BLOCKED_MANUAL'
                and (q.manual_block_until is null or q.manual_block_until > now()))
              or (q.state <> 'RELEASED_MANUAL'
                and (
                  q.eligible_at > now()
                  or (q.eligible_at <= now()
                    and q.eligible_at >= timestamptz '2026-06-02 00:00:00-03')
                ))
            )
        )
    ),
    page_rows as materialized (
      select *
      from matching
      order by
        has_upcoming_route desc,
        (data_da_ultima_visita is null) desc,
        data_da_ultima_visita asc nulls last,
        id asc
      limit v_page_size
      offset v_page_offset
    )
    select
      coalesce(
        (
          select jsonb_agg(
            to_jsonb(p) - 'has_upcoming_route'
            order by
              p.has_upcoming_route desc,
              (p.data_da_ultima_visita is null) desc,
              p.data_da_ultima_visita asc nulls last,
              p.id asc
          )
          from page_rows p
        ),
        '[]'::jsonb
      ),
      (select count(*)::bigint from matching);
  else
    return query
    with matching as materialized (
      select
        f.*,
        exists (
          select 1
          from public.visits v
          where v.cliente_id = f.id
            and v.route_id is not null
            and v.completed_at is null
            and v.visit_date >= (now() at time zone 'America/Fortaleza')::date
        ) as has_upcoming_route
      from public.get_rotas_agenda_filtered_v2(
        coalesce(p_filters, '{}'::jsonb),
        p_company_name,
        p_company_code
      ) f
    ),
    page_rows as materialized (
      select *
      from matching
      order by
        has_upcoming_route desc,
        (data_da_ultima_visita is null) desc,
        data_da_ultima_visita asc nulls last,
        id asc
      limit v_page_size
      offset v_page_offset
    )
    select
      coalesce(
        (
          select jsonb_agg(
            to_jsonb(p) - 'has_upcoming_route'
            order by
              p.has_upcoming_route desc,
              (p.data_da_ultima_visita is null) desc,
              p.data_da_ultima_visita asc nulls last,
              p.id asc
          )
          from page_rows p
        ),
        '[]'::jsonb
      ),
      (select count(*)::bigint from matching);
  end if;
end;
$$;

revoke all on function public.get_rotas_agenda_page_and_count_v1(
  integer, integer, jsonb, text, text
) from public, anon;
grant execute on function public.get_rotas_agenda_page_and_count_v1(
  integer, integer, jsonb, text, text
) to authenticated;
