alter table public.agenda
  add column if not exists visit_completed_at timestamptz,
  add column if not exists visit_completed_vidas integer;

drop policy if exists "Vendedor can update own visits" on public.agenda;
create policy "Vendedor can update own visits" on public.agenda
  for update
  using (
    is_vendedor()
    and (
      vendedor = current_display_name()
      or consultor = current_display_name()
    )
    and visit_generated_at is not null
  )
  with check (
    is_vendedor()
    and (
      vendedor = current_display_name()
      or consultor = current_display_name()
    )
    and visit_generated_at is not null
  );
