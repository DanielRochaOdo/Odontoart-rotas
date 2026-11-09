create or replace function public.list_profile_emails(p_user_ids uuid[] default null)
returns table(user_id uuid, email text)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(public.current_profile_role() in ('SUPERVISOR', 'ASSISTENTE'), false) is not true then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  return query
    select u.id::uuid, u.email::text
    from auth.users u
    where p_user_ids is null
      or cardinality(p_user_ids) = 0
      or u.id = any(p_user_ids);
end;
$$;

revoke all on function public.list_profile_emails(uuid[]) from public;
grant execute on function public.list_profile_emails(uuid[]) to authenticated;

create or replace function public.settings_update_profile(p_profile_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if coalesce(public.current_profile_role() in ('SUPERVISOR', 'ASSISTENTE'), false) is not true then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Atualizacao invalida.' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in (
      'display_name', 'nome', 'supervisor_id', 'vendedor_id', 'is_inactive',
      'can_access_pre_cadastro', 'can_access_next_route_dashboard'
    ) then
      raise exception 'Campo nao permitido: %', v_key using errcode = '22023';
    end if;
  end loop;

  update public.profiles
  set display_name = case when p_patch ? 'display_name' then p_patch->>'display_name' else display_name end,
      nome = case when p_patch ? 'nome' then p_patch->>'nome' else nome end,
      supervisor_id = case when p_patch ? 'supervisor_id' then nullif(p_patch->>'supervisor_id', '')::uuid else supervisor_id end,
      vendedor_id = case when p_patch ? 'vendedor_id' then nullif(p_patch->>'vendedor_id', '')::uuid else vendedor_id end,
      is_inactive = case when p_patch ? 'is_inactive' then (p_patch->>'is_inactive')::boolean else is_inactive end,
      can_access_pre_cadastro = case when p_patch ? 'can_access_pre_cadastro' then (p_patch->>'can_access_pre_cadastro')::boolean else can_access_pre_cadastro end,
      can_access_next_route_dashboard = case when p_patch ? 'can_access_next_route_dashboard' then (p_patch->>'can_access_next_route_dashboard')::boolean else can_access_next_route_dashboard end
  where id = p_profile_id;

  if not found then
    raise exception 'Perfil nao encontrado.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.settings_update_profile(uuid, jsonb) from public;
grant execute on function public.settings_update_profile(uuid, jsonb) to authenticated;
