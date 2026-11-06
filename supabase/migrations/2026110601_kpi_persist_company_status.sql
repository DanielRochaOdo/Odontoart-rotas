alter table public.kpi_sync_snapshots
  drop constraint if exists kpi_sync_snapshots_status_check;

alter table public.kpi_sync_snapshots
  add constraint kpi_sync_snapshots_status_check
  check (status in (
    'ok', 'preenchido', 'em_branco',
    'inativo', 'so_perda', 'so_venda', 'so_ganho', 'crescimento', 'queda', 'neutro'
  )) not valid;

with latest_kpi_status as (
  select distinct on (codigo)
    codigo,
    status
  from public.kpi_sync_snapshots
  where codigo is not null
    and status in ('inativo', 'so_perda', 'so_venda', 'so_ganho', 'crescimento', 'queda', 'neutro')
  order by codigo, snapshot_at desc, created_at desc, id desc
)
update public.clientes as cliente
set categoria = case latest.status
  when 'inativo' then 'Inativo'
  when 'so_perda' then 'So perda'
  when 'so_venda' then 'So ganho'
  when 'so_ganho' then 'So ganho'
  when 'crescimento' then 'Crescimento'
  when 'queda' then 'Queda'
  when 'neutro' then 'Neutro'
end
from latest_kpi_status as latest
where cliente.codigo = latest.codigo
  and cliente.categoria is distinct from case latest.status
    when 'inativo' then 'Inativo'
    when 'so_perda' then 'So perda'
    when 'so_venda' then 'So ganho'
    when 'so_ganho' then 'So ganho'
    when 'crescimento' then 'Crescimento'
    when 'queda' then 'Queda'
    when 'neutro' then 'Neutro'
  end;
