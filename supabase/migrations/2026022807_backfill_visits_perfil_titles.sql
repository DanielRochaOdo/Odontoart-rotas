-- Backfill: corrige visits.perfil_visita que ficou apenas com HH:MM
-- Regra:
-- 1) Se houver somente horarios, usa o contexto de agenda.perfil_visita para prefixar ALMOCO/JANTAR.
-- 2) Se houver multiplos horarios, marca como HORARIO CUSTOMIZADO.
-- 3) Mantem valores ja titulados intactos.

with candidates as (
  select
    v.id,
    trim(coalesce(v.perfil_visita_opcoes, v.perfil_visita)) as raw_profile,
    trim(coalesce(a.perfil_visita, '')) as agenda_profile
  from public.visits v
  left join public.agenda a on a.id = v.agenda_id
  where coalesce(v.perfil_visita_opcoes, v.perfil_visita) is not null
),
normalized as (
  select
    c.id,
    c.raw_profile,
    c.agenda_profile,
    regexp_replace(c.raw_profile, '\s*[•,]\s*', ' | ', 'g') as times_pipe,
    (c.raw_profile ~ '^\s*\d{1,2}:\d{2}(\s*[•,]\s*\d{1,2}:\d{2})*\s*$') as is_time_only
  from candidates c
),
resolved as (
  select
    n.id,
    case
      when not n.is_time_only then n.raw_profile
      when n.times_pipe like '%|%' then 'HORARIO CUSTOMIZADO ' || regexp_replace(n.times_pipe, '\s*\|\s*', ' , ', 'g')
      when n.agenda_profile ilike '%ALMOCO%' and n.agenda_profile not ilike '%JANTAR%'
        then 'ALMOCO ' || n.raw_profile
      when n.agenda_profile ilike '%JANTAR%' and n.agenda_profile not ilike '%ALMOCO%'
        then 'JANTAR ' || n.raw_profile
      when n.agenda_profile ilike '%HORARIO COMERCIAL%'
        then 'HORARIO COMERCIAL'
      else 'HORARIO CUSTOMIZADO ' || n.raw_profile
    end as perfil_resolvido
  from normalized n
),
updates as (
  select
    r.id,
    nullif(trim(r.perfil_resolvido), '') as perfil_resolvido,
    case
      when r.perfil_resolvido ~ '\d{1,2}:\d{2}' then nullif(trim(r.perfil_resolvido), '')
      else null
    end as opcoes_resolvidas
  from resolved r
)
update public.visits v
set
  perfil_visita = u.perfil_resolvido,
  perfil_visita_opcoes = u.opcoes_resolvidas
from updates u
where v.id = u.id
  and (
    coalesce(v.perfil_visita, '') is distinct from coalesce(u.perfil_resolvido, '')
    or coalesce(v.perfil_visita_opcoes, '') is distinct from coalesce(u.opcoes_resolvidas, '')
  );
