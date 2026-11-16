create table if not exists public.kpi_movimentos_mensais (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  empresa text null,
  competencia date not null check (extract(day from competencia) = 1),
  entradas integer not null check (entradas >= 0),
  saidas integer not null check (saidas >= 0),
  saldo integer generated always as (entradas - saidas) stored,
  categoria text not null check (categoria in ('So perda', 'Queda', 'Crescimento', 'So ganho', 'Neutro')),
  sync_run_id uuid null references public.kpi_sync_runs(id) on delete set null,
  consultado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kpi_movimentos_mensais_codigo_competencia_key unique (codigo, competencia)
);
create index if not exists kpi_movimentos_mensais_competencia_codigo_idx
  on public.kpi_movimentos_mensais (competencia, codigo);
create index if not exists kpi_movimentos_mensais_run_idx
  on public.kpi_movimentos_mensais (sync_run_id, codigo);
create index if not exists kpi_movimentos_mensais_run_competencia_codigo_idx
  on public.kpi_movimentos_mensais (sync_run_id, competencia, codigo);
alter table public.kpi_movimentos_mensais enable row level security;
grant select on public.kpi_movimentos_mensais to authenticated;
grant all on public.kpi_movimentos_mensais to service_role;
drop policy if exists "Supervisor or assistente read kpi_movimentos_mensais" on public.kpi_movimentos_mensais;
create policy "Supervisor or assistente read kpi_movimentos_mensais"
  on public.kpi_movimentos_mensais
  for select
  using (public.is_supervisor() or public.is_assistente());
create or replace function public.kpi_persist_monthly_movements(
  p_sync_run_id uuid,
  p_codigo text,
  p_empresa text,
  p_associado_total integer,
  p_categoria text,
  p_movimentos jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_associado_total is not null and p_associado_total < 0 then
    raise exception 'AssociadoTotal nao pode ser negativo';
  end if;
  if jsonb_typeof(p_movimentos) is distinct from 'array' then
    raise exception 'Movimentos KPI deve ser um array';
  end if;

  insert into public.kpi_movimentos_mensais (
    codigo, empresa, competencia, entradas, saidas, categoria, sync_run_id, consultado_em, updated_at
  )
  select
    p_codigo,
    p_empresa,
    (item->>'competencia')::date,
    (item->>'entradas')::integer,
    (item->>'saidas')::integer,
    item->>'categoria',
    p_sync_run_id,
    now(),
    now()
  from jsonb_array_elements(p_movimentos) as movement(item)
  on conflict (codigo, competencia) do update set
    empresa = excluded.empresa,
    entradas = excluded.entradas,
    saidas = excluded.saidas,
    categoria = excluded.categoria,
    sync_run_id = excluded.sync_run_id,
    consultado_em = excluded.consultado_em,
    updated_at = now();

  get diagnostics v_rows = row_count;

  update public.clientes
  set vidas_qtde = coalesce(p_associado_total::numeric, vidas_qtde),
      categoria = p_categoria
  where codigo = p_codigo
    and (p_associado_total is not null and vidas_qtde is distinct from p_associado_total::numeric
      or categoria is distinct from p_categoria);

  return v_rows;
end;
$$;
revoke all on function public.kpi_persist_monthly_movements(uuid, text, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.kpi_persist_monthly_movements(uuid, text, text, integer, text, jsonb) to service_role;
