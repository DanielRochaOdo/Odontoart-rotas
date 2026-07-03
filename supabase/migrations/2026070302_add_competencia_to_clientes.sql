alter table public.clientes
  add column if not exists competencia text;

alter table public.pre_cadastros
  add column if not exists competencia text;
