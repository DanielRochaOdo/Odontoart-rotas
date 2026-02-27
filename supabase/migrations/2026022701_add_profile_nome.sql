alter table public.profiles
  add column if not exists nome text;

update public.profiles
set nome = coalesce(nome, display_name);

create or replace function public.normalize_profiles_text()
returns trigger
language plpgsql
as $$
begin
  new.display_name = public.normalize_upper(coalesce(new.display_name, new.nome));
  new.nome = new.display_name;
  return new;
end;
$$;

drop trigger if exists normalize_profiles_text on public.profiles;
create trigger normalize_profiles_text
before insert or update on public.profiles
for each row execute function public.normalize_profiles_text();

create or replace function public.current_display_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.normalize_upper(coalesce(nome, display_name))
  from public.profiles
  where user_id = auth.uid();
$$;

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

  insert into public.profiles (user_id, role, display_name, nome, supervisor_id, vendedor_id)
  values (
    new.id,
    desired_role::public.user_role,
    resolved_name,
    resolved_name,
    supervisor_uuid,
    vendedor_uuid
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;


