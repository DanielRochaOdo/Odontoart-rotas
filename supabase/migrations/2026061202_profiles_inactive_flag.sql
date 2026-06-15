alter table public.profiles
  add column if not exists is_inactive boolean not null default false;

comment on column public.profiles.is_inactive is 'Indica se o usuario esta inativo no modulo de gestao.';
