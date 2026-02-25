create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa text null,
  nome_fantasia text null,
  perfil_visita text null,
  endereco text null,
  bairro text null,
  cidade text null,
  uf text null,
  dedupe_key text generated always as (
    lower(coalesce(empresa, '')) || '|' || lower(coalesce(nome_fantasia, ''))
  ) stored,
  created_at timestamptz default now()
);

create unique index if not exists clientes_dedupe_key_unique
  on public.clientes (dedupe_key);

insert into public.clientes (
  empresa,
  nome_fantasia,
  perfil_visita,
  endereco,
  bairro,
  cidade,
  uf
)
select distinct on (lower(coalesce(empresa, '')), lower(coalesce(nome_fantasia, '')))
  empresa,
  nome_fantasia,
  max(perfil_visita) over (partition by lower(coalesce(empresa, '')), lower(coalesce(nome_fantasia, ''))) as perfil_visita,
  endereco,
  bairro,
  cidade,
  uf
from public.agenda
where empresa is not null or nome_fantasia is not null
on conflict (dedupe_key) do nothing;

alter table public.clientes enable row level security;

drop policy if exists "Supervisor full access on clientes" on public.clientes;
create policy "Supervisor full access on clientes" on public.clientes
  for all
  using (is_supervisor())
  with check (is_supervisor());

drop policy if exists "Assistente can read clientes" on public.clientes;
create policy "Assistente can read clientes" on public.clientes
  for select
  using (is_assistente());

drop policy if exists "Assistente can insert clientes" on public.clientes;
create policy "Assistente can insert clientes" on public.clientes
  for insert
  with check (is_assistente());
