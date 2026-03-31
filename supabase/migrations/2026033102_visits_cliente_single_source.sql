set statement_timeout = 0;

alter table public.visits
  add column if not exists cliente_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'visits_cliente_id_fkey'
  ) then
    alter table public.visits
      add constraint visits_cliente_id_fkey
      foreign key (cliente_id)
      references public.clientes(id)
      on delete cascade;
  end if;
end $$;

create index if not exists visits_cliente_idx on public.visits(cliente_id);
create unique index if not exists visits_unique_vendor_date_cliente
  on public.visits(cliente_id, assigned_to_user_id, visit_date);

update public.visits v
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
where v.agenda_id = a.id
  and v.cliente_id is null;

update public.visits v
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
where v.agenda_id = a.id
  and v.cliente_id is null;

alter table public.visits
  alter column agenda_id drop not null;

create or replace function public.sync_visit_empresa_refs()
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

drop trigger if exists visits_sync_empresa_refs on public.visits;
create trigger visits_sync_empresa_refs
before insert or update of agenda_id, cliente_id
on public.visits
for each row
execute function public.sync_visit_empresa_refs();

create or replace function public.update_agenda_from_visit()
returns trigger
language plpgsql
as $$
declare
  target_cliente_id uuid;
  target_agenda_id uuid;
  source_codigo text;
  source_empresa text;
  source_fantasia text;
  perfil_update text;
begin
  target_cliente_id := new.cliente_id;
  target_agenda_id := new.agenda_id;

  if target_cliente_id is null and target_agenda_id is not null then
    select a.cod_1, a.empresa, a.nome_fantasia
      into source_codigo, source_empresa, source_fantasia
    from public.agenda a
    where a.id = target_agenda_id;

    if found then
      select c.id
        into target_cliente_id
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

  if target_agenda_id is null and target_cliente_id is not null then
    select c.codigo, c.empresa, c.nome_fantasia
      into source_codigo, source_empresa, source_fantasia
    from public.clientes c
    where c.id = target_cliente_id;

    if found then
      select a.id
        into target_agenda_id
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

  if new.completed_at is not null and new.completed_vidas is not null then
    if target_cliente_id is not null then
      update public.clientes
        set visit_completed_at = new.completed_at,
            visit_completed_vidas = new.completed_vidas,
            data_da_ultima_visita = coalesce(new.visit_date, data_da_ultima_visita)
      where id = target_cliente_id;
    end if;

    if target_agenda_id is not null then
      update public.agenda
        set visit_completed_at = new.completed_at,
            visit_completed_vidas = new.completed_vidas,
            data_da_ultima_visita = coalesce(new.visit_date, data_da_ultima_visita)
      where id = target_agenda_id;
    end if;
  end if;

  if target_cliente_id is not null then
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
      where (
        v.cliente_id = target_cliente_id
        or (
          v.cliente_id is null
          and target_agenda_id is not null
          and v.agenda_id = target_agenda_id
        )
      )
      and coalesce(v.perfil_visita, v.perfil_visita_opcoes) is not null
    ) src
    where perfil_item is not null;

    if perfil_update is not null then
      update public.clientes
        set perfil_visita = perfil_update
      where id = target_cliente_id;

      if target_agenda_id is not null then
        update public.agenda
          set perfil_visita = perfil_update
        where id = target_agenda_id;
      end if;
    end if;
  elsif target_agenda_id is not null then
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
      where v.agenda_id = target_agenda_id
        and coalesce(v.perfil_visita, v.perfil_visita_opcoes) is not null
    ) src
    where perfil_item is not null;

    if perfil_update is not null then
      update public.agenda
        set perfil_visita = perfil_update
      where id = target_agenda_id;
    end if;
  end if;

  return new;
end;
$$;
