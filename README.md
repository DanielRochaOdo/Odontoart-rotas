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

## Supabase (migrations)
Os scripts SQL ficam em `supabase/migrations`.
- `20260224_profiles.sql` cria a tabela `profiles`.
- `20260224_agenda_routes_rls.sql` cria `agenda`, `routes`, `route_stops`, helpers e politicas RLS.

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
