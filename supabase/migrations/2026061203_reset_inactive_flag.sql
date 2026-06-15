update public.profiles
set
  is_inactive = false,
  force_reauth_after = null
where is_inactive is true
   or force_reauth_after is not null;

update auth.users
set banned_until = null
where banned_until is not null;
