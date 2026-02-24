create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  role text check (role in ('VENDEDOR','SUPERVISOR','ASSISTENTE')),
  display_name text,
  company_id uuid null,
  created_at timestamptz default now()
);

comment on table public.profiles is 'Perfis internos da Odontoart (uso interno).';
