-- Backfill para corrigir perfis antigos incompletos:
-- 1) Consolida perfis por agenda a partir de visits
-- 2) Propaga para clientes por empresa/nome_fantasia

with visit_profiles as (
  select
    v.agenda_id,
    array_remove(
      array_agg(
        distinct nullif(trim(coalesce(v.perfil_visita_opcoes, v.perfil_visita)), '')
      ),
      null
    ) as perfis
  from public.visits v
  where v.agenda_id is not null
  group by v.agenda_id
),
agenda_profiles as (
  select
    vp.agenda_id,
    (
      select string_agg(item, ' • ' order by item)
      from unnest(vp.perfis) as item
    ) as perfil_consolidado
  from visit_profiles vp
  where coalesce(array_length(vp.perfis, 1), 0) > 0
)
update public.agenda a
set perfil_visita = ap.perfil_consolidado
from agenda_profiles ap
where a.id = ap.agenda_id
  and coalesce(a.perfil_visita, '') <> coalesce(ap.perfil_consolidado, '');

with cliente_profiles_raw as (
  select
    lower(coalesce(a.empresa, '')) as empresa_key,
    lower(coalesce(a.nome_fantasia, '')) as fantasia_key,
    array_remove(
      array_agg(distinct nullif(trim(a.perfil_visita), '')),
      null
    ) as perfis
  from public.agenda a
  group by 1, 2
),
cliente_profiles as (
  select
    cpr.empresa_key,
    cpr.fantasia_key,
    (
      select string_agg(item, ' • ' order by item)
      from unnest(cpr.perfis) as item
    ) as perfil_consolidado
  from cliente_profiles_raw cpr
  where coalesce(array_length(cpr.perfis, 1), 0) > 0
)
update public.clientes c
set perfil_visita = cp.perfil_consolidado
from cliente_profiles cp
where lower(coalesce(c.empresa, '')) = cp.empresa_key
  and lower(coalesce(c.nome_fantasia, '')) = cp.fantasia_key
  and coalesce(c.perfil_visita, '') <> coalesce(cp.perfil_consolidado, '');

