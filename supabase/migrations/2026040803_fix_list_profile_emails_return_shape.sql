create or replace function public.list_profile_emails(p_user_ids uuid[] default null)
returns table(user_id uuid, email text)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_supervisor() then
    raise exception 'Acesso negado.'
      using errcode = '42501';
  end if;

  return query
    select
      u.id::uuid as user_id,
      u.email::text as email
    from auth.users u
    where p_user_ids is null
      or cardinality(p_user_ids) = 0
      or u.id = any(p_user_ids);
end;
$$;

revoke all on function public.list_profile_emails(uuid[]) from public;
grant execute on function public.list_profile_emails(uuid[]) to authenticated;
