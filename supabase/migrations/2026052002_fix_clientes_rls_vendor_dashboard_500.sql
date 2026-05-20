-- Harden auth helper functions and optimize vendor read policy on clientes.
-- This mitigates dashboard 500s that can happen for specific heavy users.

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  with profile_row as (
    select p.role, p.force_reauth_after
    from public.profiles p
    where p.user_id = auth.uid()
    order by p.created_at desc nulls last
    limit 1
  ),
  jwt_iat as (
    select case
      when coalesce(auth.jwt() ->> 'iat', '') ~ '^[0-9]+(\.[0-9]+)?$'
        then to_timestamp((auth.jwt() ->> 'iat')::double precision)
      else to_timestamp(0)
    end as issued_at
  )
  select case
    when pr.force_reauth_after is null then pr.role
    when ji.issued_at >= pr.force_reauth_after then pr.role
    else null
  end
  from profile_row pr
  cross join jwt_iat ji;
$$;

grant execute on function public.current_profile_role() to authenticated;

create or replace function public.current_display_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  with profile_row as (
    select p.display_name, p.force_reauth_after
    from public.profiles p
    where p.user_id = auth.uid()
    order by p.created_at desc nulls last
    limit 1
  ),
  jwt_iat as (
    select case
      when coalesce(auth.jwt() ->> 'iat', '') ~ '^[0-9]+(\.[0-9]+)?$'
        then to_timestamp((auth.jwt() ->> 'iat')::double precision)
      else to_timestamp(0)
    end as issued_at
  )
  select case
    when pr.force_reauth_after is null then pr.display_name
    when ji.issued_at >= pr.force_reauth_after then pr.display_name
    else null
  end
  from profile_row pr
  cross join jwt_iat ji;
$$;

grant execute on function public.current_display_name() to authenticated;

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

