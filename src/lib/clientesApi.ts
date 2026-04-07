import { supabase } from "./supabase";
import type { ClienteHistoryRow, ClienteRow } from "../types/clientes";
import { extractCustomTimes } from "./perfilVisita";
import { fetchNominatimCoordinatesByAddress, fetchNominatimCoordinatesByQuery } from "./nominatim";
const DEFAULT_SITUACAO = "Ativo";
const CLIENTES_SELECT_COLUMNS =
  "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, cnpj, empresa, pessoa, contato, grupo, obs_comercial, obs, nome_fantasia, complemento, perfil_visita, situacao, categoria, endereco, bairro, cidade, uf, latitude, longitude, geocode_source, geocode_updated_at, created_at";

const normalizePerfilTimes = (value: string | null) => {
  if (!value) return { perfil: null as string | null, opcoes: null as string | null };
  const cleanedPerfil = value.trim();
  const hasTimes = extractCustomTimes(cleanedPerfil).length > 0;
  return {
    perfil: cleanedPerfil,
    opcoes: hasTimes ? cleanedPerfil : null,
  };
};

export const fetchClientes = async () => {
  const PAGE_SIZE = 1000;
  const CONCURRENCY = 4;
  const rowsById = new Map<string, ClienteRow>();
  const { count, error: countError } = await supabase
    .from("clientes")
    .select("id", { count: "exact", head: true });
  if (countError) throw new Error(countError.message);
  const total = count ?? 0;
  if (total === 0) return [] as ClienteRow[];

  const fetchRange = async (from: number, to: number) => {
    const { data, error } = await supabase
      .from("clientes")
      .select(CLIENTES_SELECT_COLUMNS)
      // Stable ordering avoids duplicates/missing rows across paginated ranges.
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as ClienteRow[];
  };

  const starts = Array.from(
    { length: Math.ceil(total / PAGE_SIZE) },
    (_, index) => index * PAGE_SIZE,
  );

  for (let index = 0; index < starts.length; index += CONCURRENCY) {
    const chunk = starts.slice(index, index + CONCURRENCY);
    const batches = await Promise.all(
      chunk.map((start) => fetchRange(start, start + PAGE_SIZE - 1)),
    );
    batches.forEach((batch) => {
      batch.forEach((row) => {
        if (!row.id) return;
        rowsById.set(row.id, row);
      });
    });
  }

  return Array.from(rowsById.values());
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

export const createCliente = async (payload: {
  codigo?: string | null;
  corte?: number | null;
  venc?: number | null;
  valor?: number | null;
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
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      codigo: payload.codigo ?? null,
      corte: payload.corte ?? null,
      venc: payload.venc ?? null,
      valor: payload.valor ?? null,
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
      perfil_visita: payload.perfil_visita ?? null,
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
  setIfDefined("perfil_visita");
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
  _options?: {
    skipDataUltimaVisitaSync?: boolean;
  },
) => {
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
    perfil_visita: payload.perfil_visita ?? null,
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

export const syncAgendaForCliente = async (cliente: ClienteRow) => {
  if (cliente.latitude !== null && cliente.longitude !== null) return;

  const road = [cliente.endereco?.trim(), cliente.bairro?.trim()].filter(Boolean).join(", ");
  const city = cliente.cidade?.trim();
  const state = cliente.uf?.trim();
  if (!road || !city || !state) return;

  let geocoded = await fetchNominatimCoordinatesByAddress(road, city, state).catch(() => null);
  if (!geocoded && cliente.bairro?.trim()) {
    geocoded = await fetchNominatimCoordinatesByQuery(`${cliente.bairro.trim()}, ${city}, ${state}, Brasil`).catch(() => null);
  }
  if (!geocoded) {
    geocoded = await fetchNominatimCoordinatesByQuery(`${city}, ${state}, Brasil`).catch(() => null);
  }
  if (!geocoded) return;

  const { error: coordsError } = await supabase
    .from("clientes")
    .update({
      latitude: geocoded.latitude,
      longitude: geocoded.longitude,
      geocode_source: "nominatim",
      geocode_updated_at: new Date().toISOString(),
    })
    .eq("id", cliente.id)
    .or("latitude.is.null,longitude.is.null");
  if (coordsError) throw new Error(coordsError.message);
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
    console.warn("Fallback de historico de visitas sem join cliente_id:", error.message);

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


