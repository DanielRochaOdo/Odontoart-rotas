drop policy if exists "Vendedor read own agenda" on public.agenda;

alter table public.agenda
  drop column if exists dt_mar_25,
  drop column if exists consultor_mar_25;

drop index if exists agenda_dt_mar_25_idx;

create policy "Vendedor read own agenda" on public.agenda
  for select
  using (
    is_vendedor()
    and (
      vendedor = current_display_name()
      or consultor = current_display_name()
    )
    and (
      data_da_ultima_visita is null
      or data_da_ultima_visita::date <= (now() at time zone 'America/Fortaleza')::date
    )
  );
