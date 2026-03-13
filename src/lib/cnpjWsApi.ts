const CNPJ_WS_PUBLIC_URL = "https://publica.cnpj.ws/cnpj";

const toNullableString = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).trim();
  return cleaned ? cleaned : null;
};

const sanitizeCnpjDigits = (value: string) => value.replace(/\D/g, "").slice(0, 14);

type CnpjWsPayload = {
  razao_social?: string | null;
  estabelecimento?: {
    logradouro?: string | null;
    numero?: string | null;
    bairro?: string | null;
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

export const fetchEmpresaByCnpjWs = async (cnpj: string): Promise<CnpjWsEmpresa> => {
  const digits = sanitizeCnpjDigits(cnpj);
  if (digits.length !== 14) {
    throw new Error("Informe um CNPJ valido com 14 digitos.");
  }

  const response = await fetch(`${CNPJ_WS_PUBLIC_URL}/${digits}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error("CNPJ nao encontrado.");
    if (response.status === 429) {
      throw new Error("Limite de consultas da API de CNPJ atingido. Aguarde alguns segundos.");
    }
    throw new Error(`Falha ao consultar CNPJ (${response.status}).`);
  }

  const payload = (await response.json()) as CnpjWsPayload;
  const estabelecimento = payload.estabelecimento ?? null;

  return {
    razao_social: toNullableString(payload.razao_social),
    logradouro: toNullableString(estabelecimento?.logradouro),
    numero: toNullableString(estabelecimento?.numero),
    bairro: toNullableString(estabelecimento?.bairro),
    estado: readEstado(estabelecimento),
    cidade: readCidade(estabelecimento),
  };
};
