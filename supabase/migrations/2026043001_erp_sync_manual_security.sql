-- Seguranca e auditoria para sincronizacao manual de empresas via ERP.
-- A senha de liberacao deve ser configurada manualmente no banco com hash (bcrypt).

create table if not exists public.erp_sync_release_secret (
  id boolean primary key default true check (id = true),
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.erp_sync_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists erp_sync_release_secret_touch_updated_at on public.erp_sync_release_secret;
create trigger erp_sync_release_secret_touch_updated_at
before update on public.erp_sync_release_secret
for each row execute function public.erp_sync_touch_updated_at();

create table if not exists public.erp_sync_unlock_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists erp_sync_unlock_sessions_user_idx
  on public.erp_sync_unlock_sessions (user_id, expires_at desc);

create index if not exists erp_sync_unlock_sessions_active_idx
  on public.erp_sync_unlock_sessions (expires_at desc)
  where revoked_at is null;

create table if not exists public.erp_sync_manual_logs (
  id bigserial primary key,
  user_id uuid null references auth.users(id) on delete set null,
  action text not null,
  status text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists erp_sync_manual_logs_created_idx
  on public.erp_sync_manual_logs (created_at desc);

create index if not exists erp_sync_manual_logs_user_created_idx
  on public.erp_sync_manual_logs (user_id, created_at desc);

alter table public.erp_sync_release_secret enable row level security;
alter table public.erp_sync_unlock_sessions enable row level security;
alter table public.erp_sync_manual_logs enable row level security;

revoke all on public.erp_sync_release_secret from anon, authenticated;
revoke all on public.erp_sync_unlock_sessions from anon, authenticated;
revoke all on public.erp_sync_manual_logs from anon, authenticated;
grant select, insert, update, delete on public.erp_sync_release_secret to service_role;
grant select, insert, update, delete on public.erp_sync_unlock_sessions to service_role;
grant select, insert on public.erp_sync_manual_logs to service_role;
grant usage, select on sequence public.erp_sync_manual_logs_id_seq to service_role;

create or replace function public.erp_sync_password_matches(p_password text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  select password_hash
    into v_hash
  from public.erp_sync_release_secret
  where id = true
    and is_active = true
  limit 1;

  if v_hash is null then
    return false;
  end if;

  return v_hash = crypt(coalesce(p_password, ''), v_hash);
end;
$$;

revoke all on function public.erp_sync_password_matches(text) from public, anon, authenticated;
grant execute on function public.erp_sync_password_matches(text) to service_role;

comment on table public.erp_sync_release_secret is
  'Senha de liberacao da sincronizacao manual ERP. Armazenar apenas hash bcrypt.';

comment on function public.erp_sync_password_matches(text) is
  'Uso interno (service_role): valida senha de liberacao pelo hash armazenado.';

-- Exemplo de configuracao (rode manualmente fora do repositorio):
-- insert into public.erp_sync_release_secret (id, password_hash, is_active)
-- values (true, crypt('<SENHA>', gen_salt('bf')), true)
-- on conflict (id) do update set password_hash = excluded.password_hash, is_active = true;
