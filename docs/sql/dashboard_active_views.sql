-- Active-only views for dashboard frontend reads

create or replace view public.v_dash_visits_active as
select *
from public.dash_visits
where deleted_at is null;

create or replace view public.v_dash_aceite_digital_active as
select *
from public.dash_aceite_digital
where deleted_at is null;

create or replace view public.v_dash_clientes_active as
select *
from public.dash_clientes
where deleted_at is null;

create or replace view public.v_dash_profiles_active as
select *
from public.dash_profiles
where deleted_at is null;

create or replace view public.v_dashboard_sync_health as
select
  max(case when status = 'ok' then finished_at end) as last_success_at,
  max(started_at) as last_started_at,
  max(finished_at) as last_finished_at
from public.dashboard_sync_runs;
