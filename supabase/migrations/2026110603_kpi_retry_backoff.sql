create or replace function public.kpi_finalize_run_item(
  p_item_id uuid,
  p_worker_id text,
  p_status text,
  p_changed boolean default false,
  p_kpi_status text default null,
  p_kpi_error text default null,
  p_error_code text default null,
  p_last_error text default null,
  p_previous_value jsonb default null,
  p_received_value jsonb default null,
  p_duration_ms integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kpi_sync_run_items
  set status = p_status,
      finished_at = now(),
      next_retry_at = case
        when p_status = 'retrying' then now() + make_interval(secs => least(300, 15 * greatest(attempts, 1)))
        else null
      end,
      changed = coalesce(p_changed, false),
      kpi_status = p_kpi_status,
      kpi_error = p_kpi_error,
      error_code = p_error_code,
      last_error = p_last_error,
      previous_value = p_previous_value,
      received_value = p_received_value,
      duration_ms = p_duration_ms,
      updated_at = now()
  where id = p_item_id
    and worker_id = p_worker_id
    and status = 'processing';
end;
$$;

revoke all on function public.kpi_finalize_run_item(uuid, text, text, boolean, text, text, text, text, jsonb, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.kpi_finalize_run_item(uuid, text, text, boolean, text, text, text, text, jsonb, jsonb, integer)
  to service_role;
