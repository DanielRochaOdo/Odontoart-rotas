# Redução de I/O — implementação de 09/10/2026

As mudanças estão no código local. Não houve conexão de escrita, migração ou publicação no Supabase de produção. Registros de clientes, visitas, aceites, execuções e snapshots são preservados.

## Fila

- Consultas somente com a página visível e conexão disponível.
- Intervalo mínimo de três minutos para buscar notificações; foco repetido não antecipa a consulta.
- Geração de avisos limitada a uma tentativa por dez minutos, inclusive após falhas.
- Web Locks coordena as consultas entre abas do mesmo usuário e perfil. BroadcastChannel distribui o resultado em memória; o armazenamento local recebe apenas horários de controle, além dos IDs de avisos dispensados que o aplicativo já mantinha.
- Uma aba nova sem outra aba ativa consegue buscar avisos mesmo que reste um horário no armazenamento.
- Navegadores sem Web Locks mantêm controle por aba, visibilidade e intervalo; não oferecem a mesma garantia de exclusão entre abas.
- Troca de conta/perfil descarta o componente anterior e ignora respostas atrasadas. A confirmação de avisos é refletida nas outras abas.

## KPI

`supabase/migrations/2026100901_reduce_kpi_io.sql` adiciona duas funções, executáveis somente por `service_role`:

1. `kpi_update_cliente_if_changed`: atualiza `vidas_qtde` e `categoria` somente se algum valor for diferente, incluindo diferenças com `NULL`. Uma mudança apenas na categoria continua sendo aplicada. Todos os clientes com o código correspondente são considerados.
2. `kpi_refresh_run_progress`: reúne sete contagens em uma leitura agregada e atualiza o progresso na mesma chamada. A atualização não regrava o registro quando os contadores estão iguais e o último heartbeat tem menos de 30 segundos. A conclusão usa o mesmo cálculo, com bloqueio da linha da execução; uma execução interrompida/falha não volta a sucesso.

O worker chama essas funções e continua gravando os snapshots de cada código, mesmo sem mudança de valores. Leases de itens, tentativas e histórico de erros continuam funcionando como antes. O tratamento de erro do worker também passa a converter o builder do Supabase em uma Promise antes de usar `.catch`, corrigindo uma falha de tipagem/runtime preexistente.

Antes, cada atualização de progresso fazia sete chamadas de contagem e uma de atualização. Agora faz uma chamada RPC, com uma leitura agregada interna e atualização condicional. Isso é redução de chamadas e trabalho redundante; não equivale a uma porcentagem garantida de redução de I/O físico.

## Dashboard

- A aba Geral deixa de iniciar, em paralelo, as consultas das abas estratégicas que não estão abertas.
- Cache limitado a 24 entradas, somente em memória, com validade de dois minutos e chave por usuário/perfil/recurso/período. Consultas simultâneas para a mesma chave compartilham a requisição. Erros não ficam no cache; respostas anteriores à invalidação não o repovoam.
- A troca de conta e o logout invalidam o cache. Escritas REST bem-sucedidas em `clientes`, `visits`, `profiles` e `aceite_digital` (também nas tabelas `dash_*`) invalidam o recurso correspondente e avisam as outras abas. Escritas por RPC, jobs externos e replicação são percebidas na próxima leitura após expirar o cache; não há assinatura Realtime nova.
- Reentrada, mudança de período e retomada de foco/conexão consultam o cache. Não foi criado polling periódico do Dashboard.
- O universo de clientes é lido uma vez por validade, com paginação estável, e alimenta tanto o mapa de clientes quanto o total. Foram eliminadas a segunda busca por IDs já carregados e a contagem exata adicional.
- A leitura de empresas da aba Geral também usa cache e paginação. Aceites e perfis das abas estratégicas passam a ser paginados, evitando o truncamento no limite padrão de mil linhas da API. Indicadores anteriormente truncados podem aumentar para o total correto.
- O histórico comercial só é solicitado na aba Comercial. A nova view opcional agrupa vidas positivas por mês, vendedor e nome atribuído, preservando os filtros existentes. Não cria tabela materializada nem rotina de limpeza.
- Se a view mensal ainda não existir, o frontend usa a view ativa atual, buscando somente as colunas necessárias e registros com vidas positivas. Falhas de permissão ou rede são exibidas; não são tratadas como ausência da view.
- Os detalhes do período continuam disponíveis. Esta alteração não converte todos os indicadores nem todas as consultas da aba Geral em agregações no servidor.

## Ativação em produção

1. No banco principal, aplicar **somente** `supabase/migrations/2026100901_reduce_kpi_io.sql`, após conferir que as migrações anteriores do KPI já estão instaladas. O novo arquivo contém criação/substituição de funções e permissões; não contém limpeza de dados. Não executar migrações antigas pendentes indiscriminadamente, pois o histórico do projeto contém backfills e limpezas anteriores.
2. Publicar `supabase/functions/kpi-sync-daily/index.ts` **depois** da migração. O worker novo depende das duas RPCs; não há fallback para a implementação antiga.
3. No banco usado por `VITE_DASHBOARD_URL`, aplicar `docs/sql/dashboard_monthly_lives.sql`, depois de `dashboard_active_views.sql`. Requer PostgreSQL 15+. Caso o Dashboard use o banco principal como fallback, aplicar onde as views `v_dash_*` realmente existirem.
4. Publicar o frontend compilado. A view mensal é opcional para compatibilidade durante o rollout; sem ela, a busca histórica reduzida continua funcionando.

A view usa `security_invoker` e concede acesso apenas aos papéis já autorizados na view de origem. Mantém a fronteira de acesso da view ativa existente; não modifica as políticas das tabelas. Referência: [PostgreSQL — CREATE VIEW](https://www.postgresql.org/docs/current/sql-createview.html).

Reversão: republicar o frontend/worker anterior. As funções e a view adicionais podem permanecer no banco sem uso, sem remover dados. Não é necessário restaurar snapshots ou reprocessar histórico.

## Validação

- `npm run test:io`: testes de cache, respostas atrasadas, isolamento, erros, paginação acima de mil linhas, filtros de vendedor, fallback do histórico, invalidação seletiva, visibilidade/conexão, coordenação de duas abas e intervalos após falha.
- A mesma suíte executa as funções SQL reais em PostgreSQL isolado com PGlite, sem `.env` ou conexão externa. Confere atualizações nulas/idênticas, códigos duplicados, mudança apenas de categoria, contagem de 1.010 itens, progresso sem regravação, estado terminal, permissões, preservação de registros/snapshots e agregação mensal.
- `npm run test:fila-data-contrato` e `npm run test:kpi-sync-progress`: passaram.
- `npm run build`: passou. O aviso CSS preexistente sobre `fila:auto-register` permanece.
- `npx deno check --no-lock supabase/functions/kpi-sync-daily/index.ts`: passou após corrigir o tratamento da Promise.
- Lint dos módulos novos, testes e componente de avisos: passou. As duas páginas de Dashboard continuam com os mesmos sete erros e quatro avisos de lint presentes no HEAD anterior, verificados por comparação; não foram alteradas partes sem relação com esta implementação.
- Navegador com APIs simuladas: Geral fez zero consultas estratégicas e zero consultas de histórico mensal; Performance adicionou sete chamadas (três períodos de visitas, dois de aceites, clientes e perfis); Comercial acrescentou somente uma chamada de histórico, reutilizando os demais dados. Uma visita concluída e sete vidas foram exibidas conforme a fixture. Sem erros de console na checagem de Performance.

O teste SQL usa PostgreSQL embarcado e o teste do navegador usa dados simulados. Ainda é necessário medir o projeto real após publicação: comparar deltas de chamadas, blocos, tempo, WAL e temporários em períodos equivalentes, junto do gráfico de Disk I/O do Supabase. Os dados fornecidos originalmente são cumulativos e não permitem prometer uma redução percentual de disco.
