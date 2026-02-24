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
3. Suba o app:
   - `npm run dev`

## Supabase (migrations)
Os scripts SQL ficam em `supabase/migrations`.
- `20260224_profiles.sql` cria a tabela `profiles`.

## Roles (MVP)
- VENDEDOR: somente leitura (dados proprios, ate hoje).
- SUPERVISOR: CRUD completo de agendas/rotas e visao total.
- ASSISTENTE: CRUD completo de agendas/rotas e visao total.

## Observacao
O app e Odontoart-only. Multi-tenant esta desativado, mas campos `company_id` estao previstos para evolucao futura.
