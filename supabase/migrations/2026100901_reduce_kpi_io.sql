-- Additive optimization: no records, snapshots or history are removed.
create or replace function public.kpi_update_cliente_if_changed(
  p_codigo text, p_vidas_qtde numeric, p_categoria text
) returns integer
language plpgsql security invoker set search_path = public
as $$
declare v_updated integer;
begin
  update public.clientes
  set vidas_qtde = p_vidas_qtde, categoria = p_categoria
  where codigo = p_codigo
    and (vidas_qtde is distinct from p_vidas_qtde or categoria is distinct from p_categoria);
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- Serialize counters/finalization for a run and count all statuses in one scan.
-- Workers still keep their item leases, retries, receipts and snapshots.
create or replace function public.kpi_refresh_run_progress(p_run_id uuid, p_finalize boolean default false)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_run public.kpi_sync_runs%rowtype;
  v_processed integer;
  v_remaining integer;
  v_failed integer;
  v_changed integer;
  v_finish boolean;
begin
  select * into v_run from public.kpi_sync_runs where id = p_run_id for update;
  if not found then raise exception 'KPI run not found: %', p_run_id; end if;

  select
    count(*) filter (where status in ('completed', 'failed', 'stopped')),
    count(*) filter (where status in ('pending', 'processing', 'retrying')),
    count(*) filter (where status = 'failed'),
    count(*) filter (where changed)
  into v_processed, v_remaining, v_failed, v_changed
  from public.kpi_sync_run_items where run_id = p_run_id;

  v_finish := p_finalize and v_remaining = 0 and v_run.status = 'running';
  if v_run.status = 'running' and (
    v_finish or
    v_run.processed_codes is distinct from v_processed or
    v_run.remaining_codes is distinct from v_remaining or
    v_run.failed_codes is distinct from v_failed or
    v_run.changed_codes is distinct from v_changed or
    v_run.last_progress_at is null or v_run.last_progress_at < now() - interval '30 seconds'
  ) then
    update public.kpi_sync_runs set
      processed_codes = v_processed, remaining_codes = v_remaining,
      failed_codes = v_failed, changed_codes = v_changed, last_progress_at = now(),
      status = case when v_finish then 'success' else status end,
      finished_at = case when v_finish then now() else finished_at end,
      current_code = case when v_finish then null else current_code end,
      current_stage = case when v_finish then null else current_stage end,
      current_code_started_at = case when v_finish then null else current_code_started_at end,
      current_attempt = case when v_finish then null else current_attempt end
    where id = p_run_id;
  end if;
  return jsonb_build_object(
    'processed', v_processed, 'remaining', v_remaining, 'failed', v_failed, 'changed', v_changed,
    'finished', v_finish or v_run.status <> 'running',
    'status', case when v_finish then 'success' else v_run.status end
  );
end;
$$;

revoke all on function public.kpi_update_cliente_if_changed(text, numeric, text) from public, anon, authenticated;
revoke all on function public.kpi_refresh_run_progress(uuid, boolean) from public, anon, authenticated;
grant execute on function public.kpi_update_cliente_if_changed(text, numeric, text) to service_role;
grant execute on function public.kpi_refresh_run_progress(uuid, boolean) to service_role;
