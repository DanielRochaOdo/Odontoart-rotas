alter table public.profiles
  drop constraint if exists profiles_assistente_requires_vendedor;

update public.profiles
  set vendedor_id = null,
      supervisor_id = null
where role = 'ASSISTENTE';

alter table public.profiles
  add constraint profiles_assistente_no_parent
  check (
    role <> 'ASSISTENTE'::public.user_role
    or (supervisor_id is null and vendedor_id is null)
  ) not valid;
