-- Corrige a visibilidade da Agenda para empresas que ainda aguardam liberacao.
-- A fila passou a distinguir RELEASE_PENDING de READY_AUTO em 2026-06-02,
-- mas os RPCs otimizados da Agenda continuavam exibindo essa situacao.

do $$
declare
  v_function_definition text;
begin
  if to_regprocedure('public.get_rotas_agenda_filtered_v2(jsonb,text,text)') is not null then
    select pg_get_functiondef('public.get_rotas_agenda_filtered_v2(jsonb,text,text)'::regprocedure)
    into v_function_definition;

    v_function_definition := replace(
      v_function_definition,
      'q.effective_state in (''PENDING_WAIT'', ''BLOCKED_MANUAL'')',
      'q.effective_state in (''PENDING_WAIT'', ''RELEASE_PENDING'', ''BLOCKED_MANUAL'')'
    );

    execute v_function_definition;
  end if;

  if to_regprocedure('public.get_rotas_agenda_first_page_v2(integer,integer,jsonb,text,text)') is not null then
    select pg_get_functiondef('public.get_rotas_agenda_first_page_v2(integer,integer,jsonb,text,text)'::regprocedure)
    into v_function_definition;

    v_function_definition := replace(
      v_function_definition,
      'or (q.state <> ''RELEASED_MANUAL'' and q.eligible_at > now())',
      'or (q.state <> ''RELEASED_MANUAL'' and (q.eligible_at > now() or (q.eligible_at <= now() and q.eligible_at >= timestamptz ''2026-06-02 00:00:00-03'')))'
    );

    execute v_function_definition;
  end if;

  if to_regprocedure('public.get_rotas_agenda_count_v1(jsonb,text,text)') is not null then
    select pg_get_functiondef('public.get_rotas_agenda_count_v1(jsonb,text,text)'::regprocedure)
    into v_function_definition;

    v_function_definition := replace(
      v_function_definition,
      'or (q.state <> ''RELEASED_MANUAL'' and q.eligible_at > now())',
      'or (q.state <> ''RELEASED_MANUAL'' and (q.eligible_at > now() or (q.eligible_at <= now() and q.eligible_at >= timestamptz ''2026-06-02 00:00:00-03'')))'
    );

    execute v_function_definition;
  end if;
end;
$$;
