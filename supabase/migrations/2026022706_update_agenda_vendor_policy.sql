-- allow vendedor to read agenda rows linked to assigned visits

drop policy if exists "Vendedor read own agenda" on public.agenda;

create policy "Vendedor read own agenda" on public.agenda
  for select
  using (
    is_vendedor()
    and (
      (
        (vendedor = current_display_name())
        and (
          data_da_ultima_visita is null
          or data_da_ultima_visita::date <= (now() at time zone 'America/Fortaleza')::date
        )
      )
      or exists (
        select 1
        from public.visits v
        where v.agenda_id = agenda.id
          and (
            v.assigned_to_user_id = auth.uid()
            or v.assigned_to_name = current_display_name()
          )
      )
    )
  );
