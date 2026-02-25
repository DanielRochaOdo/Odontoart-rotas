with clientes_base as (
  select
    c.id,
    nullif(trim(c.empresa), '') as empresa,
    nullif(trim(c.nome_fantasia), '') as nome_fantasia,
    c.perfil_visita,
    c.endereco,
    c.bairro,
    c.cidade,
    c.uf,
    c.codigo,
    coalesce(c.situacao, 'Ativo') as situacao,
    regexp_replace(lower(coalesce(c.empresa, '')), '\s+', ' ', 'g') as empresa_key,
    regexp_replace(lower(coalesce(c.nome_fantasia, '')), '\s+', ' ', 'g') as fantasia_key
  from public.clientes c
  where c.empresa is not null or c.nome_fantasia is not null
),
to_insert as (
  select *
  from clientes_base cb
  where not exists (
    select 1
    from public.agenda a
    where regexp_replace(lower(coalesce(a.empresa, '')), '\s+', ' ', 'g') = cb.empresa_key
      and regexp_replace(lower(coalesce(a.nome_fantasia, '')), '\s+', ' ', 'g') = cb.fantasia_key
  )
)
insert into public.agenda (
  empresa,
  nome_fantasia,
  perfil_visita,
  endereco,
  bairro,
  cidade,
  uf,
  cod_1,
  situacao,
  dedupe_key,
  raw_row
)
select
  empresa,
  nome_fantasia,
  perfil_visita,
  endereco,
  bairro,
  cidade,
  uf,
  codigo,
  situacao,
  empresa_key || '|' || fantasia_key || '||',
  jsonb_build_object('source', 'clientes', 'cliente_id', id)
from to_insert
on conflict (dedupe_key) do nothing;
