set statement_timeout = 0;

alter table public.visits
  add column if not exists visit_type text,
  add column if not exists supervisor_reason text,
  add column if not exists register_mode text,
  add column if not exists visit_time time,
  add column if not exists registered_by_user_id uuid references auth.users(id) on delete set null;

update public.visits
set visit_type = 'VENDEDOR'
where visit_type is null;

update public.visits
set register_mode = 'PADRAO'
where register_mode is null;

alter table public.visits
  alter column visit_type set default 'VENDEDOR',
  alter column visit_type set not null,
  alter column register_mode set default 'PADRAO',
  alter column register_mode set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'visits_visit_type_check'
  ) then
    alter table public.visits
      add constraint visits_visit_type_check
      check (visit_type in ('VENDEDOR', 'SUPERVISOR_RELACIONAMENTO'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'visits_register_mode_check'
  ) then
    alter table public.visits
      add constraint visits_register_mode_check
      check (register_mode in ('PADRAO', 'SUPERVISOR_DIFERENCIADO'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'visits_supervisor_reason_check'
  ) then
    alter table public.visits
      add constraint visits_supervisor_reason_check
      check (
        supervisor_reason is null
        or supervisor_reason in (
          'RETENCAO',
          'RELACIONAMENTO',
          'EMPRESA_INADIMPLENTE',
          'EVENTO_ODONTOMOVEL'
        )
      );
  end if;
end $$;

create index if not exists visits_visit_type_idx on public.visits(visit_type);
create index if not exists visits_supervisor_reason_idx on public.visits(supervisor_reason);
create index if not exists visits_visit_time_idx on public.visits(visit_time);

create table if not exists public.visit_supervisors (
  visit_id uuid not null references public.visits(id) on delete cascade,
  supervisor_user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (visit_id, supervisor_user_id)
);

create index if not exists visit_supervisors_supervisor_idx
  on public.visit_supervisors(supervisor_user_id);

alter table public.visit_supervisors enable row level security;

drop policy if exists "Supervisor or assistente full access on visit supervisors" on public.visit_supervisors;
create policy "Supervisor or assistente full access on visit supervisors" on public.visit_supervisors
  for all
  using (is_supervisor() or is_assistente())
  with check (is_supervisor() or is_assistente());

create table if not exists public.visit_supervisor_register (
  visit_id uuid primary key references public.visits(id) on delete cascade,
  quantidade_vidas integer null check (quantidade_vidas >= 0),
  quantidade_funcionarios integer not null check (quantidade_funcionarios >= 0),
  descricao_visita text not null,
  pessoa_contato_mesma boolean not null,
  pessoa text null,
  contato text null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid null references auth.users(id) on delete set null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'visit_supervisor_register_descricao_check'
  ) then
    alter table public.visit_supervisor_register
      add constraint visit_supervisor_register_descricao_check
      check (
        descricao_visita in (
          'REUNIAO_REALIZADA',
          'VISITA_MARCADA',
          'VISITA_PENDENTE',
          'VISITA_NAO_AUTORIZADA',
          'DUVIDAS_SOBRE_PORTAL_PLANO',
          'LISTA_SOLICITADA',
          'LISTA_RECEBIDA',
          'ODONTOMOVEL_ALINHADO',
          'ACAO_SIPAT_REALIZADA',
          'RETENCAO_REALIZADA',
          'RETENCAO_SEM_SUCESSO',
          'CANCELAMENTO_SOLICITADO'
        )
      );
  end if;
end $$;

create index if not exists visit_supervisor_register_updated_at_idx
  on public.visit_supervisor_register(updated_at desc);

alter table public.visit_supervisor_register enable row level security;

drop policy if exists "Supervisor or assistente full access on visit supervisor register" on public.visit_supervisor_register;
create policy "Supervisor or assistente full access on visit supervisor register" on public.visit_supervisor_register
  for all
  using (is_supervisor() or is_assistente())
  with check (is_supervisor() or is_assistente());
