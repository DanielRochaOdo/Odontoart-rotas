alter table if exists public.clientes
  add column if not exists categoria text;

comment on column public.clientes.categoria is
  'Categoria comercial da empresa (Inativo, So perda, Queda, Crescimento, So venda, Neutro).';
