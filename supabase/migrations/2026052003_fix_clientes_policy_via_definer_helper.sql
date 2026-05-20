-- Avoid expensive nested RLS evaluation from clientes -> visits for vendor users.
-- This helps eliminate dashboard 500 for heavy vendor accounts.

create or replace function public.vendor_can_read_cliente(p_cliente_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_display_name text := public.current_display_name();
begin
  if v_uid is null or p_cliente_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.visits v
    where v.cliente_id = p_cliente_id
      and (
        v.assigned_to_user_id = v_uid
        or (
          v.assigned_to_name is not null
          and v_display_name is not null
          and v.assigned_to_name = public.normalize_upper(v_display_name)
        )
      )
    limit 1
  );
end;
$$;

grant execute on function public.vendor_can_read_cliente(uuid) to authenticated;

drop policy if exists "Vendedor can read own clientes from visits" on public.clientes;
create policy "Vendedor can read own clientes from visits"
on public.clientes
for select
using (
  auth.role() = 'authenticated'
  and public.is_vendedor()
  and public.vendor_can_read_cliente(public.clientes.id)
);

