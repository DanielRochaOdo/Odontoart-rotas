-- Evaluate the vendor's route gate once per SQL statement instead of once per
-- visit row. Keep the same role and route visibility rules as the prior policies.

drop policy if exists "Supervisor or assistente full access on visits" on public.visits;
drop policy if exists "Vendedor can read own visits" on public.visits;
drop policy if exists "Vendedor can update own visits" on public.visits;

create policy "Visits select by role and route gate"
  on public.visits
  for select
  using (
    (select public.is_supervisor())
    or (select public.is_assistente())
    or (
      (select public.is_vendedor())
      and (
        assigned_to_user_id = (select auth.uid())
        or assigned_to_name = (select public.current_display_name())
      )
      and visit_date <= (
        select gate.max_visible_date
        from public.vendor_agenda_visibility_state() as gate
      )
    )
  );

create policy "Visits insert by supervisor or assistente"
  on public.visits
  for insert
  with check (
    (select public.is_supervisor())
    or (select public.is_assistente())
  );

create policy "Visits update by role and route gate"
  on public.visits
  for update
  using (
    (select public.is_supervisor())
    or (select public.is_assistente())
    or (
      (select public.is_vendedor())
      and (
        assigned_to_user_id = (select auth.uid())
        or assigned_to_name = (select public.current_display_name())
      )
      and visit_date <= (
        select gate.max_visible_date
        from public.vendor_agenda_visibility_state() as gate
      )
    )
  )
  with check (
    (select public.is_supervisor())
    or (select public.is_assistente())
    or (
      (select public.is_vendedor())
      and (
        assigned_to_user_id = (select auth.uid())
        or assigned_to_name = (select public.current_display_name())
      )
      and visit_date <= (
        select gate.max_visible_date
        from public.vendor_agenda_visibility_state() as gate
      )
    )
  );

create policy "Visits delete by supervisor or assistente"
  on public.visits
  for delete
  using (
    (select public.is_supervisor())
    or (select public.is_assistente())
  );
