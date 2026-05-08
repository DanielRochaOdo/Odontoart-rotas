# Regras de Roles do Sistema

Ultima revisao: 2026-05-06

Este arquivo consolida as regras de acesso por role no frontend e no banco.

## Roles oficiais

- `VENDEDOR` (`ROLE_LEVEL = 1`)
- `ASSISTENTE` (`ROLE_LEVEL = 2`)
- `SUPERVISOR` (`ROLE_LEVEL = 3`)

Nao existe role `ADMIN` neste sistema.

## Regras globais

1. Todas as rotas, exceto `/login`, exigem sessao autenticada.
2. O role do usuario vem de `public.profiles.role`.
3. Se o role vindo de metadata for invalido/ausente, o sistema cai para `VENDEDOR`.
4. Se `profiles.force_reauth_after` estiver preenchido e o token for anterior a esse horario, o role fica invalido ate novo login.
5. Regras de hierarquia em `profiles`:
   - `VENDEDOR`: `supervisor_id` obrigatorio e `vendedor_id` nulo.
   - `ASSISTENTE`: `supervisor_id` nulo e `vendedor_id` nulo.
   - `SUPERVISOR`: `supervisor_id` nulo e `vendedor_id` nulo.
6. Flags de perfil:
   - `can_access_pre_cadastro`: somente pode ser `true` para `VENDEDOR`.
   - `can_access_next_route_dashboard`: somente pode ser `true` para `VENDEDOR`.

## Matriz de acesso por modulo (frontend)

| Modulo | Rota | VENDEDOR | ASSISTENTE | SUPERVISOR | Observacoes |
|---|---|---|---|---|---|
| Dashboard | `/` | Sim | Sim | Sim | Vendedor ve visao individual. Assistente/Supervisor ve visao de equipe. |
| Rotas (planejamento) | `/agenda` | Nao | Sim | Sim | Tela `Agenda.tsx` (nome visual: Rotas). |
| Agenda (visitas) | `/visitas` | Sim | Sim | Sim | Operacoes variam por role (detalhes abaixo). |
| Aceite digital | `/aceite-digital` | Sim | Sim | Sim | Menu mostra para vendedor; assistente/supervisor acessam por link direto. |
| Empresas | `/clientes` | Nao | Sim | Sim | Edicao completa so supervisor. |
| Modulo Fila | `/fila` | Nao | Sim | Sim | Gestao de fila e avisos. |
| KPI | `/kpi` | Nao | Sim | Sim | Importacao e historico de KPI. |
| Logs | `/logs` | Nao | Nao | Sim | Somente supervisor. |
| Configuracoes | `/configuracoes` | Nao | Sim | Sim | Menu mostra so supervisor; assistente acessa por link direto. |
| Rotas (legado) | `/rotas` | Nao | Sim | Sim | Tela antiga (`Routes.tsx`), fora do menu principal. |
| Rotas no mapa (legado) | `/rotas/mapa` | Nao | Nao | Nao | Rota redireciona para `/agenda`. |

## Regras por funcionalidade

### Rotas (`/agenda`, `Agenda.tsx`)

- `ASSISTENTE` e `SUPERVISOR` podem acessar, gerar e editar visitas.
- Somente `SUPERVISOR` pode:
  - gerenciar instrucoes de visita;
  - usar geracao de rotas do tipo supervisor.

### Agenda de visitas (`/visitas`, `Visitas.tsx`)

- `VENDEDOR` pode acessar a agenda dele.
- `ASSISTENTE` e `SUPERVISOR` podem gerenciar visitas da equipe.
- Somente `SUPERVISOR` pode gerenciar instrucoes de visita.
- Filtro por supervisor existe para `ASSISTENTE` e `SUPERVISOR`.
- Controle por cadeado para liberar proxima rota existe no codigo, mas hoje esta desativado (`SHOW_VENDOR_LOCK_ICON = false`).

### Aceite digital (`/aceite-digital`)

- `VENDEDOR` registra o proprio aceite.
- `ASSISTENTE` e `SUPERVISOR` veem resumo da equipe.

### Empresas (`/clientes`)

- `ASSISTENTE` e `SUPERVISOR` podem consultar.
- `ASSISTENTE` e `SUPERVISOR` podem cadastrar.
- Somente `SUPERVISOR` pode editar cadastro existente.

### Configuracoes (`/configuracoes`)

- `SUPERVISOR`: gestao de usuarios (supervisor, vendedor, assistente), reset de sessao, eventos e sincronizacao ERP.
- `ASSISTENTE`: acesso somente ao bloco de eventos.
- `VENDEDOR`: sem acesso.

### Pre-cadastro (`PreCadastro.tsx`)

- Regra implementada no codigo:
  - `VENDEDOR` so acessa se `can_access_pre_cadastro = true`.
  - `ASSISTENTE` e `SUPERVISOR` podem revisar/aprovar/reprovar.
- Observacao: atualmente nao existe rota ativa para essa tela em `App.tsx`.
- Observacao de seguranca: no banco, a policy de `pre_cadastros` nao valida `can_access_pre_cadastro`; esse bloqueio hoje e de frontend.

### Proxima rota no dashboard

- Bloco existe no codigo do dashboard, mas esta desativado (`SHOW_NEXT_ROUTE_BLOCK = false`).
- A liberacao por data usa tabela `vendor_next_route_releases`.
- A flag `can_access_next_route_dashboard` existe em `profiles`, mas o fluxo ativo usa liberacao por data/tabela.

## Regras de banco (RLS e seguranca)

### `profiles`

- Usuario autenticado le o proprio perfil.
- `SUPERVISOR` e `ASSISTENTE` leem todos os perfis.
- Escrita de perfis e gerenciamento de usuarios e restrita a `SUPERVISOR`.
- Edge Function `manage-users` tambem valida `SUPERVISOR` antes de criar/editar/remover/resetar usuario.

### `visits`

- `SUPERVISOR` e `ASSISTENTE`: acesso total.
- `VENDEDOR`: le/atualiza somente visitas dele.
- Regra adicional: vendedor perde acesso a visitas de datas futuras se tiver visita anterior pendente (`vendor_has_pending_before`).

### `clientes`

- `SUPERVISOR`: acesso total.
- `ASSISTENTE`: leitura e insercao.
- `VENDEDOR`: leitura somente de clientes vinculados as proprias visitas.

### `aceite_digital`

- `SUPERVISOR` e `ASSISTENTE`: acesso total.
- `VENDEDOR`: leitura e insercao somente do proprio aceite.

### `pre_cadastros`

- `VENDEDOR`: cria proprio registro com status inicial `PENDENTE` e le os proprios.
- `ASSISTENTE` e `SUPERVISOR`: leitura geral e revisao (update).

### `route_events`

- `ASSISTENTE` e `SUPERVISOR`: select/insert/update/delete.
- `VENDEDOR`: sem acesso.

### `vendor_next_route_releases`

- `ASSISTENTE` e `SUPERVISOR`: acesso total.
- `VENDEDOR`: somente leitura dos proprios registros.

### Modulo Fila (`queue_release_*`)

- `ASSISTENTE` e `SUPERVISOR` podem gerenciar configuracoes e controles.
- Avisos e RPCs de fila validam permissao (`queue_release_can_manage`).
- `VENDEDOR`: sem permissao de gestao no modulo.

### `audit_logs`

- Leitura somente para `SUPERVISOR`.

### `visit_supervisors` e `visit_supervisor_register`

- Acesso total somente para `ASSISTENTE` e `SUPERVISOR`.

## Observacoes finais

1. O menu lateral nao representa tudo que existe por rota; algumas telas podem ser acessadas por link direto.
2. Quando houver conflito entre frontend e banco, a regra final e a do banco (RLS/policies).
