create or replace function public.reset_all_users_access()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_refresh_tokens_deleted integer := 0;
  v_sessions_deleted integer := 0;
  v_profiles_updated integer := 0;
begin
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens';
    get diagnostics v_refresh_tokens_deleted = row_count;
  end if;

  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions';
    get diagnostics v_sessions_deleted = row_count;
  end if;

  update public.profiles
  set force_reauth_after = now();
  get diagnostics v_profiles_updated = row_count;

  return jsonb_build_object(
    'refresh_tokens_deleted', v_refresh_tokens_deleted,
    'sessions_deleted', v_sessions_deleted,
    'profiles_updated', v_profiles_updated
  );
end;
$$;

revoke all on function public.reset_all_users_access() from public;
grant execute on function public.reset_all_users_access() to service_role;
