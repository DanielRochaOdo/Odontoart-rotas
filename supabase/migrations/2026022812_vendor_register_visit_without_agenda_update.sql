create or replace function public.update_agenda_from_visit()
returns trigger
language plpgsql
as $$
declare
  perfil_update text;
  agenda_empresa text;
  agenda_nome_fantasia text;
begin
  if new.agenda_id is null then
    return new;
  end if;

  if new.completed_at is not null and new.completed_vidas is not null then
    update public.agenda
      set visit_completed_at = new.completed_at,
          visit_completed_vidas = new.completed_vidas,
          data_da_ultima_visita = coalesce(new.visit_date, data_da_ultima_visita)
      where id = new.agenda_id;
  end if;

  select string_agg(distinct perfil_item, ' • ' order by perfil_item)
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
      replace(
        coalesce(
          nullif(trim(v.perfil_visita), ''),
          nullif(trim(v.perfil_visita_opcoes), ''),
          ''
        ),
        'â€¢',
        '•'
      ),
      '\\s*[•,]\\s*'
    ) as split_item
    where v.agenda_id = new.agenda_id
      and coalesce(v.perfil_visita, v.perfil_visita_opcoes) is not null
  ) src
  where perfil_item is not null;

  if perfil_update is not null then
    update public.agenda
      set perfil_visita = perfil_update
      where id = new.agenda_id;

    select empresa, nome_fantasia
      into agenda_empresa, agenda_nome_fantasia
      from public.agenda
      where id = new.agenda_id;

    if agenda_empresa is not null or agenda_nome_fantasia is not null then
      update public.clientes
        set perfil_visita = perfil_update
        where (
          agenda_empresa is not null
          and empresa is not null
          and public.normalize_upper(empresa) = public.normalize_upper(agenda_empresa)
        )
        or (
          agenda_nome_fantasia is not null
          and nome_fantasia is not null
          and public.normalize_upper(nome_fantasia) = public.normalize_upper(agenda_nome_fantasia)
        );
    end if;
  end if;

  return new;
end;
$$;
