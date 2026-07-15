create extension if not exists pgcrypto;

create table if not exists public.system_news (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(btrim(titulo)) > 0),
  descricao text not null check (char_length(btrim(descricao)) > 0),
  tipo text not null check (tipo in ('MELHORIA', 'ATUALIZACAO', 'CORRECAO', 'MANUTENCAO', 'AVISO')),
  modulo text not null check (char_length(btrim(modulo)) > 0),
  roles_permitidos text[] not null check (cardinality(roles_permitidos) > 0),
  data_publicacao timestamptz not null default now(),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null
);

create index if not exists system_news_data_publicacao_idx on public.system_news (data_publicacao desc, created_at desc);
create index if not exists system_news_modulo_idx on public.system_news (modulo);
create index if not exists system_news_ativo_idx on public.system_news (ativo);
create index if not exists system_news_roles_permitidos_gin_idx on public.system_news using gin (roles_permitidos);

create or replace function public.system_news_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists system_news_touch_updated_at on public.system_news;
create trigger system_news_touch_updated_at
before update on public.system_news
for each row execute function public.system_news_touch_updated_at();

create table if not exists public.system_news_admin_secrets (
  id boolean primary key default true check (id = true),
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.system_news_admin_secret_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists system_news_admin_secret_touch_updated_at on public.system_news_admin_secrets;
create trigger system_news_admin_secret_touch_updated_at
before update on public.system_news_admin_secrets
for each row execute function public.system_news_admin_secret_touch_updated_at();

create table if not exists public.system_news_admin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists system_news_admin_sessions_user_idx
  on public.system_news_admin_sessions (user_id, expires_at desc);

create index if not exists system_news_admin_sessions_active_idx
  on public.system_news_admin_sessions (expires_at desc)
  where revoked_at is null;

create or replace function public.system_news_admin_password_matches(p_password text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select password_hash
    into v_hash
  from public.system_news_admin_secrets
  where id = true
    and is_active = true
  limit 1;

  if v_hash is null then
    select password_hash
      into v_hash
    from public.erp_sync_release_secret
    where id = true
      and is_active = true
    limit 1;
  end if;

  if v_hash is null then
    return false;
  end if;

  return v_hash = crypt(btrim(coalesce(p_password, '')), v_hash);
end;
$$;

create or replace function public.system_news_is_admin_authorized()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return auth.uid() is not null
    and auth.jwt() ->> 'email' = 'daniel.rocha@odontoart.com'
    and exists (
      select 1
      from public.system_news_admin_sessions s
      where s.user_id = auth.uid()
        and s.revoked_at is null
        and s.expires_at > now()
    );
exception
  when others then
    return false;
end;
$$;

create or replace function public.system_news_request_admin_access(p_password text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if not public.system_news_admin_password_matches(p_password) then
    raise exception 'Senha invalida.' using errcode = '28P01';
  end if;

  delete from public.system_news_admin_sessions
  where user_id = v_user_id
    and revoked_at is null
    and expires_at <= now();

  update public.system_news_admin_sessions
    set revoked_at = now()
  where user_id = v_user_id
    and revoked_at is null
    and expires_at > now();

  insert into public.system_news_admin_sessions (user_id, expires_at)
  values (v_user_id, now() + interval '2 hours');

  return true;
end;
$$;

revoke all on table public.system_news from public, anon, authenticated;
revoke all on table public.system_news_admin_secrets from public, anon, authenticated;
revoke all on table public.system_news_admin_sessions from public, anon, authenticated;

grant select on public.system_news to authenticated;
grant select, insert, update, delete on public.system_news to authenticated;
grant select on public.system_news_admin_sessions to authenticated;
grant execute on function public.system_news_admin_password_matches(text) to service_role;
grant execute on function public.system_news_is_admin_authorized() to authenticated;
grant execute on function public.system_news_request_admin_access(text) to authenticated;

alter table public.system_news enable row level security;
alter table public.system_news_admin_secrets enable row level security;
alter table public.system_news_admin_sessions enable row level security;

drop policy if exists "system_news_read_visible" on public.system_news;
create policy "system_news_read_visible"
on public.system_news
for select
using (
  auth.role() = 'authenticated'
  and (
    public.system_news_is_admin_authorized()
    or (
      ativo = true
      and exists (
        select 1
        from public.profiles p
        where p.user_id = auth.uid()
          and p.role::text = any (roles_permitidos)
      )
    )
  )
);

drop policy if exists "system_news_insert_admin" on public.system_news;
create policy "system_news_insert_admin"
on public.system_news
for insert
with check (public.system_news_is_admin_authorized());

drop policy if exists "system_news_update_admin" on public.system_news;
create policy "system_news_update_admin"
on public.system_news
for update
using (public.system_news_is_admin_authorized())
with check (public.system_news_is_admin_authorized());

drop policy if exists "system_news_delete_admin" on public.system_news;
create policy "system_news_delete_admin"
on public.system_news
for delete
using (public.system_news_is_admin_authorized());

comment on table public.system_news is 'Publicacoes do modulo Novidades.';

insert into public.system_news_admin_secrets (id, password_hash, is_active)
values (true, crypt('Odo@1905', gen_salt('bf')), true)
on conflict (id) do update
set password_hash = excluded.password_hash,
    is_active = true;
