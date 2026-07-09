alter table public.visits
  add column if not exists no_visit_observation text null;
