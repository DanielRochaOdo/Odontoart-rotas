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

  select string_agg(perfil_item, ' • ' order by perfil_item)
    into perfil_update
  from (
    select distinct nullif(trim(coalesce(v.perfil_visita_opcoes, v.perfil_visita)), '') as perfil_item
    from public.visits v
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

drop trigger if exists visits_update_agenda on public.visits;
create trigger visits_update_agenda
after update of completed_at, completed_vidas, perfil_visita, perfil_visita_opcoes on public.visits
for each row
execute function public.update_agenda_from_visit();

