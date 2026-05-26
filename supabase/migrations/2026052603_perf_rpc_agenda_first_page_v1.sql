-- RPC for lite first-page retrieval (phase 6)
-- Security invoker keeps RLS behavior intact.

create or replace function public.get_rotas_agenda_first_page_v1(
  p_page_index integer default 0,
  p_page_size integer default 25,
  p_company_name text default null,
  p_company_code text default null,
  p_situacao text[] default null
)
returns table (
  id uuid,
  data_da_ultima_visita timestamptz,
  visit_completed_vidas integer,
  cod_1 text,
  empresa text,
  pessoa text,
  contato text,
  perfil_visita text,
  corte integer,
  venc integer,
  valor numeric,
  endereco text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  supervisor text,
  vendedor text,
  nome_fantasia text,
  grupo text,
  situacao text,
  categoria text,
  visit_generated_at timestamptz,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      c.id,
      c.data_da_ultima_visita,
      c.visit_completed_vidas,
      c.codigo as cod_1,
      c.empresa,
      c.pessoa,
      c.contato,
      c.perfil_visita,
      c.corte,
      c.venc,
      c.valor,
      c.endereco,
      c.complemento,
      c.bairro,
      c.cidade,
      c.uf,
      c.supervisor,
      c.vendedor,
      c.nome_fantasia,
      c.grupo,
      c.situacao,
      c.categoria,
      c.visit_generated_at,
      c.created_at
    from public.clientes c
    where
      (p_company_code is null or c.codigo = p_company_code)
      and (p_company_name is null or c.empresa ilike ('%' || p_company_name || '%'))
      and (p_situacao is null or cardinality(p_situacao) = 0 or c.situacao = any(p_situacao))
  )
  select *
  from base
  order by visit_generated_at desc nulls last, data_da_ultima_visita desc nulls last
  offset greatest(0, p_page_index) * greatest(1, p_page_size)
  limit greatest(1, p_page_size);
$$;

grant execute on function public.get_rotas_agenda_first_page_v1(integer, integer, text, text, text[]) to authenticated;

-- Rollback:
-- drop function if exists public.get_rotas_agenda_first_page_v1(integer, integer, text, text, text[]);
