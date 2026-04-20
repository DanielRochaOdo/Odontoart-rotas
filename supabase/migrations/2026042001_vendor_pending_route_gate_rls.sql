create or replace function public.vendor_has_pending_before(p_target_date date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_display_name text := public.current_display_name();
  v_has_pending boolean := false;
begin
  if v_uid is null or p_target_date is null then
    return false;
  end if;

  select exists (
    select 1
    from public.visits v
    where v.completed_at is null
      and v.visit_date < p_target_date
      and (
        coalesce(v.visit_type, 'VENDEDOR') = 'VENDEDOR'
      )
      and (
        v.assigned_to_user_id = v_uid
        or (
          v_display_name is not null
          and v.assigned_to_name = v_display_name
        )
      )
  )
  into v_has_pending;

  return coalesce(v_has_pending, false);
end;
$$;

grant execute on function public.vendor_has_pending_before(date) to authenticated;

drop policy if exists "Vendedor can read own visits" on public.visits;
create policy "Vendedor can read own visits" on public.visits
  for select
  using (
    public.is_vendedor()
    and (
      assigned_to_user_id = auth.uid()
      or assigned_to_name = public.current_display_name()
    )
    and not public.vendor_has_pending_before(visit_date)
  );

drop policy if exists "Vendedor can update own visits" on public.visits;
create policy "Vendedor can update own visits" on public.visits
  for update
  using (
    public.is_vendedor()
    and (
      assigned_to_user_id = auth.uid()
      or assigned_to_name = public.current_display_name()
    )
    and not public.vendor_has_pending_before(visit_date)
  )
  with check (
    public.is_vendedor()
    and (
      assigned_to_user_id = auth.uid()
      or assigned_to_name = public.current_display_name()
    )
    and not public.vendor_has_pending_before(visit_date)
  );
