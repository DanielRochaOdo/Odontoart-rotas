do $$
begin
  create type public.pre_cadastro_status as enum ('PENDENTE', 'APROVADO', 'REPROVADO');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.pre_cadastros (
  id uuid primary key default gen_random_uuid(),
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_by_name text null,
  reviewed_by_user_id uuid null references auth.users(id) on delete set null,
  status public.pre_cadastro_status not null default 'PENDENTE',
  review_note text null,
  approved_cliente_id uuid null references public.clientes(id) on delete set null,
  codigo text null,
  cnpj text null,
  corte numeric null,
  venc numeric null,
  valor numeric null,
  data_da_ultima_visita timestamptz null,
  cep text null,
  empresa text null,
  pessoa text null,
  contato text null,
  grupo text null,
  obs_comercial text null,
  obs text null,
  perfil_visita text null,
  situacao text null,
  endereco text null,
  complemento text null,
  bairro text null,
  cidade text null,
  uf text null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  constraint pre_cadastros_rejection_requires_reason check (
    status <> 'REPROVADO'::public.pre_cadastro_status
    or length(trim(coalesce(review_note, ''))) > 0
  )
);

create index if not exists pre_cadastros_status_idx on public.pre_cadastros(status);
create index if not exists pre_cadastros_created_by_user_idx on public.pre_cadastros(created_by_user_id);
create index if not exists pre_cadastros_created_at_idx on public.pre_cadastros(created_at desc);

alter table public.pre_cadastros enable row level security;

drop policy if exists "Vendedor can insert own pre cadastros" on public.pre_cadastros;
create policy "Vendedor can insert own pre cadastros" on public.pre_cadastros
  for insert
  with check (
    is_vendedor()
    and created_by_user_id = auth.uid()
    and status = 'PENDENTE'::public.pre_cadastro_status
  );

drop policy if exists "Vendedor can read own pre cadastros" on public.pre_cadastros;
create policy "Vendedor can read own pre cadastros" on public.pre_cadastros
  for select
  using (created_by_user_id = auth.uid());

drop policy if exists "Assistente or supervisor can read all pre cadastros" on public.pre_cadastros;
create policy "Assistente or supervisor can read all pre cadastros" on public.pre_cadastros
  for select
  using (is_assistente() or is_supervisor());

drop policy if exists "Assistente or supervisor can review pre cadastros" on public.pre_cadastros;
create policy "Assistente or supervisor can review pre cadastros" on public.pre_cadastros
  for update
  using (is_assistente() or is_supervisor())
  with check (is_assistente() or is_supervisor());
