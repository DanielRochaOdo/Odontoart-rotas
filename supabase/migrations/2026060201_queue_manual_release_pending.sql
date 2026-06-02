-- Remove a liberacao automatica do modulo fila a partir de 2026-06-02.
-- Empresas ja liberadas automaticamente antes do corte permanecem em READY_AUTO.
-- Empresas com prazo encerrado a partir do corte passam para RELEASE_PENDING
-- e continuam fora das rotas ate liberacao manual.

alter table public.queue_release_controls
  drop constraint if exists queue_release_controls_state_check;

update public.queue_release_controls
set state = 'RELEASE_PENDING',
    updated_at = now()
where state = 'READY_AUTO'
  and eligible_at >= timestamptz '2026-06-02 00:00:00-03';

update public.queue_release_controls
set state = 'READY_AUTO',
    updated_at = now()
where state = 'PENDING_WAIT'
  and eligible_at < timestamptz '2026-06-02 00:00:00-03';

alter table public.queue_release_controls
  add constraint queue_release_controls_state_check
  check (state in ('PENDING_WAIT', 'RELEASE_PENDING', 'READY_AUTO', 'RELEASED_MANUAL', 'BLOCKED_MANUAL'));

create or replace function public.queue_release_sync_states()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_waiting integer := 0;
  v_updated_unblock integer := 0;
begin
  update public.queue_release_controls
  set
    state = case
      when eligible_at < timestamptz '2026-06-02 00:00:00-03' then 'READY_AUTO'
      when eligible_at <= now() then 'RELEASE_PENDING'
      else 'PENDING_WAIT'
    end,
    updated_at = now()
  where state in ('PENDING_WAIT', 'RELEASE_PENDING', 'READY_AUTO')
    and state <> case
      when eligible_at < timestamptz '2026-06-02 00:00:00-03' then 'READY_AUTO'
      when eligible_at <= now() then 'RELEASE_PENDING'
      else 'PENDING_WAIT'
    end;
  get diagnostics v_updated_waiting = row_count;

  update public.queue_release_controls
  set
    state = case
      when eligible_at < timestamptz '2026-06-02 00:00:00-03' then 'READY_AUTO'
      when eligible_at <= now() then 'RELEASE_PENDING'
      else 'PENDING_WAIT'
    end,
    manual_block_until = null,
    manual_reason = null,
    updated_at = now()
  where state = 'BLOCKED_MANUAL'
    and manual_block_until is not null
    and manual_block_until <= now();
  get diagnostics v_updated_unblock = row_count;

  return v_updated_waiting + v_updated_unblock;
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
    raise exception 'DataContrato obrigatoria para entrada na fila.';
  end if;
  if p_data_contrato < date '2026-01-01' then
    raise exception 'Empresa fora do corte da fila (DataContrato anterior a 2026-01-01).';
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
    case
      when v_eligible_at < timestamptz '2026-06-02 00:00:00-03' then 'READY_AUTO'
      when v_eligible_at <= now() then 'RELEASE_PENDING'
      else 'PENDING_WAIT'
    end,
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
      state = case
        when v_new_eligible < timestamptz '2026-06-02 00:00:00-03' then 'READY_AUTO'
        when v_new_eligible <= now() then 'RELEASE_PENDING'
        else 'PENDING_WAIT'
      end,
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
      state = case
        when eligible_at < timestamptz '2026-06-02 00:00:00-03' then 'READY_AUTO'
        when eligible_at <= now() then 'RELEASE_PENDING'
        else 'PENDING_WAIT'
      end,
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
    when c.eligible_at < timestamptz '2026-06-02 00:00:00-03' then 'READY_AUTO'
    when c.eligible_at <= now() then 'RELEASE_PENDING'
    else 'PENDING_WAIT'
  end as effective_state,
  greatest(
    0,
    ((c.eligible_at at time zone 'America/Fortaleza')::date - (now() at time zone 'America/Fortaleza')::date)
  )::integer as days_remaining
from public.queue_release_controls c;

alter view if exists public.queue_release_controls_view
set (security_invoker = true);

grant select on public.queue_release_controls_view to authenticated;

do $$
declare
  v_function_definition text;
begin
  if to_regprocedure('public.get_rotas_agenda_filtered_v2(jsonb,text,text)') is null then
    return;
  end if;

  select pg_get_functiondef('public.get_rotas_agenda_filtered_v2(jsonb,text,text)'::regprocedure)
  into v_function_definition;

  v_function_definition := replace(
    v_function_definition,
    'q.effective_state in (''PENDING_WAIT'', ''BLOCKED_MANUAL'')',
    'q.effective_state in (''PENDING_WAIT'', ''RELEASE_PENDING'', ''BLOCKED_MANUAL'')'
  );

  execute v_function_definition;
end;
$$;
