drop policy if exists "Vendedor read own agenda" on public.agenda;
create policy "Vendedor read own agenda" on public.agenda
  for select
  using (
    is_vendedor()
    and vendedor = current_display_name()
    and (
      data_da_ultima_visita is null
      or data_da_ultima_visita::date <= (now() at time zone 'America/Fortaleza')::date
    )
  );

drop policy if exists "Vendedor can update own visits" on public.agenda;
create policy "Vendedor can update own visits" on public.agenda
  for update
  using (
    is_vendedor()
    and vendedor = current_display_name()
    and visit_generated_at is not null
  )
  with check (
    is_vendedor()
    and vendedor = current_display_name()
    and visit_generated_at is not null
  );

alter table public.agenda
  drop column if exists consultor;

drop index if exists agenda_consultor_idx;
