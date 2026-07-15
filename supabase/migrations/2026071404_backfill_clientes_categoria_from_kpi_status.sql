with latest_snapshot as (
  select distinct on (codigo)
    codigo,
    status
  from public.kpi_sync_snapshots
  order by codigo, created_at desc
)
update public.clientes c
set categoria = case
  when ls.status = 'inativo' then 'Inativo'
  when ls.status = 'so_perda' then 'So perda'
  when ls.status = 'queda' then 'Queda'
  when ls.status = 'crescimento' then 'Crescimento'
  when ls.status = 'so_venda' then 'So venda'
  when ls.status = 'neutro' then 'Neutro'
  else c.categoria
end
from latest_snapshot ls
where ls.codigo = c.codigo
  and c.categoria is distinct from case
    when ls.status = 'inativo' then 'Inativo'
    when ls.status = 'so_perda' then 'So perda'
    when ls.status = 'queda' then 'Queda'
    when ls.status = 'crescimento' then 'Crescimento'
    when ls.status = 'so_venda' then 'So venda'
    when ls.status = 'neutro' then 'Neutro'
    else c.categoria
  end;
