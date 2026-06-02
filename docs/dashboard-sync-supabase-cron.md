# Dashboard Sync via Supabase Cron

Este fluxo elimina a dependência de máquina local ligada para executar o sync do Dashboard.
A Edge Function `sync-dashboard-incremental` roda apenas incremental e é acionada por cron a cada 5 minutos.

## 1) Configurar secrets (server-side)

No projeto Supabase de destino (Dashboard), configure para a Edge Function:

- `SUPABASE_URL` (padrao do runtime da function; projeto Dashboard)
- `SUPABASE_SERVICE_ROLE_KEY` (padrao do runtime da function; projeto Dashboard)
- `PRIMARY_SUPABASE_URL` (projeto Primario)
- `PRIMARY_SERVICE_ROLE_KEY` (service_role do projeto Primario)
- `DASH_SYNC_SAFETY_LAG_SECONDS` (recomendado `60`)
- `DASH_SYNC_TABLES` (recomendado `visits,aceite_digital,clientes,profiles`)
- `CRON_SECRET` (valor forte e aleatorio)

Exemplo com CLI:

```bash
supabase secrets set \
  SUPABASE_URL="https://<dashboard-ref>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<dashboard-service-role-key>" \
  PRIMARY_SUPABASE_URL="https://<primary-ref>.supabase.co" \
  PRIMARY_SERVICE_ROLE_KEY="<primary-service-role-key>" \
  DASH_SYNC_SAFETY_LAG_SECONDS="60" \
  DASH_SYNC_TABLES="visits,aceite_digital,clientes,profiles" \
  CRON_SECRET="<strong-random-secret>"
```

Mapeamento da Edge Function (hospedada no Dashboard):

- Dashboard DB: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- Primario DB: `PRIMARY_SUPABASE_URL` + `PRIMARY_SERVICE_ROLE_KEY`

Nao commitar secrets em `.env`, migrations ou docs versionadas.

## 2) Vault para CRON_SECRET (opcional, recomendado para SQL cron)

Para evitar colocar secret literal no `cron.schedule`:

```sql
select vault.create_secret('<strong-random-secret>', 'CRON_SECRET', 'sync dashboard cron token');
```

Use a variação Vault do SQL em [`docs/sql/dashboard_sync_supabase_cron.sql`](/c:/Users/daniel.rocha/Documents/GitHub/Odontoart-rotas/docs/sql/dashboard_sync_supabase_cron.sql).

## 3) Deploy da Edge Function

```bash
supabase functions deploy sync-dashboard-incremental --no-verify-jwt
```

Arquivos da função:

- [`supabase/functions/sync-dashboard-incremental/index.ts`](/c:/Users/daniel.rocha/Documents/GitHub/Odontoart-rotas/supabase/functions/sync-dashboard-incremental/index.ts)
- [`supabase/functions/sync-dashboard-incremental/config.toml`](/c:/Users/daniel.rocha/Documents/GitHub/Odontoart-rotas/supabase/functions/sync-dashboard-incremental/config.toml)

## 4) Criar o cron (a cada 5 minutos)

Execute o SQL:

- [`docs/sql/dashboard_sync_supabase_cron.sql`](/c:/Users/daniel.rocha/Documents/GitHub/Odontoart-rotas/docs/sql/dashboard_sync_supabase_cron.sql)

Agendamento:

- Nome: `sync-dashboard-incremental-every-5m`
- Expressão: `*/5 * * * *`

## 5) Teste manual da function

```bash
curl -i \
  -X POST "https://<dashboard-ref>.supabase.co/functions/v1/sync-dashboard-incremental" \
  -H "Authorization: Bearer <CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Resposta esperada:

- `status`: `ok`, `already_running` ou `failed`
- `started_at`, `finished_at`
- `total_rows_read`, `total_rows_written`, `rows_deleted_reconciled`
- `error_message`

Sem `Authorization` válida, retorna `401`.

## 6) Validar `dashboard_sync_runs`

```sql
select id, mode, status, started_at, finished_at, total_rows_read, total_rows_written, rows_deleted_reconciled, error_message
from public.dashboard_sync_runs
order by id desc
limit 20;
```

Checagem de lock:

```sql
select lock_name, owner_id, acquired_at, heartbeat_at, locked_until
from public.dashboard_sync_lock
where lock_name = 'dashboard_sync';
```

## 7) Desativar cron

```sql
select cron.unschedule('sync-dashboard-incremental-every-5m');
```

## 8) Fallback manual continua disponível

O fallback local nao foi removido:

```bash
npm run sync:dashboard
```

Fallback local (`npm run sync:dashboard`):

- Primario DB: `PRIMARY_SUPABASE_URL` (ou fallback `VITE_SUPABASE_URL`) + `SUPABASE_SERVICE_ROLE_KEY`
- Dashboard DB: `DASHBOARD_URL` + `DASHBOARD_SERVICE_ROLE_KEY`
