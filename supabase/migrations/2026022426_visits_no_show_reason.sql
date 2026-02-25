alter table public.visits
  add column if not exists no_visit_reason text null;
