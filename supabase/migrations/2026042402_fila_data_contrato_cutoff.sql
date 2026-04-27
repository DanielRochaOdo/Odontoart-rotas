-- Corte de entrada no modulo fila:
-- somente empresas com DataContrato >= 2026-04-01.

delete from public.queue_release_controls
where data_contrato < date '2026-04-01';

alter table public.queue_release_controls
  drop constraint if exists queue_release_controls_data_contrato_min;

alter table public.queue_release_controls
  add constraint queue_release_controls_data_contrato_min
  check (data_contrato >= date '2026-04-01');

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

  if p_data_contrato < date '2026-04-01' then
    raise exception 'Empresa fora do escopo do modulo fila (DataContrato anterior a 2026-04-01).';
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
