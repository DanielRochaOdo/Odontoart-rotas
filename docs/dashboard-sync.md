# Sincronizacao Primario -> Dashboard

Esta arquitetura usa um Supabase dedicado para leitura de dashboard.
O banco primario continua como fonte da verdade.

## Resumo tecnico

- Cursor composto por tabela: `updated_at + id`.
- Janela de seguranca: processa ate `now() - lag`.
- Lock persistente com TTL em `dashboard_sync_lock` (nao depende de sessao HTTP do PostgREST).
- Checkpoint por tabela em `dashboard_sync_state`.
- Auditoria por execucao em `dashboard_sync_runs`.
- Modo `incremental` (padrao) e `backfill`.

## 1) Variaveis de ambiente

Adicione no `.env`:

```env
# Frontend (Vite) - projeto primario
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...

# Frontend (Vite) - projeto dashboard (leitura)
VITE_DASHBOARD_URL=...
VITE_DASHBOARD_ANON_KEY=...

# Script/server
PRIMARY_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
DASHBOARD_URL=...
DASHBOARD_SERVICE_ROLE_KEY=...

# Opcionais do script
DASH_SYNC_MODE=incremental
DASH_SYNC_BATCH_SIZE=1000
DASH_SYNC_SAFETY_LAG_SECONDS=60
DASH_SYNC_LOCK_TTL_SECONDS=600
DASH_SYNC_TABLES=visits,aceite_digital,clientes,profiles
DASH_SYNC_FORCE_FROM=1970-01-01T00:00:00Z

# Aliases de compatibilidade (opcionais)
SUPABASE_URL=...
SUPABASE_DASHBOARD_SERVICE_ROLE_KEY=...
```

Observacoes:
- `VITE_*` pode ir para frontend.
- `*_SERVICE_ROLE_KEY` nunca vai para frontend.
- `PRIMARY_SUPABASE_URL` e usado somente pelo script de sync.
- O script aceita fallback: `PRIMARY_SUPABASE_URL -> SUPABASE_URL -> VITE_SUPABASE_URL`.
- O script aceita fallback: `DASHBOARD_SERVICE_ROLE_KEY -> SUPABASE_DASHBOARD_SERVICE_ROLE_KEY`.

## 2) Bootstrap no banco de dashboard

Execute:

- `docs/sql/dashboard_bootstrap.sql`
- `docs/sql/dashboard_read_indexes.sql` (opcional, recomendado)
- `docs/sql/dashboard_active_views.sql` (recomendado para frontend)
- `docs/sql/dashboard_rls_policies.sql` (recomendado para controle de exposicao)

Esse bootstrap cria:
- `dashboard_sync_state`
- `dashboard_sync_runs`
- `dashboard_sync_lock`
- `dash_visits`
- `dash_aceite_digital`
- `dash_clientes`
- `dash_profiles`
- Views ativas:
  - `v_dash_visits_active`
  - `v_dash_aceite_digital_active`
  - `v_dash_clientes_active`
  - `v_dash_profiles_active`
  - `v_dashboard_sync_health`

## 3) Hardening no banco primario

Execute migration:

- `supabase/migrations/2026052901_dashboard_sync_hardening.sql`

Ela garante:
- `updated_at not null` nas tabelas sincronizadas.
- Trigger para atualizar `updated_at` em `UPDATE`.
- `deleted_at` para estrategia de soft delete.
- Indices `(updated_at, id)` para cursor incremental.

## 4) Rodar sincronizacao manual

```bash
npm run sync:dashboard
```

O script:
- Le do banco primario por cursor composto (`updated_at + id`).
- Faz `upsert` no banco de dashboard.
- Salva checkpoint por lote/tabela.
- Faz heartbeat do lock durante execucao.
- Reconcilia `DELETE` fisico via `audit_logs` e marca `deleted_at` no espelho.
- Escreve auditoria da execucao.

## Regra de frontend

- O frontend do dashboard nao deve consultar tabelas base do primario (`visits`, `clientes`, `aceite_digital`, `profiles`) para KPIs/graficos.
- O frontend deve consultar `dash_*` ou preferencialmente as views `v_dash_*_active`.
- Registros com `deleted_at` devem ser sempre excluidos da leitura ativa.
- Tabelas operacionais de sync (`dashboard_sync_runs`, `dashboard_sync_state`, `dashboard_sync_lock`) nao devem ser expostas diretamente ao anon.

## 5) Backfill x Incremental

### Incremental (padrao)

```bash
npm run sync:dashboard
```

### Backfill

PowerShell:

```powershell
$env:DASH_SYNC_MODE='backfill'; npm run sync:dashboard
```

Opcional (limitar tabelas):

```powershell
$env:DASH_SYNC_MODE='backfill'; $env:DASH_SYNC_TABLES='visits,clientes'; npm run sync:dashboard
```

## 6) Saude da sincronizacao

```sql
select id, mode, status, started_at, finished_at, total_rows_read, total_rows_written, error_message
from public.dashboard_sync_runs
order by id desc
limit 20;
```

```sql
select table_name, status, last_updated_at, last_id, started_at, finished_at, rows_read, rows_written, last_error
from public.dashboard_sync_state
order by table_name;
```

```sql
select lock_name, owner_id, acquired_at, heartbeat_at, locked_until
from public.dashboard_sync_lock;
```

## 7) Estrategia de delete

- `soft delete`: replica `deleted_at` normalmente.
- `DELETE` fisico: o sync executa reconciliacao via `audit_logs` (`action = 'DELETE'`) e marca `deleted_at` no espelho (`dash_*`).
- Checkpoint da reconciliacao: `table_name = 'audit_logs_delete_reconcile'` em `dashboard_sync_state`.

## 8) Reset de checkpoint com seguranca

Reset seletivo por tabela (recomendado em producao):

```sql
update public.dashboard_sync_state
set last_updated_at = '1970-01-01T00:00:00Z',
    last_id = '',
    status = 'idle',
    last_error = null,
    updated_at = now()
where table_name = 'visits';
```

```sql
update public.dashboard_sync_state
set last_updated_at = '1970-01-01T00:00:00Z',
    last_id = '',
    status = 'idle',
    last_error = null,
    updated_at = now()
where table_name = 'aceite_digital';
```

```sql
update public.dashboard_sync_state
set last_updated_at = '1970-01-01T00:00:00Z',
    last_id = '',
    status = 'idle',
    last_error = null,
    updated_at = now()
where table_name = 'clientes';
```

```sql
update public.dashboard_sync_state
set last_updated_at = '1970-01-01T00:00:00Z',
    last_id = '',
    status = 'idle',
    last_error = null,
    updated_at = now()
where table_name = 'profiles';
```

```sql
update public.dashboard_sync_state
set last_updated_at = '1970-01-01T00:00:00Z',
    last_id = '',
    status = 'idle',
    last_error = null,
    updated_at = now()
where table_name = 'audit_logs_delete_reconcile';
```

Reset geral (usar apenas quando necessario):

```sql
update public.dashboard_sync_state
set last_updated_at = '1970-01-01T00:00:00Z',
    last_id = '',
    status = 'idle',
    last_error = null,
    updated_at = now();
```

## 9) Checklist antes de agendar

1. Testar insert no primario e validar chegada no `dash_*`.
2. Testar update no primario e validar mudanca no `dash_*`.
3. Testar soft delete (`deleted_at`) e validar exclusao logica no dashboard.
4. Testar delete fisico e validar reconciliacao via `audit_logs`.
5. Rodar duas execucoes simultaneas e confirmar que uma aborta por lock ativo.
6. Interromper um backfill no meio e confirmar retomada por checkpoint.
7. Conferir `dashboard_sync_runs` com `status = 'ok'`.
8. Conferir `dashboard_sync_state` com `status = 'idle'` e `finished_at` recente.
9. Conferir `dashboard_sync_lock` sem lock preso apos execucao.
