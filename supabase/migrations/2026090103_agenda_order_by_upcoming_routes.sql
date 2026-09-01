-- Prioritize only routes that are still scheduled to happen.
-- Historical visits/routes must not receive this priority.

do $$
declare
  v_function_definition text;
  v_current_route_priority text := '(c.visit_generated_at is not null or exists (select 1 from public.visits v where v.cliente_id = c.id and v.route_id is not null) or exists (select 1 from public.route_stops rs where rs.cliente_id = c.id and rs.route_id is not null))';
  v_current_filtered_route_priority text := '(agenda_rows.visit_generated_at is not null or exists (select 1 from public.visits v where v.cliente_id = agenda_rows.id and v.route_id is not null) or exists (select 1 from public.route_stops rs where rs.cliente_id = agenda_rows.id and rs.route_id is not null))';
  v_upcoming_route_priority text := '(exists (select 1 from public.visits v where v.cliente_id = c.id and v.route_id is not null and v.completed_at is null and v.visit_date >= (now() at time zone ''America/Fortaleza'')::date))';
  v_upcoming_filtered_route_priority text := '(exists (select 1 from public.visits v where v.cliente_id = agenda_rows.id and v.route_id is not null and v.completed_at is null and v.visit_date >= (now() at time zone ''America/Fortaleza'')::date))';
begin
  if to_regprocedure('public.get_rotas_agenda_first_page_v2(integer,integer,jsonb,text,text)') is not null then
    select pg_get_functiondef('public.get_rotas_agenda_first_page_v2(integer,integer,jsonb,text,text)'::regprocedure)
    into v_function_definition;

    v_function_definition := replace(
      v_function_definition,
      v_current_route_priority,
      v_upcoming_route_priority
    );
    v_function_definition := replace(
      v_function_definition,
      v_current_filtered_route_priority,
      v_upcoming_filtered_route_priority
    );
    v_function_definition := replace(
      v_function_definition,
      '(c.visit_generated_at is not null)',
      v_upcoming_route_priority
    );
    v_function_definition := replace(
      v_function_definition,
      '(agenda_rows.visit_generated_at is not null)',
      v_upcoming_filtered_route_priority
    );

    execute v_function_definition;
  end if;
end;
$$;
