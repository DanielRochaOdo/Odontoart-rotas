-- Keep the common category + latest-visit filter out of the wide table-returning
-- agenda RPC. This path reads only candidate IDs and performs indexed visit lookups.
create index if not exists clientes_agenda_situacao_categoria_id_idx
  on public.clientes (situacao, categoria, id);

create or replace function public.get_rotas_agenda_latest_visit_ids_v2(
  p_filters jsonb default '{}'::jsonb,
  p_company_name text default null,
  p_company_code text default null,
  p_company_address text default null,
  p_from date default null,
  p_to date default null,
  p_invert boolean default false
)
returns table (id uuid)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_columns jsonb := coalesce(p_filters->'columns', '{}'::jsonb);
  v_categoria text[] := public._jsonb_text_array_v2(v_columns->'categoria');
  v_situacao text[] := public._jsonb_text_array_v2(v_columns->'situacao');
  v_has_unsupported_columns boolean;
  v_has_other_filters boolean;
begin
  select exists (
    select 1
    from jsonb_each(v_columns) as e(key, value)
    where e.key not in ('categoria', 'situacao')
      and case
        when jsonb_typeof(e.value) = 'array' then jsonb_array_length(e.value) > 0
        else false
      end
  ) into v_has_unsupported_columns;

  v_has_other_filters :=
    nullif(btrim(coalesce(p_filters->>'global', '')), '') is not null
    or v_has_unsupported_columns
    or coalesce(p_filters->'ranges', '{}'::jsonb) <> '{}'::jsonb
    or coalesce(p_filters->'dateRanges', '{}'::jsonb) <> '{}'::jsonb;

  if cardinality(v_categoria) = 0 or v_has_other_filters then
    return query
    select fallback.id
    from public.get_rotas_agenda_latest_visit_ids_v1(
      p_filters,
      p_company_name,
      p_company_code,
      p_company_address,
      p_from,
      p_to,
      p_invert
    ) as fallback;
    return;
  end if;

  if cardinality(v_situacao) = 0 then
    v_situacao := array['Ativo', 'ATIVO']::text[];
  end if;

  return query
  with candidates as materialized (
    select c.id
    from public.clientes c
    where c.situacao = any(v_situacao)
      and (
        (
          'SEM CATEGORIA' = any(v_categoria)
          and (
            c.categoria is null
            or btrim(c.categoria) = ''
            or c.categoria = any(array_remove(v_categoria, 'SEM CATEGORIA'))
          )
        )
        or (
          not ('SEM CATEGORIA' = any(v_categoria))
          and c.categoria = any(v_categoria)
        )
      )
      and (nullif(btrim(p_company_code), '') is null or c.codigo = btrim(p_company_code))
      and (
        nullif(btrim(p_company_name), '') is null
        or c.empresa ilike ('%' || btrim(p_company_name) || '%')
        or c.nome_fantasia ilike ('%' || btrim(p_company_name) || '%')
      )
      and (
        nullif(btrim(p_company_address), '') is null
        or c.endereco ilike ('%' || btrim(p_company_address) || '%')
      )
      and not exists (
        select 1
        from public.queue_release_controls_view q
        where q.empresa_id = c.id
          and q.effective_state in ('PENDING_WAIT', 'RELEASE_PENDING', 'BLOCKED_MANUAL')
      )
  )
  select candidates.id
  from candidates
  cross join lateral (
    select v.visit_date::date as latest_visit_date
    from public.visits v
    where v.cliente_id = candidates.id
      and v.completed_at is not null
      and v.visit_date is not null
      and (v.visit_type = 'VENDEDOR' or v.visit_type is null)
    order by v.completed_at desc, v.visit_date desc
    limit 1
  ) as latest_visit
  where (
      (
        coalesce(p_invert, false)
        and (
          (p_from is not null and latest_visit.latest_visit_date < p_from)
          or (p_to is not null and latest_visit.latest_visit_date > p_to)
        )
      )
      or (
        not coalesce(p_invert, false)
        and (p_from is null or latest_visit.latest_visit_date >= p_from)
        and (p_to is null or latest_visit.latest_visit_date <= p_to)
      )
    )
  order by candidates.id;
end;
$$;

revoke all on function public.get_rotas_agenda_latest_visit_ids_v2(
  jsonb, text, text, text, date, date, boolean
) from public, anon;
grant execute on function public.get_rotas_agenda_latest_visit_ids_v2(
  jsonb, text, text, text, date, date, boolean
) to authenticated;
