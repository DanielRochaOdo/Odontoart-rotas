-- Run in the DASHBOARD database (PostgreSQL 15+), after dashboard_active_views.sql.
-- Ordinary view: no persisted aggregates, refresh job or history deletion.
-- Invoker privileges preserve the existing active-view access boundary.
create or replace view public.v_dash_visits_monthly_lives
with (security_invoker = true) as
select
  date_trunc('month', visit_date::timestamp)::date as visit_date,
  assigned_to_user_id,
  assigned_to_name,
  sum(completed_vidas) as completed_vidas
from public.v_dash_visits_active
where visit_date is not null and completed_vidas > 0
group by 1, 2, 3;

revoke all on public.v_dash_visits_monthly_lives from public, anon, authenticated, service_role;

-- Only grant to roles already allowed to read the source view.
do $$
declare v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_role, 'public.v_dash_visits_active', 'SELECT') then
      execute format('grant select on public.v_dash_visits_monthly_lives to %I', v_role);
    end if;
  end loop;
end;
$$;
