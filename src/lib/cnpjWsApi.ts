const CNPJ_WS_PUBLIC_URL = "https://publica.cnpj.ws/cnpj";

const toNullableString = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).trim();
  return cleaned ? cleaned : null;
};

const sanitizeCnpjDigits = (value: string) => value.replace(/\D/g, "").slice(0, 14);

const calculateCnpjCheckDigit = (base: string, weights: number[]) => {
  const total = weights.reduce((sum, weight, index) => sum + Number(base[index]) * weight, 0);
  const remainder = total % 11;
  return remainder < 2 ? 0 : 11 - remainder;
};

const isValidCnpjDigits = (digits: string) => {
  if (!/^\d{14}$/.test(digits)) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const firstDigit = calculateCnpjCheckDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (firstDigit !== Number(digits[12])) return false;

  const secondDigit = calculateCnpjCheckDigit(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return secondDigit === Number(digits[13]);
};

type CnpjWsPayload = {
  message?: string | null;
  error?: string | null;
  detail?: string | null;
  razao_social?: string | null;
  estabelecimento?: {
    logradouro?: string | null;
    numero?: string | null;
    bairro?: string | null;
    cep?: string | number | null;
    estado?:
      | {
          sigla?: string | null;
          nome?: string | null;
        }
      | string
      | null;
    cidade?:
      | {
          nome?: string | null;
        }
      | string
      | null;
  } | null;
};

export type CnpjWsEmpresa = {
  razao_social: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cep: string | null;
  estado: string | null;
  cidade: string | null;
};

const readEstado = (value: CnpjWsPayload["estabelecimento"]) => {
  const estado = value?.estado;
  if (!estado) return null;
  if (typeof estado === "string") {
    const sigla = toNullableString(estado)?.toUpperCase() ?? null;
    if (!sigla) return null;
    return sigla.length <= 3 ? sigla : null;
  }
  const sigla = toNullableString(estado.sigla)?.toUpperCase() ?? null;
  if (!sigla) return null;
  return sigla.length <= 3 ? sigla : null;
};

const readCidade = (value: CnpjWsPayload["estabelecimento"]) => {
  const cidade = value?.cidade;
  if (!cidade) return null;
  if (typeof cidade === "string") return toNullableString(cidade);
  return toNullableString(cidade.nome);
};

const readErrorMessage = async (response: Response) => {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as CnpjWsPayload;
      return (
        toNullableString(payload.message) ??
        toNullableString(payload.error) ??
        toNullableString(payload.detail) ??
        null
      );
    }
    const text = (await response.text()).trim();
    return text || null;
  } catch {
    return null;
  }
};

export const fetchEmpresaByCnpjWs = async (cnpj: string): Promise<CnpjWsEmpresa> => {
  const digits = sanitizeCnpjDigits(cnpj);
  if (digits.length !== 14) {
    throw new Error("Informe um CNPJ valido com 14 digitos.");
  }
  if (!isValidCnpjDigits(digits)) {
    throw new Error("CNPJ invalido.");
  }

  const response = await fetch(`${CNPJ_WS_PUBLIC_URL}/${digits}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const apiErrorMessage = await readErrorMessage(response);
    if (response.status === 400) {
      throw new Error(apiErrorMessage ?? "CNPJ invalido ou indisponivel na API.");
    }
    if (response.status === 404) throw new Error("CNPJ nao encontrado.");
    if (response.status === 429) {
      throw new Error("Limite de consultas da API de CNPJ atingido. Aguarde alguns segundos.");
    }
    throw new Error(apiErrorMessage ?? `Falha ao consultar CNPJ (${response.status}).`);
  }

  const payload = (await response.json()) as CnpjWsPayload;
  const estabelecimento = payload.estabelecimento ?? null;

  return {
    razao_social: toNullableString(payload.razao_social),
    logradouro: toNullableString(estabelecimento?.logradouro),
    numero: toNullableString(estabelecimento?.numero),
    bairro: toNullableString(estabelecimento?.bairro),
    cep: toNullableString(estabelecimento?.cep),
    estado: readEstado(estabelecimento),
    cidade: readCidade(estabelecimento),
  };
};
