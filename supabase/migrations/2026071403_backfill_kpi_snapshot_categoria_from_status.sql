update public.kpi_sync_snapshots
set categoria = case
  when status = 'inativo' then 'Inativo'
  when status = 'so_perda' then 'So perda'
  when status = 'queda' then 'Queda'
  when status = 'crescimento' then 'Crescimento'
  when status = 'so_venda' then 'So venda'
  when status = 'neutro' then 'Neutro'
  else categoria
end
where categoria is distinct from case
  when status = 'inativo' then 'Inativo'
  when status = 'so_perda' then 'So perda'
  when status = 'queda' then 'Queda'
  when status = 'crescimento' then 'Crescimento'
  when status = 'so_venda' then 'So venda'
  when status = 'neutro' then 'Neutro'
  else categoria
end;
