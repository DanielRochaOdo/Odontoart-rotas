import { supabase } from "./supabase";

type ClienteCanonicalRow = {
  id: string;
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
  created_at: string | null;
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
  "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, grupo, obs_comercial, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf, created_at";
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

const makeEnderecoKey = (
  endereco: string | null | undefined,
  complemento: string | null | undefined,
  bairro: string | null | undefined,
  cidade: string | null | undefined,
  uf: string | null | undefined,
  cep: string | null | undefined,
) => {
  const enderecoKey = normalize(endereco);
  const complementoKey = normalize(complemento);
  const bairroKey = normalize(bairro);
  const cidadeKey = normalize(cidade);
  const ufKey = normalize(uf);
  const cepKey = normalize(cep);
  if (!enderecoKey && !complementoKey && !bairroKey && !cidadeKey && !ufKey && !cepKey) return "";
  return `endereco:${enderecoKey}|complemento:${complementoKey}|bairro:${bairroKey}|cidade:${cidadeKey}|uf:${ufKey}|cep:${cepKey}`;
};

const makeEmpresaFantasiaEnderecoKey = (
  empresa: string | null | undefined,
  nomeFantasia: string | null | undefined,
  endereco: string | null | undefined,
  complemento: string | null | undefined,
  bairro: string | null | undefined,
  cidade: string | null | undefined,
  uf: string | null | undefined,
  cep: string | null | undefined,
) => {
  const empresaFantasiaKey = makeEmpresaFantasiaKey(empresa, nomeFantasia);
  const enderecoKey = makeEnderecoKey(endereco, complemento, bairro, cidade, uf, cep);
  if (!empresaFantasiaKey && !enderecoKey) return "";
  if (!empresaFantasiaKey) return `empresa:|fantasia:|${enderecoKey}`;
  if (!enderecoKey) return empresaFantasiaKey;
  return `${empresaFantasiaKey}|${enderecoKey}`;
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

type CanonicalMaps = {
  byEmpresaFantasiaEndereco: Map<string, ClienteCanonicalRow>;
  byEmpresaFantasiaUnique: Map<string, ClienteCanonicalRow>;
  byCodigoUnique: Map<string, ClienteCanonicalRow>;
};

const getCreatedAtMs = (value: string | null | undefined) => {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
};

const shouldReplaceCanonical = (current: ClienteCanonicalRow | undefined, next: ClienteCanonicalRow) => {
  if (!current) return true;
  return getCreatedAtMs(next.created_at) > getCreatedAtMs(current.created_at);
};

const hasSingleNonAmbiguousBranchKey = (keys: Set<string>, itemsCount: number) => {
  if (keys.size === 0) return false;
  if (keys.size > 1) return false;
  if (keys.has("") && itemsCount > 1) return false;
  return true;
};

const makeBranchDiscriminatorKey = (row: ClienteCanonicalRow) =>
  makeEmpresaFantasiaEnderecoKey(
    row.empresa,
    row.nome_fantasia,
    row.endereco,
    row.complemento,
    row.bairro,
    row.cidade,
    row.uf,
    row.cep,
  );

const buildCanonicalByKey = async <T extends AgendaSharedLike>(rows: T[]): Promise<CanonicalMaps> => {
  if (rows.length === 0) {
    return {
      byEmpresaFantasiaEndereco: new Map<string, ClienteCanonicalRow>(),
      byEmpresaFantasiaUnique: new Map<string, ClienteCanonicalRow>(),
      byCodigoUnique: new Map<string, ClienteCanonicalRow>(),
    };
  }

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

  const canonicalCandidatesById = new Map<string, ClienteCanonicalRow>();
  const ingestCanonicalCandidates = (data: ClienteCanonicalRow[]) => {
    data.forEach((item) => {
      if (!item?.id) return;
      const current = canonicalCandidatesById.get(item.id);
      if (shouldReplaceCanonical(current, item)) {
        canonicalCandidatesById.set(item.id, item);
      }
    });
  };

  if (codigos.length > 0) {
    const data = await fetchClientesCanonicalByIn("codigo", codigos);
    ingestCanonicalCandidates(data);
  }

  if (empresas.length > 0) {
    const data = await fetchClientesCanonicalByIn("empresa", empresas);
    ingestCanonicalCandidates(data);
  }

  if (fantasias.length > 0) {
    const data = await fetchClientesCanonicalByIn("nome_fantasia", fantasias);
    ingestCanonicalCandidates(data);
  }

  const canonicalByEmpresaFantasiaEndereco = new Map<string, ClienteCanonicalRow>();
  const candidatesByEmpresaFantasia = new Map<string, ClienteCanonicalRow[]>();
  const candidatesByCodigo = new Map<string, ClienteCanonicalRow[]>();

  canonicalCandidatesById.forEach((cliente) => {
    const empresaFantasiaEnderecoKey = makeEmpresaFantasiaEnderecoKey(
      cliente.empresa,
      cliente.nome_fantasia,
      cliente.endereco,
      cliente.complemento,
      cliente.bairro,
      cliente.cidade,
      cliente.uf,
      cliente.cep,
    );
    if (empresaFantasiaEnderecoKey) {
      const current = canonicalByEmpresaFantasiaEndereco.get(empresaFantasiaEnderecoKey);
      if (shouldReplaceCanonical(current, cliente)) {
        canonicalByEmpresaFantasiaEndereco.set(empresaFantasiaEnderecoKey, cliente);
      }
    }

    const empresaFantasiaKey = makeEmpresaFantasiaKey(cliente.empresa, cliente.nome_fantasia);
    if (empresaFantasiaKey) {
      const existing = candidatesByEmpresaFantasia.get(empresaFantasiaKey) ?? [];
      existing.push(cliente);
      candidatesByEmpresaFantasia.set(empresaFantasiaKey, existing);
    }

    const codigoKey = makeCodigoKey(cliente.codigo);
    if (codigoKey) {
      const existing = candidatesByCodigo.get(codigoKey) ?? [];
      existing.push(cliente);
      candidatesByCodigo.set(codigoKey, existing);
    }
  });

  const canonicalByEmpresaFantasiaUnique = new Map<string, ClienteCanonicalRow>();
  candidatesByEmpresaFantasia.forEach((items, empresaFantasiaKey) => {
    const uniqueBranchKeys = new Set(items.map(makeBranchDiscriminatorKey));
    if (!hasSingleNonAmbiguousBranchKey(uniqueBranchKeys, items.length)) return;

    const canonical = items.reduce<ClienteCanonicalRow | undefined>(
      (best, item) => (shouldReplaceCanonical(best, item) ? item : best),
      undefined,
    );

    if (canonical) {
      canonicalByEmpresaFantasiaUnique.set(empresaFantasiaKey, canonical);
    }
  });

  const canonicalByCodigoUnique = new Map<string, ClienteCanonicalRow>();

  candidatesByCodigo.forEach((items, codigoKey) => {
    const uniqueBranchKeys = new Set(items.map(makeBranchDiscriminatorKey));
    if (!hasSingleNonAmbiguousBranchKey(uniqueBranchKeys, items.length)) return;

    const canonical = items.reduce<ClienteCanonicalRow | undefined>(
      (best, item) => (shouldReplaceCanonical(best, item) ? item : best),
      undefined,
    );

    if (canonical) {
      canonicalByCodigoUnique.set(codigoKey, canonical);
    }
  });

  return {
    byEmpresaFantasiaEndereco: canonicalByEmpresaFantasiaEndereco,
    byEmpresaFantasiaUnique: canonicalByEmpresaFantasiaUnique,
    byCodigoUnique: canonicalByCodigoUnique,
  };
};

const resolveCanonicalForRow = <T extends AgendaSharedLike>(
  row: T,
  canonicalMaps: CanonicalMaps,
) => {
  const byEmpresaFantasiaEndereco = canonicalMaps.byEmpresaFantasiaEndereco.get(
    makeEmpresaFantasiaEnderecoKey(
      row.empresa,
      row.nome_fantasia,
      row.endereco,
      row.complemento,
      row.bairro,
      row.cidade,
      row.uf,
      row.cep,
    ),
  );
  const byEmpresaFantasia = canonicalMaps.byEmpresaFantasiaUnique.get(
    makeEmpresaFantasiaKey(row.empresa, row.nome_fantasia),
  );
  const byCodigo = canonicalMaps.byCodigoUnique.get(makeCodigoKey(row.cod_1));
  return byEmpresaFantasiaEndereco ?? byEmpresaFantasia ?? byCodigo;
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

  const canonicalMaps = await buildCanonicalByKey(rows);

  return rows.map((row) => {
    const canonical = resolveCanonicalForRow(row, canonicalMaps);
    return hydrateAgendaRowFromCanonical(row, canonical);
  });
};

export const filterHydrateAgendaRowsFromClientes = async <T extends AgendaSharedLike>(rows: T[]) => {
  if (rows.length === 0) return rows;

  const canonicalMaps = await buildCanonicalByKey(rows);

  return rows.flatMap((row) => {
    const canonical = resolveCanonicalForRow(row, canonicalMaps);
    if (!canonical) return [];
    return [hydrateAgendaRowFromCanonical(row, canonical)];
  });
};

