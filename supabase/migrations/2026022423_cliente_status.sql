do $$
begin
  if not exists (select 1 from pg_type where typname = 'cliente_status') then
    create type public.cliente_status as enum ('Ativo', 'Inativo');
  end if;
end $$;

alter table public.clientes
  add column if not exists status public.cliente_status not null default 'Ativo';

update public.clientes
set status = 'Ativo'
where status is null;

alter table public.agenda
  add column if not exists cliente_status public.cliente_status not null default 'Ativo';

update public.agenda
set cliente_status = 'Ativo'
where cliente_status is null;

create index if not exists agenda_cliente_status_idx on public.agenda(cliente_status);
