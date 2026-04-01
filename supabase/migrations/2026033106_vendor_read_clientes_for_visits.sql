drop policy if exists "Vendedor can read own clientes from visits" on public.clientes;

create policy "Vendedor can read own clientes from visits"
on public.clientes
for select
using (
  is_vendedor()
  and exists (
    select 1
    from public.visits v
    where v.cliente_id = public.clientes.id
      and (
        v.assigned_to_user_id = auth.uid()
        or (
          v.assigned_to_name is not null
          and public.current_display_name() is not null
          and public.normalize_upper(v.assigned_to_name) = public.normalize_upper(public.current_display_name())
        )
      )
  )
);
