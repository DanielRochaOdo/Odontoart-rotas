const ODONTOART_EMPRESA_URL = "https://odontoart.s4e.com.br//api/empresa/BuscaEmpresas";
const ODONTOART_DEFAULT_TOKEN = "7DqKKmNcZDWY2Pie35tbKwY6hAKXzS5wWl7hNLAmPWBIljmfeX";

export type OdontoartEmpresaResponseRow = {
  Id?: number | string | null;
  RazaoSocial?: string | null;
  NomeSituacao?: string | null;
  nomeSituacao?: string | null;
  ValorTitular?: number | string | null;
  Cep?: string | null;
  UfNome?: string | null;
  MunicipioNome?: string | null;
  Logradouro?: string | null;
  Numero?: number | string | null;
  BairroNome?: string | null;
  Corte?: number | string | null;
  Vencimento?: number | string | null;
  ObservacaoComercial?: string | null;
  PrecoPlano?: Array<{
    ValorTitular?: number | string | null;
  }> | null;
};

const OBS_CANDIDATE_KEYS = [
  "ObservacaoComercial",
  "observacaoComercial",
  "observacao_comercial",
  "ObsComercial",
  "obsComercial",
];

const SITUACAO_CANDIDATE_KEYS = [
  "NomeSituacao",
  "nomeSituacao",
  "nome_situacao",
  "NomeSituação",
  "nomeSituação",
  "SituacaoNome",
  "situacaoNome",
  "situacao",
  "status",
];

const readStringByKeysFromUnknown = (value: unknown, keys: string[], depth = 0): string | null => {
  if (depth > 4 || value === null || value === undefined) return null;
  if (typeof value === "string") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readStringByKeysFromUnknown(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  for (const nested of Object.values(record)) {
    const found = readStringByKeysFromUnknown(nested, keys, depth + 1);
    if (found) return found;
  }

  return null;
};

const readObsFromUnknown = (value: unknown) =>
  readStringByKeysFromUnknown(value, OBS_CANDIDATE_KEYS, 0);

const readSituacaoFromUnknown = (value: unknown) =>
  readStringByKeysFromUnknown(value, SITUACAO_CANDIDATE_KEYS, 0);

const extractEmpresaFromPayload = (payload: unknown): OdontoartEmpresaResponseRow | null => {
  let empresa: OdontoartEmpresaResponseRow | null = null;
  if (payload && typeof payload === "object") {
    const asRecord = payload as Record<string, unknown>;
    const dados = asRecord.dados;
    if (Array.isArray(dados) && dados.length > 0 && dados[0] && typeof dados[0] === "object") {
      empresa = dados[0] as OdontoartEmpresaResponseRow;
    } else if (Array.isArray(payload) && payload.length > 0 && payload[0] && typeof payload[0] === "object") {
      empresa = payload[0] as OdontoartEmpresaResponseRow;
    }
  }
  if (!empresa) return null;

  const situacao =
    empresa.NomeSituacao?.trim() ||
    empresa.nomeSituacao?.trim() ||
    readSituacaoFromUnknown(empresa) ||
    readSituacaoFromUnknown(payload) ||
    null;

  return {
    ...empresa,
    NomeSituacao: situacao,
  };
};

const fetchEmpresaPayloadById = async (empresaId: string) => {
  const trimmedEmpresaId = empresaId.trim();
  if (!trimmedEmpresaId) return null as unknown;

  const token = (import.meta.env.VITE_ODONTOART_TOKEN as string | undefined)?.trim() || ODONTOART_DEFAULT_TOKEN;
  const search = new URLSearchParams({
    token,
    empresaId: trimmedEmpresaId,
  });

  const response = await fetch(`${ODONTOART_EMPRESA_URL}?${search.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar empresa (${response.status}).`);
  }

  return (await response.json()) as unknown;
};

export const fetchEmpresaByEmpresaId = async (empresaId: string) => {
  const payload = await fetchEmpresaPayloadById(empresaId);
  return extractEmpresaFromPayload(payload);
};

export const fetchObservacaoComercialByEmpresaId = async (empresaId: string) => {
  const payload = await fetchEmpresaPayloadById(empresaId);
  const empresa = extractEmpresaFromPayload(payload);
  if (empresa?.ObservacaoComercial && empresa.ObservacaoComercial.trim()) {
    return empresa.ObservacaoComercial.trim();
  }
  return readObsFromUnknown(payload);
};
