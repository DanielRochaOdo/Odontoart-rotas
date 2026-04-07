create table if not exists public.vendor_next_route_releases (
  id uuid primary key default gen_random_uuid(),
  vendor_user_id uuid not null references auth.users(id) on delete cascade,
  release_date date not null,
  released_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (vendor_user_id, release_date)
);

create index if not exists vendor_next_route_releases_vendor_date_idx
  on public.vendor_next_route_releases(vendor_user_id, release_date);

alter table public.vendor_next_route_releases enable row level security;

drop policy if exists "Supervisor or assistente full access on vendor_next_route_releases" on public.vendor_next_route_releases;
create policy "Supervisor or assistente full access on vendor_next_route_releases"
  on public.vendor_next_route_releases
  for all
  using (public.is_supervisor() or public.is_assistente())
  with check (public.is_supervisor() or public.is_assistente());

drop policy if exists "Vendedor can read own vendor_next_route_releases" on public.vendor_next_route_releases;
create policy "Vendedor can read own vendor_next_route_releases"
  on public.vendor_next_route_releases
  for select
  using (public.is_vendedor() and vendor_user_id = auth.uid());
