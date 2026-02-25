alter table public.clientes
  alter column situacao set default 'Ativo';

update public.clientes
set situacao = 'Ativo'
where situacao is null;

alter table public.agenda
  alter column situacao set default 'Ativo';

update public.agenda
set situacao = 'Ativo'
where situacao is null;

alter table public.clientes
  drop column if exists status;

alter table public.agenda
  drop column if exists cliente_status;

drop index if exists agenda_cliente_status_idx;

drop type if exists public.cliente_status;
