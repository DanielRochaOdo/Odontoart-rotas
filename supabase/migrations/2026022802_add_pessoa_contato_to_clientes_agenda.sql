alter table public.clientes
  add column if not exists pessoa text null,
  add column if not exists contato text null;

alter table public.agenda
  add column if not exists pessoa text null,
  add column if not exists contato text null;
