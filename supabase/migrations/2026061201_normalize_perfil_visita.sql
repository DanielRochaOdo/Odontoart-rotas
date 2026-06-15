create or replace function public.normalize_perfil_visita_text(raw text)
returns text
language sql
immutable
as $$
  select nullif(
    (
      select string_agg(item, ', ' order by ord)
      from (
        select item, min(ord) as ord
        from (
          select
            nullif(
              trim(
                regexp_replace(
                  public.normalize_upper(split_item),
                  '\s+',
                  ' ',
                  'g'
                )
              ),
              ''
            ) as item,
            ord
          from regexp_split_to_table(
            replace(coalesce(raw, ''), chr(8226), ','),
            '\s*[,;|]\s*'
          ) with ordinality as split_item(split_item, ord)
        ) normalized
        where item is not null
        group by item
      ) deduped
    ),
    ''
  );
$$;

create or replace function public.sanitize_perfil_visita_row()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'visits' then
    new.perfil_visita := public.normalize_perfil_visita_text(new.perfil_visita);
    if new.perfil_visita_opcoes is not null then
      new.perfil_visita_opcoes := public.normalize_perfil_visita_text(new.perfil_visita_opcoes);
      if new.perfil_visita_opcoes = new.perfil_visita then
        new.perfil_visita_opcoes := null;
      end if;
    end if;
    return new;
  end if;

  new.perfil_visita := public.normalize_perfil_visita_text(new.perfil_visita);
  return new;
end;
$$;

drop trigger if exists sanitize_clientes_perfil_visita on public.clientes;
create trigger sanitize_clientes_perfil_visita
before insert or update of perfil_visita on public.clientes
for each row
execute function public.sanitize_perfil_visita_row();

do $$
begin
  if to_regclass('public.agenda') is not null then
    execute 'drop trigger if exists sanitize_agenda_perfil_visita on public.agenda';
    execute '
      create trigger sanitize_agenda_perfil_visita
      before insert or update of perfil_visita on public.agenda
      for each row
      execute function public.sanitize_perfil_visita_row()
    ';
  end if;
end
$$;

drop trigger if exists sanitize_visits_perfil_visita on public.visits;
create trigger sanitize_visits_perfil_visita
before insert or update of perfil_visita, perfil_visita_opcoes on public.visits
for each row
execute function public.sanitize_perfil_visita_row();

update public.clientes
set perfil_visita = public.normalize_perfil_visita_text(perfil_visita)
where perfil_visita is not null
  and coalesce(perfil_visita, '') <> coalesce(public.normalize_perfil_visita_text(perfil_visita), '');

do $$
begin
  if to_regclass('public.agenda') is not null then
    execute '
      update public.agenda
      set perfil_visita = public.normalize_perfil_visita_text(perfil_visita)
      where perfil_visita is not null
        and coalesce(perfil_visita, '''') <> coalesce(public.normalize_perfil_visita_text(perfil_visita), '''')
    ';
  end if;
end
$$;

update public.visits
set
  perfil_visita = public.normalize_perfil_visita_text(perfil_visita),
  perfil_visita_opcoes = case
    when perfil_visita_opcoes is null then null
    else public.normalize_perfil_visita_text(perfil_visita_opcoes)
  end
where perfil_visita is not null
   or perfil_visita_opcoes is not null;
