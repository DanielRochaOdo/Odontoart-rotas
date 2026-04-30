create extension if not exists pgcrypto;

create or replace function public.erp_sync_password_matches(p_password text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select password_hash
    into v_hash
  from public.erp_sync_release_secret
  where id = true
    and is_active = true
  limit 1;

  if v_hash is null then
    return false;
  end if;

  return v_hash = extensions.crypt(coalesce(p_password, ''), v_hash);
end;
$$;

revoke all on function public.erp_sync_password_matches(text) from public, anon, authenticated;
grant execute on function public.erp_sync_password_matches(text) to service_role;
