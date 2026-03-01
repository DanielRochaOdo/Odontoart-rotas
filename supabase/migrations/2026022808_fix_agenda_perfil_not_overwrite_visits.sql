create or replace function public.sync_open_visits_from_agenda_perfil()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.perfil_visita is not distinct from old.perfil_visita then
    return new;
  end if;

  -- Nao sobrescrever perfil individual por vendedor.
  -- Apenas faz backfill quando a visita aberta ainda nao tem perfil.
  update public.visits
     set perfil_visita = new.perfil_visita,
         perfil_visita_opcoes = case
           when coalesce(new.perfil_visita, '') ~ '\\d{1,2}:\\d{2}.*\\d{1,2}:\\d{2}' then new.perfil_visita
           else null
         end
   where agenda_id = new.id
     and completed_at is null
     and coalesce(trim(perfil_visita), '') = '';

  return new;
end;
$$;
