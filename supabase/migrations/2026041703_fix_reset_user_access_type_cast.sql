create or replace function public.reset_user_access(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_refresh_tokens_deleted integer := 0;
  v_sessions_deleted integer := 0;
begin
  if p_user_id is null then
    raise exception 'user_id obrigatorio.'
      using errcode = '22023';
  end if;

  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id::text = $1::text'
      using p_user_id;
    get diagnostics v_refresh_tokens_deleted = row_count;
  end if;

  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id::text = $1::text'
      using p_user_id;
    get diagnostics v_sessions_deleted = row_count;
  end if;

  return jsonb_build_object(
    'refresh_tokens_deleted', v_refresh_tokens_deleted,
    'sessions_deleted', v_sessions_deleted
  );
end;
$$;

revoke all on function public.reset_user_access(uuid) from public;
grant execute on function public.reset_user_access(uuid) to service_role;
