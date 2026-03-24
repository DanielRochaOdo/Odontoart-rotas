import { supabase } from "./supabase";

type ClienteCanonicalRow = {
  codigo: string | null;
  corte: number | null;
  venc: number | null;
  valor: number | null;
  data_da_ultima_visita: string | null;
  cep: string | null;
  empresa: string | null;
  pessoa: string | null;
  contato: string | null;
  grupo: string | null;
  obs_comercial: string | null;
  nome_fantasia: string | null;
  complemento: string | null;
  perfil_visita: string | null;
  situacao: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
};

type AgendaSharedLike = {
  id?: string;
  cod_1?: string | null;
  corte?: number | null;
  venc?: number | null;
  valor?: number | null;
  data_da_ultima_visita?: string | null;
  cep?: string | null;
  empresa?: string | null;
  pessoa?: string | null;
  contato?: string | null;
  grupo?: string | null;
  obs_contrato_1?: string | null;
  nome_fantasia?: string | null;
  complemento?: string | null;
  perfil_visita?: string | null;
  situacao?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
};

const CLIENTES_CANONICAL_SELECT =
  "codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, grupo, obs_comercial, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf";
const CLIENTES_CANONICAL_CHUNK_SIZE = 50;

const normalize = (value: string | null | undefined) =>
  (value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const makeCodigoKey = (codigo: string | null | undefined) => {
  const normalized = normalize(codigo);
  return normalized ? `codigo:${normalized}` : "";
};

const makeEmpresaFantasiaKey = (empresa: string | null | undefined, nomeFantasia: string | null | undefined) => {
  const empresaKey = normalize(empresa);
  const fantasiaKey = normalize(nomeFantasia);
  if (!empresaKey && !fantasiaKey) return "";
  return `empresa:${empresaKey}|fantasia:${fantasiaKey}`;
};

const splitIntoChunks = <T,>(values: T[], chunkSize: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
};

const fetchClientesCanonicalByIn = async (
  column: "codigo" | "empresa" | "nome_fantasia",
  values: string[],
) => {
  const rows: ClienteCanonicalRow[] = [];
  const chunks = splitIntoChunks(values, CLIENTES_CANONICAL_CHUNK_SIZE);

  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from("clientes")
      .select(CLIENTES_CANONICAL_SELECT)
      .in(column, chunk);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as ClienteCanonicalRow[]));
  }

  return rows;
};

const buildCanonicalByKey = async <T extends AgendaSharedLike>(rows: T[]) => {
  if (rows.length === 0) return new Map<string, ClienteCanonicalRow>();

  const codigos = Array.from(
    new Set(
      rows
        .map((row) => (row.cod_1 ?? "").trim())
        .filter(Boolean),
    ),
  );
  const empresas = Array.from(
    new Set(
      rows
        .map((row) => (row.empresa ?? "").trim())
        .filter(Boolean),
    ),
  );
  const fantasias = Array.from(
    new Set(
      rows
        .map((row) => (row.nome_fantasia ?? "").trim())
        .filter(Boolean),
    ),
  );

  const canonicalByKey = new Map<string, ClienteCanonicalRow>();

  if (codigos.length > 0) {
    const data = await fetchClientesCanonicalByIn("codigo", codigos);
    data.forEach((item) => {
      const cliente = item as ClienteCanonicalRow;
      const key = makeCodigoKey(cliente.codigo);
      if (key) canonicalByKey.set(key, cliente);
    });
  }

  if (empresas.length > 0) {
    const data = await fetchClientesCanonicalByIn("empresa", empresas);
    data.forEach((item) => {
      const cliente = item as ClienteCanonicalRow;
      const key = makeEmpresaFantasiaKey(cliente.empresa, cliente.nome_fantasia);
      if (key) canonicalByKey.set(key, cliente);
    });
  }

  if (fantasias.length > 0) {
    const data = await fetchClientesCanonicalByIn("nome_fantasia", fantasias);
    data.forEach((item) => {
      const cliente = item as ClienteCanonicalRow;
      const key = makeEmpresaFantasiaKey(cliente.empresa, cliente.nome_fantasia);
      if (key) canonicalByKey.set(key, cliente);
    });
  }

  return canonicalByKey;
};

const resolveCanonicalForRow = <T extends AgendaSharedLike>(
  row: T,
  canonicalByKey: Map<string, ClienteCanonicalRow>,
) => {
  const byCodigo = canonicalByKey.get(makeCodigoKey(row.cod_1));
  const byEmpresaFantasia = canonicalByKey.get(makeEmpresaFantasiaKey(row.empresa, row.nome_fantasia));
  return byCodigo ?? byEmpresaFantasia;
};

const hydrateAgendaRowFromCanonical = <T extends AgendaSharedLike>(
  row: T,
  canonical: ClienteCanonicalRow | undefined,
) => {
  if (!canonical) return row;

  return {
    ...row,
    cod_1: canonical.codigo,
    corte: canonical.corte,
    venc: canonical.venc,
    valor: canonical.valor,
    data_da_ultima_visita: canonical.data_da_ultima_visita,
    cep: canonical.cep,
    empresa: canonical.empresa,
    pessoa: canonical.pessoa,
    contato: canonical.contato,
    grupo: canonical.grupo,
    obs_contrato_1: canonical.obs_comercial,
    nome_fantasia: canonical.nome_fantasia,
    complemento: canonical.complemento,
    perfil_visita: canonical.perfil_visita,
    situacao: canonical.situacao,
    endereco: canonical.endereco,
    bairro: canonical.bairro,
    cidade: canonical.cidade,
    uf: canonical.uf,
  } as T;
};

export const hydrateAgendaRowsFromClientes = async <T extends AgendaSharedLike>(rows: T[]) => {
  if (rows.length === 0) return rows;

  const canonicalByKey = await buildCanonicalByKey(rows);

  return rows.map((row) => {
    const canonical = resolveCanonicalForRow(row, canonicalByKey);
    return hydrateAgendaRowFromCanonical(row, canonical);
  });
};

export const filterHydrateAgendaRowsFromClientes = async <T extends AgendaSharedLike>(rows: T[]) => {
  if (rows.length === 0) return rows;

  const canonicalByKey = await buildCanonicalByKey(rows);

  return rows.flatMap((row) => {
    const canonical = resolveCanonicalForRow(row, canonicalByKey);
    if (!canonical) return [];
    return [hydrateAgendaRowFromCanonical(row, canonical)];
  });
};

