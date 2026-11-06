create or replace function public.kpi_seed_run_items(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  insert into public.kpi_sync_run_items (run_id, codigo, status)
  select p_run_id, codes.codigo, 'pending'
  from (
    select distinct regexp_replace(btrim(cliente.codigo::text), '\.0+$', '') as codigo
    from public.clientes as cliente
    where cliente.codigo is not null
      and btrim(cliente.codigo::text) <> ''
  ) as codes
  where codes.codigo <> ''
  on conflict (run_id, codigo) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.kpi_seed_run_items(uuid) from public, anon, authenticated;
grant execute on function public.kpi_seed_run_items(uuid) to service_role;
