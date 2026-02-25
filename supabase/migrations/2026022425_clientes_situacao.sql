alter table public.clientes
  add column if not exists situacao text null;

with latest as (
  select distinct on (lower(coalesce(empresa, '')), lower(coalesce(nome_fantasia, '')))
    lower(coalesce(empresa, '')) as empresa_key,
    lower(coalesce(nome_fantasia, '')) as fantasia_key,
    situacao
  from public.agenda
  where situacao is not null
  order by
    lower(coalesce(empresa, '')),
    lower(coalesce(nome_fantasia, '')),
    data_da_ultima_visita desc nulls last,
    created_at desc
)
update public.clientes c
set situacao = latest.situacao
from latest
where lower(coalesce(c.empresa, '')) = latest.empresa_key
  and lower(coalesce(c.nome_fantasia, '')) = latest.fantasia_key
  and c.situacao is null;
