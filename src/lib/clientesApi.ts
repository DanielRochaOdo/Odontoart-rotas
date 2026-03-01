import { supabase } from "./supabase";
import type { ClienteHistoryRow, ClienteRow } from "../types/clientes";
import { extractCustomTimes } from "./perfilVisita";

const escapeOrValue = (value: string) => `"${value.replace(/"/g, '\\"')}"`;
const DEFAULT_SITUACAO = "Ativo";
const normalizeAgendaKeyPart = (value?: string | null) =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
const buildAgendaDedupeKey = (empresa?: string | null, nomeFantasia?: string | null) =>
  `${normalizeAgendaKeyPart(empresa)}|${normalizeAgendaKeyPart(nomeFantasia)}||`;

const normalizePerfilTimes = (value: string | null) => {
  if (!value) return { perfil: null as string | null, opcoes: null as string | null };
  const cleanedPerfil = value.trim();
  const hasTimes = extractCustomTimes(cleanedPerfil).length > 0;
  return {
    perfil: cleanedPerfil,
    opcoes: hasTimes ? cleanedPerfil : null,
  };
};

const upsertAgendaFromClientesPayloads = async (
  payloads: Array<{
    codigo?: string | null;
    corte?: number | null;
    venc?: number | null;
    data_da_ultima_visita?: string | null;
    valor?: number | null;
    cep?: string | null;
    empresa?: string | null;
    pessoa?: string | null;
    contato?: string | null;
    nome_fantasia?: string | null;
    complemento?: string | null;
    perfil_visita?: string | null;
    situacao?: string | null;
    endereco?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
  }>,
) => {
  const agendaRows = payloads
    .map((payload) => {
      const empresa = payload.empresa ?? null;
      const nomeFantasia = payload.nome_fantasia ?? null;
      if (!empresa && !nomeFantasia) return null;
      return {
        cod_1: payload.codigo ?? null,
        corte: payload.corte ?? null,
        venc: payload.venc ?? null,
        data_da_ultima_visita: payload.data_da_ultima_visita ?? null,
        valor: payload.valor ?? null,
        cep: payload.cep ?? null,
        empresa,
        pessoa: payload.pessoa ?? null,
        contato: payload.contato ?? null,
        nome_fantasia: nomeFantasia,
        complemento: payload.complemento ?? null,
        perfil_visita: payload.perfil_visita ?? null,
        endereco: payload.endereco ?? null,
        bairro: payload.bairro ?? null,
        cidade: payload.cidade ?? null,
        uf: payload.uf ?? null,
        situacao: payload.situacao ?? DEFAULT_SITUACAO,
        dedupe_key: buildAgendaDedupeKey(empresa, nomeFantasia),
        raw_row: {
          source: "clientes",
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (agendaRows.length === 0) return;

  const { error } = await supabase
    .from("agenda")
    .upsert(agendaRows, { onConflict: "dedupe_key", ignoreDuplicates: true });

  if (error) throw new Error(error.message);

  const updates = payloads.filter(
    (payload) =>
      payload.data_da_ultima_visita &&
      (payload.empresa?.trim() || payload.nome_fantasia?.trim()),
  );
  for (const payload of updates) {
    const empresa = payload.empresa?.trim() ?? null;
    const nomeFantasia = payload.nome_fantasia?.trim() ?? null;
    if (!empresa && !nomeFantasia) continue;
    let query = supabase
      .from("agenda")
      .update({ data_da_ultima_visita: payload.data_da_ultima_visita });
    if (empresa && nomeFantasia) {
      query = query.or(
        `empresa.eq.${escapeOrValue(empresa)},nome_fantasia.eq.${escapeOrValue(nomeFantasia)}`,
      );
    } else if (empresa) {
      query = query.eq("empresa", empresa);
    } else if (nomeFantasia) {
      query = query.eq("nome_fantasia", nomeFantasia);
    }
    const { error: updateError } = await query;
    if (updateError) throw new Error(updateError.message);
  }
};

export const fetchClientes = async () => {
  const { data, error } = await supabase
    .from("clientes")
    .select(
      "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf, created_at",
    );

  if (error) throw new Error(error.message);
  return (data ?? []) as ClienteRow[];
};

export const createCliente = async (payload: {
  codigo?: string | null;
  corte?: number | null;
  venc?: number | null;
  valor?: number | null;
  data_da_ultima_visita?: string | null;
  cep?: string | null;
  empresa?: string | null;
  pessoa?: string | null;
  contato?: string | null;
  nome_fantasia?: string | null;
  complemento?: string | null;
  perfil_visita?: string | null;
  situacao?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
}) => {
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      codigo: payload.codigo ?? null,
      corte: payload.corte ?? null,
      venc: payload.venc ?? null,
      valor: payload.valor ?? null,
      data_da_ultima_visita: payload.data_da_ultima_visita ?? null,
      cep: payload.cep ?? null,
      empresa: payload.empresa ?? null,
      pessoa: payload.pessoa ?? null,
      contato: payload.contato ?? null,
      nome_fantasia: payload.nome_fantasia ?? null,
      complemento: payload.complemento ?? null,
      perfil_visita: payload.perfil_visita ?? null,
      situacao: payload.situacao ?? DEFAULT_SITUACAO,
      endereco: payload.endereco ?? null,
      bairro: payload.bairro ?? null,
      cidade: payload.cidade ?? null,
      uf: payload.uf ?? null,
    })
    .select(
      "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf, created_at",
    )
    .single();

  if (error) throw new Error(error.message);
  await upsertAgendaFromClientesPayloads([data as ClienteRow]);
  return data as ClienteRow;
};

export const updateCliente = async (id: string, payload: Partial<ClienteRow>) => {
  const updatePayload: Record<string, unknown> = {};
  const setIfDefined = <K extends keyof ClienteRow>(key: K, column: string = key) => {
    const value = payload[key];
    if (value !== undefined) {
      updatePayload[column] = value;
    }
  };

  setIfDefined("codigo");
  setIfDefined("corte");
  setIfDefined("venc");
  setIfDefined("valor");
  setIfDefined("data_da_ultima_visita");
  setIfDefined("cep");
  setIfDefined("empresa");
  setIfDefined("pessoa");
  setIfDefined("contato");
  setIfDefined("nome_fantasia");
  setIfDefined("complemento");
  setIfDefined("perfil_visita");
  setIfDefined("situacao");
  setIfDefined("endereco");
  setIfDefined("bairro");
  setIfDefined("cidade");
  setIfDefined("uf");

  if (Object.keys(updatePayload).length === 0) {
    const { data, error } = await supabase
      .from("clientes")
      .select(
        "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf, created_at",
      )
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data as ClienteRow;
  }

  const { data, error } = await supabase
    .from("clientes")
    .update(updatePayload)
    .eq("id", id)
    .select(
      "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf, created_at",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as ClienteRow;
};

export const syncVisitsForCliente = async (cliente: ClienteRow) => {
  const empresa = cliente.empresa?.trim();
  const nomeFantasia = cliente.nome_fantasia?.trim();

  let agendaQuery = supabase.from("agenda").select("id, perfil_visita");

  if (empresa && nomeFantasia) {
    agendaQuery = agendaQuery.or(
      `empresa.eq.${escapeOrValue(empresa)},nome_fantasia.eq.${escapeOrValue(nomeFantasia)}`,
    );
  } else if (empresa) {
    agendaQuery = agendaQuery.eq("empresa", empresa);
  } else if (nomeFantasia) {
    agendaQuery = agendaQuery.eq("nome_fantasia", nomeFantasia);
  } else {
    return;
  }

  const { data: agendaRows, error: agendaError } = await agendaQuery;
  if (agendaError) throw new Error(agendaError.message);

  const rows = (agendaRows ?? []).filter((row) => row.id);
  for (const row of rows) {
    const { perfil, opcoes } = normalizePerfilTimes((row as { perfil_visita?: string | null }).perfil_visita ?? null);
    const { error: updateError } = await supabase
      .from("visits")
      .update({
        perfil_visita: perfil,
        perfil_visita_opcoes: opcoes,
      })
      .eq("agenda_id", row.id);
    if (updateError) throw new Error(updateError.message);
  }
};

export const deleteCliente = async (id: string) => {
  const { error } = await supabase.from("clientes").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

export const upsertClientes = async (
  payloads: Array<{
    codigo?: string | null;
    corte?: number | null;
    venc?: number | null;
    data_da_ultima_visita?: string | null;
    valor?: number | null;
    cep?: string | null;
    empresa?: string | null;
    pessoa?: string | null;
    contato?: string | null;
    nome_fantasia?: string | null;
    complemento?: string | null;
    perfil_visita?: string | null;
    situacao?: string | null;
    endereco?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
  }>,
) => {
  if (payloads.length === 0) return [];
  const normalized = payloads.map((payload) => ({
    codigo: payload.codigo ?? null,
    corte: payload.corte ?? null,
    venc: payload.venc ?? null,
    data_da_ultima_visita: payload.data_da_ultima_visita ?? null,
    valor: payload.valor ?? null,
    cep: payload.cep ?? null,
    empresa: payload.empresa ?? null,
    pessoa: payload.pessoa ?? null,
    contato: payload.contato ?? null,
    nome_fantasia: payload.nome_fantasia ?? null,
    complemento: payload.complemento ?? null,
    perfil_visita: payload.perfil_visita ?? null,
    situacao: payload.situacao ?? DEFAULT_SITUACAO,
    endereco: payload.endereco ?? null,
    bairro: payload.bairro ?? null,
    cidade: payload.cidade ?? null,
    uf: payload.uf ?? null,
  }));
  const clientesRows = normalized;
  const { data, error } = await supabase
    .from("clientes")
    .upsert(clientesRows, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select(
      "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf, created_at",
    );
  if (error) throw new Error(error.message);
  await upsertAgendaFromClientesPayloads(normalized);
  return (data ?? []) as ClienteRow[];
};

export const syncAgendaForCliente = async (cliente: ClienteRow) => {
  const situacao = cliente.situacao ?? DEFAULT_SITUACAO;
  const empresa = cliente.empresa?.trim();
  const nomeFantasia = cliente.nome_fantasia?.trim();

  let query = supabase.from("agenda").update({
    situacao,
    cod_1: cliente.codigo ?? null,
    corte: cliente.corte ?? null,
    venc: cliente.venc ?? null,
    data_da_ultima_visita: cliente.data_da_ultima_visita ?? null,
    cep: cliente.cep ?? null,
    empresa: cliente.empresa ?? null,
    pessoa: cliente.pessoa ?? null,
    contato: cliente.contato ?? null,
    nome_fantasia: cliente.nome_fantasia ?? null,
    perfil_visita: cliente.perfil_visita ?? null,
    valor: cliente.valor ?? null,
    complemento: cliente.complemento ?? null,
    endereco: cliente.endereco ?? null,
    bairro: cliente.bairro ?? null,
    cidade: cliente.cidade ?? null,
    uf: cliente.uf ?? null,
  });

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
      "id, visit_date, assigned_to_name, assigned_to_user_id, perfil_visita, perfil_visita_opcoes, completed_at, completed_vidas, agenda:agenda_id (situacao, supervisor)",
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
      perfil_visita_opcoes: (row as { perfil_visita_opcoes?: string | null }).perfil_visita_opcoes ?? null,
      completed_at: row.completed_at ?? null,
      completed_vidas: row.completed_vidas ?? null,
      situacao: agenda?.situacao ?? null,
      supervisor: (agenda as { supervisor?: string | null } | null)?.supervisor ?? null,
    };
  }) as ClienteHistoryRow[];
};

