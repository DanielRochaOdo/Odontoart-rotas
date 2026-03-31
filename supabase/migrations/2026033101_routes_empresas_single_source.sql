set statement_timeout = 0;

alter table public.clientes
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geocode_source text,
  add column if not exists geocode_updated_at timestamptz,
  add column if not exists instructions text,
  add column if not exists visit_completed_vidas integer,
  add column if not exists visit_generated_at timestamptz,
  add column if not exists vendedor text,
  add column if not exists supervisor text;

create index if not exists clientes_lat_lng_idx on public.clientes(latitude, longitude);
create index if not exists clientes_city_uf_idx on public.clientes(cidade, uf);
create index if not exists clientes_codigo_idx on public.clientes(codigo);
create index if not exists clientes_empresa_nome_fantasia_idx on public.clientes(empresa, nome_fantasia);
create index if not exists agenda_cod_1_idx on public.agenda(cod_1);
create index if not exists agenda_empresa_nome_fantasia_idx on public.agenda(empresa, nome_fantasia);

with latest_by_codigo as (
  select distinct on (a.cod_1)
    a.cod_1,
    a.latitude,
    a.longitude,
    a.geocode_source,
    a.geocode_updated_at,
    a.instructions,
    a.visit_completed_vidas,
    a.visit_generated_at,
    a.vendedor,
    a.supervisor
  from public.agenda a
  where a.cod_1 is not null
  order by a.cod_1, a.data_da_ultima_visita desc nulls last, a.created_at desc
)
update public.clientes c
set
  latitude = coalesce(c.latitude, l.latitude),
  longitude = coalesce(c.longitude, l.longitude),
  geocode_source = coalesce(c.geocode_source, l.geocode_source),
  geocode_updated_at = coalesce(c.geocode_updated_at, l.geocode_updated_at),
  instructions = coalesce(c.instructions, l.instructions),
  visit_completed_vidas = coalesce(c.visit_completed_vidas, l.visit_completed_vidas),
  visit_generated_at = coalesce(c.visit_generated_at, l.visit_generated_at),
  vendedor = coalesce(c.vendedor, l.vendedor),
  supervisor = coalesce(c.supervisor, l.supervisor)
from latest_by_codigo l
where c.codigo is not null
  and c.codigo = l.cod_1
  and (
    c.latitude is null
    or c.longitude is null
    or c.geocode_source is null
    or c.geocode_updated_at is null
    or c.instructions is null
    or c.visit_completed_vidas is null
    or c.visit_generated_at is null
    or c.vendedor is null
    or c.supervisor is null
  );

with latest_by_nome as (
  select distinct on (a.empresa, a.nome_fantasia)
    a.empresa,
    a.nome_fantasia,
    a.latitude,
    a.longitude,
    a.geocode_source,
    a.geocode_updated_at,
    a.instructions,
    a.visit_completed_vidas,
    a.visit_generated_at,
    a.vendedor,
    a.supervisor
  from public.agenda a
  where a.empresa is not null or a.nome_fantasia is not null
  order by a.empresa, a.nome_fantasia, a.data_da_ultima_visita desc nulls last, a.created_at desc
)
update public.clientes c
set
  latitude = coalesce(c.latitude, l.latitude),
  longitude = coalesce(c.longitude, l.longitude),
  geocode_source = coalesce(c.geocode_source, l.geocode_source),
  geocode_updated_at = coalesce(c.geocode_updated_at, l.geocode_updated_at),
  instructions = coalesce(c.instructions, l.instructions),
  visit_completed_vidas = coalesce(c.visit_completed_vidas, l.visit_completed_vidas),
  visit_generated_at = coalesce(c.visit_generated_at, l.visit_generated_at),
  vendedor = coalesce(c.vendedor, l.vendedor),
  supervisor = coalesce(c.supervisor, l.supervisor)
from latest_by_nome l
where coalesce(c.empresa, '') = coalesce(l.empresa, '')
  and coalesce(c.nome_fantasia, '') = coalesce(l.nome_fantasia, '')
  and (
    c.latitude is null
    or c.longitude is null
    or c.geocode_source is null
    or c.geocode_updated_at is null
    or c.instructions is null
    or c.visit_completed_vidas is null
    or c.visit_generated_at is null
    or c.vendedor is null
    or c.supervisor is null
  );

alter table public.route_stops
  add column if not exists cliente_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'route_stops_cliente_id_fkey'
  ) then
    alter table public.route_stops
      add constraint route_stops_cliente_id_fkey
      foreign key (cliente_id)
      references public.clientes(id)
      on delete set null;
  end if;
end $$;

create index if not exists route_stops_cliente_idx on public.route_stops(cliente_id);

update public.route_stops rs
set cliente_id = pick.cliente_id
from public.agenda a
join lateral (
  select c.id as cliente_id
  from public.clientes c
  where c.codigo is not null
    and a.cod_1 is not null
    and c.codigo = a.cod_1
  order by c.created_at desc
  limit 1
) pick on true
where rs.agenda_id = a.id
  and rs.cliente_id is null;

update public.route_stops rs
set cliente_id = pick.cliente_id
from public.agenda a
join lateral (
  select c.id as cliente_id
  from public.clientes c
  where (a.empresa is not null or a.nome_fantasia is not null)
    and coalesce(c.empresa, '') = coalesce(a.empresa, '')
    and coalesce(c.nome_fantasia, '') = coalesce(a.nome_fantasia, '')
  order by c.created_at desc
  limit 1
) pick on true
where rs.agenda_id = a.id
  and rs.cliente_id is null;

create or replace function public.sync_route_stop_empresa_refs()
returns trigger
language plpgsql
as $$
declare
  source_codigo text;
  source_empresa text;
  source_fantasia text;
begin
  if new.cliente_id is null and new.agenda_id is not null then
    select a.cod_1, a.empresa, a.nome_fantasia
      into source_codigo, source_empresa, source_fantasia
    from public.agenda a
    where a.id = new.agenda_id;

    if found then
      select c.id
        into new.cliente_id
      from public.clientes c
      where (
        source_codigo is not null
        and c.codigo is not null
        and public.normalize_upper(c.codigo) = public.normalize_upper(source_codigo)
      )
      or (
        (source_empresa is not null or source_fantasia is not null)
        and public.normalize_upper(coalesce(c.empresa, '')) = public.normalize_upper(coalesce(source_empresa, ''))
        and public.normalize_upper(coalesce(c.nome_fantasia, '')) = public.normalize_upper(coalesce(source_fantasia, ''))
      )
      order by
        case
          when source_codigo is not null
            and c.codigo is not null
            and public.normalize_upper(c.codigo) = public.normalize_upper(source_codigo)
          then 0 else 1
        end,
        c.created_at desc
      limit 1;
    end if;
  end if;

  if new.agenda_id is null and new.cliente_id is not null then
    select c.codigo, c.empresa, c.nome_fantasia
      into source_codigo, source_empresa, source_fantasia
    from public.clientes c
    where c.id = new.cliente_id;

    if found then
      select a.id
        into new.agenda_id
      from public.agenda a
      where (
        source_codigo is not null
        and a.cod_1 is not null
        and public.normalize_upper(a.cod_1) = public.normalize_upper(source_codigo)
      )
      or (
        (source_empresa is not null or source_fantasia is not null)
        and public.normalize_upper(coalesce(a.empresa, '')) = public.normalize_upper(coalesce(source_empresa, ''))
        and public.normalize_upper(coalesce(a.nome_fantasia, '')) = public.normalize_upper(coalesce(source_fantasia, ''))
      )
      order by
        case
          when source_codigo is not null
            and a.cod_1 is not null
            and public.normalize_upper(a.cod_1) = public.normalize_upper(source_codigo)
          then 0 else 1
        end,
        a.created_at desc
      limit 1;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists route_stops_sync_empresa_refs on public.route_stops;
create trigger route_stops_sync_empresa_refs
before insert or update of agenda_id, cliente_id
on public.route_stops
for each row
execute function public.sync_route_stop_empresa_refs();
