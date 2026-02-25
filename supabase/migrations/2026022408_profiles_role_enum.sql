do $$
begin
  create type public.user_role as enum ('VENDEDOR', 'SUPERVISOR', 'ASSISTENTE');
exception
  when duplicate_object then null;
end $$;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  alter column role type public.user_role
  using role::public.user_role;

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
    desired_role::public.user_role,
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
