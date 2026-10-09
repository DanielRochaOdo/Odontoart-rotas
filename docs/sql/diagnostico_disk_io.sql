-- Diagnostico somente leitura para PostgreSQL 14+ com pg_stat_statements
-- atualizado e instalado em public ou extensions (padroes do Supabase).
-- Nao instala extensoes, nao reseta estatisticas e nao executa consultas da app.
-- Execute no SQL Editor do projeto que apresentou o alerta.
-- Exporte cada resultado em T0 e novamente em T1, 15-30 minutos depois.
-- Compare deltas, preservando dbid, userid, queryid e toplevel.
-- Se houver erro, execute ROLLBACK; verifique a versao/schema da extensao.
-- Se o editor mostrar apenas um resultado, selecione um SELECT por execucao,
-- mantendo o BEGIN/SET LOCAL/COMMIT em torno dele.

begin read only;
set local search_path = pg_catalog, extensions, public;
set local statement_timeout = '15s';
set local lock_timeout = '2s';

-- 1. Contexto: resets/eviccoes e intervalo sao essenciais para interpretar deltas.
select
  clock_timestamp() as captured_at,
  current_database() as database_name,
  current_setting('server_version') as server_version,
  current_setting('block_size')::integer as block_size,
  current_setting('track_io_timing') as track_io_timing,
  current_setting('pg_stat_statements.track', true) as statement_tracking,
  e.extversion as extension_version,
  n.nspname as extension_schema,
  i.stats_reset,
  i.dealloc
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
cross join pg_stat_statements_info i
where e.extname = 'pg_stat_statements';

-- 2. Consulta principal. Apenas top-level evita somar novamente trabalho de
-- funcoes/triggers que tambem tenha sido registrado como chamada aninhada.
-- O ranking une seis criterios; cada identidade aparece uma unica vez.
with measured as materialized (
  select
    clock_timestamp() as captured_at,
    s.dbid,
    s.userid,
    s.queryid::text as queryid,
    s.toplevel,
    s.calls,
    s.rows,
    s.total_exec_time,
    s.shared_blks_hit,
    s.shared_blks_read,
    s.shared_blks_dirtied,
    s.shared_blks_written,
    s.temp_blks_read,
    s.temp_blks_written,
    s.wal_bytes,
    -- Os nomes de timing mudaram entre versoes do PostgreSQL.
    coalesce(
      (to_jsonb(s)->>'shared_blk_read_time')::numeric,
      (to_jsonb(s)->>'blk_read_time')::numeric
    ) as shared_read_ms,
    coalesce(
      (to_jsonb(s)->>'shared_blk_write_time')::numeric,
      (to_jsonb(s)->>'blk_write_time')::numeric
    ) as shared_write_ms,
    left(s.query, 2500) as query_excerpt
  from pg_stat_statements s
  where s.dbid = (select oid from pg_database where datname = current_database())
    and s.toplevel
    and s.calls > 0
), ranked as (
  select measured.*,
    row_number() over (order by shared_blks_read desc, total_exec_time desc) as rank_read,
    row_number() over (order by shared_blks_written desc, total_exec_time desc) as rank_written,
    row_number() over (order by total_exec_time desc) as rank_time,
    row_number() over (order by calls desc, total_exec_time desc) as rank_calls,
    row_number() over (order by wal_bytes desc, total_exec_time desc) as rank_wal,
    row_number() over (order by temp_blks_written desc, total_exec_time desc) as rank_temp
  from measured
)
select *,
  round(total_exec_time::numeric / nullif(calls, 0), 2) as mean_exec_ms,
  round(shared_blks_read::numeric * current_setting('block_size')::numeric / 1048576, 3) as shared_read_mib,
  round(shared_blks_written::numeric * current_setting('block_size')::numeric / 1048576, 3) as shared_written_mib,
  round(wal_bytes / 1048576, 3) as wal_mib,
  round(temp_blks_written::numeric * current_setting('block_size')::numeric / 1048576, 3) as temp_written_mib
from ranked
where rank_time <= 15
   or rank_calls <= 15
   or (rank_read <= 15 and shared_blks_read > 0)
   or (rank_written <= 15 and shared_blks_written > 0)
   or (rank_wal <= 15 and wal_bytes > 0)
   or (rank_temp <= 15 and temp_blks_written > 0)
order by total_exec_time desc;

-- 3. Atividade acumulada do banco. Inclui referencia de reset independente.
select
  clock_timestamp() as captured_at,
  datid, datname, stats_reset,
  xact_commit, xact_rollback,
  blks_read, blks_hit,
  tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted,
  temp_files, temp_bytes, deadlocks,
  blk_read_time, blk_write_time,
  pg_database_size(datid) as database_bytes
from pg_stat_database
where datname = current_database();

-- 4. Espaco ocupado e atividade por tabela; n_live_tup/n_dead_tup sao estimativas.
-- pg_total_relation_size inclui indices e TOAST; nao e uma medicao de I/O.
select
  clock_timestamp() as captured_at,
  s.schemaname, s.relname,
  pg_total_relation_size(s.relid) as total_bytes,
  pg_table_size(s.relid) as table_bytes_including_toast,
  pg_indexes_size(s.relid) as index_bytes,
  s.n_live_tup, s.n_dead_tup,
  s.n_tup_ins, s.n_tup_upd, s.n_tup_del, s.n_tup_hot_upd,
  s.seq_scan, s.idx_scan,
  s.last_autovacuum, s.last_autoanalyze
from pg_stat_user_tables s
order by pg_total_relation_size(s.relid) desc
limit 25;

commit;
