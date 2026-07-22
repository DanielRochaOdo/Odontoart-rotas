# Odontoart Agenda+ Rotas

App web interno da Odontoart para gestao de agenda e rotas comerciais. Uso exclusivo da equipe Odontoart (sem cadastro publico).

## Stack
- Vite + React + Tailwind
- Supabase (Postgres + Auth + Storage + Edge Functions)
- Timezone padrao: America/Fortaleza

## Configuracao local
1. Instale dependencias:
   - `npm install`
2. Configure as variaveis de ambiente em `.env.local`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_URL` (para scripts)
   - `SUPABASE_SERVICE_ROLE_KEY` (para scripts)
3. Suba o app:
   - `npm run dev`

## Keepalive do Supabase Free

O repositorio possui um workflow diario em `.github/workflows/supabase-keepalive.yml` para manter o projeto Supabase Free ativo. Ele faz somente uma leitura minima, usando a chave publica `anon`, na tabela dedicada `supabase_keepalive`.

Para configurar no GitHub:
1. Acesse `Settings` > `Secrets and variables` > `Actions` no repositorio.
2. Cadastre o secret `SUPABASE_URL` com a URL do projeto Supabase.
3. Cadastre o secret `SUPABASE_ANON_KEY` com a chave publica `anon` do projeto Supabase.
4. Nao cadastre nem use `service_role` para este workflow.

A tabela e a politica RLS ficam em `supabase/migrations/2026072202_supabase_keepalive.sql`. O workflow executa diariamente às 03:17 UTC (`17 3 * * *`) e tambem pode ser iniciado manualmente pela aba `Actions`.

## Supabase (migrations)
Os scripts SQL ficam em `supabase/migrations`.
- `2026022401_profiles.sql` cria a tabela `profiles`.
- `2026022402_agenda_routes_rls.sql` cria `agenda`, `routes`, `route_stops`, helpers e politicas RLS.

## Importacao XLSX
- Arquivo esperado: `data/agenda.xlsx` (aba ` BASE`).
- Executar: `npm run import:agenda`.
- O script cria `dedupe_key` (empresa + nome_fantasia + data + vendedor) e evita duplicacoes.

## Roles (MVP)
- VENDEDOR: somente leitura (dados proprios, ate hoje).
- SUPERVISOR: CRUD completo de agendas/rotas e visao total.
- ASSISTENTE: CRUD completo de agendas/rotas e visao total.

## RLS (MVP)
- `agenda`: VENDEDOR so le seus registros (vendedor ou consultor) ate hoje, SUPERVISOR/ASSISTENTE com CRUD total.
- `routes` e `route_stops`: VENDEDOR ve apenas rotas atribuídas, SUPERVISOR/ASSISTENTE com CRUD total.

## Observacao
O app e Odontoart-only. Multi-tenant esta desativado, mas campos `company_id` estao previstos para evolucao futura.

## Modulos (MVP)
- Dashboard com indicadores (hoje/semana/mes), situacao e distribuicao por cidade/UF.
- Agenda (tabela com filtros em header, date range, chips e exportacao CSV).
- Rotas (CRUD de rotas/paradas, abertura em Google Maps/Waze).
