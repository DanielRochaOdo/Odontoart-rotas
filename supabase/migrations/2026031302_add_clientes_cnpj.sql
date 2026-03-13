alter table if exists public.clientes
  add column if not exists cnpj text null;

create index if not exists clientes_cnpj_idx
  on public.clientes (cnpj);
