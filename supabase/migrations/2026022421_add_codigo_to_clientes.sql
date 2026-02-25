alter table public.clientes
  add column if not exists codigo text;

update public.clientes c
set codigo = a.cod_1
from (
  select distinct on (lower(coalesce(empresa, '')), lower(coalesce(nome_fantasia, '')))
    lower(coalesce(empresa, '')) || '|' || lower(coalesce(nome_fantasia, '')) as dedupe_key,
    cod_1
  from public.agenda
  where cod_1 is not null
    and (empresa is not null or nome_fantasia is not null)
) a
where c.dedupe_key = a.dedupe_key
  and c.codigo is null;
