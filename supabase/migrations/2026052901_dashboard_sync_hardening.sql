-- Ensure source tables are sync-safe for dashboard replication
-- Adds updated_at + deleted_at columns and updated_at trigger for incremental cursor reliability.

create or replace function public.sync_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter table if exists public.visits
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz null;

alter table if exists public.aceite_digital
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz null;

alter table if exists public.clientes
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz null;

alter table if exists public.profiles
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz null;

drop trigger if exists visits_sync_touch_updated_at on public.visits;
create trigger visits_sync_touch_updated_at
before update on public.visits
for each row execute function public.sync_touch_updated_at();

drop trigger if exists aceite_digital_sync_touch_updated_at on public.aceite_digital;
create trigger aceite_digital_sync_touch_updated_at
before update on public.aceite_digital
for each row execute function public.sync_touch_updated_at();

drop trigger if exists clientes_sync_touch_updated_at on public.clientes;
create trigger clientes_sync_touch_updated_at
before update on public.clientes
for each row execute function public.sync_touch_updated_at();

drop trigger if exists profiles_sync_touch_updated_at on public.profiles;
create trigger profiles_sync_touch_updated_at
before update on public.profiles
for each row execute function public.sync_touch_updated_at();

create index if not exists idx_visits_sync_cursor
  on public.visits(updated_at, id);

create index if not exists idx_aceite_digital_sync_cursor
  on public.aceite_digital(updated_at, id);

create index if not exists idx_clientes_sync_cursor
  on public.clientes(updated_at, id);

create index if not exists idx_profiles_sync_cursor
  on public.profiles(updated_at, id);
