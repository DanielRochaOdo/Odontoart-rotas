create or replace function public.sync_clientes_from_agenda()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if coalesce(new.cod_1, '') = ''
     and coalesce(new.empresa, '') = ''
     and coalesce(new.nome_fantasia, '') = '' then
    return new;
  end if;

  update public.clientes
     set codigo = new.cod_1,
         corte = new.corte,
         venc = new.venc,
         valor = new.valor,
         data_da_ultima_visita = new.data_da_ultima_visita,
         cep = new.cep,
         empresa = new.empresa,
         pessoa = new.pessoa,
         contato = new.contato,
         nome_fantasia = new.nome_fantasia,
         complemento = new.complemento,
         perfil_visita = new.perfil_visita,
         situacao = new.situacao,
         endereco = new.endereco,
         bairro = new.bairro,
         cidade = new.cidade,
         uf = new.uf
   where (new.cod_1 is not null and codigo is not null and public.normalize_upper(codigo) = public.normalize_upper(new.cod_1))
      or (new.empresa is not null and empresa is not null and public.normalize_upper(empresa) = public.normalize_upper(new.empresa))
      or (new.nome_fantasia is not null and nome_fantasia is not null and public.normalize_upper(nome_fantasia) = public.normalize_upper(new.nome_fantasia));

  if new.empresa is not null or new.nome_fantasia is not null then
    insert into public.clientes (
      codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato,
      nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf
    )
    values (
      new.cod_1, new.corte, new.venc, new.valor, new.data_da_ultima_visita, new.cep, new.empresa, new.pessoa, new.contato,
      new.nome_fantasia, new.complemento, new.perfil_visita, new.situacao, new.endereco, new.bairro, new.cidade, new.uf
    )
    on conflict (dedupe_key) do update
      set codigo = excluded.codigo,
          corte = excluded.corte,
          venc = excluded.venc,
          valor = excluded.valor,
          data_da_ultima_visita = excluded.data_da_ultima_visita,
          cep = excluded.cep,
          pessoa = excluded.pessoa,
          contato = excluded.contato,
          complemento = excluded.complemento,
          perfil_visita = excluded.perfil_visita,
          situacao = excluded.situacao,
          endereco = excluded.endereco,
          bairro = excluded.bairro,
          cidade = excluded.cidade,
          uf = excluded.uf;
  end if;

  return new;
end;
$$;

create or replace function public.sync_agenda_from_clientes()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if coalesce(new.codigo, '') = ''
     and coalesce(new.empresa, '') = ''
     and coalesce(new.nome_fantasia, '') = '' then
    return new;
  end if;

  update public.agenda
     set cod_1 = new.codigo,
         corte = new.corte,
         venc = new.venc,
         valor = new.valor,
         data_da_ultima_visita = new.data_da_ultima_visita,
         cep = new.cep,
         empresa = new.empresa,
         pessoa = new.pessoa,
         contato = new.contato,
         nome_fantasia = new.nome_fantasia,
         complemento = new.complemento,
         perfil_visita = new.perfil_visita,
         situacao = new.situacao,
         endereco = new.endereco,
         bairro = new.bairro,
         cidade = new.cidade,
         uf = new.uf
   where (new.codigo is not null and cod_1 is not null and public.normalize_upper(cod_1) = public.normalize_upper(new.codigo))
      or (new.empresa is not null and empresa is not null and public.normalize_upper(empresa) = public.normalize_upper(new.empresa))
      or (new.nome_fantasia is not null and nome_fantasia is not null and public.normalize_upper(nome_fantasia) = public.normalize_upper(new.nome_fantasia));

  if new.empresa is not null or new.nome_fantasia is not null then
    insert into public.agenda (
      cod_1, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato,
      nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf,
      dedupe_key, raw_row
    )
    values (
      new.codigo, new.corte, new.venc, new.valor, new.data_da_ultima_visita, new.cep, new.empresa, new.pessoa, new.contato,
      new.nome_fantasia, new.complemento, new.perfil_visita, new.situacao, new.endereco, new.bairro, new.cidade, new.uf,
      lower(coalesce(new.empresa, '')) || '|' || lower(coalesce(new.nome_fantasia, '')) || '||',
      '{"source":"clientes_sync"}'::jsonb
    )
    on conflict (dedupe_key) do update
      set cod_1 = excluded.cod_1,
          corte = excluded.corte,
          venc = excluded.venc,
          valor = excluded.valor,
          data_da_ultima_visita = excluded.data_da_ultima_visita,
          cep = excluded.cep,
          pessoa = excluded.pessoa,
          contato = excluded.contato,
          complemento = excluded.complemento,
          perfil_visita = excluded.perfil_visita,
          situacao = excluded.situacao,
          endereco = excluded.endereco,
          bairro = excluded.bairro,
          cidade = excluded.cidade,
          uf = excluded.uf;
  end if;

  return new;
end;
$$;

create or replace function public.sync_open_visits_from_agenda_perfil()
returns trigger
language plpgsql
as $$
declare
  has_multiple_times boolean;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.perfil_visita is not distinct from old.perfil_visita then
    return new;
  end if;

  has_multiple_times := coalesce(new.perfil_visita, '') ~ '\d{1,2}:\d{2}.*\d{1,2}:\d{2}';

  update public.visits
     set perfil_visita = new.perfil_visita,
         perfil_visita_opcoes = case when has_multiple_times then new.perfil_visita else null end
   where agenda_id = new.id
     and completed_at is null;

  return new;
end;
$$;

drop trigger if exists agenda_sync_clientes_after_write on public.agenda;
create trigger agenda_sync_clientes_after_write
after insert or update of cod_1, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf
on public.agenda
for each row
execute function public.sync_clientes_from_agenda();

drop trigger if exists clientes_sync_agenda_after_write on public.clientes;
create trigger clientes_sync_agenda_after_write
after insert or update of codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf
on public.clientes
for each row
execute function public.sync_agenda_from_clientes();

drop trigger if exists agenda_sync_open_visits_perfil on public.agenda;
create trigger agenda_sync_open_visits_perfil
after update of perfil_visita
on public.agenda
for each row
execute function public.sync_open_visits_from_agenda_perfil();

