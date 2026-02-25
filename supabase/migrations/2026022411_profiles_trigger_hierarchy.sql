create or replace function public.handle_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_role text;
  supervisor_uuid uuid;
  vendedor_uuid uuid;
begin
  desired_role := coalesce(new.raw_user_meta_data->>'role', 'VENDEDOR');
  if desired_role not in ('VENDEDOR','SUPERVISOR','ASSISTENTE') then
    desired_role := 'VENDEDOR';
  end if;

  supervisor_uuid := nullif(new.raw_user_meta_data->>'supervisor_id', '')::uuid;
  vendedor_uuid := nullif(new.raw_user_meta_data->>'vendedor_id', '')::uuid;

  insert into public.profiles (user_id, role, display_name, supervisor_id, vendedor_id)
  values (
    new.id,
    desired_role::public.user_role,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'name',
      nullif(split_part(new.email, '@', 1), ''),
      'Colaborador'
    ),
    supervisor_uuid,
    vendedor_uuid
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;
