-- Optional aggregate layer for fast dashboard reads (run on DASHBOARD Supabase)

create table if not exists public.dash_kpi_daily (
  day date primary key,
  total_visits integer not null default 0,
  completed_visits integer not null default 0,
  no_visit_count integer not null default 0,
  visit_vidas_total numeric not null default 0,
  aceite_vidas_total numeric not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.refresh_dash_kpi_daily(p_from date default null, p_to date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := coalesce(p_from, current_date - interval '120 days');
  v_to date := coalesce(p_to, current_date);
begin
  delete from public.dash_kpi_daily
  where day between v_from and v_to;

  insert into public.dash_kpi_daily(day, total_visits, completed_visits, no_visit_count, visit_vidas_total, aceite_vidas_total, updated_at)
  select
    d.day,
    coalesce(v.total_visits, 0),
    coalesce(v.completed_visits, 0),
    coalesce(v.no_visit_count, 0),
    coalesce(v.visit_vidas_total, 0),
    coalesce(a.aceite_vidas_total, 0),
    now()
  from (
    select generate_series(v_from, v_to, interval '1 day')::date as day
  ) d
  left join (
    select
      visit_date as day,
      count(*)::int as total_visits,
      count(*) filter (where completed_at is not null)::int as completed_visits,
      count(*) filter (where no_visit_reason is not null)::int as no_visit_count,
      coalesce(sum(completed_vidas), 0)::numeric as visit_vidas_total
    from public.dash_visits
    where visit_date between v_from and v_to
      and deleted_at is null
    group by visit_date
  ) v on v.day = d.day
  left join (
    select
      entry_date as day,
      coalesce(sum(vidas), 0)::numeric as aceite_vidas_total
    from public.dash_aceite_digital
    where entry_date between v_from and v_to
      and deleted_at is null
    group by entry_date
  ) a on a.day = d.day;
end;
$$;
