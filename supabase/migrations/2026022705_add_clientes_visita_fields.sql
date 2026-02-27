-- add corte/venc/tit/data_da_ultima_visita to clientes
alter table public.clientes
  add column if not exists corte numeric,
  add column if not exists venc numeric,
  add column if not exists tit text,
  add column if not exists data_da_ultima_visita timestamptz;

with latest as (
  select distinct on (lower(coalesce(empresa, '')), lower(coalesce(nome_fantasia, '')))
    lower(coalesce(empresa, '')) as empresa_key,
    lower(coalesce(nome_fantasia, '')) as fantasia_key,
    corte,
    venc,
    tit,
    data_da_ultima_visita
  from public.agenda
  order by
    lower(coalesce(empresa, '')),
    lower(coalesce(nome_fantasia, '')),
    data_da_ultima_visita desc nulls last,
    created_at desc
)
update public.clientes c
set corte = latest.corte,
    venc = latest.venc,
    tit = latest.tit,
    data_da_ultima_visita = latest.data_da_ultima_visita
from latest
where lower(coalesce(c.empresa, '')) = latest.empresa_key
  and lower(coalesce(c.nome_fantasia, '')) = latest.fantasia_key;
