import { supabase } from "./supabase";
import type { ClienteHistoryRow, ClienteRow } from "../types/clientes";
import { extractCustomTimes, normalizePerfilVisitaValue } from "./perfilVisita";
const DEFAULT_SITUACAO = "Ativo";
const CLIENTES_SELECT_COLUMNS =
  "id, codigo, corte, venc, valor, reajuste_pct, data_da_ultima_visita, cep, cnpj, empresa, pessoa, contato, grupo, obs_comercial, obs, nome_fantasia, complemento, perfil_visita, situacao, categoria, endereco, bairro, cidade, uf, latitude, longitude, geocode_source, geocode_updated_at, created_at";
const MAX_CLIENTES_PAGE_SIZE = 100;

export type ClienteListRow = Pick<
  ClienteRow,
  "id" | "codigo" | "empresa" | "pessoa" | "contato" | "grupo" | "perfil_visita" | "situacao" | "cep" | "cidade" | "uf" | "created_at"
>;

const clampPageSize = (value: number) => {
  if (!Number.isFinite(value)) return 50;
  const normalized = Math.floor(value);
  if (normalized < 1) return 1;
  if (normalized > MAX_CLIENTES_PAGE_SIZE) return MAX_CLIENTES_PAGE_SIZE;
  return normalized;
};

const sanitizeSearchTerm = (value: string | null | undefined) =>
  (value ?? "").replace(/%/g, "").trim();

const normalizePerfilTimes = (value: string | null) => {
  const cleanedPerfil = normalizePerfilVisitaValue(value);
  if (!cleanedPerfil) return { perfil: null as string | null, opcoes: null as string | null };
  const hasTimes = extractCustomTimes(cleanedPerfil).length > 0;
  return {
    perfil: cleanedPerfil,
    opcoes: hasTimes ? cleanedPerfil : null,
  };
};

export const fetchClientesPage = async (params: {
  page: number;
  pageSize?: number;
  search?: string;
  searchMode?: "codigo" | "empresa" | "geral";
  situacao?: "" | "Ativo" | "Suspenso/Inadimplente" | "Cancelado";
}) => {
  const page = Number.isFinite(params.page) && params.page > 0 ? Math.floor(params.page) : 1;
  const pageSize = clampPageSize(params.pageSize ?? 50);
  const offset = (page - 1) * pageSize;
  const searchTerm = sanitizeSearchTerm(params.search);
  const { data, error } = await supabase.rpc("get_empresas_first_page_v1", {
    p_page_size: pageSize,
    p_page_offset: offset,
    p_search: searchTerm || null,
    p_search_mode: params.searchMode ?? "codigo",
    p_situacao: params.situacao || null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ClienteListRow[];
};

export const fetchClientesCount = async (params: {
  search?: string;
  searchMode?: "codigo" | "empresa" | "geral";
  situacao?: "" | "Ativo" | "Suspenso/Inadimplente" | "Cancelado";
}) => {
  const searchTerm = sanitizeSearchTerm(params.search);
  const { data, error } = await supabase.rpc("get_empresas_count_v1", {
    p_search: searchTerm || null,
    p_search_mode: params.searchMode ?? "codigo",
    p_situacao: params.situacao || null,
  });
  if (error) {
    throw new Error(error.message);
  }
  const total = typeof data === "number" ? data : Number(data ?? 0);
  return total;
};

export const fetchClienteById = async (id: string) => {
  const { data, error } = await supabase
    .from("clientes")
    .select(CLIENTES_SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Cliente ${id} nao encontrado.`);
  return data as ClienteRow;
};

export const fetchClientesByCodigoExact = async (codigo: string) => {
  const normalized = codigo.trim();
  if (!normalized) return [] as ClienteRow[];

  const { data, error } = await supabase
    .from("clientes")
    .select(CLIENTES_SELECT_COLUMNS)
    .eq("codigo", normalized)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ClienteRow[];
};

export const fetchClientesByCnpjExact = async (cnpj: string) => {
  const normalized = cnpj.trim();
  if (!normalized) return [] as ClienteRow[];
  const digits = normalized.replace(/\D/g, "");
  const formatted =
    digits.length === 14
      ? `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
      : normalized;
  const candidates = Array.from(new Set([normalized, formatted, digits].filter(Boolean)));

  const { data, error } = await supabase
    .from("clientes")
    .select(CLIENTES_SELECT_COLUMNS)
    .in("cnpj", candidates)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ClienteRow[];
};

export const fetchClientesByEnderecoExact = async (params: {
  endereco: string;
  excludeId?: string | null;
  limit?: number;
}) => {
  const normalized = params.endereco.replace(/[%*]/g, "").trim();
  if (!normalized) return [] as ClienteRow[];
  const limit =
    Number.isFinite(params.limit) && (params.limit ?? 0) > 0
      ? Math.min(Math.floor(params.limit ?? 0), 500)
      : 200;

  let query = supabase
    .from("clientes")
    .select(CLIENTES_SELECT_COLUMNS)
    .ilike("endereco", normalized)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params.excludeId) {
    query = query.neq("id", params.excludeId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ClienteRow[];
};

export const createCliente = async (payload: {
  codigo?: string | null;
  corte?: number | null;
  venc?: number | null;
  valor?: number | null;
  reajuste_pct?: number | null;
  data_da_ultima_visita?: string | null;
  cep?: string | null;
  cnpj?: string | null;
  empresa?: string | null;
  pessoa?: string | null;
  contato?: string | null;
  grupo?: string | null;
  obs_comercial?: string | null;
  obs?: string | null;
  nome_fantasia?: string | null;
  complemento?: string | null;
  perfil_visita?: string | null;
  situacao?: string | null;
  categoria?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
}) => {
  const normalizedPerfil = normalizePerfilVisitaValue(payload.perfil_visita ?? null);
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      codigo: payload.codigo ?? null,
      corte: payload.corte ?? null,
      venc: payload.venc ?? null,
      valor: payload.valor ?? null,
      reajuste_pct: payload.reajuste_pct ?? null,
      data_da_ultima_visita: payload.data_da_ultima_visita ?? null,
      cep: payload.cep ?? null,
      cnpj: payload.cnpj ?? null,
      empresa: payload.empresa ?? null,
      pessoa: payload.pessoa ?? null,
      contato: payload.contato ?? null,
      grupo: payload.grupo ?? null,
      obs_comercial: payload.obs_comercial ?? null,
      obs: payload.obs ?? null,
      nome_fantasia: payload.nome_fantasia ?? null,
      complemento: payload.complemento ?? null,
      perfil_visita: normalizedPerfil,
      situacao: payload.situacao ?? DEFAULT_SITUACAO,
      categoria: payload.categoria ?? null,
      endereco: payload.endereco ?? null,
      bairro: payload.bairro ?? null,
      cidade: payload.cidade ?? null,
      uf: payload.uf ?? null,
    })
    .select(CLIENTES_SELECT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
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
  setIfDefined("reajuste_pct");
  setIfDefined("data_da_ultima_visita");
  setIfDefined("cep");
  setIfDefined("cnpj");
  setIfDefined("empresa");
  setIfDefined("pessoa");
  setIfDefined("contato");
  setIfDefined("grupo");
  setIfDefined("obs_comercial");
  setIfDefined("obs");
  setIfDefined("nome_fantasia");
  setIfDefined("complemento");
  if (payload.perfil_visita !== undefined) {
    updatePayload.perfil_visita = normalizePerfilVisitaValue(payload.perfil_visita);
  }
  setIfDefined("situacao");
  setIfDefined("categoria");
  setIfDefined("endereco");
  setIfDefined("bairro");
  setIfDefined("cidade");
  setIfDefined("uf");

  if (Object.keys(updatePayload).length === 0) {
    const { data, error } = await supabase
      .from("clientes")
      .select(CLIENTES_SELECT_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`Cliente ${id} nao encontrado.`);
    return data as ClienteRow;
  }

  const { error: updateError } = await supabase
    .from("clientes")
    .update(updatePayload)
    .eq("id", id);
  if (updateError) throw new Error(updateError.message);

  const { data: fallbackData, error: fallbackError } = await supabase
    .from("clientes")
    .select(CLIENTES_SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (fallbackError) throw new Error(fallbackError.message);
  if (!fallbackData) throw new Error(`Cliente ${id} nao encontrado.`);
  return fallbackData as ClienteRow;
};

export const syncVisitsForCliente = async (cliente: ClienteRow) => {
  const { perfil, opcoes } = normalizePerfilTimes(cliente.perfil_visita ?? null);
  const { error: updateByClienteError } = await supabase
    .from("visits")
    .update({
      perfil_visita: perfil,
      perfil_visita_opcoes: opcoes,
    })
    .eq("cliente_id", cliente.id);
  if (updateByClienteError) throw new Error(updateByClienteError.message);
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
    cnpj?: string | null;
    empresa?: string | null;
    pessoa?: string | null;
    contato?: string | null;
    grupo?: string | null;
    obs_comercial?: string | null;
    obs?: string | null;
    nome_fantasia?: string | null;
    complemento?: string | null;
    perfil_visita?: string | null;
    situacao?: string | null;
    categoria?: string | null;
    endereco?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
  }>,
  options?: {
    skipDataUltimaVisitaSync?: boolean;
  },
) => {
  void options;
  if (payloads.length === 0) return [];
  const normalized = payloads.map((payload) => ({
    codigo: payload.codigo ?? null,
    corte: payload.corte ?? null,
    venc: payload.venc ?? null,
    data_da_ultima_visita: payload.data_da_ultima_visita ?? null,
    valor: payload.valor ?? null,
    cep: payload.cep ?? null,
    cnpj: payload.cnpj ?? null,
    empresa: payload.empresa ?? null,
    pessoa: payload.pessoa ?? null,
    contato: payload.contato ?? null,
    grupo: payload.grupo ?? null,
    obs_comercial: payload.obs_comercial ?? null,
    obs: payload.obs ?? null,
    nome_fantasia: payload.nome_fantasia ?? null,
    complemento: payload.complemento ?? null,
    perfil_visita: normalizePerfilVisitaValue(payload.perfil_visita ?? null),
    situacao: payload.situacao ?? DEFAULT_SITUACAO,
    categoria: payload.categoria ?? null,
    endereco: payload.endereco ?? null,
    bairro: payload.bairro ?? null,
    cidade: payload.cidade ?? null,
    uf: payload.uf ?? null,
  }));
  const clientesRows = normalized;
  const { data, error } = await supabase
    .from("clientes")
    .upsert(clientesRows, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select(CLIENTES_SELECT_COLUMNS);
  if (error) throw new Error(error.message);
  return (data ?? []) as ClienteRow[];
};

export const fetchClienteHistory = async (cliente: ClienteRow) => {
  const baseSelect =
    "id, visit_date, assigned_to_name, assigned_to_user_id, perfil_visita, perfil_visita_opcoes, completed_at, completed_vidas";

  const mapHistoryRows = (
    rows: Array<{
      id: string;
      visit_date?: string | null;
      assigned_to_name?: string | null;
      assigned_to_user_id?: string | null;
      perfil_visita?: string | null;
      perfil_visita_opcoes?: string | null;
      completed_at?: string | null;
      completed_vidas?: number | null;
      cliente?: { situacao?: string | null; supervisor?: string | null } | Array<{ situacao?: string | null; supervisor?: string | null }> | null;
    }>,
  ) =>
    rows.map((row) => {
      const clienteJoin = Array.isArray(row.cliente) ? row.cliente[0] : row.cliente;
      return {
        id: row.id,
        visit_date: row.visit_date ?? null,
        assigned_to_name: row.assigned_to_name ?? null,
        assigned_to_user_id: row.assigned_to_user_id ?? null,
        perfil_visita: row.perfil_visita ?? null,
        perfil_visita_opcoes: row.perfil_visita_opcoes ?? null,
        completed_at: row.completed_at ?? null,
        completed_vidas: row.completed_vidas ?? null,
        situacao: clienteJoin?.situacao ?? cliente.situacao ?? null,
        supervisor: clienteJoin?.supervisor ?? null,
      };
    }) as ClienteHistoryRow[];

  const { data, error } = await supabase
    .from("visits")
    .select(
      `${baseSelect}, cliente:cliente_id (situacao, supervisor)`,
    )
    .eq("cliente_id", cliente.id)
    .order("visit_date", { ascending: false });

  if (error) {

    const fallbackByClienteId = await supabase
      .from("visits")
      .select(baseSelect)
      .eq("cliente_id", cliente.id)
      .order("visit_date", { ascending: false });

    if (!fallbackByClienteId.error) {
      return mapHistoryRows((fallbackByClienteId.data ?? []) as Array<{
        id: string;
        visit_date?: string | null;
        assigned_to_name?: string | null;
        assigned_to_user_id?: string | null;
        perfil_visita?: string | null;
        perfil_visita_opcoes?: string | null;
        completed_at?: string | null;
        completed_vidas?: number | null;
      }>);
    }

    throw new Error(error.message);
  }

  return mapHistoryRows((data ?? []) as Array<{
    id: string;
    visit_date?: string | null;
    assigned_to_name?: string | null;
    assigned_to_user_id?: string | null;
    perfil_visita?: string | null;
    perfil_visita_opcoes?: string | null;
    completed_at?: string | null;
    completed_vidas?: number | null;
    cliente?: { situacao?: string | null; supervisor?: string | null } | Array<{ situacao?: string | null; supervisor?: string | null }> | null;
  }>);
};


