alter table public.clientes
add column if not exists regra_visita_observacao text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clientes_regra_visita_observacao_len_chk'
  ) then
    alter table public.clientes
      add constraint clientes_regra_visita_observacao_len_chk
      check (
        regra_visita_observacao is null
        or length(btrim(regra_visita_observacao)) <= 50
      );
  end if;
end $$;

