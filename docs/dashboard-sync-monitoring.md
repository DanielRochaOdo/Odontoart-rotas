# Monitoramento do Sync Dashboard

## Objetivo

Monitorar a saude da sincronizacao `Primario -> Dashboard` sem alterar dados.

Script:

- `scripts/monitor_dashboard_sync.ts`

Comando:

- `npm run monitor:dashboard-sync`

## Variaveis de ambiente

Obrigatorias:

- `DASHBOARD_URL`
- `DASHBOARD_SERVICE_ROLE_KEY`

Opcionais:

- `DASH_MONITOR_MAX_SUCCESS_AGE_MINUTES` (padrao: `15`)
- `DASH_MONITOR_MAX_RUNNING_STATE_MINUTES` (padrao: `20`)

## O que o monitor valida

1. Ultimas execucoes (`dashboard_sync_runs`)
- Le as ultimas 5.
- Alerta se as ultimas 3 nao estiverem `ok`.
- Alerta se qualquer uma das ultimas 3 tiver `error_message`.

2. Ultimo sucesso
- Busca `last_success_at` por `status = 'ok'`.
- FALHA se o ultimo sucesso tiver mais de 15 minutos (ou valor configurado).

3. Estado por tabela (`dashboard_sync_state`)
- Alerta se `last_error` estiver preenchido.
- Alerta se `status != idle` por tempo excessivo.

4. Lock (`dashboard_sync_lock`)
- OK: `owner_id` nulo.
- ATENCAO: `owner_id` preenchido com `locked_until` no futuro.
- FALHA: `owner_id` preenchido com `locked_until` expirado.

5. Metricas de delete
- Exibe `rows_deleted_reconciled` das ultimas execucoes (nao falha automaticamente).

## Exit code

- `0` => `OK`
- `1` => `ATENCAO`
- `2` => `FALHA`

## Execucao manual

```bash
npm run monitor:dashboard-sync
```

## Exemplo de saida

```txt
=== Monitor Dashboard Sync ===
Status geral: OK
Ultimo sucesso: 2026-05-29T15:10:00.000Z

Ultimas execucoes (top 5):
- #21 status=ok read=120 written=120 deleted_reconciled=0 started=... finished=... error=-

Estado por tabela:
- clientes: status=idle last_error=- rows_read=...

Lock:
- dashboard_sync: owner_id=null heartbeat_at=null locked_until=null

Recomendacao: Operacao normal. Manter monitoramento.
```

## Como interpretar alertas

- `ATENCAO`: existe risco/instabilidade, mas o fluxo pode estar operando parcialmente.
- `FALHA`: risco alto de indisponibilidade de sync (por exemplo, sem sucesso recente ou lock preso).

## Agendamento no Windows Task Scheduler

Frequencia recomendada:

- a cada 5 minutos (quando sync roda a cada 5 minutos), ou
- a cada 10 minutos (ambientes com menor criticidade).

Passos:

1. Criar tarefa basica.
2. Trigger: recorrente a cada 5 ou 10 minutos.
3. Acao:
   - Programa/script: `powershell.exe`
   - Argumentos:
     ```txt
     -NoProfile -ExecutionPolicy Bypass -Command "cd 'C:\caminho\do\repo'; npm run monitor:dashboard-sync"
     ```
4. Configurar conta com acesso ao `.env` e ao Node/npm.
5. Registrar logs da saida para auditoria operacional.

## Observacoes

- O monitor e somente leitura.
- Nao imprime secrets.
- Nao altera arquitetura do sync.
