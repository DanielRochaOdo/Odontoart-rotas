create extension if not exists pg_trgm;

create index if not exists clientes_empresa_trgm_idx
  on public.clientes
  using gin (empresa gin_trgm_ops);

create index if not exists clientes_situacao_idx
  on public.clientes (situacao);

create index if not exists clientes_categoria_idx
  on public.clientes (categoria);

create index if not exists clientes_cidade_idx
  on public.clientes (cidade);

create index if not exists clientes_bairro_idx
  on public.clientes (bairro);

create index if not exists clientes_vendedor_idx
  on public.clientes (vendedor);

create index if not exists clientes_grupo_idx
  on public.clientes (grupo);

create index if not exists clientes_perfil_visita_idx
  on public.clientes (perfil_visita);

create index if not exists clientes_data_da_ultima_visita_idx
  on public.clientes (data_da_ultima_visita desc);

create index if not exists clientes_visit_completed_vidas_idx
  on public.clientes (visit_completed_vidas);
