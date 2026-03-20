alter table public.profiles
  add column if not exists can_access_pre_cadastro boolean;

update public.profiles
set can_access_pre_cadastro = false
where can_access_pre_cadastro is null;

alter table public.profiles
  alter column can_access_pre_cadastro set default false,
  alter column can_access_pre_cadastro set not null;

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
  resolved_name text;
  resolved_can_access_pre_cadastro boolean;
begin
  desired_role := coalesce(new.raw_user_meta_data->>'role', 'VENDEDOR');
  if desired_role not in ('VENDEDOR','SUPERVISOR','ASSISTENTE') then
    desired_role := 'VENDEDOR';
  end if;

  supervisor_uuid := nullif(new.raw_user_meta_data->>'supervisor_id', '')::uuid;
  vendedor_uuid := nullif(new.raw_user_meta_data->>'vendedor_id', '')::uuid;

  resolved_name := coalesce(
    new.raw_user_meta_data->>'nome',
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'name',
    nullif(split_part(new.email, '@', 1), ''),
    'Colaborador'
  );

  resolved_can_access_pre_cadastro := case
    when lower(coalesce(new.raw_user_meta_data->>'can_access_pre_cadastro', '')) in ('1', 't', 'true', 'y', 'yes', 'on')
      then true
    else false
  end;

  if desired_role <> 'VENDEDOR' then
    resolved_can_access_pre_cadastro := false;
  end if;

  insert into public.profiles (
    user_id,
    role,
    display_name,
    nome,
    can_access_pre_cadastro,
    supervisor_id,
    vendedor_id
  )
  values (
    new.id,
    desired_role::public.user_role,
    resolved_name,
    resolved_name,
    resolved_can_access_pre_cadastro,
    supervisor_uuid,
    vendedor_uuid
  )
  on conflict (user_id) do update
    set role = excluded.role,
        display_name = excluded.display_name,
        nome = excluded.nome,
        can_access_pre_cadastro = excluded.can_access_pre_cadastro,
        supervisor_id = excluded.supervisor_id,
        vendedor_id = excluded.vendedor_id;

  return new;
end;
$$;
