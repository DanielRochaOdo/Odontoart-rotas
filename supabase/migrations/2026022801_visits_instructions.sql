alter table public.visits
  add column if not exists instructions text null;
