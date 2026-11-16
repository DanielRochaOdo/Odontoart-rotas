-- Index the visit lookups used by Agenda's latest completed vendor-visit filter.
-- Null visit_type is treated as VENDEDOR by the existing filter semantics.
create index if not exists visits_agenda_latest_vendor_order_idx
  on public.visits (completed_at desc, visit_date desc, cliente_id)
  where cliente_id is not null
    and completed_at is not null
    and visit_date is not null
    and (visit_type = 'VENDEDOR' or visit_type is null);

create index if not exists visits_agenda_latest_vendor_cliente_idx
  on public.visits (cliente_id, completed_at desc, visit_date desc)
  where cliente_id is not null
    and completed_at is not null
    and visit_date is not null
    and (visit_type = 'VENDEDOR' or visit_type is null);

-- Resolve the latest completed vendor visit and its date range in Postgres.
-- This avoids fetching every matching client/visit into the browser.
create or replace function public.get_rotas_agenda_latest_visit_ids_v1(
  p_filters jsonb default '{}'::jsonb,
  p_company_name text default null,
  p_company_code text default null,
  p_company_address text default null,
  p_from date default null,
  p_to date default null,
  p_invert boolean default false
)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select agenda_rows.id
  from public.get_rotas_agenda_filtered_v2(
    coalesce(p_filters, '{}'::jsonb),
    null,
    p_company_code
  ) as agenda_rows
  cross join lateral (
    select v.visit_date::date as latest_visit_date
    from public.visits v
    where v.cliente_id = agenda_rows.id
      and v.completed_at is not null
      and v.visit_date is not null
      and (v.visit_type = 'VENDEDOR' or v.visit_type is null)
    order by v.completed_at desc, v.visit_date desc
    limit 1
  ) as latest_visit
  where (nullif(btrim(p_company_name), '') is null
      or agenda_rows.empresa ilike ('%' || btrim(p_company_name) || '%')
      or agenda_rows.nome_fantasia ilike ('%' || btrim(p_company_name) || '%'))
    and (nullif(btrim(p_company_address), '') is null
      or agenda_rows.endereco ilike ('%' || btrim(p_company_address) || '%'))
    and (
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
  order by agenda_rows.id;
$$;

revoke all on function public.get_rotas_agenda_latest_visit_ids_v1(
  jsonb, text, text, text, date, date, boolean
) from public, anon;
grant execute on function public.get_rotas_agenda_latest_visit_ids_v1(
  jsonb, text, text, text, date, date, boolean
) to authenticated;
