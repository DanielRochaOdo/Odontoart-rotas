-- Defensive hardening for profile helper functions used by RLS.
-- Goal: never raise runtime errors during policy evaluation.

create or replace function public.current_profile_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_force_reauth_after timestamptz;
  v_iat timestamptz := to_timestamp(0);
begin
  select p.role, p.force_reauth_after
    into v_role, v_force_reauth_after
  from public.profiles p
  where p.user_id = auth.uid()
  order by p.created_at desc nulls last
  limit 1;

  if v_role is null then
    return null;
  end if;

  begin
    if coalesce(auth.jwt() ->> 'iat', '') ~ '^[0-9]+(\.[0-9]+)?$' then
      v_iat := to_timestamp((auth.jwt() ->> 'iat')::double precision);
    end if;
  exception
    when others then
      v_iat := to_timestamp(0);
  end;

  if v_force_reauth_after is null or v_iat >= v_force_reauth_after then
    return v_role;
  end if;

  return null;
exception
  when others then
    return null;
end;
$$;

grant execute on function public.current_profile_role() to authenticated;

create or replace function public.current_display_name()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_display_name text;
  v_force_reauth_after timestamptz;
  v_iat timestamptz := to_timestamp(0);
begin
  select p.display_name, p.force_reauth_after
    into v_display_name, v_force_reauth_after
  from public.profiles p
  where p.user_id = auth.uid()
  order by p.created_at desc nulls last
  limit 1;

  if v_display_name is null then
    return null;
  end if;

  begin
    if coalesce(auth.jwt() ->> 'iat', '') ~ '^[0-9]+(\.[0-9]+)?$' then
      v_iat := to_timestamp((auth.jwt() ->> 'iat')::double precision);
    end if;
  exception
    when others then
      v_iat := to_timestamp(0);
  end;

  if v_force_reauth_after is null or v_iat >= v_force_reauth_after then
    return v_display_name;
  end if;

  return null;
exception
  when others then
    return null;
end;
$$;

grant execute on function public.current_display_name() to authenticated;

create or replace function public.is_vendedor()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.current_profile_role() = 'VENDEDOR';
exception
  when others then
    return false;
end;
$$;

grant execute on function public.is_vendedor() to authenticated;

drop policy if exists "Vendedor can read own clientes from visits" on public.clientes;
create policy "Vendedor can read own clientes from visits"
on public.clientes
for select
using (
  auth.role() = 'authenticated'
  and public.is_vendedor()
  and public.vendor_can_read_cliente(public.clientes.id)
);

