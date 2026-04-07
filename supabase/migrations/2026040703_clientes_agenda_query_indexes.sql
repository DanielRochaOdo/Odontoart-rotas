create index if not exists clientes_agenda_situacao_visit_generated_idx
  on public.clientes (
    situacao,
    visit_generated_at desc nulls last,
    data_da_ultima_visita desc nulls last,
    id desc
  );

create index if not exists clientes_agenda_visit_generated_idx
  on public.clientes (
    visit_generated_at desc nulls last,
    data_da_ultima_visita desc nulls last,
    id desc
  );

create index if not exists clientes_codigo_idx
  on public.clientes (codigo);
