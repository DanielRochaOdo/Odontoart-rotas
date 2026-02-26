update public.visits
set perfil_visita_opcoes = regexp_replace(perfil_visita_opcoes, '\\s*,\\s*', ' • ', 'g')
where perfil_visita_opcoes is not null
  and perfil_visita_opcoes like '%,%';

update public.visits v
set perfil_visita_opcoes = regexp_replace(a.perfil_visita, '\\s*,\\s*', ' • ', 'g')
from public.agenda a
where v.perfil_visita_opcoes is null
  and v.agenda_id = a.id
  and a.perfil_visita is not null
  and a.perfil_visita ~ '\\d{2}:\\d{2}.*\\d{2}:\\d{2}';
