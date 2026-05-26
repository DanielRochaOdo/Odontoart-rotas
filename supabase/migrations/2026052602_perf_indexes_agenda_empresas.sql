-- Performance indexes for Agenda/Empresas list queries (phase 5)
-- These indexes target filters/sort actually used by src/lib/agendaApi.ts and src/lib/clientesApi.ts.

-- 1) Sort path for agenda first page (default order by visit_generated_at, data_da_ultima_visita)
create index if not exists clientes_agenda_sort_v1_idx
  on public.clientes (visit_generated_at desc, data_da_ultima_visita desc, id);

-- 2) Combined filter + sort for situacao-aware agenda/empresas queries
create index if not exists clientes_situacao_agenda_sort_v1_idx
  on public.clientes (situacao, visit_generated_at desc, data_da_ultima_visita desc, id);

-- 3) Exact lookup path used by search mode codigo
create index if not exists clientes_codigo_agenda_v1_idx
  on public.clientes (codigo, id);

-- 4) Optional ILIKE acceleration for company name search.
create extension if not exists pg_trgm;
create index if not exists clientes_empresa_trgm_v1_idx
  on public.clientes using gin (empresa gin_trgm_ops);

-- Rollback:
-- drop index if exists public.clientes_empresa_trgm_v1_idx;
-- drop index if exists public.clientes_codigo_agenda_v1_idx;
-- drop index if exists public.clientes_situacao_agenda_sort_v1_idx;
-- drop index if exists public.clientes_agenda_sort_v1_idx;
