alter table public.clientes
  add column if not exists complemento text null;

alter table public.agenda
  add column if not exists complemento text null;
