create table if not exists public.queue_release_settings (
  id boolean primary key default true check (id),
  feature_start_at timestamptz not null default now(),
  default_waiting_days integer not null default 30 check (default_waiting_days > 0),
  reminder_days integer[] not null default array[30, 15, 7, 1],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.queue_release_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.queue_release_controls (
  empresa_id uuid primary key references public.clientes(id) on delete cascade,
  codigo text null,
  empresa text null,
  cnpj text null,
  data_contrato date not null,
  waiting_days_snapshot integer not null check (waiting_days_snapshot > 0),
  eligible_at timestamptz not null,
  state text not null default 'PENDING_WAIT' check (state in ('PENDING_WAIT', 'READY_AUTO', 'RELEASED_MANUAL', 'BLOCKED_MANUAL')),
  manual_block_until timestamptz null,
  manual_reason text null,
  manual_override_by uuid null references auth.users(id) on delete set null,
  manual_override_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists queue_release_controls_state_idx
  on public.queue_release_controls(state);

create index if not exists queue_release_controls_eligible_at_idx
  on public.queue_release_controls(eligible_at);

create table if not exists public.queue_release_events (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.queue_release_controls(empresa_id) on delete cascade,
  event_type text not null check (
    event_type in (
      'NEW_COMPANY_WAITING',
      'COUNTDOWN_30',
      'COUNTDOWN_15',
      'COUNTDOWN_7',
      'COUNTDOWN_1',
      'RULE_CHANGED',
      'RELEASED_MANUAL',
      'BLOCKED_MANUAL'
    )
  ),
  payload jsonb not null default '{}'::jsonb,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists queue_release_events_created_at_idx
  on public.queue_release_events(created_at desc);

create index if not exists queue_release_events_empresa_created_idx
  on public.queue_release_events(empresa_id, created_at desc);

create unique index if not exists queue_release_events_single_alert_idx
  on public.queue_release_events(empresa_id, event_type)
  where event_type in (
    'NEW_COMPANY_WAITING',
    'COUNTDOWN_30',
    'COUNTDOWN_15',
    'COUNTDOWN_7',
    'COUNTDOWN_1'
  );

create table if not exists public.queue_release_event_receipts (
  event_id uuid not null references public.queue_release_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists queue_release_event_receipts_user_idx
  on public.queue_release_event_receipts(user_id, acknowledged_at desc);

create or replace function public.queue_release_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists queue_release_settings_touch_updated_at on public.queue_release_settings;
create trigger queue_release_settings_touch_updated_at
before update on public.queue_release_settings
for each row execute function public.queue_release_touch_updated_at();

drop trigger if exists queue_release_controls_touch_updated_at on public.queue_release_controls;
create trigger queue_release_controls_touch_updated_at
before update on public.queue_release_controls
for each row execute function public.queue_release_touch_updated_at();

drop function if exists public.queue_release_can_manage();
create or replace function public.queue_release_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'authenticated' and (is_supervisor() or is_assistente());
$$;

grant execute on function public.queue_release_can_manage() to authenticated;

create or replace function public.queue_release_emit_event(
  p_empresa_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_created_by uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.queue_release_events (empresa_id, event_type, payload, created_by)
  values (p_empresa_id, p_event_type, coalesce(p_payload, '{}'::jsonb), p_created_by)
  on conflict do nothing;
end;
$$;

create or replace function public.queue_release_sync_states()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_auto integer := 0;
  v_updated_unblock integer := 0;
begin
  update public.queue_release_controls
  set
    state = case when eligible_at <= now() then 'READY_AUTO' else 'PENDING_WAIT' end,
    updated_at = now()
  where state in ('PENDING_WAIT', 'READY_AUTO')
    and state <> case when eligible_at <= now() then 'READY_AUTO' else 'PENDING_WAIT' end;
  get diagnostics v_updated_auto = row_count;

  update public.queue_release_controls
  set
    state = case when eligible_at <= now() then 'READY_AUTO' else 'PENDING_WAIT' end,
    manual_block_until = null,
    manual_reason = null,
    updated_at = now()
  where state = 'BLOCKED_MANUAL'
    and manual_block_until is not null
    and manual_block_until <= now();
  get diagnostics v_updated_unblock = row_count;

  return v_updated_auto + v_updated_unblock;
end;
$$;

grant execute on function public.queue_release_sync_states() to authenticated;

create or replace function public.queue_release_register_company(
  p_empresa_id uuid,
  p_data_contrato date,
  p_waiting_days integer default null
)
returns public.queue_release_controls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.queue_release_settings%rowtype;
  v_cliente record;
  v_row public.queue_release_controls%rowtype;
  v_waiting_days integer;
  v_eligible_at timestamptz;
  v_actor_name text;
begin
  if not public.queue_release_can_manage() then
    raise exception 'Sem permissao para gerenciar modulo fila.';
  end if;

  if p_empresa_id is null then
    raise exception 'Empresa obrigatoria.';
  end if;
  if p_data_contrato is null then
    raise exception 'DataContrato obrigatoria.';
  end if;

  select * into v_settings
  from public.queue_release_settings
  where id = true
  limit 1;

  if v_settings.id is null then
    insert into public.queue_release_settings (id) values (true)
    on conflict (id) do nothing;
    select * into v_settings
    from public.queue_release_settings
    where id = true
    limit 1;
  end if;

  select id, codigo, empresa, cnpj, created_at
  into v_cliente
  from public.clientes
  where id = p_empresa_id
  limit 1;

  if v_cliente.id is null then
    raise exception 'Empresa nao encontrada no cadastro.';
  end if;

  if v_cliente.created_at < v_settings.feature_start_at then
    raise exception 'Empresa fora do escopo do modulo fila (nao retroativo).';
  end if;

  select * into v_row
  from public.queue_release_controls
  where empresa_id = p_empresa_id
  limit 1;

  if v_row.empresa_id is not null then
    return v_row;
  end if;

  v_waiting_days := coalesce(p_waiting_days, v_settings.default_waiting_days);
  if v_waiting_days <= 0 then
    raise exception 'Prazo em dias deve ser maior que zero.';
  end if;

  v_eligible_at := (p_data_contrato::timestamp + interval '12 hour') + make_interval(days => v_waiting_days);

  insert into public.queue_release_controls (
    empresa_id,
    codigo,
    empresa,
    cnpj,
    data_contrato,
    waiting_days_snapshot,
    eligible_at,
    state,
    manual_block_until,
    manual_reason,
    manual_override_by,
    manual_override_at
  )
  values (
    p_empresa_id,
    v_cliente.codigo,
    v_cliente.empresa,
    v_cliente.cnpj,
    p_data_contrato,
    v_waiting_days,
    v_eligible_at,
    case when v_eligible_at <= now() then 'READY_AUTO' else 'PENDING_WAIT' end,
    null,
    null,
    auth.uid(),
    now()
  )
  returning * into v_row;

  select coalesce(p.nome, p.display_name) into v_actor_name
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  perform public.queue_release_emit_event(
    p_empresa_id,
    'NEW_COMPANY_WAITING',
    jsonb_build_object(
      'codigo', v_row.codigo,
      'empresa', v_row.empresa,
      'data_contrato', v_row.data_contrato,
      'eligible_at', v_row.eligible_at,
      'waiting_days', v_row.waiting_days_snapshot,
      'actor_name', coalesce(v_actor_name, '')
    ),
    auth.uid()
  );

  return v_row;
end;
$$;

grant execute on function public.queue_release_register_company(uuid, date, integer) to authenticated;

create or replace function public.queue_release_apply_action(
  p_empresa_id uuid,
  p_action text,
  p_waiting_days integer default null,
  p_block_days integer default null,
  p_reason text default null
)
returns public.queue_release_controls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.queue_release_controls%rowtype;
  v_old_row public.queue_release_controls%rowtype;
  v_action text;
  v_new_eligible timestamptz;
  v_actor_name text;
  v_block_until timestamptz;
begin
  if not public.queue_release_can_manage() then
    raise exception 'Sem permissao para gerenciar modulo fila.';
  end if;

  v_action := upper(coalesce(trim(p_action), ''));
  if v_action = '' then
    raise exception 'Acao obrigatoria.';
  end if;

  select * into v_row
  from public.queue_release_controls
  where empresa_id = p_empresa_id
  for update;

  if v_row.empresa_id is null then
    raise exception 'Empresa nao registrada no modulo fila.';
  end if;

  v_old_row := v_row;

  select coalesce(p.nome, p.display_name) into v_actor_name
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if v_action = 'RELEASE_NOW' then
    update public.queue_release_controls
    set
      state = 'RELEASED_MANUAL',
      manual_block_until = null,
      manual_reason = p_reason,
      manual_override_by = auth.uid(),
      manual_override_at = now(),
      updated_at = now()
    where empresa_id = p_empresa_id
    returning * into v_row;

    perform public.queue_release_emit_event(
      p_empresa_id,
      'RELEASED_MANUAL',
      jsonb_build_object(
        'old_state', v_old_row.state,
        'new_state', v_row.state,
        'reason', coalesce(p_reason, ''),
        'actor_name', coalesce(v_actor_name, '')
      ),
      auth.uid()
    );

    return v_row;
  end if;

  if v_action = 'SET_WAITING_DAYS' then
    if p_waiting_days is null or p_waiting_days <= 0 then
      raise exception 'Informe um prazo valido para atualizacao.';
    end if;

    v_new_eligible := (v_row.data_contrato::timestamp + interval '12 hour') + make_interval(days => p_waiting_days);

    update public.queue_release_controls
    set
      waiting_days_snapshot = p_waiting_days,
      eligible_at = v_new_eligible,
      state = case when v_new_eligible <= now() then 'READY_AUTO' else 'PENDING_WAIT' end,
      manual_block_until = null,
      manual_reason = p_reason,
      manual_override_by = auth.uid(),
      manual_override_at = now(),
      updated_at = now()
    where empresa_id = p_empresa_id
    returning * into v_row;

    perform public.queue_release_emit_event(
      p_empresa_id,
      'RULE_CHANGED',
      jsonb_build_object(
        'old_waiting_days', v_old_row.waiting_days_snapshot,
        'new_waiting_days', v_row.waiting_days_snapshot,
        'old_eligible_at', v_old_row.eligible_at,
        'new_eligible_at', v_row.eligible_at,
        'reason', coalesce(p_reason, ''),
        'actor_name', coalesce(v_actor_name, '')
      ),
      auth.uid()
    );

    return v_row;
  end if;

  if v_action = 'BLOCK_DAYS' then
    if p_block_days is null or p_block_days <= 0 then
      raise exception 'Informe a quantidade de dias para bloqueio.';
    end if;

    v_block_until := now() + make_interval(days => p_block_days);

    update public.queue_release_controls
    set
      state = 'BLOCKED_MANUAL',
      manual_block_until = v_block_until,
      manual_reason = p_reason,
      manual_override_by = auth.uid(),
      manual_override_at = now(),
      updated_at = now()
    where empresa_id = p_empresa_id
    returning * into v_row;

    perform public.queue_release_emit_event(
      p_empresa_id,
      'BLOCKED_MANUAL',
      jsonb_build_object(
        'old_state', v_old_row.state,
        'new_state', v_row.state,
        'block_until', v_row.manual_block_until,
        'reason', coalesce(p_reason, ''),
        'actor_name', coalesce(v_actor_name, '')
      ),
      auth.uid()
    );

    return v_row;
  end if;

  if v_action = 'UNBLOCK' then
    update public.queue_release_controls
    set
      state = case when eligible_at <= now() then 'READY_AUTO' else 'PENDING_WAIT' end,
      manual_block_until = null,
      manual_reason = p_reason,
      manual_override_by = auth.uid(),
      manual_override_at = now(),
      updated_at = now()
    where empresa_id = p_empresa_id
    returning * into v_row;

    perform public.queue_release_emit_event(
      p_empresa_id,
      'RULE_CHANGED',
      jsonb_build_object(
        'old_state', v_old_row.state,
        'new_state', v_row.state,
        'reason', coalesce(p_reason, ''),
        'actor_name', coalesce(v_actor_name, '')
      ),
      auth.uid()
    );

    return v_row;
  end if;

  raise exception 'Acao invalida: %', v_action;
end;
$$;

grant execute on function public.queue_release_apply_action(uuid, text, integer, integer, text) to authenticated;

create or replace function public.queue_release_generate_countdown_events(
  p_reference_date date default ((now() at time zone 'America/Fortaleza')::date)
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.queue_release_settings%rowtype;
  v_row public.queue_release_controls%rowtype;
  v_inserted integer := 0;
  v_diff_days integer;
  v_event_type text;
begin
  if auth.role() = 'authenticated' and not public.queue_release_can_manage() then
    raise exception 'Sem permissao para gerar avisos do modulo fila.';
  end if;

  perform public.queue_release_sync_states();

  select * into v_settings
  from public.queue_release_settings
  where id = true
  limit 1;

  if v_settings.id is null then
    return 0;
  end if;

  for v_row in
    select *
    from public.queue_release_controls
    where state = 'PENDING_WAIT'
  loop
    v_diff_days := ((v_row.eligible_at at time zone 'America/Fortaleza')::date - p_reference_date);
    if not (v_diff_days = any(v_settings.reminder_days)) then
      continue;
    end if;

    v_event_type := case v_diff_days
      when 30 then 'COUNTDOWN_30'
      when 15 then 'COUNTDOWN_15'
      when 7 then 'COUNTDOWN_7'
      when 1 then 'COUNTDOWN_1'
      else null
    end;

    if v_event_type is null then
      continue;
    end if;

    insert into public.queue_release_events (
      empresa_id,
      event_type,
      payload,
      created_by
    )
    values (
      v_row.empresa_id,
      v_event_type,
      jsonb_build_object(
        'codigo', v_row.codigo,
        'empresa', v_row.empresa,
        'days_left', v_diff_days,
        'eligible_at', v_row.eligible_at
      ),
      null
    )
    on conflict do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$$;

grant execute on function public.queue_release_generate_countdown_events(date) to authenticated;

create or replace function public.queue_release_pending_notifications(
  p_limit integer default 10
)
returns table (
  event_id uuid,
  empresa_id uuid,
  codigo text,
  empresa text,
  event_type text,
  payload jsonb,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.queue_release_can_manage() then
    raise exception 'Sem permissao para consultar avisos do modulo fila.';
  end if;

  return query
  select
    e.id as event_id,
    c.empresa_id,
    c.codigo,
    c.empresa,
    e.event_type,
    e.payload,
    e.created_by,
    e.created_at
  from public.queue_release_events e
  join public.queue_release_controls c on c.empresa_id = e.empresa_id
  where not exists (
    select 1
    from public.queue_release_event_receipts r
    where r.event_id = e.id
      and r.user_id = auth.uid()
  )
  order by e.created_at asc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$$;

grant execute on function public.queue_release_pending_notifications(integer) to authenticated;

create or replace function public.queue_release_acknowledge_event(
  p_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.queue_release_can_manage() then
    raise exception 'Sem permissao para confirmar aviso do modulo fila.';
  end if;

  insert into public.queue_release_event_receipts (event_id, user_id)
  values (p_event_id, auth.uid())
  on conflict (event_id, user_id) do nothing;
end;
$$;

grant execute on function public.queue_release_acknowledge_event(uuid) to authenticated;

create or replace view public.queue_release_controls_view as
select
  c.empresa_id,
  c.codigo,
  c.empresa,
  c.cnpj,
  c.data_contrato,
  c.waiting_days_snapshot,
  c.eligible_at,
  c.state,
  c.manual_block_until,
  c.manual_reason,
  c.manual_override_by,
  c.manual_override_at,
  c.created_at,
  c.updated_at,
  case
    when c.state = 'BLOCKED_MANUAL' and (c.manual_block_until is null or c.manual_block_until > now()) then 'BLOCKED_MANUAL'
    when c.state = 'RELEASED_MANUAL' then 'RELEASED_MANUAL'
    when c.eligible_at <= now() then 'READY_AUTO'
    else 'PENDING_WAIT'
  end as effective_state,
  greatest(
    0,
    ((c.eligible_at at time zone 'America/Fortaleza')::date - (now() at time zone 'America/Fortaleza')::date)
  )::integer as days_remaining
from public.queue_release_controls c;

alter table public.queue_release_settings enable row level security;
alter table public.queue_release_controls enable row level security;
alter table public.queue_release_events enable row level security;
alter table public.queue_release_event_receipts enable row level security;

grant select, update on public.queue_release_settings to authenticated;
grant select, insert, update on public.queue_release_controls to authenticated;
grant select on public.queue_release_events to authenticated;
grant select, insert on public.queue_release_event_receipts to authenticated;
grant select on public.queue_release_controls_view to authenticated;

drop policy if exists "Queue settings manage by supervisor assistant" on public.queue_release_settings;
create policy "Queue settings manage by supervisor assistant"
on public.queue_release_settings
for all
using (public.queue_release_can_manage())
with check (public.queue_release_can_manage());

drop policy if exists "Queue controls manage by supervisor assistant" on public.queue_release_controls;
create policy "Queue controls manage by supervisor assistant"
on public.queue_release_controls
for all
using (public.queue_release_can_manage())
with check (public.queue_release_can_manage());

drop policy if exists "Queue events read by supervisor assistant" on public.queue_release_events;
create policy "Queue events read by supervisor assistant"
on public.queue_release_events
for select
using (public.queue_release_can_manage());

drop policy if exists "Queue receipts own by supervisor assistant" on public.queue_release_event_receipts;
create policy "Queue receipts own by supervisor assistant"
on public.queue_release_event_receipts
for all
using (public.queue_release_can_manage() and user_id = auth.uid())
with check (public.queue_release_can_manage() and user_id = auth.uid());
