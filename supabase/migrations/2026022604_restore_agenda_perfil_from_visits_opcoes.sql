with latest as (
  select distinct on (agenda_id)
    agenda_id,
    perfil_visita_opcoes
  from public.visits
  where perfil_visita_opcoes is not null
    and perfil_visita_opcoes ~ '\\d{2}:\\d{2}.*\\d{2}:\\d{2}'
  order by agenda_id, completed_at desc nulls last
)
update public.agenda a
set perfil_visita = l.perfil_visita_opcoes
from latest l
where a.id = l.agenda_id
  and (a.perfil_visita is null or a.perfil_visita !~ '\\d{2}:\\d{2}.*\\d{2}:\\d{2}');
