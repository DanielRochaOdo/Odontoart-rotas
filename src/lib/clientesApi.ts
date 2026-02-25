import { supabase } from "./supabase";
import type { ClienteHistoryRow, ClienteRow } from "../types/clientes";

const escapeOrValue = (value: string) => `"${value.replace(/"/g, '\\"')}"`;

export const fetchClientes = async () => {
  const { data, error } = await supabase
    .from("clientes")
    .select(
      "id, codigo, empresa, nome_fantasia, perfil_visita, situacao, status, endereco, bairro, cidade, uf, created_at",
    );

  if (error) throw new Error(error.message);
  return (data ?? []) as ClienteRow[];
};

export const createCliente = async (payload: {
  codigo?: string | null;
  empresa?: string | null;
  nome_fantasia?: string | null;
  perfil_visita?: string | null;
  situacao?: string | null;
  status?: "Ativo" | "Inativo" | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
}) => {
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      codigo: payload.codigo ?? null,
      empresa: payload.empresa ?? null,
      nome_fantasia: payload.nome_fantasia ?? null,
      perfil_visita: payload.perfil_visita ?? null,
      situacao: payload.situacao ?? null,
      status: payload.status ?? "Ativo",
      endereco: payload.endereco ?? null,
      bairro: payload.bairro ?? null,
      cidade: payload.cidade ?? null,
      uf: payload.uf ?? null,
    })
    .select(
      "id, codigo, empresa, nome_fantasia, perfil_visita, situacao, status, endereco, bairro, cidade, uf, created_at",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as ClienteRow;
};

export const updateCliente = async (id: string, payload: Partial<ClienteRow>) => {
  const { data, error } = await supabase
    .from("clientes")
    .update({
      codigo: payload.codigo ?? null,
      empresa: payload.empresa ?? null,
      nome_fantasia: payload.nome_fantasia ?? null,
      perfil_visita: payload.perfil_visita ?? null,
      situacao: payload.situacao ?? null,
      status: payload.status ?? "Ativo",
      endereco: payload.endereco ?? null,
      bairro: payload.bairro ?? null,
      cidade: payload.cidade ?? null,
      uf: payload.uf ?? null,
    })
    .eq("id", id)
    .select(
      "id, codigo, empresa, nome_fantasia, perfil_visita, situacao, status, endereco, bairro, cidade, uf, created_at",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as ClienteRow;
};

export const deleteCliente = async (id: string) => {
  const { error } = await supabase.from("clientes").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

export const syncAgendaForCliente = async (cliente: ClienteRow) => {
  const status = cliente.status ?? "Ativo";
  const situacao = cliente.situacao ?? null;
  const empresa = cliente.empresa?.trim();
  const nomeFantasia = cliente.nome_fantasia?.trim();

  let query = supabase.from("agenda").update({ cliente_status: status, situacao });

  if (empresa && nomeFantasia) {
    query = query.or(
      `empresa.eq.${escapeOrValue(empresa)},nome_fantasia.eq.${escapeOrValue(nomeFantasia)}`,
    );
  } else if (empresa) {
    query = query.eq("empresa", empresa);
  } else if (nomeFantasia) {
    query = query.eq("nome_fantasia", nomeFantasia);
  } else {
    return;
  }

  const { error } = await query;
  if (error) throw new Error(error.message);
};

export const fetchClienteHistory = async (cliente: ClienteRow) => {
  const empresa = cliente.empresa?.trim();
  const nomeFantasia = cliente.nome_fantasia?.trim();

  let agendaQuery = supabase.from("agenda").select("id, situacao, empresa, nome_fantasia");

  if (empresa && nomeFantasia) {
    agendaQuery = agendaQuery.or(
      `empresa.eq.${escapeOrValue(empresa)},nome_fantasia.eq.${escapeOrValue(nomeFantasia)}`,
    );
  } else if (empresa) {
    agendaQuery = agendaQuery.eq("empresa", empresa);
  } else if (nomeFantasia) {
    agendaQuery = agendaQuery.eq("nome_fantasia", nomeFantasia);
  }

  const { data: agendaRows, error: agendaError } = await agendaQuery;
  if (agendaError) throw new Error(agendaError.message);

  const agendaIds = (agendaRows ?? []).map((row) => row.id).filter(Boolean);
  if (agendaIds.length === 0) return [];

  const { data, error } = await supabase
    .from("visits")
    .select(
      "id, visit_date, assigned_to_name, assigned_to_user_id, perfil_visita, completed_at, completed_vidas, agenda:agenda_id (situacao)",
    )
    .in("agenda_id", agendaIds)
    .order("visit_date", { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const agenda = Array.isArray(row.agenda) ? row.agenda[0] : row.agenda;
    return {
      id: row.id,
      visit_date: row.visit_date ?? null,
      assigned_to_name: row.assigned_to_name ?? null,
      assigned_to_user_id: row.assigned_to_user_id ?? null,
      perfil_visita: row.perfil_visita ?? null,
      completed_at: row.completed_at ?? null,
      completed_vidas: row.completed_vidas ?? null,
      situacao: agenda?.situacao ?? null,
    };
  }) as ClienteHistoryRow[];
};
