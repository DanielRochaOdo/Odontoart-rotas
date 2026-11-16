# Plano para reduzir a carga do módulo KPI no Supabase

Data: 11/11/2026

## Objetivo

Reduzir chamadas repetidas e volume lido pelo módulo KPI sem perder os indicadores
nem o acompanhamento da sincronização. O histórico de snapshots pode ser removido,
conforme confirmado pelo usuário. A causa deve ser confirmada
com medições recentes no projeto Supabase antes de atribuir a avaria a uma query
específica.

## Implementação local

O fluxo foi implementado no código local em 11/11/2026. A migration
`2026111201_kpi_monthly_ledger.sql` cria `kpi_movimentos_mensais`, com upsert por
`(codigo, competencia)`, e a função `kpi_persist_monthly_movements` grava os
totais e atualiza categoria e `vidas_qtde` atomicamente. A função Edge consulta
`AssociadoTotal` uma vez por código, divide as movimentações por competência e
preserva o total local se o endpoint de cadastro falhar.

O Dashboard do KPI lê a tabela mensal, soma os meses da consulta para os
indicadores atuais e oferece a aba **Histórico 12 meses**. O worker não grava
mais snapshots; a tela não consulta snapshots nem relê o histórico a cada avanço
da sincronização. O polling de status foi reduzido para um ciclo de 15 segundos e
pausa a leitura quando a aba está oculta ou o navegador está offline.

A migration ainda precisa ser aplicada no projeto Supabase e a Edge Function
precisa ser publicada para ativar o fluxo fora deste checkout. Não foi feita
limpeza da tabela antiga de snapshots: os dados legados permanecem no banco,
mas deixam de ser lidos ou escritos pelo novo fluxo.

## Regra funcional do KPI

O KPI usa duas APIs com responsabilidades distintas. A API de movimentações
retorna entradas e saídas do intervalo escolhido; esses valores alimentam o
histórico por competência e o status. A API de empresas retorna
`dados[].AssociadoTotal`, o total atual de vidas; usar esse valor absoluto para
atualizar `clientes.vidas_qtde`, inclusive preenchendo o campo local vazio. O
usuário confirmou essa mudança em relação à regra anterior de manter somente o
histórico quando o campo estivesse vazio.
Não somar o delta histórico de entradas menos saídas ao `AssociadoTotal`, pois o
total atual já representa as vidas existentes e essa soma pode duplicar
movimentos. Por exemplo, para o código 4609, a amostra informa `AssociadoTotal`
117 e, em outubro, 11 entradas e 5 saídas. Registra-se o saldo histórico +6 e
atualiza-se a quantidade atual para 117, sem gravar 123.

O status é calculado pelas entradas e saídas — Só perda, Queda, Crescimento,
Só ganho ou Neutro — e `clientes.categoria` é atualizado independentemente do
valor de vidas. Para intervalos com várias competências, guardar o status mensal
em cada linha e calcular `clientes.categoria` com os totais somados do intervalo
completo selecionado. Cada leitura bem-sucedida substitui a anterior na mesma
competência; não somar consultas repetidas.

Gravação e tratamento de falhas devem ser idempotentes. Aceitar `AssociadoTotal`
somente quando presente, numérico, inteiro e maior ou igual a zero; zero é um
valor válido. Se essa API falhar ou retornar valor ausente/inválido, preservar
`vidas_qtde` atual e registrar o erro, sem impedir a gravação da movimentação e
da categoria quando a API de movimentos tiver sucesso.

### Contratos das APIs observados

- API de empresas: `GET /api/empresa/BuscaEmpresas?empresaId={codigo}`. O total
  está em `dados[].AssociadoTotal`; conferir que `dados[].Id` corresponde ao
  código consultado antes de persistir. No exemplo 4609, o total atual é 117.
- API de movimentações: `GET /v2/api/contratos/movimentacao-vidas` com
  `codigo_empresa`, `data_inicio` e `data_fim`. Para outubro de 2026, a amostra
  retorna `total.entradas = 11` e `total.saidas = 5` (3+8 entradas e 1+4 saídas
  entre associados e dependentes). Usar o bloco `total` como agregado do KPI.
- Em cada execução manual, chamar a API de empresas uma vez por código para o
  total atual e a API de movimentos para cada trecho mensal solicitado. Não
  enviar token ao navegador; ambas as chamadas ficam no worker autenticado. São
  chamadas separadas no mesmo run, usando concorrência limitada para não duplicar
  pressão desnecessária sobre as APIs.

## Diagnóstico que motivou a alteração

Antes desta alteração, `src/pages/KPI.tsx` carregava snapshots por execução e
relia o resultado durante o processamento.

O ciclo anterior também executava contagens exatas de snapshots e erros e podia
fazer duas consultas sequenciais para localizar o banner.

Durante uma execução, o avanço de `processed_codes` iniciava novas leituras
completas dos snapshots daquela execução. As páginas anteriores eram lidas de
novo à medida que o conjunto crescia.

O worker é um fluxo distinto: consulta a API externa do ERP com seis workers e
persiste histórico mensal, categoria e estado dos itens.
Uma chamada à API do ERP não é por si só uma leitura do Postgres, mas a execução
gera trabalho no banco. O diagnóstico anterior de outubro de 2026 identificou
gravações frequentes de KPI em estatísticas acumuladas; esses números não provam
que o worker seja a causa atual nem medem o intervalo de coleta.

Na implementação atual, o worker usa `AssociadoTotal` absoluto e já não calcula
vidas a partir do saldo histórico. A categoria usa o saldo agregado do intervalo
selecionado e o status mensal fica junto à respectiva competência.

Referências do código: [KPI.tsx](../src/pages/KPI.tsx),
[worker kpi-sync-daily](../supabase/functions/kpi-sync-daily/index.ts),
[diagnóstico anterior](diagnostico-io-supabase-2026-10-09.md) e
[otimizações de I/O registradas](melhorias-io-implementadas-2026-10-09.md).

## Plano de ação

### Fase 1 — confirmar causa e registrar linha de base

1. No projeto Supabase afetado, registrar projeto, horário, plano e indicador
   observado (Disk I/O, CPU, memória, latência ou espaço ocupado).
2. Coletar estatísticas em T0 e novamente após 15–30 minutos de uso representativo,
   preservando a identidade da query e os contadores de chamadas, tempo, blocos,
   temporários e WAL. Cruzar com os gráficos do mesmo intervalo.
3. Segmentar a janela por uma pessoa com KPI aberto, múltiplas abas e execução
   ativa. Registrar quantas vezes o worker foi iniciado e o número aproximado de
   códigos processados.
4. Comparar deltas antes/depois, não contadores históricos acumulados. Usar o
   SQL somente leitura existente em [diagnostico_disk_io.sql](sql/diagnostico_disk_io.sql).

**Saída:** lista das queries KPI que mais contribuem por chamadas, tempo, blocos
lidos/escritos, temporários e WAL, com intervalo de coleta conhecido.

### Fase 2 — garantir a regra de negócio e a idempotência

1. Para cada código, consultar a API de empresas uma vez por execução e a API de
   movimentações para cada trecho mensal do intervalo. Uma seleção de 90 dias
   com três competências gera uma consulta da API de empresas e até três de
   movimentos por código.
2. Sempre gravar histórico e status das movimentações. Atualizar
   `clientes.categoria` quando houver resposta válida de movimentações, inclusive
   quando entradas e saídas forem ambas zero.
3. Validar `AssociadoTotal` como inteiro não negativo e gravá-lo como valor
   absoluto em `clientes.vidas_qtde`, inclusive preenchendo campo local vazio.
   Se a resposta for ausente/inválida, preservar o valor local e registrar erro.
4. Usar `(codigo, competencia)` como chave de substituição. O retry do mesmo
   item deve ser seguro; uma nova leitura daquela competência substitui os
   totais anteriores. O upsert idempotente do total absoluto não aplica
   movimentações novamente.
5. Validar pelo menos: API retorna `AssociadoTotal = 117` e movimentos de outubro
   com 11 entradas e 5 saídas: vidas ficam em 117 e histórico registra +6;
   campo local vazio é preenchido por total válido; zero é aceito; total ausente,
   negativo, fracionário ou inválido preserva o campo local; retries; código sem
   cadastro; e entradas/saídas zero.

**Saída:** quantidade e categoria atualizadas de forma atômica, estado atual
explicável e reprocessamento sem duplicar movimentos.

### Fase 3 — conter leituras redundantes no frontend

1. Atualizar status com um único endpoint/consulta de status por ciclo. Evitar as
   duas contagens exatas a cada ciclo; reutilizar os totais já persistidos no
   banner da execução ou solicitar uma contagem agregada somente em momentos
   necessários (por exemplo, ao abrir detalhes ou concluir a execução).
2. Fazer polling adaptativo: pausar quando a aba estiver oculta ou offline,
   impedir ciclos sobrepostos e usar intervalo maior quando não houver execução.
   Como ponto inicial: 15 segundos durante execução ativa e 60 segundos em repouso,
   ajustáveis depois da medição.
3. Durante a sincronização, atualizar o banner e os contadores. Consultar a tabela
   atual uma vez após a publicação da execução. Se resultados parciais forem
   necessários, consultar somente linhas novas com cursor estável.
4. No carregamento inicial, buscar diretamente a projeção atual, paginada de forma
   estável; remover a consulta de snapshots por run e o fallback de 30 dias.
5. Deduplicar chamadas simultâneas e coordenar abas, preservando isolamento por
   usuário. Ao trocar conta, invalidar dados em memória e descartar respostas
   atrasadas.

**Prioridade:** alta. São alterações de cliente e podem reduzir carga sem novo
índice ou varredura adicional no banco.

### Fase 4 — reduzir consultas do worker se as métricas apontarem para ele

1. Confirmar que a função implantada corresponde ao código local e identificar
   quais chamadas dominam o delta (itens, projeção atual, `clientes`, progresso ou
   retries).
2. Ajustar concorrência e lote com base em latência do ERP e do banco; não elevar
   os seis workers atuais. Medir também efeitos na duração total e na taxa de
   retry.
3. Preservar escrita idempotente, leases, recuperação e progresso. Atualizar
   somente valores que mudaram. O usuário confirmou que não precisa preservar o
   histórico de snapshots.
4. Se chamadas pequenas e repetidas continuarem dominantes, avaliar uma operação
   em lote transacional no Postgres, comparando escrita/WAL, locks, falhas parciais
   e custo de manutenção antes de adotar.

**Dependência:** esta fase só deve avançar após a coleta separar a carga da UI da
carga de sincronização. O repositório já contém otimizações anteriores de escrita
de KPI; validar o estado implantado antes de repetir essas mudanças.

### Fase 5 — plano de query, índices ou agregação somente com evidência

Para cada SELECT com tempo ou leitura altos, obter plano com filtros e contexto
equivalentes aos do usuário/RLS. Avaliar índice somente se o plano e o padrão de
uso justificarem; índices novos também aumentam custo de escrita e armazenamento.
Se o dashboard precisar de muitas agregações sobre histórico grande, considerar
uma projeção diária/relatório agregado, atualizada fora do caminho interativo e
com fonte e horário de atualização visíveis. Não criar índice ou tabela
materializada preventivamente.

## Modelo mensal para a nova aba do Dashboard

O usuário escolhe livremente as datas inicial e final ao clicar em
**Sincronizar**; não há período fixo nem Cron. O sistema identifica as
competências mensais tocadas pelo intervalo e, como a API retorna totais
agregados, divide a consulta nos trechos mensais correspondentes. Por exemplo,
um intervalo que vai de 20 de janeiro a 10 de março gera trechos de 20–31 de
janeiro, 1–28 de fevereiro e 1–10 de março. A nova tabela deve ter uma linha
por código e competência mensal, por exemplo `kpi_movimentos_mensais`, com
`codigo`, `competencia`, entradas, saídas, saldo, categoria/status, datas cobertas,
run de origem e horário de atualização. Chave única: `(codigo, competencia)`.
As datas cobertas identificam exatamente o trecho consultado para aquela linha.
Uma competência pode ser consultada novamente: cada leitura bem-sucedida
substitui a versão anterior, e a gravação deve refletir a resposta atual da API.
O fato de a API retornar os mesmos totais para um mês passado decorre do
comportamento da origem e da impossibilidade de alterar movimentos passados; não
é uma regra que o sistema deva impor ou garantir. O sistema guarda as datas
consultadas para dar contexto ao dado, sem bloquear reconsultas por considerar
uma competência fechada.

Essa tabela substitui `kpi_sync_snapshots` como fonte do front e como histórico
funcional: manter apenas as doze competências necessárias para o Dashboard, se
essa for a retenção escolhida. A execução em andamento continua usando
`kpi_sync_run_items` como staging/retry; cada item deve conservar o resultado
validado da API de total atual e os resultados mensais da API de movimentos. Ao
persistir, uma transação grava o histórico e atualiza `clientes.categoria`;
quando `AssociadoTotal` for válido, atualizar `clientes.vidas_qtde` pelo valor
absoluto, inclusive preenchendo campo vazio. O front lê os registros das
últimas doze competências com
paginação/consulta agregada adequada. A UI não chama o ERP ao abrir o Dashboard.

Para a mesma competência, a leitura mais nova da API de movimentos substitui a
anterior, mesmo que cubra outro número de dias; não se somam respostas repetidas.
O total atual vem da API de empresas como valor absoluto, não de acumular deltas
mensais. O histórico anual começa a acumular a partir da implantação, sem
backfill de meses anteriores. Ao consultar um período passado, o KPI registra
movimentos e status daquele período, mas mantém em `vidas_qtde` o `AssociadoTotal`
atual retornado pela API de empresas.

## Pesquisa de boas práticas e recomendação escalável

Pesquisa realizada em 11/11/2026, priorizando documentação oficial do Supabase
e do PostgreSQL.

### 1. Separar integração externa, persistência e leitura

- Manter o consumo da API Odontoart no worker/Edge Function. A resposta é
  validada e persistida no banco; o front não chama o ERP e não faz a aplicação
  de saldo. O Supabase recomenda funções de banco para trabalho intensivo em
  dados e Edge Functions para integrações e orquestração externa
  ([Database Functions](https://supabase.com/docs/guides/database/functions),
  [Edge Functions](https://supabase.com/docs/guides/functions)).
- Manter `kpi_sync_runs` e `kpi_sync_run_items` como estado durável da execução.
  Já existe lease/retry por item e valores retornados em `received_value`, então
  não é necessário adotar outra fila sem demonstrar uma limitação desse mecanismo.
  Se futuramente houver demanda por fila dedicada, o Supabase Queues/PGMQ é uma
  opção persistente. A garantia de entrega do broker não substitui idempotência
  das gravações no banco ([Supabase Queues](https://supabase.com/docs/guides/queues),
  [PGMQ](https://supabase.com/docs/guides/queues/pgmq)).

### 2. Usar ledger de aplicação e projeção atual

Modelo conceitual recomendado:

1. **Movimentação mensal (ledger e fonte do Dashboard):** uma linha relacional
   por código/competência com entradas, saídas, saldo, status e run de origem.
   Chave única `(codigo, competencia)`; guardar números em colunas tipadas.
2. **Execução/staging:** manter `kpi_sync_runs` e `kpi_sync_run_items` para
   progresso, retry e publicação do mês, sem usá-los como fonte da tela anual.
3. **Cadastro oficial:** `clientes.categoria` recebe o status da movimentação.
   `clientes.vidas_qtde` recebe o `AssociadoTotal` atual validado da API de
   empresas, inclusive quando o campo local estiver vazio. O valor precisa ser
   inteiro e não negativo; resposta inválida não substitui o valor já salvo.

Uma constraint única impede duplicar a chave exata de ledger; `INSERT ... ON
CONFLICT` permite operação atômica sob concorrência
([PostgreSQL INSERT/UPSERT](https://www.postgresql.org/docs/current/sql-insert.html)).
Para qualquer nova leitura de uma competência já existente, substituir os totais
e as datas cobertas. A quantidade atual é atualizada separadamente pelo valor
absoluto validado de `AssociadoTotal`; não aplicar sobre ele o saldo das
movimentações do período. A gravação do ledger, a Categoria e a quantidade atual
devem ser atômicas quando as respostas válidas estiverem disponíveis.

### 3. Aplicar os efeitos em uma transação atômica

Uma função RPC ou uma transação SQL por lote deve, na mesma transação:

1. inserir/atualizar a chave do resultado no ledger;
2. atualizar `clientes.categoria` a partir das movimentações do período;
3. se `AssociadoTotal` for válido e corresponder ao código consultado, gravar o
   valor absoluto em `clientes.vidas_qtde`; se for inválido, preservar o atual;
4. atualizar a projeção lida pelo front e marcar separadamente o resultado das
   duas APIs, para que falha de uma não descarte o sucesso da outra.

Falha em qualquer etapa deve reverter todas as alterações do item/lote. Preferir
`SECURITY INVOKER`; se for indispensável `SECURITY DEFINER`, fixar `search_path`,
qualificar tabelas e restringir `EXECUTE` a `service_role`/papéis necessários,
porque funções com privilégios elevados podem contornar RLS
([segurança de Database Functions](https://supabase.com/docs/guides/database/functions),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)).

Para escalar, processar vários códigos por chamada com operações set-based em
lotes moderados e medir lock time, WAL, duração e retries. Não fazer uma única
transação gigante para toda a execução: aumenta duração de locks e o impacto de
falhas. Preservar concorrência limitada do worker; aumentá-la só se a medição
mostrar capacidade no Postgres e no ERP.

### 4. Atualizar a leitura de forma incremental; evitar refresh global

A recomendação é uma tabela normal de projeção mantida pelo próprio fluxo de
publicação, e não uma materialized view que precise de refresh completo após cada
run. Views comuns recalculam sua consulta a cada leitura; materialized views leem
mais rápido, mas podem ficar desatualizadas e exigem refresh, que disputa recursos
e tem restrições de concorrência. São adequadas quando tolerar atraso e a consulta
agregada realmente custar caro; não parecem a melhor primeira opção para uma
linha atual por código ([Supabase Views](https://supabase.com/docs/guides/database/views),
[PostgreSQL REFRESH MATERIALIZED VIEW](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html)).

Na tela, ler a projeção publicada uma vez após conclusão e pausar polling em abas
ocultas. Durante o run, solicitar apenas progresso. Evitar contagens exatas e
releituras completas de snapshots a cada atualização.

### Viabilidade para o Postgres e o histórico anual

A consulta manual com período escolhido pelo usuário é viável e não exige
intervalo mínimo de 90 dias por motivo do PostgreSQL. O worker deve dividir o
período por competência antes de chamar a API de movimentos, pois o parser atual
extrai somente `total.entradas` e `total.saidas` para cada intervalo. Assim cada
resposta agregada pertence a uma única linha mensal. A API de empresas acrescenta
uma consulta por código para obter o `AssociadoTotal` atual. Períodos longos
aumentam as chamadas à API de movimentos conforme a quantidade de competências e
códigos; o trabalho no Postgres
continua proporcional às linhas gravadas e consultadas. A carga principal
também depende de polling repetido e releituras, não de um mínimo arbitrário de
dias. A competência deve ser calculada com datas locais consistentes no fuso
operacional `America/Fortaleza`.

Uma nova consulta substitui por upsert a leitura anterior de cada competência
afetada. O total de vidas é atualizado por substituição absoluta com
`AssociadoTotal`, sem somar movimentos do período. Não agendar job.

Uma linha por código/mês produz aproximadamente `12 × quantidade de códigos`
linhas por ano; o front só precisa ler/agregar as doze competências pedidas. Isso
é um volume razoável para uma tabela Postgres indexada por `(competencia, codigo)`
e com chave única `(codigo, competencia)` para upsert. O ganho principal vem de
não chamar a API nem reler todas as execuções quando alguém abre o Dashboard.

O endpoint de movimentos não tem período mínimo, conforme confirmado pelo
usuário. O parser atual extrai somente um total para o intervalo inteiro; por
isso, qualquer intervalo que atravesse competências precisa ser dividido em
trechos mensais antes das chamadas. Uma janela de 90 dias pode exigir até três
consultas de movimentos por código, além de uma consulta da API de empresas para
o total atual. O front, depois disso, consulta apenas os registros Postgres
persistidos.

Não haverá backfill inicial. As competências históricas passam a ser registradas
à medida que o usuário fizer consultas após a implantação. Cada sincronização
também reconcilia a quantidade atual pelo `AssociadoTotal` quando válido; a
categoria depende de uma resposta válida da API de movimentos.

### 5. Segurança, índices e monitoramento

- Habilitar RLS na nova tabela exposta, com acesso de leitura para os mesmos perfis
  autorizados ao KPI e escrita apenas pelo worker. Se a leitura usar view, usar
  `security_invoker = true` no PostgreSQL 15+ para respeitar RLS das tabelas base
  ([Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)).
- Criar somente índices que correspondam aos filtros reais, começando pela chave
  primária/única do código e pelos filtros de run/período efetivamente consultados.
  Cada índice tem custo de armazenamento e de escrita; confirmar o ganho no plano
  antes de mantê-lo ([Query Optimization](https://supabase.com/docs/guides/database/query-optimization),
  [Query plans](https://supabase.com/docs/guides/api/query-plans)).
- Comparar deltas de `pg_stat_statements` e gráficos do Supabase: chamadas, linhas,
  tempo total, blocos lidos/escritos, temporários e WAL. A documentação do Supabase
  recomenda esse módulo para localizar queries lentas e frequentes
  ([pg_stat_statements](https://supabase.com/docs/guides/database/extensions/pg_stat_statements)).
- Não particionar nem materializar preventivamente. Particionamento só se o volume,
  retenção e planos medidos justificarem a manutenção adicional
  ([PostgreSQL Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)).

### Decisão recomendada

Adotar `kpi_movimentos_mensais` (nome provisório) como fonte da nova aba e remover
gravações e leituras de `kpi_sync_snapshots`, cuja perda histórica foi aceita.
Consultar a API somente ao clicar em **Sincronizar**, com período definido pelo
usuário e dividido por competência; ler o ano de dados persistidos no Dashboard.
Manter `kpi_sync_runs` e `kpi_sync_run_items` para processamento, retries e
diagnóstico operacional, com retenção curta se histórico técnico também não for
necessário. Uma leitura substitui a anterior na mesma competência. Histórico e
Categoria são atualizados a partir da API de movimentos; `vidas_qtde` recebe o
total absoluto validado da API de empresas, sem acumular o delta histórico.

## Critérios de aceite

- Em uma aba ativa e sem execução, no máximo uma consulta de status por minuto;
  em execução, no máximo uma consulta de status a cada 15 segundos, sem ciclos
  sobrepostos.
- Aba oculta ou offline não mantém polling.
- A tela consulta a projeção atual e não lê `kpi_sync_snapshots`.
- Indicadores, filtros, exportação e recuperação da sincronização mantêm o
  comportamento funcional definido pelo produto.
- Para o exemplo do código 4609, `AssociadoTotal = 117` e movimentos de outubro
  com 11 entradas e 5 saídas resultam em `vidas_qtde = 117`, histórico mensal +6
  e Categoria Crescimento; não gravar 123.
- Um retry ou reexecução substitui a linha da competência e mantém o mesmo total
  atual quando `AssociadoTotal` não mudou.
- Em janelas equivalentes, comparar chamadas, linhas, tempo, blocos lidos e
  escritos, temporários e WAL no `pg_stat_statements`, junto do gráfico de I/O do
  Supabase. A redução deve aparecer nos deltas da(s) query(s) alvo.
- Não declarar sucesso apenas por reduzir número de requests HTTP se o trabalho
  e os blocos lidos no Postgres permanecerem iguais.

## Riscos e decisões abertas

- Ainda não há captura atual do Supabase que ligue o alerta à tela KPI ou ao
  worker. O JSON analisado em outubro era cumulativo e não trazia período de coleta.
- O histórico anual começa a acumular com os dados obtidos a partir da
  implantação; não haverá backfill. Se `AssociadoTotal` falhar ou vier inválido,
  preserva-se `vidas_qtde` existente e registra-se erro; movimentos válidos ainda
  podem atualizar histórico e Categoria.
- Para períodos com mais de uma competência, `clientes.categoria` agora reflete
  o agregado de entradas e saídas no intervalo completo selecionado; a tabela
  mantém a categoria de cada competência separadamente.
- O usuário confirmou que snapshots históricos não são necessários e que perder
  esse histórico é aceitável. Execuções e itens devem ser retidos apenas pelo
  tempo necessário para retries e diagnóstico, conforme política definida.
- O estado exato dos índices e migrations aplicados em produção deve ser
  conferido antes de qualquer alteração de banco.
- Uma réplica ou banco de dashboard separado é uma opção de arquitetura para
  relatórios, mas não deve ser introduzida antes de medir as mudanças menores e
  validar requisitos de atualização e autorização.

## Referências técnicas

- [Supabase: Query Optimization](https://supabase.com/docs/guides/database/query-optimization)
- [Supabase: Performance Tuning](https://supabase.com/docs/guides/platform/performance)
- [Supabase: Query plans with explain()](https://supabase.com/docs/guides/api/query-plans)
- [PostgreSQL: Monitoring Database Activity](https://www.postgresql.org/docs/current/monitoring.html)
