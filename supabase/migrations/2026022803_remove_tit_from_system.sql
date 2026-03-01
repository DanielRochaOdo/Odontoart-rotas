alter table public.clientes
  drop column if exists tit;

alter table public.agenda
  drop column if exists tit;

create or replace function public.normalize_agenda_text()
returns trigger
language plpgsql
as $$
begin
  new.cod_1 = public.normalize_upper(new.cod_1);
  new.cep = public.normalize_upper(new.cep);
  new.empresa = public.normalize_upper(new.empresa);
  new.perfil_visita = public.normalize_upper(new.perfil_visita);
  new.endereco = public.normalize_upper(new.endereco);
  new.bairro = public.normalize_upper(new.bairro);
  new.cidade = public.normalize_upper(new.cidade);
  new.uf = public.normalize_upper(new.uf);
  new.supervisor = public.normalize_upper(new.supervisor);
  new.vendedor = public.normalize_upper(new.vendedor);
  new.nome_fantasia = public.normalize_upper(new.nome_fantasia);
  new.grupo = public.normalize_upper(new.grupo);
  new.situacao = coalesce(public.normalize_upper(new.situacao), 'ATIVO');
  new.obs_contrato_1 = public.normalize_upper(new.obs_contrato_1);
  new.visit_assigned_to = public.normalize_upper(new.visit_assigned_to);
  return new;
end;
$$;

create or replace function public.update_agenda_from_visit()
returns trigger
language plpgsql
as $$
declare
  perfil_update text;
  agenda_empresa text;
  agenda_nome_fantasia text;
begin
  if new.agenda_id is null then
    return new;
  end if;

  if new.completed_at is not null and new.completed_vidas is not null then
    update public.agenda
      set visit_completed_at = new.completed_at,
          visit_completed_vidas = new.completed_vidas
      where id = new.agenda_id;
  end if;

  perfil_update := coalesce(new.perfil_visita_opcoes, new.perfil_visita);

  if new.completed_at is not null and perfil_update is not null then
    update public.agenda
      set perfil_visita = perfil_update
      where id = new.agenda_id;

    select empresa, nome_fantasia
      into agenda_empresa, agenda_nome_fantasia
      from public.agenda
      where id = new.agenda_id;

    if agenda_empresa is not null or agenda_nome_fantasia is not null then
      update public.clientes
        set perfil_visita = perfil_update
        where (
          agenda_empresa is not null
          and empresa is not null
          and public.normalize_upper(empresa) = public.normalize_upper(agenda_empresa)
        )
        or (
          agenda_nome_fantasia is not null
          and nome_fantasia is not null
          and public.normalize_upper(nome_fantasia) = public.normalize_upper(agenda_nome_fantasia)
        );
    end if;
  end if;

  return new;
end;
$$;
