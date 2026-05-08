# Regras de Negocio - VENDEDOR

Ultima revisao: 2026-05-06
Fonte: `rules.md`

Este documento consolida somente as regras que impactam o perfil `VENDEDOR` (`ROLE_LEVEL = 1`).

## Regras globais do perfil

1. Todas as rotas, exceto `/login`, exigem sessao autenticada.
2. O role do usuario vem de `public.profiles.role`.
3. Se o role vier invalido ou ausente no metadata, o sistema cai para `VENDEDOR`.
4. Se `profiles.force_reauth_after` estiver preenchido e o token for anterior, o role fica invalido ate novo login.
5. Hierarquia obrigatoria em `profiles`:
   - `supervisor_id` obrigatorio.
   - `vendedor_id` deve ser nulo.
6. Flags de perfil:
   - `can_access_pre_cadastro` pode ser `true` para vendedor.
   - `can_access_next_route_dashboard` pode ser `true` para vendedor.

## Acesso no frontend (rotas)

### Rotas com acesso

- `/` (Dashboard): acesso permitido com visao individual.
- `/visitas` (Agenda de visitas): acesso permitido para agenda propria.
- `/aceite-digital`: acesso permitido para registrar proprio aceite.

### Rotas sem acesso

- `/agenda` (Rotas/planejamento)
- `/clientes`
- `/fila`
- `/kpi`
- `/logs`
- `/configuracoes`
- `/rotas` (legado)
- `/rotas/mapa` (legado)

## Regras por funcionalidade

### Agenda de visitas (`/visitas`)

- Vendedor acessa somente as visitas dele.
- Controle de cadeado para liberar proxima rota existe no codigo, mas esta desativado (`SHOW_VENDOR_LOCK_ICON = false`).

### Regras de horario para visualizacao de rotas (`/visitas`)

- A liberacao da proxima rota por horario ocorre a partir das `19:00` (`now.getHours() >= 19`), usando a hora local do dispositivo/navegador.
- Antes das `19:00`, datas acima do limite liberado ficam desabilitadas no calendario.
- Se a primeira rota do vendedor estiver no futuro:
  - antes das `19:00`, o limite fica em hoje;
  - depois das `19:00`, libera a data da primeira rota.
- Se ja existir rota hoje/passada, a proxima rota so libera apos validar a rota anterior:
  - todas as visitas da data anterior precisam estar concluidas;
  - se houve visita concluida, o aceite digital da data deve estar registrado.
- Se houver pendencia, a visualizacao para nas datas seguintes ate regularizar (inclusive fora da janela de horario).
- Se a validacao falhar por erro tecnico, o sistema bloqueia o acesso a proximas rotas e exibe mensagem de bloqueio.
- Se uma data acima do limite estiver selecionada, o sistema ajusta automaticamente para a data maxima permitida.

### Aceite digital (`/aceite-digital`)

- Vendedor registra o proprio aceite digital.
- Vendedor nao gerencia aceite da equipe.

### Pre-cadastro (`PreCadastro.tsx`)

- Vendedor so acessa se `can_access_pre_cadastro = true`.
- Vendedor cria pre-cadastro proprio com status inicial `PENDENTE`.
- Vendedor acompanha somente os proprios pre-cadastros.
- Observacao: nao ha rota ativa para essa tela em `App.tsx` atualmente.
- Observacao de seguranca: validacao de `can_access_pre_cadastro` esta no frontend.

### Proxima rota no dashboard

- Bloco de proxima rota esta desativado (`SHOW_NEXT_ROUTE_BLOCK = false`).
- Fluxo ativo de liberacao usa `vendor_next_route_releases` (liberacao por data).

## Regras de banco (RLS) para vendedor

### `profiles`

- Pode ler o proprio perfil.
- Nao pode gerenciar usuarios/perfis.

### `visits`

- Pode ler e atualizar somente as proprias visitas.
- Restricao adicional: perde acesso a visitas futuras se houver visita anterior pendente (`vendor_has_pending_before`).

### `clientes`

- Pode ler somente clientes vinculados as proprias visitas.
- Nao pode cadastrar nem editar clientes.

### `aceite_digital`

- Pode ler e inserir somente o proprio aceite.

### `pre_cadastros`

- Pode criar registro proprio.
- Pode ler somente os proprios registros.

### `vendor_next_route_releases`

- Pode apenas ler os proprios registros.

### Tabelas/modulos sem permissao de vendedor

- `route_events`
- Modulo fila (`queue_release_*`)
- `audit_logs`
- `visit_supervisors`
- `visit_supervisor_register`

## Observacoes finais

1. O menu lateral nao cobre todas as rotas; acesso real e validado por role e policies.
2. Em conflito entre frontend e banco, prevalece a regra do banco (RLS/policies).
