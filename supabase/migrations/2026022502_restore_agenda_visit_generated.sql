with visit_rollup as (
  select
    agenda_id,
    min(created_at) as first_created_at,
    (array_agg(assigned_to_name order by created_at asc nulls last))[1] as first_assigned_name,
    (array_agg(route_id order by created_at asc nulls last))[1] as first_route_id,
    max(completed_at) as last_completed_at,
    max(completed_vidas) as last_completed_vidas
  from public.visits
  group by agenda_id
)
update public.agenda a
set
  visit_generated_at = coalesce(a.visit_generated_at, v.first_created_at),
  visit_assigned_to = coalesce(a.visit_assigned_to, v.first_assigned_name),
  visit_route_id = coalesce(a.visit_route_id, v.first_route_id),
  visit_completed_at = coalesce(a.visit_completed_at, v.last_completed_at),
  visit_completed_vidas = coalesce(a.visit_completed_vidas, v.last_completed_vidas)
from visit_rollup v
where a.id = v.agenda_id
  and a.visit_generated_at is null;
