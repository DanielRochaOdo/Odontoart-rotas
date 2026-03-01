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
          visit_completed_vidas = new.completed_vidas
      where id = new.agenda_id;
  end if;

  select string_agg(distinct perfil_item, ' • ' order by perfil_item)
    into perfil_update
  from (
    select nullif(trim(regexp_replace(split_item, '\\s+', ' ', 'g')), '') as perfil_item
    from public.visits v
    cross join lateral regexp_split_to_table(
      replace(coalesce(v.perfil_visita_opcoes, v.perfil_visita, ''), 'â€¢', '•'),
      '\\s*[•,]\\s*'
    ) as split_item
    where v.agenda_id = new.agenda_id
      and coalesce(v.perfil_visita_opcoes, v.perfil_visita) is not null
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

with agg as (
  select
    v.agenda_id,
    string_agg(distinct perfil_item, ' • ' order by perfil_item) as perfil_consolidado
  from public.visits v
  cross join lateral regexp_split_to_table(
    replace(coalesce(v.perfil_visita_opcoes, v.perfil_visita, ''), 'â€¢', '•'),
    '\\s*[•,]\\s*'
  ) as split_item
  cross join lateral (
    select nullif(trim(regexp_replace(split_item, '\\s+', ' ', 'g')), '') as perfil_item
  ) normalized
  where v.agenda_id is not null
    and coalesce(v.perfil_visita_opcoes, v.perfil_visita) is not null
    and normalized.perfil_item is not null
  group by v.agenda_id
)
update public.agenda a
set perfil_visita = agg.perfil_consolidado
from agg
where a.id = agg.agenda_id
  and coalesce(a.perfil_visita, '') <> coalesce(agg.perfil_consolidado, '');

update public.clientes c
set perfil_visita = a.perfil_visita
from public.agenda a
where a.perfil_visita is not null
  and (
    (a.empresa is not null and c.empresa is not null and public.normalize_upper(c.empresa) = public.normalize_upper(a.empresa))
    or (a.nome_fantasia is not null and c.nome_fantasia is not null and public.normalize_upper(c.nome_fantasia) = public.normalize_upper(a.nome_fantasia))
  )
  and coalesce(c.perfil_visita, '') <> coalesce(a.perfil_visita, '');
