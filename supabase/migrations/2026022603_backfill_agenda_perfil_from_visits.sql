with latest as (
  select distinct on (agenda_id)
    agenda_id,
    perfil_visita
  from public.visits
  where completed_at is not null
    and perfil_visita is not null
  order by agenda_id, completed_at desc
)
update public.agenda a
set perfil_visita = l.perfil_visita
from latest l
where a.id = l.agenda_id;
