-- Enforce the Agenda visibility rules for vendors in the database.
-- A route date is visible from 19:00 Fortaleza time on its previous calendar day,
-- provided all earlier route dates have their visits and required digital acceptance recorded.

create index if not exists visits_vendor_gate_user_date_idx
  on public.visits (assigned_to_user_id, visit_date)
  where coalesce(visit_type, 'VENDEDOR') = 'VENDEDOR';

create index if not exists visits_vendor_gate_name_date_idx
  on public.visits (assigned_to_name, visit_date);

create or replace function public.vendor_agenda_can_view_date(p_target_date date)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_display_name text := public.current_display_name();
  v_local_now timestamp without time zone := timezone('America/Fortaleza', now());
  v_today date := v_local_now::date;
begin
  if v_uid is null or p_target_date is null or not public.is_vendedor() then
    return false;
  end if;

  if v_local_now < ((p_target_date - 1) + time '19:00') then
    return false;
  end if;

  if exists (
    select 1
    from public.visits v
    where v.visit_date < p_target_date
      and v.visit_date <= v_today
      and coalesce(v.visit_type, 'VENDEDOR') = 'VENDEDOR'
      and (
        v.assigned_to_user_id = v_uid
        or (
          v_display_name is not null
          and v.assigned_to_name = v_display_name
        )
      )
      and v.completed_at is null
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.visits v
    where v.visit_date < p_target_date
      and v.visit_date <= v_today
      and coalesce(v.visit_type, 'VENDEDOR') = 'VENDEDOR'
      and (
        v.assigned_to_user_id = v_uid
        or (
          v_display_name is not null
          and v.assigned_to_name = v_display_name
        )
      )
      and not exists (
        select 1
        from public.aceite_digital a
        where a.vendor_user_id = v_uid
          and a.entry_date = v.visit_date
      )
  ) then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.vendor_agenda_visibility_state()
returns table (
  max_visible_date date,
  pending_route_date date,
  pending_acceptance_date date,
  release_limit_date date,
  block_message text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_display_name text := public.current_display_name();
  v_local_now timestamp without time zone := timezone('America/Fortaleza', now());
  v_today date := v_local_now::date;
  v_release_limit date;
  v_pending_route date;
  v_pending_acceptance date;
  v_block_date date;
  v_max_visible date;
  v_message text := null;
begin
  if v_uid is null or not public.is_vendedor() then
    return query select null::date, null::date, null::date, null::date, null::text;
    return;
  end if;

  v_release_limit := v_today + case when v_local_now::time >= time '19:00' then 1 else 0 end;

  select min(v.visit_date)
  into v_pending_route
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
    and v.completed_at is null;

  select min(required_dates.visit_date)
  into v_pending_acceptance
  from (
    select v.visit_date
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
  ) required_dates
  where not exists (
    select 1
    from public.aceite_digital a
    where a.vendor_user_id = v_uid
      and a.entry_date = required_dates.visit_date
  );

  v_block_date := least(v_pending_route, v_pending_acceptance);
  v_max_visible := least(coalesce(v_block_date, v_release_limit), v_release_limit);

  if v_block_date is not null and v_block_date <= v_release_limit then
    if v_pending_route is not null
      and (v_pending_acceptance is null or v_pending_route <= v_pending_acceptance) then
      v_message := format(
        'Conclua todas as visitas da rota de %s para liberar as proximas rotas.',
        to_char(v_pending_route, 'DD/MM/YYYY')
      );
    else
      v_message := format(
        'Registre o Aceite Digital da rota de %s para liberar as proximas rotas.',
        to_char(v_pending_acceptance, 'DD/MM/YYYY')
      );
    end if;
  elsif v_local_now::time < time '19:00' then
    v_message := format(
      'A rota de %s sera liberada a partir das 19:00 de %s.',
      to_char(v_today + 1, 'DD/MM/YYYY'),
      to_char(v_today, 'DD/MM/YYYY')
    );
  end if;

  return query
  select v_max_visible, v_pending_route, v_pending_acceptance, v_release_limit, v_message;
end;
$$;

create or replace function public.vendor_agenda_can_register_acceptance(p_entry_date date)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    auth.uid() is not null
    and public.is_vendedor()
    and p_entry_date is not null
    and p_entry_date <= (timezone('America/Fortaleza', now()))::date
    and public.vendor_agenda_can_view_date(p_entry_date)
    and exists (
      select 1
      from public.visits v
      where v.visit_date = p_entry_date
        and coalesce(v.visit_type, 'VENDEDOR') = 'VENDEDOR'
        and (
          v.assigned_to_user_id = auth.uid()
          or (
            public.current_display_name() is not null
            and v.assigned_to_name = public.current_display_name()
          )
        )
    )
    and not exists (
      select 1
      from public.aceite_digital a
      where a.vendor_user_id = auth.uid()
        and a.entry_date = p_entry_date
    );
$$;

revoke all on function public.vendor_agenda_can_view_date(date) from public;
revoke all on function public.vendor_agenda_visibility_state() from public;
revoke all on function public.vendor_agenda_can_register_acceptance(date) from public;
grant execute on function public.vendor_agenda_can_view_date(date) to authenticated;
grant execute on function public.vendor_agenda_visibility_state() to authenticated;
grant execute on function public.vendor_agenda_can_register_acceptance(date) to authenticated;

drop policy if exists "Vendedor can read own visits" on public.visits;
create policy "Vendedor can read own visits" on public.visits
  for select
  using (
    public.is_vendedor()
    and (
      assigned_to_user_id = auth.uid()
      or (
        assigned_to_name = public.current_display_name()
      )
    )
    and public.vendor_agenda_can_view_date(visit_date)
  );

drop policy if exists "Vendedor can update own visits" on public.visits;
create policy "Vendedor can update own visits" on public.visits
  for update
  using (
    public.is_vendedor()
    and (
      assigned_to_user_id = auth.uid()
      or (
        assigned_to_name = public.current_display_name()
      )
    )
    and public.vendor_agenda_can_view_date(visit_date)
  )
  with check (
    public.is_vendedor()
    and (
      assigned_to_user_id = auth.uid()
      or (
        assigned_to_name = public.current_display_name()
      )
    )
    and public.vendor_agenda_can_view_date(visit_date)
  );

drop policy if exists "Vendedor can insert own aceite digital" on public.aceite_digital;
create policy "Vendedor can insert own aceite digital" on public.aceite_digital
  for insert
  with check (
    public.is_vendedor()
    and vendor_user_id = auth.uid()
    and public.vendor_agenda_can_register_acceptance(entry_date)
  );
