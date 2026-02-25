export type CepMapped = {
  cep?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  complemento?: string | null;
};

export const sanitizeCep = (value: string) => value.replace(/\D/g, "").slice(0, 8);

export const formatCep = (value: string) => {
  const digits = sanitizeCep(value);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

const pickValue = (data: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = data[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
};

export const isCepErrorPayload = (payload: Record<string, unknown>) => {
  const errorFlag = payload.erro ?? payload.Erro ?? payload.error ?? payload.Error;
  if (typeof errorFlag === "boolean") return errorFlag;
  if (typeof errorFlag === "string") return errorFlag.trim() !== "";
  return false;
};

export const mapCepResponse = (payload: Record<string, unknown>): CepMapped => {
  const tipoLogradouro = pickValue(payload, [
    "TipoLogradouro",
    "tipoLogradouro",
    "tipo_logradouro",
  ]);
  const logradouro = pickValue(payload, ["Logradouro", "logradouro"]);
  const enderecoBase = [tipoLogradouro, logradouro].filter(Boolean).join(" ").trim();
  const endereco = enderecoBase || pickValue(payload, ["endereco", "Endereco", "logradouro"]);

  return {
    cep: pickValue(payload, ["cep", "CEP"]),
    endereco,
    bairro: pickValue(payload, ["Bairro", "bairro"]),
    cidade: pickValue(payload, [
      "Municipio",
      "municipio",
      "Cidade",
      "cidade",
      "localidade",
      "Localidade",
    ]),
    uf: pickValue(payload, ["Uf", "uf", "UF"]),
    complemento: pickValue(payload, ["Complemento", "complemento"]),
  };
};
