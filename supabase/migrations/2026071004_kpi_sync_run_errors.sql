create extension if not exists pgcrypto;

create table if not exists public.kpi_sync_run_errors (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.kpi_sync_runs(id) on delete cascade,
  codigo text not null,
  stage text not null,
  error_message text not null,
  http_status integer null,
  payload_preview text null,
  created_at timestamptz not null default now()
);

create index if not exists kpi_sync_run_errors_sync_run_id_idx
  on public.kpi_sync_run_errors(sync_run_id, created_at desc);

create index if not exists kpi_sync_run_errors_codigo_idx
  on public.kpi_sync_run_errors(codigo);

alter table public.kpi_sync_run_errors enable row level security;

drop policy if exists "Supervisor or assistente full access on kpi_sync_run_errors" on public.kpi_sync_run_errors;
create policy "Supervisor or assistente full access on kpi_sync_run_errors"
  on public.kpi_sync_run_errors
  for all
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('SUPERVISOR', 'ASSISTENTE')
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('SUPERVISOR', 'ASSISTENTE')
    )
  );
