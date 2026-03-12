create or replace function public.sync_clientes_from_agenda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_match_key text;
  old_match_key text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  new_match_key := lower(coalesce(new.empresa, '')) || '|' || lower(coalesce(new.nome_fantasia, ''));
  old_match_key := null;

  if tg_op = 'UPDATE' then
    old_match_key := lower(coalesce(old.empresa, '')) || '|' || lower(coalesce(old.nome_fantasia, ''));
  end if;

  if new_match_key = '|' and coalesce(old_match_key, '|') = '|' then
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
         grupo = new.grupo,
         obs_comercial = new.obs_contrato_1,
         nome_fantasia = new.nome_fantasia,
         complemento = new.complemento,
         perfil_visita = new.perfil_visita,
         situacao = new.situacao,
         endereco = new.endereco,
         bairro = new.bairro,
         cidade = new.cidade,
         uf = new.uf
   where (lower(coalesce(empresa, '')) || '|' || lower(coalesce(nome_fantasia, ''))) = new_match_key
      or (
        old_match_key is not null
        and old_match_key <> new_match_key
        and (lower(coalesce(empresa, '')) || '|' || lower(coalesce(nome_fantasia, ''))) = old_match_key
      );

  if new_match_key <> '|' then
    insert into public.clientes (
      codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, grupo, obs_comercial,
      nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf
    )
    values (
      new.cod_1, new.corte, new.venc, new.valor, new.data_da_ultima_visita, new.cep, new.empresa, new.pessoa, new.contato, new.grupo, new.obs_contrato_1,
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
          grupo = excluded.grupo,
          obs_comercial = excluded.obs_comercial,
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
security definer
set search_path = public
as $$
declare
  new_match_key text;
  old_match_key text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  new_match_key := lower(coalesce(new.empresa, '')) || '|' || lower(coalesce(new.nome_fantasia, '')) || '||';
  old_match_key := null;

  if tg_op = 'UPDATE' then
    old_match_key := lower(coalesce(old.empresa, '')) || '|' || lower(coalesce(old.nome_fantasia, '')) || '||';
  end if;

  if new_match_key = '|||' and coalesce(old_match_key, '|||') = '|||' then
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
         grupo = new.grupo,
         obs_contrato_1 = new.obs_comercial,
         nome_fantasia = new.nome_fantasia,
         complemento = new.complemento,
         perfil_visita = new.perfil_visita,
         situacao = new.situacao,
         endereco = new.endereco,
         bairro = new.bairro,
         cidade = new.cidade,
         uf = new.uf,
         dedupe_key = new_match_key
   where coalesce(
           dedupe_key,
           lower(coalesce(empresa, '')) || '|' || lower(coalesce(nome_fantasia, '')) || '||'
         ) = new_match_key
      or (
        old_match_key is not null
        and old_match_key <> new_match_key
        and coalesce(
              dedupe_key,
              lower(coalesce(empresa, '')) || '|' || lower(coalesce(nome_fantasia, '')) || '||'
            ) = old_match_key
      );

  if new_match_key <> '|||' then
    insert into public.agenda (
      cod_1, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, grupo, obs_contrato_1,
      nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf,
      dedupe_key, raw_row
    )
    values (
      new.codigo, new.corte, new.venc, new.valor, new.data_da_ultima_visita, new.cep, new.empresa, new.pessoa, new.contato, new.grupo, new.obs_comercial,
      new.nome_fantasia, new.complemento, new.perfil_visita, new.situacao, new.endereco, new.bairro, new.cidade, new.uf,
      new_match_key,
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
          grupo = excluded.grupo,
          obs_contrato_1 = excluded.obs_contrato_1,
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
