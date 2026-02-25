-- Backfill roles for existing profiles created before role enforcement
update public.profiles
set role = 'ASSISTENTE'::public.user_role
where role is null
  and vendedor_id is not null;

update public.profiles
set role = 'VENDEDOR'::public.user_role
where role is null
  and vendedor_id is null
  and supervisor_id is not null;
