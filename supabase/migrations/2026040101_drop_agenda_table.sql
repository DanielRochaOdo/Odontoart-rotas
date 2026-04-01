set statement_timeout = 0;

-- Final backfill for legacy rows that still rely on agenda_id.
do $$
begin
  if to_regclass('public.agenda') is null then
    return;
  end if;

  update public.visits v
     set cliente_id = pick.cliente_id
    from public.agenda a
    join lateral (
      select c.id as cliente_id
      from public.clientes c
      where (
        a.cod_1 is not null
        and c.codigo is not null
        and public.normalize_upper(c.codigo) = public.normalize_upper(a.cod_1)
      )
      or (
        (a.empresa is not null or a.nome_fantasia is not null)
        and public.normalize_upper(coalesce(c.empresa, '')) = public.normalize_upper(coalesce(a.empresa, ''))
        and public.normalize_upper(coalesce(c.nome_fantasia, '')) = public.normalize_upper(coalesce(a.nome_fantasia, ''))
      )
      order by
        case
          when a.cod_1 is not null
            and c.codigo is not null
            and public.normalize_upper(c.codigo) = public.normalize_upper(a.cod_1)
          then 0 else 1
        end,
        c.created_at desc
      limit 1
    ) pick on true
  where v.cliente_id is null
    and v.agenda_id = a.id;

  update public.route_stops rs
     set cliente_id = pick.cliente_id
    from public.agenda a
    join lateral (
      select c.id as cliente_id
      from public.clientes c
      where (
        a.cod_1 is not null
        and c.codigo is not null
        and public.normalize_upper(c.codigo) = public.normalize_upper(a.cod_1)
      )
      or (
        (a.empresa is not null or a.nome_fantasia is not null)
        and public.normalize_upper(coalesce(c.empresa, '')) = public.normalize_upper(coalesce(a.empresa, ''))
        and public.normalize_upper(coalesce(c.nome_fantasia, '')) = public.normalize_upper(coalesce(a.nome_fantasia, ''))
      )
      order by
        case
          when a.cod_1 is not null
            and c.codigo is not null
            and public.normalize_upper(c.codigo) = public.normalize_upper(a.cod_1)
          then 0 else 1
        end,
        c.created_at desc
      limit 1
    ) pick on true
  where rs.cliente_id is null
    and rs.agenda_id = a.id;
end $$;

-- Remove compatibility triggers that still depend on agenda/agenda_id.
drop trigger if exists visits_sync_empresa_refs on public.visits;
drop trigger if exists route_stops_sync_empresa_refs on public.route_stops;
drop trigger if exists visits_update_agenda on public.visits;
drop trigger if exists clientes_sync_agenda_after_write on public.clientes;

do $$
begin
  if to_regclass('public.agenda') is not null then
    execute 'drop trigger if exists agenda_sync_clientes_after_write on public.agenda';
    execute 'drop trigger if exists agenda_sync_open_visits_perfil on public.agenda';
    execute 'drop trigger if exists normalize_agenda_text on public.agenda';
    execute 'drop trigger if exists audit_logs_agenda on public.agenda';
    execute 'drop policy if exists "Supervisor or assistente full access on agenda" on public.agenda';
    execute 'drop policy if exists "Vendedor read own agenda" on public.agenda';
    execute 'drop policy if exists "Vendedor can update own visits" on public.agenda';
  end if;
end $$;

-- Replace visit completion/profile sync with a cliente-only trigger.
create or replace function public.update_cliente_from_visit()
returns trigger
language plpgsql
as $$
declare
  target_cliente_id uuid;
  perfil_update text;
begin
  target_cliente_id := new.cliente_id;

  if target_cliente_id is null then
    return new;
  end if;

  if new.completed_at is not null and new.completed_vidas is not null then
    update public.clientes
       set visit_completed_vidas = new.completed_vidas,
           data_da_ultima_visita = coalesce(new.visit_date, data_da_ultima_visita)
     where id = target_cliente_id;
  end if;

  select string_agg(distinct perfil_item, ', ' order by perfil_item)
    into perfil_update
  from (
    select nullif(
      trim(
        regexp_replace(
          public.normalize_upper(split_item),
          '\\s+',
          ' ',
          'g'
        )
      ),
      ''
    ) as perfil_item
    from public.visits v
    cross join lateral regexp_split_to_table(
      coalesce(
        nullif(trim(v.perfil_visita), ''),
        nullif(trim(v.perfil_visita_opcoes), ''),
        ''
      ),
      '\\s*,\\s*'
    ) as split_item
    where v.cliente_id = target_cliente_id
      and coalesce(v.perfil_visita, v.perfil_visita_opcoes) is not null
  ) src
  where perfil_item is not null;

  if perfil_update is not null then
    update public.clientes
       set perfil_visita = perfil_update
     where id = target_cliente_id;
  end if;

  return new;
end;
$$;

drop trigger if exists visits_update_cliente on public.visits;
create trigger visits_update_cliente
after insert or update of completed_at, completed_vidas, perfil_visita, perfil_visita_opcoes, visit_date, cliente_id
on public.visits
for each row
execute function public.update_cliente_from_visit();

-- Drop legacy agenda functions/RPCs.
drop function if exists public.sync_visit_empresa_refs();
drop function if exists public.sync_route_stop_empresa_refs();
drop function if exists public.update_agenda_from_visit();
drop function if exists public.sync_clientes_from_agenda();
drop function if exists public.sync_agenda_from_clientes();
drop function if exists public.sync_open_visits_from_agenda_perfil();
drop function if exists public.normalize_agenda_text();
drop function if exists public.agenda_exact_match_ids(text, text);

-- Remove agenda tables before dropping agenda_id columns to avoid legacy policy/function dependencies.
drop table if exists public.agenda_headers_map;
drop table if exists public.agenda cascade;

-- Remove legacy agenda_id references in relational tables.
drop index if exists public.visits_agenda_idx;
drop index if exists public.visits_unique_vendor_date;
drop index if exists public.route_stops_agenda_idx;

alter table if exists public.visits
  drop constraint if exists visits_agenda_id_fkey;

alter table if exists public.route_stops
  drop constraint if exists route_stops_agenda_id_fkey;

alter table if exists public.visits
  drop column if exists agenda_id cascade;

alter table if exists public.route_stops
  drop column if exists agenda_id cascade;

create unique index if not exists visits_unique_vendor_date_cliente
  on public.visits(cliente_id, assigned_to_user_id, visit_date);
