-- Reduce audit_logs footprint and prevent runaway growth.
-- Strategy:
-- 1) Keep only compact payloads (no full row snapshots for updates).
-- 2) Retain only recent logs and cap total rows.
-- 3) Compact existing storage immediately.

do $$
begin
  create extension if not exists pg_cron with schema extensions;
exception
  when insufficient_privilege then
    null;
  when undefined_file then
    null;
end $$;

create or replace function public.audit_row_projection(p_table_name text, p_row jsonb)
returns jsonb
language plpgsql
immutable
as $$
begin
  if p_row is null then
    return '{}'::jsonb;
  end if;

  case p_table_name
    when 'agenda' then
      return jsonb_strip_nulls(
        jsonb_build_object(
          'cod_1', p_row->'cod_1',
          'empresa', p_row->'empresa',
          'nome_fantasia', p_row->'nome_fantasia',
          'perfil_visita', p_row->'perfil_visita',
          'data_da_ultima_visita', p_row->'data_da_ultima_visita',
          'corte', p_row->'corte',
          'venc', p_row->'venc',
          'valor', p_row->'valor',
          'cep', p_row->'cep',
          'endereco', p_row->'endereco',
          'complemento', p_row->'complemento',
          'bairro', p_row->'bairro',
          'cidade', p_row->'cidade',
          'uf', p_row->'uf',
          'supervisor', p_row->'supervisor',
          'vendedor', p_row->'vendedor',
          'grupo', p_row->'grupo',
          'situacao', p_row->'situacao',
          'obs_contrato_1', p_row->'obs_contrato_1',
          'pessoa', p_row->'pessoa',
          'contato', p_row->'contato',
          'visit_completed_at', p_row->'visit_completed_at',
          'visit_completed_vidas', p_row->'visit_completed_vidas'
        )
      );
    when 'clientes' then
      return jsonb_strip_nulls(
        jsonb_build_object(
          'codigo', p_row->'codigo',
          'empresa', p_row->'empresa',
          'nome_fantasia', p_row->'nome_fantasia',
          'perfil_visita', p_row->'perfil_visita',
          'data_da_ultima_visita', p_row->'data_da_ultima_visita',
          'corte', p_row->'corte',
          'venc', p_row->'venc',
          'valor', p_row->'valor',
          'cep', p_row->'cep',
          'endereco', p_row->'endereco',
          'complemento', p_row->'complemento',
          'bairro', p_row->'bairro',
          'cidade', p_row->'cidade',
          'uf', p_row->'uf',
          'grupo', p_row->'grupo',
          'situacao', p_row->'situacao',
          'obs_comercial', p_row->'obs_comercial',
          'pessoa', p_row->'pessoa',
          'contato', p_row->'contato',
          'cnpj', p_row->'cnpj'
        )
      );
    when 'visits' then
      return jsonb_strip_nulls(
        jsonb_build_object(
          'agenda_id', p_row->'agenda_id',
          'assigned_to_user_id', p_row->'assigned_to_user_id',
          'assigned_to_name', p_row->'assigned_to_name',
          'visit_date', p_row->'visit_date',
          'perfil_visita', p_row->'perfil_visita',
          'perfil_visita_opcoes', p_row->'perfil_visita_opcoes',
          'completed_at', p_row->'completed_at',
          'completed_vidas', p_row->'completed_vidas',
          'no_visit_reason', p_row->'no_visit_reason',
          'instructions', p_row->'instructions',
          'route_id', p_row->'route_id'
        )
      );
    when 'routes' then
      return jsonb_strip_nulls(
        jsonb_build_object(
          'name', p_row->'name',
          'assigned_to_user_id', p_row->'assigned_to_user_id',
          'date', p_row->'date'
        )
      );
    when 'route_stops' then
      return jsonb_strip_nulls(
        jsonb_build_object(
          'route_id', p_row->'route_id',
          'agenda_id', p_row->'agenda_id',
          'stop_order', p_row->'stop_order',
          'notes', p_row->'notes'
        )
      );
    when 'profiles' then
      return jsonb_strip_nulls(
        jsonb_build_object(
          'user_id', p_row->'user_id',
          'role', p_row->'role',
          'display_name', p_row->'display_name',
          'nome', p_row->'nome',
          'supervisor_id', p_row->'supervisor_id',
          'vendedor_id', p_row->'vendedor_id'
        )
      );
    when 'aceite_digital' then
      return jsonb_strip_nulls(
        jsonb_build_object(
          'vendor_user_id', p_row->'vendor_user_id',
          'vendor_name', p_row->'vendor_name',
          'entry_date', p_row->'entry_date',
          'vidas', p_row->'vidas'
        )
      );
    else
      return jsonb_strip_nulls(
        p_row - array['created_at', 'updated_at', 'raw_row', 'dedupe_key']::text[]
      );
  end case;
end;
$$;

create or replace function public.audit_trim_payload(p_payload jsonb, p_max_chars integer default 220)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_key text;
  v_text text;
  v_value jsonb;
  v_result jsonb := '{}'::jsonb;
begin
  if p_payload is null then
    return null;
  end if;

  for v_key in select jsonb_object_keys(p_payload)
  loop
    v_value := p_payload -> v_key;

    if jsonb_typeof(v_value) = 'string' then
      v_text := p_payload ->> v_key;
      if char_length(v_text) > p_max_chars then
        v_result := v_result || jsonb_build_object(v_key, left(v_text, p_max_chars) || '...');
      else
        v_result := v_result || jsonb_build_object(v_key, v_text);
      end if;
    else
      v_result := v_result || jsonb_build_object(v_key, v_value);
    end if;
  end loop;

  return jsonb_strip_nulls(v_result);
end;
$$;

create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_record_id text;
  v_old jsonb;
  v_new jsonb;
  v_old_diff jsonb := '{}'::jsonb;
  v_new_diff jsonb := '{}'::jsonb;
  v_key text;
begin
  -- Avoid recursive noise caused by chained triggers.
  if pg_trigger_depth() > 1 then
    if TG_OP = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_user_id := auth.uid();
  v_user_name := current_display_name();

  if TG_OP = 'INSERT' then
    v_record_id := coalesce(new.id::text, null);
    v_new := public.audit_trim_payload(public.audit_row_projection(TG_TABLE_NAME, to_jsonb(new)));

    if coalesce(v_new, '{}'::jsonb) = '{}'::jsonb then
      return new;
    end if;

    insert into public.audit_logs (table_name, action, record_id, user_id, user_name, new_data)
    values (TG_TABLE_NAME, TG_OP, v_record_id, v_user_id, v_user_name, v_new);
    return new;
  elsif TG_OP = 'UPDATE' then
    v_record_id := coalesce(new.id::text, old.id::text, null);
    v_old := public.audit_trim_payload(public.audit_row_projection(TG_TABLE_NAME, to_jsonb(old)));
    v_new := public.audit_trim_payload(public.audit_row_projection(TG_TABLE_NAME, to_jsonb(new)));

    for v_key in
      select key
      from (
        select jsonb_object_keys(coalesce(v_old, '{}'::jsonb)) as key
        union
        select jsonb_object_keys(coalesce(v_new, '{}'::jsonb)) as key
      ) keys
    loop
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_old_diff := v_old_diff || jsonb_build_object(v_key, v_old -> v_key);
        v_new_diff := v_new_diff || jsonb_build_object(v_key, v_new -> v_key);
      end if;
    end loop;

    if v_old_diff = '{}'::jsonb and v_new_diff = '{}'::jsonb then
      return new;
    end if;

    insert into public.audit_logs (table_name, action, record_id, user_id, user_name, old_data, new_data)
    values (TG_TABLE_NAME, TG_OP, v_record_id, v_user_id, v_user_name, v_old_diff, v_new_diff);
    return new;
  elsif TG_OP = 'DELETE' then
    v_record_id := coalesce(old.id::text, null);
    v_old := public.audit_trim_payload(public.audit_row_projection(TG_TABLE_NAME, to_jsonb(old)));

    if coalesce(v_old, '{}'::jsonb) = '{}'::jsonb then
      return old;
    end if;

    insert into public.audit_logs (table_name, action, record_id, user_id, user_name, old_data)
    values (TG_TABLE_NAME, TG_OP, v_record_id, v_user_id, v_user_name, v_old);
    return old;
  end if;

  return null;
exception
  when others then
    if TG_OP = 'DELETE' then
      return old;
    end if;
    return new;
end;
$$;

create or replace function public.prune_audit_logs(
  p_keep_days integer default 14,
  p_keep_rows integer default 75000
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.audit_logs
  where created_at < now() - make_interval(days => p_keep_days);

  delete from public.audit_logs
  where id in (
    select id
    from public.audit_logs
    order by created_at desc
    offset p_keep_rows
  );
end;
$$;

-- One-time compaction to reclaim space now.
do $$
begin
  create temporary table tmp_audit_logs_keep on commit drop as
  select *
  from public.audit_logs
  where created_at >= now() - interval '14 days'
  order by created_at desc
  limit 75000;

  truncate table public.audit_logs;

  insert into public.audit_logs (
    id,
    table_name,
    action,
    record_id,
    user_id,
    user_name,
    old_data,
    new_data,
    created_at
  )
  select
    id,
    table_name,
    action,
    record_id,
    user_id,
    user_name,
    public.audit_trim_payload(public.audit_row_projection(table_name, old_data)),
    public.audit_trim_payload(public.audit_row_projection(table_name, new_data)),
    created_at
  from tmp_audit_logs_keep
  order by created_at;
end $$;

drop index if exists public.audit_logs_user_idx;

do $$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
  from cron.job
  where jobname = 'prune-audit-logs'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'prune-audit-logs',
    '17 3 * * *',
    $job$select public.prune_audit_logs(14, 75000);$job$
  );
exception
  when undefined_table then
    null;
  when undefined_function then
    null;
  when invalid_schema_name then
    null;
  when insufficient_privilege then
    null;
end $$;
