-- Ensure bairro column exists on agenda (idempotent)
alter table if exists public.agenda
  add column if not exists bairro text;
