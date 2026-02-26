create table if not exists public.aceite_digital (
  id uuid primary key default gen_random_uuid(),
  vendor_user_id uuid not null references auth.users(id) on delete cascade,
  vendor_name text null,
  entry_date date not null default current_date,
  vidas integer not null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  constraint aceite_digital_vidas_nonnegative check (vidas >= 0)
);

create index if not exists aceite_digital_vendor_idx on public.aceite_digital(vendor_user_id);
create index if not exists aceite_digital_date_idx on public.aceite_digital(entry_date);
create unique index if not exists aceite_digital_vendor_date_unique
  on public.aceite_digital(vendor_user_id, entry_date);

alter table public.aceite_digital enable row level security;

drop policy if exists "Supervisor or assistente full access on aceite digital" on public.aceite_digital;
create policy "Supervisor or assistente full access on aceite digital" on public.aceite_digital
  for all
  using (is_supervisor() or is_assistente())
  with check (is_supervisor() or is_assistente());

drop policy if exists "Vendedor can read own aceite digital" on public.aceite_digital;
create policy "Vendedor can read own aceite digital" on public.aceite_digital
  for select
  using (is_vendedor() and vendor_user_id = auth.uid());

drop policy if exists "Vendedor can insert own aceite digital" on public.aceite_digital;
create policy "Vendedor can insert own aceite digital" on public.aceite_digital
  for insert
  with check (is_vendedor() and vendor_user_id = auth.uid());
