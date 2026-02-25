-- Backfill profiles for any auth users without a profile row
insert into public.profiles (user_id, role, display_name, supervisor_id, vendedor_id)
select
  u.id,
  case
    when u.raw_user_meta_data->>'role' in ('VENDEDOR','SUPERVISOR','ASSISTENTE')
      then (u.raw_user_meta_data->>'role')::public.user_role
    else 'VENDEDOR'::public.user_role
  end as role,
  coalesce(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'name',
    nullif(split_part(u.email, '@', 1), ''),
    'Colaborador'
  ) as display_name,
  case
    when (u.raw_user_meta_data->>'supervisor_id') ~* '^[0-9a-f-]{36}$'
      then (u.raw_user_meta_data->>'supervisor_id')::uuid
    else null
  end as supervisor_id,
  case
    when (u.raw_user_meta_data->>'vendedor_id') ~* '^[0-9a-f-]{36}$'
      then (u.raw_user_meta_data->>'vendedor_id')::uuid
    else null
  end as vendedor_id
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null;
