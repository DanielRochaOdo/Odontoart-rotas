alter table public.profiles
  drop constraint if exists profiles_vendor_requires_supervisor,
  drop constraint if exists profiles_assistente_requires_vendedor,
  drop constraint if exists profiles_supervisor_no_parent;

alter table public.profiles
  add constraint profiles_vendor_requires_supervisor
  check (
    role <> 'VENDEDOR'::public.user_role
    or (supervisor_id is not null and vendedor_id is null)
  ) not valid;

alter table public.profiles
  add constraint profiles_assistente_requires_vendedor
  check (
    role <> 'ASSISTENTE'::public.user_role
    or (vendedor_id is not null and supervisor_id is null)
  ) not valid;

alter table public.profiles
  add constraint profiles_supervisor_no_parent
  check (
    role <> 'SUPERVISOR'::public.user_role
    or (supervisor_id is null and vendedor_id is null)
  ) not valid;
