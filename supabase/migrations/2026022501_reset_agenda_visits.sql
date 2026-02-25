update public.agenda
set
  visit_generated_at = null,
  visit_assigned_to = null,
  visit_route_id = null,
  visit_completed_at = null,
  visit_completed_vidas = null
where visit_generated_at is not null;
