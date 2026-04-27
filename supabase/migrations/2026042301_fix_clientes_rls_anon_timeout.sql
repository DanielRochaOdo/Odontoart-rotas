-- Evita timeout para requisicoes anonimas em clientes apos limpeza de cache/sessao.
-- Para role anon, as policies retornam false sem avaliar funcoes de perfil por linha.

drop policy if exists "Supervisor full access on clientes" on public.clientes;
create policy "Supervisor full access on clientes"
on public.clientes
for all
using (
  auth.role() = 'authenticated'
  and is_supervisor()
)
with check (
  auth.role() = 'authenticated'
  and is_supervisor()
);

drop policy if exists "Assistente can read clientes" on public.clientes;
create policy "Assistente can read clientes"
on public.clientes
for select
using (
  auth.role() = 'authenticated'
  and is_assistente()
);

drop policy if exists "Assistente can insert clientes" on public.clientes;
create policy "Assistente can insert clientes"
on public.clientes
for insert
with check (
  auth.role() = 'authenticated'
  and is_assistente()
);

drop policy if exists "Vendedor can read own clientes from visits" on public.clientes;
create policy "Vendedor can read own clientes from visits"
on public.clientes
for select
using (
  auth.role() = 'authenticated'
  and is_vendedor()
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

create index if not exists clientes_empresa_id_order_idx
on public.clientes (empresa asc nulls last, id asc);
