-- Empresas count fast-path for vendor scope to avoid timeout under RLS-heavy full scan.

create or replace function public.get_empresas_count_v1(
  p_search text default null,
  p_search_mode text default 'codigo',
  p_situacao text default null
)
returns bigint
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_mode text := lower(coalesce(nullif(btrim(p_search_mode), ''), 'codigo'));
  v_situacao text := nullif(btrim(coalesce(p_situacao, '')), '');
  v_total bigint;
  v_display_name text := public.current_display_name();
begin
  -- Vendor path: derive visible clientes from visits assignment set first.
  -- This avoids scanning all clientes rows when RLS policy for vendor is exists(visits...).
  if public.is_vendedor() then
    if v_search is null then
      select count(*)::bigint
      into v_total
      from (
        select c.id
        from public.visits v
        join public.clientes c on c.id = v.cliente_id
        where (
          v.assigned_to_user_id = auth.uid()
          or (
            v.assigned_to_name is not null
            and v_display_name is not null
            and public.normalize_upper(v.assigned_to_name) = public.normalize_upper(v_display_name)
          )
        )
          and (v_situacao is null or c.situacao = v_situacao)
        group by c.id
      ) s;
      return coalesce(v_total, 0);
    end if;

    if v_mode = 'codigo' then
      select count(*)::bigint
      into v_total
      from (
        select c.id
        from public.visits v
        join public.clientes c on c.id = v.cliente_id
        where (
          v.assigned_to_user_id = auth.uid()
          or (
            v.assigned_to_name is not null
            and v_display_name is not null
            and public.normalize_upper(v.assigned_to_name) = public.normalize_upper(v_display_name)
          )
        )
          and (v_situacao is null or c.situacao = v_situacao)
          and c.codigo = v_search
        group by c.id
      ) s;
      return coalesce(v_total, 0);
    end if;

    if v_mode = 'empresa' then
      select count(*)::bigint
      into v_total
      from (
        select c.id
        from public.visits v
        join public.clientes c on c.id = v.cliente_id
        where (
          v.assigned_to_user_id = auth.uid()
          or (
            v.assigned_to_name is not null
            and v_display_name is not null
            and public.normalize_upper(v.assigned_to_name) = public.normalize_upper(v_display_name)
          )
        )
          and (v_situacao is null or c.situacao = v_situacao)
          and c.empresa ilike ('%' || v_search || '%')
        group by c.id
      ) s;
      return coalesce(v_total, 0);
    end if;
  end if;

  -- Non-vendor (or generic) path.
  if v_search is null then
    if v_situacao is null then
      select count(*)::bigint into v_total from public.clientes c;
    else
      select count(*)::bigint into v_total from public.clientes c where c.situacao = v_situacao;
    end if;
    return coalesce(v_total, 0);
  end if;

  if v_mode = 'codigo' then
    select count(*)::bigint
    into v_total
    from public.clientes c
    where (v_situacao is null or c.situacao = v_situacao)
      and c.codigo = v_search;
    return coalesce(v_total, 0);
  end if;

  if v_mode = 'empresa' then
    select count(*)::bigint
    into v_total
    from public.clientes c
    where (v_situacao is null or c.situacao = v_situacao)
      and c.empresa ilike ('%' || v_search || '%');
    return coalesce(v_total, 0);
  end if;

  select count(*)::bigint
  into v_total
  from public.clientes c
  where (v_situacao is null or c.situacao = v_situacao)
    and (
      c.codigo ilike ('%' || v_search || '%')
      or c.cep ilike ('%' || v_search || '%')
      or c.empresa ilike ('%' || v_search || '%')
      or c.nome_fantasia ilike ('%' || v_search || '%')
      or c.pessoa ilike ('%' || v_search || '%')
      or c.contato ilike ('%' || v_search || '%')
      or c.grupo ilike ('%' || v_search || '%')
      or c.obs_comercial ilike ('%' || v_search || '%')
      or c.obs ilike ('%' || v_search || '%')
      or c.situacao ilike ('%' || v_search || '%')
      or c.cidade ilike ('%' || v_search || '%')
      or c.uf ilike ('%' || v_search || '%')
      or c.bairro ilike ('%' || v_search || '%')
    );

  return coalesce(v_total, 0);
end;
$$;

-- Rollback
-- Re-apply definition from 2026052614_rpc_perf_hotfix.sql.
