-- Permite remocao segura de empresa da fila quando DataContrato
-- vier invalida/ausente/fora do corte na API/ERP.

create or replace function public.queue_release_remove_company(
  p_empresa_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if not public.queue_release_can_manage() then
    raise exception 'Sem permissao para gerenciar modulo fila.';
  end if;

  if p_empresa_id is null then
    raise exception 'Empresa obrigatoria.';
  end if;

  select exists (
    select 1
    from public.queue_release_controls
    where empresa_id = p_empresa_id
  ) into v_exists;

  if not v_exists then
    return false;
  end if;

  delete from public.queue_release_controls
  where empresa_id = p_empresa_id;

  return true;
end;
$$;

grant execute on function public.queue_release_remove_company(uuid, text) to authenticated;
