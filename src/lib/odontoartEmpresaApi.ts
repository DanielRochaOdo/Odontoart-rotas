const ODONTOART_EMPRESA_URL = "https://odontoart.s4e.com.br/api/empresa/BuscaEmpresas";
const ODONTOART_DEFAULT_TOKEN = "7DqKKmNcZDWY2Pie35tbKwY6hAKXzS5wWl7hNLAmPWBIljmfeX";
const ODONTOART_TIMEOUT_MS = 12000;
const ODONTOART_MAX_ATTEMPTS = 3;
const ODONTOART_CACHE_TTL_MS = 5 * 60 * 1000;
const ODONTOART_PROXY_URL = (import.meta.env.VITE_ODONTOART_PROXY_URL as string | undefined)?.trim() ?? "";

type OdontoartPayloadCacheEntry = {
  payload: unknown;
  expiresAt: number;
};

const odontoartPayloadCache = new Map<string, OdontoartPayloadCacheEntry>();
const odontoartInFlightRequests = new Map<string, Promise<unknown>>();

export type OdontoartPlanoCodigo = 2 | 18 | 19 | 20;

export type OdontoartPlanoValor = {
  planoCodigo: OdontoartPlanoCodigo;
  planoNome: "ODONTOART PJ INDIVIDUAL" | "Multimaster" | "Multiplus" | "Multiprev";
  valorTitular: number | null;
  valorDependente: number | null;
};

type OdontoartPrecoPlanoRow = {
  Plano?: number | string | null;
  ValorTitular?: number | string | null;
  ValorDependente?: number | string | null;
};

export type OdontoartEmpresaResponseRow = {
  Id?: number | string | null;
  AnoMesPrimeiroPagamento?: string | number | null;
  anoMesPrimeiroPagamento?: string | number | null;
  AnoMesPrimeiroPgto?: string | number | null;
  anoMesPrimeiroPgto?: string | number | null;
  DataContrato?: string | null;
  dataContrato?: string | null;
  Cnpj?: string | number | null;
  CNPJ?: string | number | null;
  cnpj?: string | number | null;
  CnpjCpf?: string | number | null;
  NomeFantasia?: string | null;
  NomeFantazia?: string | null;
  RazaoSocial?: string | null;
  NomeSituacao?: string | null;
  nomeSituacao?: string | null;
  ValorTitular?: number | string | null;
  Cep?: string | number | null;
  CEP?: string | number | null;
  cep?: string | number | null;
  CobrancaCep?: string | number | null;
  cobrancaCep?: string | number | null;
  FaturaCep?: string | number | null;
  faturaCep?: string | number | null;
  UfNome?: string | null;
  MunicipioNome?: string | null;
  Logradouro?: string | null;
  Numero?: number | string | null;
  BairroNome?: string | null;
  Corte?: number | string | null;
  Vencimento?: number | string | null;
  ObservacaoComercial?: string | null;
  PrecoPlano?: OdontoartPrecoPlanoRow[] | null;
};

const ODONTOART_PLANOS: Array<{ codigo: OdontoartPlanoCodigo; nome: OdontoartPlanoValor["planoNome"] }> = [
  { codigo: 2, nome: "ODONTOART PJ INDIVIDUAL" },
  { codigo: 18, nome: "Multiprev" },
  { codigo: 19, nome: "Multiplus" },
  { codigo: 20, nome: "Multimaster" },
];

const PLANO_CODE_KEYS = [
  "Plano",
  "plano",
  "IdPlano",
  "idPlano",
  "PlanoId",
  "planoId",
  "CodigoPlano",
  "codigoPlano",
  "id",
] as const;

const PLANO_VALOR_TITULAR_KEYS = [
  "ValorTitular",
  "valorTitular",
  "valor_titular",
  "Titular",
  "titular",
] as const;

const PLANO_VALOR_DEPENDENTE_KEYS = [
  "ValorDependente",
  "valorDependente",
  "valor_dependente",
  "Dependente",
  "dependente",
] as const;

const parseNumberFromUnknown = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parsePlanoCodigo = (value: unknown): OdontoartPlanoCodigo | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 2 || value === 18 || value === 19 || value === 20) return value;
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    const parsed = Number(normalized);
    if (parsed === 2 || parsed === 18 || parsed === 19 || parsed === 20) return parsed;
    const firstNumber = Number(normalized.match(/\d+/)?.[0] ?? "");
    if (firstNumber === 2 || firstNumber === 18 || firstNumber === 19 || firstNumber === 20) return firstNumber;
  }
  if (typeof value === "object" && value !== null) {
    const maybeRecord = value as Record<string, unknown>;
    const nested =
      parsePlanoCodigo(maybeRecord.Plano) ??
      parsePlanoCodigo(maybeRecord.plano) ??
      parsePlanoCodigo(maybeRecord.id);
    if (nested) return nested;
  }
  return null;
};

const readRecordValueByKeyInsensitive = (record: Record<string, unknown>, key: string) => {
  if (key in record) return record[key];
  const target = key.toLowerCase();
  const foundKey = Object.keys(record).find((candidate) => candidate.toLowerCase() === target);
  if (!foundKey) return undefined;
  return record[foundKey];
};

const readRecordValueByKeys = (record: Record<string, unknown>, keys: readonly string[]) => {
  for (const key of keys) {
    const value = readRecordValueByKeyInsensitive(record, key);
    if (value !== undefined) return value;
  }
  return undefined;
};

const collectPlanoCandidates = (
  value: unknown,
  target: Array<{
    codigo: OdontoartPlanoCodigo;
    valorTitular: number | null;
    valorDependente: number | null;
  }>,
  depth = 0,
) => {
  if (depth > 6 || value === null || value === undefined) return;

  if (Array.isArray(value)) {
    value.forEach((item) => collectPlanoCandidates(item, target, depth + 1));
    return;
  }

  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const rawPlano = readRecordValueByKeys(record, PLANO_CODE_KEYS);
  const codigo = parsePlanoCodigo(rawPlano);
  const valorTitular = parseNumberFromUnknown(readRecordValueByKeys(record, PLANO_VALOR_TITULAR_KEYS));
  const valorDependente = parseNumberFromUnknown(readRecordValueByKeys(record, PLANO_VALOR_DEPENDENTE_KEYS));
  const hasPlanoField = rawPlano !== undefined;
  const hasAnyValorField =
    readRecordValueByKeys(record, PLANO_VALOR_TITULAR_KEYS) !== undefined ||
    readRecordValueByKeys(record, PLANO_VALOR_DEPENDENTE_KEYS) !== undefined;

  if (codigo && (hasPlanoField || hasAnyValorField)) {
    target.push({
      codigo,
      valorTitular,
      valorDependente,
    });
  }

  Object.values(record).forEach((nested) => collectPlanoCandidates(nested, target, depth + 1));
};

export const extractOdontoartPlanoValores = (
  empresa: OdontoartEmpresaResponseRow,
): OdontoartPlanoValor[] => {
  const byPlano = new Map<
    OdontoartPlanoCodigo,
    { valorTitular: number | null; valorDependente: number | null }
  >();

  const candidates: Array<{
    codigo: OdontoartPlanoCodigo;
    valorTitular: number | null;
    valorDependente: number | null;
  }> = [];

  collectPlanoCandidates(empresa, candidates);

  candidates.forEach((candidate) => {
    const previous = byPlano.get(candidate.codigo);
    byPlano.set(candidate.codigo, {
      valorTitular: candidate.valorTitular ?? previous?.valorTitular ?? null,
      valorDependente: candidate.valorDependente ?? previous?.valorDependente ?? null,
    });
  });

  return ODONTOART_PLANOS.map(({ codigo, nome }) => {
    const row = byPlano.get(codigo);
    return {
      planoCodigo: codigo,
      planoNome: nome,
      valorTitular: row?.valorTitular ?? null,
      valorDependente: row?.valorDependente ?? null,
    };
  });
};

export const resolveOdontoartValorTitular = (empresa: OdontoartEmpresaResponseRow) => {
  const fromPlanos = extractOdontoartPlanoValores(empresa).find((plano) => plano.valorTitular !== null);
  if (fromPlanos?.valorTitular !== null && fromPlanos?.valorTitular !== undefined) {
    return fromPlanos.valorTitular;
  }
  return parseNumberFromUnknown(empresa.ValorTitular);
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

  const cached = odontoartPayloadCache.get(trimmedEmpresaId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const runningRequest = odontoartInFlightRequests.get(trimmedEmpresaId);
  if (runningRequest) {
    return runningRequest;
  }

  const loadPayload = async () => {
    const remember = (payload: unknown) => {
      odontoartPayloadCache.set(trimmedEmpresaId, {
        payload,
        expiresAt: Date.now() + ODONTOART_CACHE_TTL_MS,
      });
      return payload;
    };

    const fetchViaProxy = async () => {
      const response = await fetch(ODONTOART_PROXY_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({ empresaId: trimmedEmpresaId }),
      });
      if (!response.ok) {
        throw new Error(`Falha ao consultar proxy Odontoart (${response.status}).`);
      }
      return (await response.json()) as unknown;
    };

    if (ODONTOART_PROXY_URL) {
      return remember(await fetchViaProxy());
    }

    const token = (import.meta.env.VITE_ODONTOART_TOKEN as string | undefined)?.trim() || ODONTOART_DEFAULT_TOKEN;
    const isNumericCode = /^\d+$/.test(trimmedEmpresaId);
    const codeCandidates = Array.from(
      new Set(
        [
          trimmedEmpresaId,
          isNumericCode ? trimmedEmpresaId.replace(/^0+/, "") : "",
          isNumericCode ? String(Number(trimmedEmpresaId)) : "",
        ].filter(Boolean),
      ),
    );

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    const shouldRetryStatus = (status: number) =>
      status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

    const fetchCandidate = async (candidate: string) => {
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= ODONTOART_MAX_ATTEMPTS; attempt += 1) {
        const search = new URLSearchParams({
          token,
          empresaId: candidate,
        });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ODONTOART_TIMEOUT_MS);

        try {
          const response = await fetch(`${ODONTOART_EMPRESA_URL}?${search.toString()}`, {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
            signal: controller.signal,
          });

          if (!response.ok) {
            const retriable = shouldRetryStatus(response.status);
            if (!retriable || attempt >= ODONTOART_MAX_ATTEMPTS) {
              throw new Error(`Falha ao consultar empresa (${response.status}).`);
            }
            await sleep(250 * attempt);
            continue;
          }

          return (await response.json()) as unknown;
        } catch (error) {
          const isAbort = error instanceof Error && error.name === "AbortError";
          const transient =
            isAbort ||
            (error instanceof TypeError && /network|fetch|failed/i.test(error.message));
          lastError = isAbort
            ? new Error("Tempo limite excedido ao consultar API da Odontoart.")
            : error instanceof Error
              ? error
              : new Error("Erro de comunicacao com API da Odontoart.");
          if (!transient || attempt >= ODONTOART_MAX_ATTEMPTS) {
            throw lastError;
          }
          await sleep(250 * attempt);
        } finally {
          clearTimeout(timeoutId);
        }
      }

      if (lastError) throw lastError;
      throw new Error("Falha ao consultar API da Odontoart.");
    };

    let lastPayload: unknown = null;
    for (const candidate of codeCandidates) {
      const payload = await fetchCandidate(candidate);
      lastPayload = payload;
      const empresa = extractEmpresaFromPayload(payload);
      if (empresa) return remember(payload);
    }

    return remember(lastPayload);
  };

  const request = loadPayload().finally(() => {
    odontoartInFlightRequests.delete(trimmedEmpresaId);
  });
  odontoartInFlightRequests.set(trimmedEmpresaId, request);
  return request;
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
