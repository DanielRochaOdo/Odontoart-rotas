-- Fix the filtered Agenda ordering path where visit_generated_at conflicts
-- with the output column of get_rotas_agenda_first_page_v2.

do $$
declare
  v_function_definition text;
begin
  if to_regprocedure('public.get_rotas_agenda_first_page_v2(integer,integer,jsonb,text,text)') is not null then
    select pg_get_functiondef('public.get_rotas_agenda_first_page_v2(integer,integer,jsonb,text,text)'::regprocedure)
    into v_function_definition;

    v_function_definition := replace(
      v_function_definition,
      'from public.get_rotas_agenda_filtered_v2(p_filters, p_company_name, p_company_code)',
      'from public.get_rotas_agenda_filtered_v2(p_filters, p_company_name, p_company_code) as agenda_rows'
    );
    v_function_definition := replace(
      v_function_definition,
      'order by (visit_generated_at is not null) desc, (data_da_ultima_visita is null) desc, data_da_ultima_visita asc nulls last, id asc',
      'order by (agenda_rows.visit_generated_at is not null) desc, (agenda_rows.data_da_ultima_visita is null) desc, agenda_rows.data_da_ultima_visita asc nulls last, agenda_rows.id asc'
    );

    execute v_function_definition;
  end if;
end;
$$;
