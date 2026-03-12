alter table if exists public.agenda
  add column if not exists instructions text null;
