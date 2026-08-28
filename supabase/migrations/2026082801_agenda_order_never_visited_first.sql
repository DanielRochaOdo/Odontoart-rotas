-- Define a ordem padrão da Agenda:
-- 1. empresas com visita agendada;
-- 2. empresas nunca visitadas;
-- 3. última visita da mais antiga para a mais recente;
-- 4. id da empresa como desempate estável.

do $$
declare
  v_function_definition text;
begin
  if to_regprocedure('public.get_rotas_agenda_first_page_v2(integer,integer,jsonb,text,text)') is not null then
    select pg_get_functiondef('public.get_rotas_agenda_first_page_v2(integer,integer,jsonb,text,text)'::regprocedure)
    into v_function_definition;

    v_function_definition := replace(
      v_function_definition,
      'order by c.visit_generated_at desc nulls last, c.data_da_ultima_visita desc nulls last, c.id asc',
      'order by (c.visit_generated_at is not null) desc, (c.data_da_ultima_visita is null) desc, c.data_da_ultima_visita asc nulls last, c.id asc'
    );
    v_function_definition := replace(
      v_function_definition,
      'order by visit_generated_at desc nulls last, data_da_ultima_visita desc nulls last, id asc',
      'order by (visit_generated_at is not null) desc, (data_da_ultima_visita is null) desc, data_da_ultima_visita asc nulls last, id asc'
    );

    execute v_function_definition;
  end if;
end;
$$;
