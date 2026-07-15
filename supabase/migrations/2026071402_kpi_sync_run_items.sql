create table if not exists public.kpi_sync_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.kpi_sync_runs(id) on delete cascade,
  codigo text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'retrying', 'completed', 'failed', 'stopped')),
  attempts integer not null default 0,
  worker_id text null,
  claimed_at timestamptz null,
  heartbeat_at timestamptz null,
  started_at timestamptz null,
  finished_at timestamptz null,
  next_retry_at timestamptz null,
  last_error text null,
  error_code text null,
  previous_value jsonb null,
  received_value jsonb null,
  changed boolean not null default false,
  kpi_status text null,
  kpi_error text null,
  duration_ms integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists kpi_sync_run_items_run_codigo_key
  on public.kpi_sync_run_items(run_id, codigo);

create index if not exists kpi_sync_run_items_run_status_idx
  on public.kpi_sync_run_items(run_id, status, created_at asc);

create index if not exists kpi_sync_run_items_worker_idx
  on public.kpi_sync_run_items(worker_id, heartbeat_at desc);

alter table public.kpi_sync_run_items enable row level security;

drop policy if exists "Supervisor or assistente full access on kpi_sync_run_items" on public.kpi_sync_run_items;
create policy "Supervisor or assistente full access on kpi_sync_run_items"
  on public.kpi_sync_run_items
  for all
  using (public.is_supervisor() or public.is_assistente())
  with check (public.is_supervisor() or public.is_assistente());

create or replace function public.kpi_claim_next_run_items(
  p_run_id uuid,
  p_worker_id text,
  p_claim_size integer,
  p_retry_timeout_seconds integer default 120
)
returns table (
  id uuid,
  codigo text,
  status text,
  attempts integer,
  worker_id text,
  claimed_at timestamptz,
  heartbeat_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select i.id
    from public.kpi_sync_run_items i
    where i.run_id = p_run_id
      and (
        i.status = 'pending'
        or (i.status = 'retrying' and coalesce(i.next_retry_at, now()) <= now())
        or (i.status = 'processing' and coalesce(i.heartbeat_at, i.claimed_at, now()) < now() - make_interval(secs => p_retry_timeout_seconds))
      )
    order by i.created_at asc, i.id asc
    for update skip locked
    limit greatest(coalesce(p_claim_size, 0), 0)
  )
  update public.kpi_sync_run_items i
  set status = 'processing',
      worker_id = p_worker_id,
      claimed_at = now(),
      heartbeat_at = now(),
      started_at = coalesce(i.started_at, now()),
      attempts = i.attempts + 1,
      updated_at = now()
  from claimed
  where i.id = claimed.id
  returning i.id, i.codigo, i.status, i.attempts, i.worker_id, i.claimed_at, i.heartbeat_at;
end;
$$;

create or replace function public.kpi_touch_run_item(
  p_item_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kpi_sync_run_items
  set heartbeat_at = now(),
      updated_at = now()
  where id = p_item_id
    and worker_id = p_worker_id
    and status = 'processing';
end;
$$;

create or replace function public.kpi_finalize_run_item(
  p_item_id uuid,
  p_worker_id text,
  p_status text,
  p_changed boolean default false,
  p_kpi_status text default null,
  p_kpi_error text default null,
  p_error_code text default null,
  p_last_error text default null,
  p_previous_value jsonb default null,
  p_received_value jsonb default null,
  p_duration_ms integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kpi_sync_run_items
  set status = p_status,
      finished_at = now(),
      changed = coalesce(p_changed, false),
      kpi_status = p_kpi_status,
      kpi_error = p_kpi_error,
      error_code = p_error_code,
      last_error = p_last_error,
      previous_value = p_previous_value,
      received_value = p_received_value,
      duration_ms = p_duration_ms,
      updated_at = now()
  where id = p_item_id
    and worker_id = p_worker_id
    and status = 'processing';
end;
$$;
