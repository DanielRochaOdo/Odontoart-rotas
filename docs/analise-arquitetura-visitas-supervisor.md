# Analise de Arquitetura - Visitas de Supervisor

## 1) Objetivo
Documentar a proposta tecnica para o novo fluxo de visitas de supervisor, preservando estabilidade do sistema atual e principios SOLID, sem quebrar regras de negocio ja existentes para vendedor.

## 2) Premissas Fechadas
1. Nao existe role `ADMIN`. O perfil de maior privilegio e `SUPERVISOR`.
2. O novo fluxo e um novo tipo de visita (nao um modulo separado).
3. `tipo_visita` e obrigatorio e nunca pode ficar vazio.
4. Para supervisor:
   - aceite digital nao e obrigatorio;
   - `quantidade_vidas` e opcional;
   - `quantidade_funcionarios` e diferente de vidas;
   - pode haver mais de um supervisor na mesma rota.
5. No calendario:
   - se houver visita de supervisor na data, pin da data fica roxo;
   - na lista "visitas do dia", visitas de supervisor ficam destacadas.
6. Flag por empresa no menu de rotas (baseada na ultima visita do supervisor):
   - `0..90` dias: verde
   - `91..180` dias: amarelo
   - `>180` dias: vermelho
   - sem historico: cinza
7. Dashboard deve ter bloco separado para visitas de supervisor com:
   - realizadas
   - pendentes (tudo que nao foi registrado)
   - vidas (soma com `null = 0`)
   - motivo de cada visita
   - filtro por supervisor (select simples)
8. Horario da visita pode sempre ser atualizado, tanto vendedor quanto supervisor, com carater informativo.

## 3) Escopo Funcional

### 3.1 Geracao de Rotas (Modal "Gerar visitas")
1. Dividir em abas:
   - `Vendedor` (fluxo atual, sem alteracao de comportamento)
   - `Supervisor` (fluxo novo)
2. Aba `Supervisor`:
   - `Supervisores destino` (multiselect, incluindo o proprio login)
   - `Data da visita`
   - `Empresas` selecionadas na rota
   - `Motivo` por empresa (`RETENCAO`, `RELACIONAMENTO`, `EMPRESA INADIMPLENTE`, `EVENTO/ODONTOMOVEL`)

### 3.2 Registro de Visita Supervisor
1. Pergunta de modo:
   - `Tratar igual vendedor?`
2. Se `SIM`: usa o fluxo atual do vendedor.
3. Se `NAO` (registro diferenciado), exigir:
   - `quantidade_vidas` (opcional, inteiro >= 0)
   - `horario_visita`
   - `quantidade_funcionarios` (inteiro >= 0)
   - `descricao_visita` (select obrigatorio):
     - `Reuniao realizada`
     - `Visita marcada`
     - `Visita pendente`
     - `Visita nao autorizada`
     - `Duvidas sobre portal/plano`
     - `Lista solicitada`
     - `Lista recebida`
     - `Odontomovel alinhado`
     - `Acao/SIPAT realizada`
     - `Retencao realizada`
     - `Retencao sem sucesso`
     - `Cancelamento solicitado`
   - `pessoa_contato_mesma` (`SIM`/`NAO`)
4. Se `pessoa_contato_mesma = NAO`:
   - expandir campos `Pessoa` e `Contato`
   - ao salvar, atualizar esses campos no cadastro da empresa
5. Regra recomendada de consistencia:
   - `quantidade_funcionarios >= quantidade_vidas` quando vidas for informado

### 3.3 Agenda/Calendario
1. Indicador por data:
   - manter comportamento atual
   - adicionar prioridade visual para visita de supervisor (pin roxo)
2. Lista de visitas do dia:
   - destacar visitas de supervisor
   - ordenar supervisor antes de vendedor

### 3.4 Flag da Empresa (Modulo Rotas)
1. Base de calculo:
   - sempre a ultima visita de supervisor concluida relacionada ao supervisor logado
2. Cores:
   - verde: `0..90`
   - amarelo: `91..180`
   - vermelho: `>180`
   - cinza: sem historico
3. Timezone de referencia para diferenca de dias:
   - `America/Fortaleza`

### 3.5 Dashboard
1. Bloco separado `Visitas de Supervisor`.
2. KPIs:
   - `realizadas`: visitas registradas
   - `pendentes`: visitas sem registro
   - `vidas`: soma de vidas com `null = 0`
3. Analiticos:
   - distribuicao por motivo (`RETENCAO`, `RELACIONAMENTO`, `EMPRESA INADIMPLENTE`, `EVENTO/ODONTOMOVEL`)
   - lista detalhada por visita
4. Filtro:
   - select de supervisor (`Todos` + supervisores)

## 4) Proposta de Modelagem (Nao Implementada)

### 4.1 Tabela `visits` (evolucao)
Adicionar colunas:
1. `visit_type text not null`  
   Valores: `VENDEDOR`, `SUPERVISOR_RELACIONAMENTO`
2. `supervisor_reason text null`  
   Valores internos: `RETENCAO`, `RELACIONAMENTO`, `EMPRESA_INADIMPLENTE`, `EVENTO_ODONTOMOVEL`  
   Labels exibidos: `RETENCAO`, `RELACIONAMENTO`, `EMPRESA INADIMPLENTE`, `EVENTO/ODONTOMOVEL` (obrigatorio quando `visit_type = SUPERVISOR_RELACIONAMENTO`)
3. `register_mode text not null default 'PADRAO'`  
   Valores: `PADRAO`, `SUPERVISOR_DIFERENCIADO`
4. `visit_time time null`  
   Campo informativo editavel para qualquer tipo
5. `registered_by_user_id uuid null`  
   Usuario que efetivamente registrou

### 4.2 Relacao N:N de Supervisores por Visita
Criar tabela `visit_supervisors`:
1. `visit_id uuid not null references visits(id) on delete cascade`
2. `supervisor_user_id uuid not null references profiles(user_id) on delete cascade`
3. `created_at timestamptz default now()`
4. PK composta `(visit_id, supervisor_user_id)`

Uso:
1. Permitir mais de um supervisor vinculado na mesma visita/rota.
2. Base para calendario, dashboard por supervisor e calculo da flag por supervisor logado.

### 4.3 Detalhe de Registro Diferenciado do Supervisor
Criar tabela `visit_supervisor_register` (1:1 com visita):
1. `visit_id uuid primary key references visits(id) on delete cascade`
2. `quantidade_vidas integer null check (quantidade_vidas >= 0)`
3. `quantidade_funcionarios integer not null check (quantidade_funcionarios >= 0)`
4. `descricao_visita text not null`
   Valores permitidos:
   - `REUNIAO_REALIZADA` (`Reuniao realizada`)
   - `VISITA_MARCADA` (`Visita marcada`)
   - `VISITA_PENDENTE` (`Visita pendente`)
   - `VISITA_NAO_AUTORIZADA` (`Visita nao autorizada`)
   - `DUVIDAS_SOBRE_PORTAL_PLANO` (`Duvidas sobre portal/plano`)
   - `LISTA_SOLICITADA` (`Lista solicitada`)
   - `LISTA_RECEBIDA` (`Lista recebida`)
   - `ODONTOMOVEL_ALINHADO` (`Odontomovel alinhado`)
   - `ACAO_SIPAT_REALIZADA` (`Acao/SIPAT realizada`)
   - `RETENCAO_REALIZADA` (`Retencao realizada`)
   - `RETENCAO_SEM_SUCESSO` (`Retencao sem sucesso`)
   - `CANCELAMENTO_SOLICITADO` (`Cancelamento solicitado`)
5. `pessoa_contato_mesma boolean not null`
6. `pessoa text null`
7. `contato text null`
8. `updated_at timestamptz default now()`
9. `updated_by_user_id uuid null references auth.users(id)`

Observacao:
1. `quantidade_vidas` permanece opcional no modo diferenciado.
2. Quando `pessoa_contato_mesma = false`, `pessoa` e `contato` tornam-se obrigatorios.
3. O campo `descricao_visita` nao e texto livre; deve usar select fixo com os valores permitidos.

## 5) Regras de Negocio por Tipo (Policy/Strategy)
Criar politicas de validacao por tipo para evitar `if` espalhado:
1. `VendedorVisitPolicy` (comportamento atual)
2. `SupervisorVisitPolicy` (geracao e registro supervisor)

Beneficios:
1. Isola regras por tipo (OCP/SRP).
2. Mantem fluxo vendedor sem regressao.
3. Facilita evolucao para novos tipos futuros.

## 6) Autorizacao
1. Fluxo supervisor habilitado apenas para role `SUPERVISOR`.
2. Supervisor pode criar rota para si e para outros supervisores.
3. Leitura de visitas supervisor deve obedecer participacao em `visit_supervisors` quando aplicavel.

## 7) Definicao de Status para Dashboard Supervisor
1. `Realizada`: `completed_at is not null`.
2. `Pendente`: `completed_at is null` (nao registrada).
3. `No visit` com motivo continua sendo registro (nao entra em pendente).

## 8) Compatibilidade e Estabilidade
1. Nao alterar fluxo vendedor existente.
2. Migrations retrocompativeis:
   - backfill de `visit_type = VENDEDOR` para legado
   - depois aplicar `NOT NULL` e constraints
3. Feature flag para:
   - aba supervisor na geracao
   - pin roxo/destaque no calendario
   - bloco supervisor no dashboard
4. Testes minimos:
   - regressao do fluxo vendedor
   - validacao por tipo
   - calculo de flag por dias e sem historico
   - consolidacao dashboard por supervisor e por `Todos`

## 9) Observacoes de Implementacao
1. Recomendado versionar contratos de leitura (agenda/dashboard) adicionando campos sem quebrar payload atual.
2. Garantir auditoria para:
   - mudanca de `Pessoa` e `Contato` da empresa via registro supervisor
   - alteracoes de registro diferenciado
3. Centralizar calculo de dias da flag no backend para evitar divergencia entre telas.

## 10) Ponto para Validacao Final Antes de Codar
1. No filtro `Todos` do bloco supervisor no dashboard, confirmar regra de contagem:
   - recomendacao: contar visita unica (sem duplicar quando houver 2+ supervisores na mesma visita).
