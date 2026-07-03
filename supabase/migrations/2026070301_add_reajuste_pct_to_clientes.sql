alter table public.clientes
  add column if not exists reajuste_pct numeric;

alter table public.pre_cadastros
  add column if not exists reajuste_pct numeric;
