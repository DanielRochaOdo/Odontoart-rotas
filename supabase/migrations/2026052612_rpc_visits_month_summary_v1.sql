-- Visits monthly summary RPC to replace heavy paginated embed query.
-- Uses [month_start, month_end_exclusive) interval.

create or replace function public.get_visits_month_summary_v1(
  p_month_start date,
  p_month_end_exclusive date,
  p_assigned_to_user_id uuid default null,
  p_visit_type text default null,
  p_completed_only boolean default null
)
returns table (
  visit_day date,
  total_visits bigint,
  completed_visits bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    v.visit_date as visit_day,
    count(*)::bigint as total_visits,
    count(*) filter (where v.completed_at is not null)::bigint as completed_visits
  from public.visits v
  where
    v.visit_date >= p_month_start
    and v.visit_date < p_month_end_exclusive
    and (p_assigned_to_user_id is null or v.assigned_to_user_id = p_assigned_to_user_id)
    and (p_visit_type is null or v.visit_type = p_visit_type)
    and (
      p_completed_only is null
      or (p_completed_only = true and v.completed_at is not null)
      or (p_completed_only = false)
    )
  group by v.visit_date
  order by v.visit_date asc;
$$;

grant execute on function public.get_visits_month_summary_v1(date, date, uuid, text, boolean) to authenticated;

-- Rollback
-- drop function if exists public.get_visits_month_summary_v1(date, date, uuid, text, boolean);
