-- Mark sample visit as generated so it appears in Visitas and is hidden from Agenda
update public.agenda
set
  visit_generated_at = now(),
  visit_assigned_to = vendedor,
  visit_route_id = null
where dedupe_key = 'clinica sorriso forte|sorriso forte|2026-02-24|joao pereira';
