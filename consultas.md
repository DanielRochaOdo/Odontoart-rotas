# Consultas SQL - Rotas / Agenda

Este arquivo concentra consultas SQL uteis para analise no banco (PostgreSQL/Supabase).

## 1) Total de visitas por dia no mes

```sql
SELECT
  to_char(v.visit_date::date, 'DD/MM') AS dia,
  COUNT(*) AS total_visitas
FROM visits v
WHERE v.visit_date >= DATE '2026-05-01'
  AND v.visit_date < DATE '2026-06-01'
GROUP BY v.visit_date::date
ORDER BY v.visit_date::date;
```

## 2) Total de visitas por dia no mes (incluindo dias zerados)

```sql
WITH dias AS (
  SELECT generate_series(DATE '2026-05-01', DATE '2026-05-31', INTERVAL '1 day')::date AS dia
)
SELECT
  to_char(d.dia, 'DD/MM') AS dia,
  COALESCE(COUNT(v.id), 0) AS total_visitas
FROM dias d
LEFT JOIN visits v
  ON v.visit_date::date = d.dia
GROUP BY d.dia
ORDER BY d.dia;
```

## 3) Visitas por vendedor em um periodo

```sql
SELECT
  COALESCE(v.assigned_to_name, 'SEM NOME') AS vendedor,
  COUNT(*) AS total_visitas
FROM visits v
WHERE v.visit_date >= DATE '2026-05-01'
  AND v.visit_date < DATE '2026-06-01'
GROUP BY COALESCE(v.assigned_to_name, 'SEM NOME')
ORDER BY total_visitas DESC, vendedor;
```

## 4) Visitas de um vendedor especifico no mes

```sql
SELECT
  v.id,
  v.visit_date::date AS data_visita,
  v.assigned_to_name AS vendedor,
  v.completed_at,
  v.no_visit_reason,
  c.codigo AS codigo_empresa,
  c.empresa
FROM visits v
LEFT JOIN clientes c ON c.id = v.cliente_id
WHERE v.visit_date >= DATE '2026-05-01'
  AND v.visit_date < DATE '2026-06-01'
  AND (
    v.assigned_to_name ILIKE '%DIEGO BRASIL%'
    OR v.assigned_to_user_id = '2e033cca-c456-4e92-aad1-5efb18d52c08'
  )
ORDER BY v.visit_date::date, c.empresa;
```

## 5) Total de empresas com visita no periodo

```sql
SELECT
  COUNT(DISTINCT v.cliente_id) AS total_empresas_visitadas
FROM visits v
WHERE v.visit_date >= DATE '2026-05-01'
  AND v.visit_date < DATE '2026-06-01';
```

## 6) Empresas sem visita no periodo

```sql
SELECT
  c.id,
  c.codigo,
  c.empresa
FROM clientes c
WHERE NOT EXISTS (
  SELECT 1
  FROM visits v
  WHERE v.cliente_id = c.id
    AND v.visit_date >= DATE '2026-05-01'
    AND v.visit_date < DATE '2026-06-01'
)
ORDER BY c.empresa;
```

## 7) Visitas pendentes vs concluidas no periodo

```sql
SELECT
  COUNT(*) FILTER (WHERE v.completed_at IS NULL) AS pendentes,
  COUNT(*) FILTER (WHERE v.completed_at IS NOT NULL) AS concluidas,
  COUNT(*) AS total
FROM visits v
WHERE v.visit_date >= DATE '2026-05-01'
  AND v.visit_date < DATE '2026-06-01';
```

## 8) Visitas por codigo da empresa (ex.: 3645)

```sql
SELECT
  c.codigo,
  c.empresa,
  v.id AS visit_id,
  v.visit_date::date AS data_visita,
  v.assigned_to_name,
  v.completed_at,
  v.route_id
FROM clientes c
LEFT JOIN visits v ON v.cliente_id = c.id
WHERE c.codigo = '3645'
ORDER BY v.visit_date DESC NULLS LAST;
```

## 9) Top empresas por quantidade de visitas

```sql
SELECT
  c.codigo,
  c.empresa,
  COUNT(*) AS total_visitas
FROM visits v
JOIN clientes c ON c.id = v.cliente_id
WHERE v.visit_date >= DATE '2026-05-01'
  AND v.visit_date < DATE '2026-06-01'
GROUP BY c.codigo, c.empresa
ORDER BY total_visitas DESC, c.empresa
LIMIT 50;
```

## 10) Conferencia de consistencia: resumo por dia (visits)

```sql
SELECT
  v.visit_date::date AS dia,
  COUNT(*) AS total_visitas,
  COUNT(*) FILTER (WHERE v.completed_at IS NOT NULL) AS concluidas,
  COUNT(*) FILTER (WHERE v.completed_at IS NULL) AS pendentes
FROM visits v
WHERE v.visit_date >= DATE '2026-05-01'
  AND v.visit_date < DATE '2026-06-01'
GROUP BY v.visit_date::date
ORDER BY v.visit_date::date;
```

## Dicas de uso

- Troque os intervalos usando padrao `[inicio, fim)`:
  - `visit_date >= DATE 'YYYY-MM-01'`
  - `visit_date < DATE 'YYYY-MM-01' + INTERVAL '1 month'`
- Para um dia especifico:
  - `visit_date = DATE '2026-05-21'`
- Para filtrar um vendedor:
  - por nome: `assigned_to_name ILIKE '%NOME%'`
  - por usuario: `assigned_to_user_id = 'uuid'`
