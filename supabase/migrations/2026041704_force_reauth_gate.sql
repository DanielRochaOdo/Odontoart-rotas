alter table public.profiles
  add column if not exists force_reauth_after timestamptz null;

comment on column public.profiles.force_reauth_after is 'Quando preenchido, invalida permissoes para tokens emitidos antes desse momento.';

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when p.force_reauth_after is null then p.role
      when coalesce(to_timestamp((nullif(auth.jwt() ->> 'iat', ''))::double precision), to_timestamp(0)) >= p.force_reauth_after then p.role
      else null
    end
  from public.profiles p
  where p.user_id = auth.uid();
$$;

grant execute on function public.current_profile_role() to authenticated;

create or replace function public.current_display_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when p.force_reauth_after is null then p.display_name
      when coalesce(to_timestamp((nullif(auth.jwt() ->> 'iat', ''))::double precision), to_timestamp(0)) >= p.force_reauth_after then p.display_name
      else null
    end
  from public.profiles p
  where p.user_id = auth.uid();
$$;

grant execute on function public.current_display_name() to authenticated;
