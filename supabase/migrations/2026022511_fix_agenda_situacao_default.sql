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
  new.situacao = coalesce(public.normalize_upper(new.situacao), 'ATIVO');
  new.obs_contrato_1 = public.normalize_upper(new.obs_contrato_1);
  new.obs_contrato_2 = public.normalize_upper(new.obs_contrato_2);
  new.visit_assigned_to = public.normalize_upper(new.visit_assigned_to);
  return new;
end;
$$;

update public.agenda
set situacao = 'ATIVO'
where situacao is null
  or btrim(situacao) = '';
