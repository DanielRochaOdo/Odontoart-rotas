import { supabase } from "./supabase";
import type { ClienteHistoryRow, ClienteRow } from "../types/clientes";
import { extractCustomTimes } from "./perfilVisita";
import { fetchNominatimCoordinatesByAddress, fetchNominatimCoordinatesByQuery } from "./nominatim";
const DEFAULT_SITUACAO = "Ativo";
const normalizeAgendaKeyPart = (value?: string | null) =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
const buildAgendaDedupeKey = (empresa?: string | null, nomeFantasia?: string | null) =>
  `${normalizeAgendaKeyPart(empresa)}|${normalizeAgendaKeyPart(nomeFantasia)}||`;
const CLIENTES_SELECT_COLUMNS =
  "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, cnpj, empresa, pessoa, contato, grupo, obs_comercial, obs, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf, created_at";

const normalizePerfilTimes = (value: string | null) => {
  if (!value) return { perfil: null as string | null, opcoes: null as string | null };
  const cleanedPerfil = value.trim();
  const hasTimes = extractCustomTimes(cleanedPerfil).length > 0;
  return {
    perfil: cleanedPerfil,
    opcoes: hasTimes ? cleanedPerfil : null,
  };
};

const collectAgendaIdsForCliente = async (
  cliente: Pick<ClienteRow, "codigo" | "empresa" | "nome_fantasia">,
) => {
  const codigo = cliente.codigo?.trim();
  const empresa = cliente.empresa?.trim();
  const nomeFantasia = cliente.nome_fantasia?.trim();
  const hasEmpresaIdentity = Boolean(empresa || nomeFantasia);
  const agendaIds = new Set<string>();

  const appendAgendaIds = (
    data: Array<{ id?: string | null }> | null,
    error: { message: string } | null,
  ) => {
    if (error) throw new Error(error.message);
    (data ?? []).forEach((row) => {
      const id = row.id;
      if (id) agendaIds.add(id);
    });
  };

  if (hasEmpresaIdentity) {
    const agendaKey = buildAgendaDedupeKey(empresa, nomeFantasia);
    const { data, error } = await supabase.from("agenda").select("id").eq("dedupe_key", agendaKey);
    appendAgendaIds(data as Array<{ id?: string | null }> | null, error);

    if (agendaIds.size === 0) {
      let fallbackQuery = supabase.from("agenda").select("id");
      if (empresa && nomeFantasia) {
        fallbackQuery = fallbackQuery.eq("empresa", empresa).eq("nome_fantasia", nomeFantasia);
      } else if (empresa) {
        fallbackQuery = fallbackQuery.eq("empresa", empresa);
      } else if (nomeFantasia) {
        fallbackQuery = fallbackQuery.eq("nome_fantasia", nomeFantasia);
      }
      const { data: fallbackData, error: fallbackError } = await fallbackQuery;
      appendAgendaIds(fallbackData as Array<{ id?: string | null }> | null, fallbackError);
    }
  } else if (codigo) {
    const { data, error } = await supabase.from("agenda").select("id").eq("cod_1", codigo);
    appendAgendaIds(data as Array<{ id?: string | null }> | null, error);
  }

  return Array.from(agendaIds);
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
    grupo?: string | null;
    obs_comercial?: string | null;
    nome_fantasia?: string | null;
    complemento?: string | null;
    perfil_visita?: string | null;
    situacao?: string | null;
    endereco?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
  }>,
  options?: {
    skipDataUltimaVisitaSync?: boolean;
  },
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
        grupo: payload.grupo ?? null,
        obs_contrato_1: payload.obs_comercial ?? null,
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

  if (options?.skipDataUltimaVisitaSync) return;

  const updates = payloads.filter(
    (payload) =>
      payload.data_da_ultima_visita &&
      (payload.empresa?.trim() || payload.nome_fantasia?.trim()),
  );
  for (const payload of updates) {
    const empresa = payload.empresa?.trim() ?? null;
    const nomeFantasia = payload.nome_fantasia?.trim() ?? null;
    if (!empresa && !nomeFantasia) continue;
    const query = supabase
      .from("agenda")
      .update({ data_da_ultima_visita: payload.data_da_ultima_visita })
      .eq("dedupe_key", buildAgendaDedupeKey(empresa, nomeFantasia));
    const { error: updateError } = await query;
    if (updateError) throw new Error(updateError.message);
  }
};

export const fetchClientes = async () => {
  const PAGE_SIZE = 1000;
  const rows: ClienteRow[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("clientes")
      .select(CLIENTES_SELECT_COLUMNS)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw new Error(error.message);

    const batch = (data ?? []) as ClienteRow[];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
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
  setIfDefined("endereco");
  setIfDefined("bairro");
  setIfDefined("cidade");
  setIfDefined("uf");

  if (Object.keys(updatePayload).length === 0) {
    const { data, error } = await supabase.from("clientes").select(CLIENTES_SELECT_COLUMNS).eq("id", id).single();
    if (error) throw new Error(error.message);
    return data as ClienteRow;
  }

  const { data, error } = await supabase
    .from("clientes")
    .update(updatePayload)
    .eq("id", id)
    .select(CLIENTES_SELECT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as ClienteRow;
};

export const syncVisitsForCliente = async (cliente: ClienteRow) => {
  const agendaIds = await collectAgendaIdsForCliente(cliente);
  if (agendaIds.length === 0) return;

  const { data: agendaRows, error: agendaError } = await supabase
    .from("agenda")
    .select("id, perfil_visita")
    .in("id", agendaIds);
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
    endereco?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
  }>,
  options?: {
    skipAgendaDataUltimaVisitaSync?: boolean;
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
  if (!options?.skipAgendaDataUltimaVisitaSync) {
    await upsertAgendaFromClientesPayloads(normalized, {
      skipDataUltimaVisitaSync: false,
    });
  }
  return (data ?? []) as ClienteRow[];
};

export const syncAgendaForCliente = async (cliente: ClienteRow) => {
  const situacao = cliente.situacao ?? DEFAULT_SITUACAO;
  const agendaIds = await collectAgendaIdsForCliente(cliente);
  if (agendaIds.length === 0) return;

  const { error } = await supabase.from("agenda").update({
    situacao,
    cod_1: cliente.codigo ?? null,
    corte: cliente.corte ?? null,
    venc: cliente.venc ?? null,
    data_da_ultima_visita: cliente.data_da_ultima_visita ?? null,
    cep: cliente.cep ?? null,
    empresa: cliente.empresa ?? null,
    pessoa: cliente.pessoa ?? null,
    contato: cliente.contato ?? null,
    grupo: cliente.grupo ?? null,
    obs_contrato_1: cliente.obs_comercial ?? null,
    nome_fantasia: cliente.nome_fantasia ?? null,
    perfil_visita: cliente.perfil_visita ?? null,
    valor: cliente.valor ?? null,
    complemento: cliente.complemento ?? null,
    endereco: cliente.endereco ?? null,
    bairro: cliente.bairro ?? null,
    cidade: cliente.cidade ?? null,
    uf: cliente.uf ?? null,
  }).in("id", agendaIds);
  if (error) throw new Error(error.message);

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

  const { data: matchingRows, error: missingError } = await supabase
    .from("agenda")
    .select("id, latitude, longitude")
    .in("id", agendaIds);
  if (missingError) throw new Error(missingError.message);
  const missingIds = (matchingRows ?? [])
    .filter((row) => row.latitude === null || row.longitude === null)
    .map((row) => row.id)
    .filter(Boolean);
  if (missingIds.length === 0) return;

  const { error: coordsError } = await supabase
    .from("agenda")
    .update({
      latitude: geocoded.latitude,
      longitude: geocoded.longitude,
      geocode_source: "nominatim",
      geocode_updated_at: new Date().toISOString(),
    })
    .in("id", missingIds);
  if (coordsError) throw new Error(coordsError.message);
};

export const fetchClienteHistory = async (cliente: ClienteRow) => {
  const agendaIds = await collectAgendaIdsForCliente(cliente);
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


