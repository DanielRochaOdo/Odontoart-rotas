create or replace function public.handle_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_role text;
begin
  desired_role := coalesce(new.raw_user_meta_data->>'role', 'VENDEDOR');
  if desired_role not in ('VENDEDOR','SUPERVISOR','ASSISTENTE') then
    desired_role := 'VENDEDOR';
  end if;

  insert into public.profiles (user_id, role, display_name)
  values (
    new.id,
    desired_role,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'name',
      nullif(split_part(new.email, '@', 1), ''),
      'Colaborador'
    )
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_profile_sync on auth.users;
create trigger on_auth_user_profile_sync
after insert on auth.users
for each row execute procedure public.handle_auth_user_profile();
