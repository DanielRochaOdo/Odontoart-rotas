create table if not exists public.supabase_keepalive (
  id boolean primary key default true check (id = true),
  created_at timestamptz not null default now()
);

insert into public.supabase_keepalive (id)
values (true)
on conflict (id) do nothing;

alter table public.supabase_keepalive enable row level security;

grant select on table public.supabase_keepalive to anon;

drop policy if exists "Public can read keepalive row" on public.supabase_keepalive;
create policy "Public can read keepalive row"
  on public.supabase_keepalive
  for select
  to anon
  using (true);
