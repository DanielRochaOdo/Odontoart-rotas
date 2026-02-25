alter table public.clientes
  add column if not exists cep text;

alter table public.agenda
  add column if not exists cep text;

create or replace function public.normalize_agenda_text()
returns trigger
language plpgsql
as $$
begin
  new.cod_1 = public.normalize_upper(new.cod_1);
  new.cep = public.normalize_upper(new.cep);
  new.empresa = public.normalize_upper(new.empresa);
  new.perfil_visita = public.normalize_upper(new.perfil_visita);
  new.tit = public.normalize_upper(new.tit);
  new.endereco = public.normalize_upper(new.endereco);
  new.bairro = public.normalize_upper(new.bairro);
  new.cidade = public.normalize_upper(new.cidade);
  new.uf = public.normalize_upper(new.uf);
  new.supervisor = public.normalize_upper(new.supervisor);
  new.vendedor = public.normalize_upper(new.vendedor);
  new.cod_2 = public.normalize_upper(new.cod_2);
  new.nome_fantasia = public.normalize_upper(new.nome_fantasia);
  new.grupo = public.normalize_upper(new.grupo);
  new.situacao = public.normalize_upper(new.situacao);
  new.obs_contrato_1 = public.normalize_upper(new.obs_contrato_1);
  new.obs_contrato_2 = public.normalize_upper(new.obs_contrato_2);
  new.visit_assigned_to = public.normalize_upper(new.visit_assigned_to);
  return new;
end;
$$;

create or replace function public.normalize_clientes_text()
returns trigger
language plpgsql
as $$
begin
  new.codigo = public.normalize_upper(new.codigo);
  new.cep = public.normalize_upper(new.cep);
  new.empresa = public.normalize_upper(new.empresa);
  new.nome_fantasia = public.normalize_upper(new.nome_fantasia);
  new.perfil_visita = public.normalize_upper(new.perfil_visita);
  new.endereco = public.normalize_upper(new.endereco);
  new.bairro = public.normalize_upper(new.bairro);
  new.cidade = public.normalize_upper(new.cidade);
  new.uf = public.normalize_upper(new.uf);
  new.situacao = public.normalize_upper(new.situacao);
  return new;
end;
$$;

update public.clientes
set cep = public.normalize_upper(cep);

update public.agenda
set cep = public.normalize_upper(cep);
