# Diagnostico das estatisticas de I/O fornecidas

Data da analise: 09/10/2026. Fonte: JSON anexado pelo usuario, com 15 entradas
por blocos compartilhados lidos e 15 por blocos compartilhados escritos.
O periodo de coleta, o reset dos contadores e o projeto exato nao foram informados.
Nao houve acesso ao banco remoto nem alteracao da aplicacao ou de migrations.

## Conclusao

O recorte identifica frequencia elevada acumulada em avisos da Fila, operacoes
de KPI e consultas lentas. Ele nao comprova, isoladamente, esgotamento de Disk IO
Budget, crescimento excessivo de armazenamento ou que a IA seja sua causa.
As consultas sao normalizadas, sem valores concretos dos filtros, e nao trazem
usuario do banco, cache hits, WAL, temporarios ou tempo de espera de I/O.

Assumindo blocos de 8 KiB, os 15 registros de leitura somam 1.703 blocos =
13,305 MiB. Os 15 de escrita somam 6.212 blocos = 48,531 MiB. Isso representa
atividade contabilizada nesse recorte, nao tamanho do banco nem bytes fisicos
medidos no dispositivo. Existem consultas repetidas entre os dois rankings;
nao somar novamente chamadas e tempo dessas entradas.

## Achados cruzados com o codigo

| Operacao | Chamadas acumuladas | Media por chamada | Interpretacao |
|---|---:|---:|---|
| `queue_release_pending_notifications` | 101.508 | 95,38 ms | 2h41min21s de execucao somada, mas apenas 89 blocos lidos no recorte; prioridade de frequencia |
| SELECT de visitas concluidas com bairro | 175 | 2.717,99 ms | Consulta lenta; plano/RLS/esperas precisam ser medidos |
| SELECT de visitas por periodo | 36 | 2.510,97 ms | Outra consulta lenta; ranking nao identifica os parametros reais |
| SELECT de empresas ordenadas por nome | 84 | 3.259,54 ms | Verificar volume, paginacao, ordenacao e permissoes |
| Introspeccao de tabelas | 6.620 | 135,48 ms | SQL de catalogos compativel com descoberta/recarregamento de schema |
| Introspeccao de funcoes | 6.462 | 107,49 ms | Investigar logs do PostgREST; nao atribuir automaticamente a IA |
| Upsert unitario de snapshots KPI | 21.864 | 18,87 ms | Fonte recorrente de gravacoes |
| Atualizacao de etapas em `kpi_sync_runs` | 50.072 | 0,57 ms | Muitas chamadas historicas; frequencia atual ainda desconhecida |
| Normalizacao em massa de `visits` | 1 | 6.353,50 ms | Maior escrita do ranking: 1.245 blocos, operacao pontual |

### Fila

[FilaAlertsModal.tsx](../src/components/FilaAlertsModal.tsx) consulta ao montar,
a cada 180 segundos e a cada foco da janela. O bloqueio de chamada simultanea
existe por instancia; nao ha no codigo examinado pausa por aba oculta,
intervalo minimo entre eventos de foco ou coordenacao entre abas.
Ha tambem tentativa de gerar eventos de contagem regressiva a cada dez minutos
por instancia. A contagem de 101.508 chamadas nao informa chamadas por dia.

A RPC esta em
[2026042401_modulo_fila.sql](../supabase/migrations/2026042401_modulo_fila.sql),
consulta eventos sem recibo do usuario e ordena pelos mais antigos. A migration
ja possui indice de data e chave `(event_id, user_id)` nos recibos. Nao ha
evidencia para criar esses mesmos indices novamente.

Melhoria proposta: consultar somente quando visivel/conectado, limitar chamadas
em eventos de foco, aplicar recuo em falhas e coordenar abas quando necessario.
Preservar atualizacao apos confirmacao e uma latencia de notificacao definida.
Medir chamadas/minuto antes e depois; o ganho em I/O fisico ainda e desconhecido.

### KPI

[kpi-sync-daily/index.ts](../supabase/functions/kpi-sync-daily/index.ts) executa
`touchItem`, consulta o ERP, atualiza `clientes`, faz upsert do snapshot e finaliza
o item. A verificacao `changed` compara vidas com o snapshot anterior; os dois
ramos atualmente atualizam `clientes` e gravam snapshot.

Para evitar regravacoes sem efeito, comparar no banco os valores finais de
`vidas_qtde` E `categoria`, com semantica `IS DISTINCT FROM`. Nao basta remover
o ramo `changed === false`: categoria pode precisar mudar e o snapshot registra
que a empresa foi processada. Preservar historico, progresso e retomada.

`updateRunProgressFromItems` faz sete contagens separadas e uma atualizacao.
Uma agregacao por status pode reduzir chamadas. Agrupar finalizacao/snapshot
tambem merece avaliacao, mantendo atomicidade e idempotencia.
Os 50.072 updates historicos de etapas nao foram atribuidos a um ponto exato da
versao atual; conferir a Edge Function realmente implantada antes de corrigi-los.

### Consultas do Dashboard

O codigo atual de [DashboardEstrategico.tsx](../src/pages/DashboardEstrategico.tsx)
carrega periodo atual, periodos comparativos, historico de visitas e universo
de empresas, inclusive com varias paginas. Existe oportunidade de usar
agregacoes no banco e carregar detalhes sob demanda, mantendo os indicadores.

Entretanto, o JSON cita `public.visits`/`public.clientes`, enquanto a rota atual
usa `v_dash_visits_active`/`v_dash_clientes_active`. O SELECT com join de bairro
tambem nao corresponde literalmente ao caminho atual inspecionado. Portanto,
o recorte pode incluir outra versao, outro consumidor ou configuracao de projeto.
Confirmar queryid e SQL de uma coleta recente antes de mapear a uma tela atual.

### Escritas pontuais e manutencao

A maior escrita corresponde ao UPDATE da migration
[2026061201_normalize_perfil_visita.sql](../supabase/migrations/2026061201_normalize_perfil_visita.sql).
Outros dois registros com uma chamada correspondem aos backfills de categorias
de clientes/snapshots de julho. Eles nao sao prova de um processo repetindo hoje.

`prune_audit_logs` aparece 134 vezes. No repositorio, o agendamento e diario,
com retencao de 14 dias e limite de 75 mil registros. Nao inferir o periodo
exato da coleta dessa contagem: pode haver execucoes manuais ou outro agendamento.

## Coleta necessaria para fechar a causa

O [SQL de diagnostico](sql/diagnostico_disk_io.sql) consulta apenas estatisticas
e metadados, sem executar as consultas de negocio, sem resetar contadores e
sem modificar dados. Requer PostgreSQL 14+ e pg_stat_statements atualizado.
Foi revisado estaticamente; nao executado no ambiente remoto.

1. Identificar projeto e indicador: Disk IO Budget/IOPS/throughput ou espaco ocupado.
2. Registrar horario e coletar T0; repetir em 15-30 minutos durante o uso representativo.
3. Comparar deltas pela identidade completa `(dbid, userid, queryid, toplevel)`.
   Resets, eviccoes ou registros ausentes impedem determinadas comparacoes;
   rankings nao incluem todas as consultas do banco.
4. Cruzar com graficos do mesmo intervalo: IOPS, throughput, memoria, swap,
   CPU e disponibilidade. O SQL nao mede swap nem todo o I/O do host.
5. Para SELECTs lentos ainda ativos, obter plano com os mesmos filtros e
   contexto autenticado/RLS. Um plano como administrador pode ocultar o custo
   do perfil real. `EXPLAIN ANALYZE` executa a consulta; iniciar por EXPLAIN
   sem ANALYZE e usar uma execucao medida com limites quando necessario.

Ordem recomendada: reduzir consultas redundantes da Fila; medir e reduzir
gravacoes sem mudanca no KPI; confirmar os planos e a versao das consultas
lentas; investigar a recorrencia de descoberta de schema; so entao decidir
sobre novos indices, alteracoes de infraestrutura ou cache adicional.
Dos padroes do Reflect analisados anteriormente, deduplicacao de trabalho e
invalidação seletiva de cache sao os mais pertinentes a este problema.

## Fontes tecnicas

- Campos, unidades e identidade dos contadores: [PostgreSQL pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html).
- IOPS, throughput e pressao de memoria/swap: [Supabase High Disk I/O](https://supabase.com/docs/guides/troubleshooting/exhaust-disk-io).
- Diferenca entre tamanho do banco e espaco total: [Supabase Database and Disk Size](https://supabase.com/docs/guides/platform/database-size).
- Descoberta e recarga de metadados: [PostgREST Schema Cache](https://docs.postgrest.org/en/latest/references/schema_cache.html).
