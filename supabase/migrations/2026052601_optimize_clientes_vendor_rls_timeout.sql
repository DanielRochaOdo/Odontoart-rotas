-- Optimize clientes vendor-read policy to prevent statement_timeout on large datasets.
-- Replace per-row function call with indexed EXISTS and add supporting indexes.

create index if not exists visits_cliente_assigned_user_idx
on public.visits (cliente_id, assigned_to_user_id);

create index if not exists visits_cliente_assigned_name_idx
on public.visits (cliente_id, assigned_to_name);

drop policy if exists "Vendedor can read own clientes from visits" on public.clientes;
create policy "Vendedor can read own clientes from visits"
on public.clientes
for select
using (
  auth.role() = 'authenticated'
  and public.is_vendedor()
  and exists (
    select 1
    from public.visits v
    where v.cliente_id = public.clientes.id
      and (
        v.assigned_to_user_id = auth.uid()
        or (
          v.assigned_to_name is not null
          and public.current_display_name() is not null
          and v.assigned_to_name = public.normalize_upper(public.current_display_name())
        )
      )
  )
);
