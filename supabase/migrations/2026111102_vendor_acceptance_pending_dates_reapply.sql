-- Correcao de versao: no Supabase remoto, 2026111101 pertence a
-- kpi_monthly_ledger. A funcao de aceite nunca foi instalada, apesar de o
-- CLI mostrar 2026111101 como sincronizada (compara apenas a versao).
-- Esta nova migracao reutiliza o SQL idempotente sem editar historico remoto
-- nem alterar as politicas RLS da Agenda ou os aceites registrados.

-- Aceite Digital: listagem consistente das pendencias do vendedor autenticado.
-- A policy de public.visits bloqueia rotas futuras; consultar visits pelo
-- navegador escondia justamente as datas que o usuario precisa regularizar.
-- Esta funcao aplica a MESMA regra de datas de vendor_agenda_visibility_state:
-- toda data com visitas do vendedor ate hoje em America/Fortaleza requer aceite.
--
-- Nao altera RLS de visits, politica de insercao de aceite, limite das 19h
-- nem libera rotas. Nao aceita user_id como argumento e so revela datas do
-- vendedor autenticado. Retorna um unico JSON para nao sofrer paginacao 1000.

create or replace function public.vendor_acceptance_pending_dates_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_display_name text := public.current_display_name();
  v_today date := (timezone('America/Fortaleza', now()))::date;
  v_result jsonb;
begin
  if v_uid is null or not public.is_vendedor() then
    raise exception 'Acesso ao aceite digital restrito ao vendedor autenticado.'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entry_date', required.visit_date,
        'total_visits', required.total_visits,
        'unfinished_visits', required.unfinished_visits
      )
      order by required.visit_date
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      v.visit_date,
      count(*)::bigint as total_visits,
      count(*) filter (where v.completed_at is null)::bigint as unfinished_visits
    from public.visits v
    where v.visit_date <= v_today
      and coalesce(v.visit_type, 'VENDEDOR') = 'VENDEDOR'
      and (
        v.assigned_to_user_id = v_uid
        or (
          v_display_name is not null
          and v.assigned_to_name = v_display_name
        )
      )
    group by v.visit_date
  ) required
  where not exists (
    select 1
    from public.aceite_digital a
    where a.vendor_user_id = v_uid
      and a.entry_date = required.visit_date
  );

  return v_result;
end;
$$;

revoke all on function public.vendor_acceptance_pending_dates_v1()
  from public, anon;
grant execute on function public.vendor_acceptance_pending_dates_v1()
  to authenticated;

comment on function public.vendor_acceptance_pending_dates_v1() is
  'Datas sem aceite do vendedor autenticado, inclusive as ocultas pelo bloqueio das rotas. Retorna JSON ordenado, com total de visitas e visitas nao concluidas; nao altera permissoes.';
