create or replace function public.update_agenda_from_visit()
returns trigger
language plpgsql
as $$
declare
  old_vidas integer := coalesce(old.completed_vidas, 0);
  new_vidas integer := coalesce(new.completed_vidas, 0);
  delta integer := 0;
  clean_tit text;
  current_tit numeric := 0;
  perfil_update text;
  agenda_empresa text;
  agenda_nome_fantasia text;
begin
  if new.agenda_id is null then
    return new;
  end if;

  if new.completed_at is not null and old.completed_at is null then
    delta := new_vidas;
  elsif new.completed_at is not null and old.completed_at is not null and new_vidas <> old_vidas then
    delta := new_vidas - old_vidas;
  end if;

  if delta <> 0 then
    select nullif(regexp_replace(coalesce(tit, ''), '[^0-9.-]', '', 'g'), '')
      into clean_tit
      from public.agenda
      where id = new.agenda_id
      for update;

    current_tit := coalesce(clean_tit::numeric, 0);

    update public.agenda
      set tit = (current_tit + delta)::text
      where id = new.agenda_id;
  end if;

  perfil_update := coalesce(new.perfil_visita_opcoes, new.perfil_visita);

  if new.completed_at is not null and perfil_update is not null then
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
        where (agenda_empresa is not null and empresa = agenda_empresa)
           or (agenda_nome_fantasia is not null and nome_fantasia = agenda_nome_fantasia);
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

update public.clientes c
set perfil_visita = a.perfil_visita
from public.agenda a
where a.perfil_visita is not null
  and (
    (c.empresa is not null and a.empresa = c.empresa)
    or (c.nome_fantasia is not null and a.nome_fantasia = c.nome_fantasia)
  );
