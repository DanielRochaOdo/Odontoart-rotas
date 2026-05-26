-- Empresas RPCs v1 (list + real count)
-- Mirrors current UI filters: search, searchMode, situacao.
-- Security invoker keeps RLS behavior.

create or replace function public.get_empresas_first_page_v1(
  p_page_size integer default 50,
  p_page_offset integer default 0,
  p_search text default null,
  p_search_mode text default 'codigo',
  p_situacao text default null
)
returns table (
  id uuid,
  codigo text,
  empresa text,
  pessoa text,
  contato text,
  grupo text,
  perfil_visita text,
  situacao text,
  cep text,
  cidade text,
  uf text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
with p as (
  select
    nullif(btrim(coalesce(p_search, '')), '') as search_term,
    lower(coalesce(nullif(btrim(p_search_mode), ''), 'codigo')) as search_mode,
    nullif(btrim(coalesce(p_situacao, '')), '') as situacao_term
)
select
  c.id,
  c.codigo,
  c.empresa,
  c.pessoa,
  c.contato,
  c.grupo,
  c.perfil_visita,
  c.situacao,
  c.cep,
  c.cidade,
  c.uf,
  c.created_at
from public.clientes c
cross join p
where
  (p.situacao_term is null or c.situacao = p.situacao_term)
  and (
    p.search_term is null
    or (
      p.search_mode = 'codigo'
      and c.codigo = p.search_term
    )
    or (
      p.search_mode = 'empresa'
      and c.empresa ilike ('%' || p.search_term || '%')
    )
    or (
      p.search_mode = 'geral'
      and (
        c.codigo ilike ('%' || p.search_term || '%')
        or c.cep ilike ('%' || p.search_term || '%')
        or c.empresa ilike ('%' || p.search_term || '%')
        or c.nome_fantasia ilike ('%' || p.search_term || '%')
        or c.pessoa ilike ('%' || p.search_term || '%')
        or c.contato ilike ('%' || p.search_term || '%')
        or c.grupo ilike ('%' || p.search_term || '%')
        or c.obs_comercial ilike ('%' || p.search_term || '%')
        or c.obs ilike ('%' || p.search_term || '%')
        or c.situacao ilike ('%' || p.search_term || '%')
        or c.cidade ilike ('%' || p.search_term || '%')
        or c.uf ilike ('%' || p.search_term || '%')
        or c.bairro ilike ('%' || p.search_term || '%')
      )
    )
  )
order by c.empresa asc nulls last, c.id asc
offset greatest(0, p_page_offset)
limit greatest(1, p_page_size);
$$;

grant execute on function public.get_empresas_first_page_v1(integer, integer, text, text, text) to authenticated;

create or replace function public.get_empresas_count_v1(
  p_search text default null,
  p_search_mode text default 'codigo',
  p_situacao text default null
)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
with p as (
  select
    nullif(btrim(coalesce(p_search, '')), '') as search_term,
    lower(coalesce(nullif(btrim(p_search_mode), ''), 'codigo')) as search_mode,
    nullif(btrim(coalesce(p_situacao, '')), '') as situacao_term
)
select count(*)::bigint
from public.clientes c
cross join p
where
  (p.situacao_term is null or c.situacao = p.situacao_term)
  and (
    p.search_term is null
    or (
      p.search_mode = 'codigo'
      and c.codigo = p.search_term
    )
    or (
      p.search_mode = 'empresa'
      and c.empresa ilike ('%' || p.search_term || '%')
    )
    or (
      p.search_mode = 'geral'
      and (
        c.codigo ilike ('%' || p.search_term || '%')
        or c.cep ilike ('%' || p.search_term || '%')
        or c.empresa ilike ('%' || p.search_term || '%')
        or c.nome_fantasia ilike ('%' || p.search_term || '%')
        or c.pessoa ilike ('%' || p.search_term || '%')
        or c.contato ilike ('%' || p.search_term || '%')
        or c.grupo ilike ('%' || p.search_term || '%')
        or c.obs_comercial ilike ('%' || p.search_term || '%')
        or c.obs ilike ('%' || p.search_term || '%')
        or c.situacao ilike ('%' || p.search_term || '%')
        or c.cidade ilike ('%' || p.search_term || '%')
        or c.uf ilike ('%' || p.search_term || '%')
        or c.bairro ilike ('%' || p.search_term || '%')
      )
    )
  );
$$;

grant execute on function public.get_empresas_count_v1(text, text, text) to authenticated;

-- Rollback
-- drop function if exists public.get_empresas_count_v1(text, text, text);
-- drop function if exists public.get_empresas_first_page_v1(integer, integer, text, text, text);
