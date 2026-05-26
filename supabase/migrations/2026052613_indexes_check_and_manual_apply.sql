-- Index verification + optional manual apply script (DO NOT auto-apply blindly).
-- Purpose: confirm target DB has required indexes for observed slow queries.
-- Safe to run verification SELECTs in any environment.
-- If missing indexes are found, apply CREATE INDEX statements in a controlled window.

-- Verification
select
  i.schemaname,
  i.tablename,
  i.indexname,
  i.indexdef
from pg_indexes i
where i.schemaname = 'public'
  and i.tablename = 'clientes'
  and i.indexname in (
    'clientes_empresa_id_order_idx',
    'clientes_agenda_situacao_visit_generated_idx',
    'clientes_agenda_visit_generated_idx',
    'clientes_codigo_idx',
    'clientes_empresa_trgm_idx'
  )
order by i.indexname;

-- Optional manual apply (only if missing in target DB)
-- Note: prefer running CONCURRENTLY outside migration transactions.
-- create index concurrently if not exists clientes_empresa_id_order_idx
--   on public.clientes (empresa asc nulls last, id asc);
--
-- create index concurrently if not exists clientes_agenda_situacao_visit_generated_idx
--   on public.clientes (situacao, visit_generated_at desc nulls last, data_da_ultima_visita desc nulls last, id desc);
--
-- create index concurrently if not exists clientes_agenda_visit_generated_idx
--   on public.clientes (visit_generated_at desc nulls last, data_da_ultima_visita desc nulls last, id desc);
--
-- create index concurrently if not exists clientes_codigo_idx
--   on public.clientes (codigo);
--
-- create extension if not exists pg_trgm;
-- create index concurrently if not exists clientes_empresa_trgm_idx
--   on public.clientes using gin (empresa gin_trgm_ops);

-- Rollback (if any optional index is created in this script)
-- drop index concurrently if exists public.clientes_empresa_trgm_idx;
-- drop index concurrently if exists public.clientes_codigo_idx;
-- drop index concurrently if exists public.clientes_agenda_visit_generated_idx;
-- drop index concurrently if exists public.clientes_agenda_situacao_visit_generated_idx;
-- drop index concurrently if exists public.clientes_empresa_id_order_idx;
