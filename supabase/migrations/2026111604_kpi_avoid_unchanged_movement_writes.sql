-- Keep the monthly ledger stable when a recheck returns the same values.
-- The completed run items now identify which companies were checked in a run.
create or replace function public.kpi_persist_monthly_movements(
  p_sync_run_id uuid,
  p_codigo text,
  p_empresa text,
  p_associado_total integer,
  p_categoria text,
  p_movimentos jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_associado_total is not null and p_associado_total < 0 then
    raise exception 'AssociadoTotal nao pode ser negativo';
  end if;
  if jsonb_typeof(p_movimentos) is distinct from 'array' then
    raise exception 'Movimentos KPI deve ser um array';
  end if;

  insert into public.kpi_movimentos_mensais as existing (
    codigo, empresa, competencia, entradas, saidas, categoria, sync_run_id, consultado_em, updated_at
  )
  select
    p_codigo,
    p_empresa,
    (item->>'competencia')::date,
    (item->>'entradas')::integer,
    (item->>'saidas')::integer,
    item->>'categoria',
    p_sync_run_id,
    now(),
    now()
  from jsonb_array_elements(p_movimentos) as movement(item)
  on conflict (codigo, competencia) do update set
    empresa = excluded.empresa,
    entradas = excluded.entradas,
    saidas = excluded.saidas,
    categoria = excluded.categoria,
    sync_run_id = excluded.sync_run_id,
    consultado_em = excluded.consultado_em,
    updated_at = now()
  where (
    existing.empresa,
    existing.entradas,
    existing.saidas,
    existing.categoria
  ) is distinct from (
    excluded.empresa,
    excluded.entradas,
    excluded.saidas,
    excluded.categoria
  );

  get diagnostics v_rows = row_count;

  update public.clientes
  set vidas_qtde = coalesce(p_associado_total::numeric, vidas_qtde),
      categoria = p_categoria
  where codigo = p_codigo
    and (p_associado_total is not null and vidas_qtde is distinct from p_associado_total::numeric
      or categoria is distinct from p_categoria);

  return v_rows;
end;
$$;

-- Read the run's completed companies and join them to the stable monthly ledger.
-- This preserves the current-run report without rewriting unchanged ledger rows.
create or replace function public.kpi_movement_rows_for_run_v1(p_sync_run_id uuid)
returns table (
  id uuid,
  sync_run_id uuid,
  codigo text,
  empresa text,
  competencia date,
  entradas integer,
  saidas integer,
  saldo integer,
  categoria text,
  consultado_em timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_supervisor() or public.is_assistente()) then
    raise exception 'Sem permissao para consultar historico KPI.';
  end if;

  return query
  select
    movements.id,
    p_sync_run_id,
    movements.codigo,
    movements.empresa,
    movements.competencia,
    movements.entradas,
    movements.saidas,
    movements.saldo,
    movements.categoria,
    movements.consultado_em,
    movements.created_at
  from public.kpi_sync_run_items items
  join public.kpi_movimentos_mensais movements
    on movements.codigo = items.codigo
  where items.run_id = p_sync_run_id
    and items.status = 'completed'
  order by movements.competencia, movements.codigo;
end;
$$;

revoke all on function public.kpi_persist_monthly_movements(uuid, text, text, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.kpi_persist_monthly_movements(uuid, text, text, integer, text, jsonb)
  to service_role;

revoke all on function public.kpi_movement_rows_for_run_v1(uuid) from public, anon;
grant execute on function public.kpi_movement_rows_for_run_v1(uuid) to authenticated;
