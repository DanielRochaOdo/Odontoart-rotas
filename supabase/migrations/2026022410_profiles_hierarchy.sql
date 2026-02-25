alter table public.profiles
  add column if not exists supervisor_id uuid references public.profiles(id) on delete set null,
  add column if not exists vendedor_id uuid references public.profiles(id) on delete set null;

create index if not exists profiles_supervisor_id_idx on public.profiles(supervisor_id);
create index if not exists profiles_vendedor_id_idx on public.profiles(vendedor_id);

drop policy if exists "Supervisor can update profiles" on public.profiles;
drop policy if exists "Supervisor can insert profiles" on public.profiles;
drop policy if exists "Supervisor can delete profiles" on public.profiles;
drop policy if exists "Supervisor or assistente can update profiles" on public.profiles;

create policy "Supervisor can update profiles" on public.profiles
  for update
  using (is_supervisor())
  with check (is_supervisor());

create policy "Supervisor can insert profiles" on public.profiles
  for insert
  with check (is_supervisor());

create policy "Supervisor can delete profiles" on public.profiles
  for delete
  using (is_supervisor());
