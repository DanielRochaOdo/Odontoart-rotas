export const DATA_CORTE_FILA = "2026-01-01";

export type DataContratoBloqueioReason =
  | "DATA_CONTRATO_INVALIDA_OU_AUSENTE"
  | "DATA_CONTRATO_FORA_DO_CORTE";

export type DataContratoDetalheReason =
  | "API_DATA_CONTRATO_NAO_RETORNADA"
  | "API_DATA_CONTRATO_FORMATO_INVALIDO"
  | "DATA_CONTRATO_FORA_DO_CORTE"
  | "DATA_CONTRATO_ELEGIVEL";

type DataContratoEvaluation =
  | {
      eligible: true;
      dataContratoIso: string;
      reason: "DATA_CONTRATO_ELEGIVEL";
    }
  | {
      eligible: false;
      dataContratoIso: string | null;
      reason: DataContratoBloqueioReason;
      detailReason: DataContratoDetalheReason;
    };

const pad2 = (value: number) => String(value).padStart(2, "0");

const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const isValidDateParts = (year: number, month: number, day: number) => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;

  const monthDays = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1];
};

const buildIso = (year: number, month: number, day: number) =>
  `${String(year)}-${pad2(month)}-${pad2(day)}`;

const toInt = (value: string) => Number.parseInt(value, 10);

export const parseDataContratoToIso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const mmYyyy = raw.match(/^(\d{2})\/(\d{4})$/);
  if (mmYyyy) {
    const month = toInt(mmYyyy[1]);
    const year = toInt(mmYyyy[2]);
    if (!isValidDateParts(year, month, 1)) return null;
    return buildIso(year, month, 1);
  }

  const ddMmYyyy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddMmYyyy) {
    const day = toInt(ddMmYyyy[1]);
    const month = toInt(ddMmYyyy[2]);
    const year = toInt(ddMmYyyy[3]);
    if (!isValidDateParts(year, month, day)) return null;
    return buildIso(year, month, day);
  }

  const yyyyMmDd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyyMmDd) {
    const year = toInt(yyyyMmDd[1]);
    const month = toInt(yyyyMmDd[2]);
    const day = toInt(yyyyMmDd[3]);
    if (!isValidDateParts(year, month, day)) return null;
    return buildIso(year, month, day);
  }

  const yyyyMmDdSlash = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (yyyyMmDdSlash) {
    const year = toInt(yyyyMmDdSlash[1]);
    const month = toInt(yyyyMmDdSlash[2]);
    const day = toInt(yyyyMmDdSlash[3]);
    if (!isValidDateParts(year, month, day)) return null;
    return buildIso(year, month, day);
  }

  const yyyyMmDdCompact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (yyyyMmDdCompact) {
    const year = toInt(yyyyMmDdCompact[1]);
    const month = toInt(yyyyMmDdCompact[2]);
    const day = toInt(yyyyMmDdCompact[3]);
    if (!isValidDateParts(year, month, day)) return null;
    return buildIso(year, month, day);
  }

  const yyyyMm = raw.match(/^(\d{4})-(\d{2})$/);
  if (yyyyMm) {
    const year = toInt(yyyyMm[1]);
    const month = toInt(yyyyMm[2]);
    if (!isValidDateParts(year, month, 1)) return null;
    return buildIso(year, month, 1);
  }

  const yyyyMmSlash = raw.match(/^(\d{4})\/(\d{2})$/);
  if (yyyyMmSlash) {
    const year = toInt(yyyyMmSlash[1]);
    const month = toInt(yyyyMmSlash[2]);
    if (!isValidDateParts(year, month, 1)) return null;
    return buildIso(year, month, 1);
  }

  const yyyyMmCompact = raw.match(/^(\d{4})(\d{2})$/);
  if (yyyyMmCompact) {
    const year = toInt(yyyyMmCompact[1]);
    const month = toInt(yyyyMmCompact[2]);
    if (!isValidDateParts(year, month, 1)) return null;
    return buildIso(year, month, 1);
  }

  return null;
};

export const isDataContratoElegivelParaFila = (dataContratoIso: string) =>
  dataContratoIso >= DATA_CORTE_FILA;

const readObjectValueByKeys = (value: unknown, keys: string[]) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keyMap = new Map(Object.keys(record).map((key) => [key.toLowerCase(), key]));

  for (const key of keys) {
    const mappedKey = keyMap.get(key.toLowerCase());
    if (!mappedKey) continue;
    const candidate = record[mappedKey];
    if (candidate !== null && candidate !== undefined && String(candidate).trim() !== "") {
      return candidate;
    }
  }

  return undefined;
};

const parseAnoMesPrimeiroPagamentoToIso = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return parseDataContratoToIso(value);
};

export const resolveFilaDataContratoToIso = (empresa: unknown) => {
  const primeiroPagamento = readObjectValueByKeys(empresa, [
    "AnoMesPrimeiroPagamento",
    "anoMesPrimeiroPagamento",
    "AnoMesPrimeiroPgto",
    "anoMesPrimeiroPgto",
    "ANO_MES_PRIMEIRO_PAGAMENTO",
  ]);
  const primeiroPagamentoIso = parseAnoMesPrimeiroPagamentoToIso(primeiroPagamento);
  if (primeiroPagamentoIso) return primeiroPagamentoIso;

  const dataContrato = readObjectValueByKeys(empresa, ["DataContrato", "dataContrato"]);
  return parseDataContratoToIso(dataContrato);
};

export const evaluateFilaEmpresaForQueue = (empresa: unknown) =>
  evaluateDataContratoForFila(resolveFilaDataContratoToIso(empresa));

export const evaluateDataContratoForFila = (value: unknown): DataContratoEvaluation => {
  if (value === null || value === undefined || String(value).trim() === "") {
    return {
      eligible: false,
      dataContratoIso: null,
      reason: "DATA_CONTRATO_INVALIDA_OU_AUSENTE",
      detailReason: "API_DATA_CONTRATO_NAO_RETORNADA",
    };
  }

  const parsed = parseDataContratoToIso(value);
  if (!parsed) {
    return {
      eligible: false,
      dataContratoIso: null,
      reason: "DATA_CONTRATO_INVALIDA_OU_AUSENTE",
      detailReason: "API_DATA_CONTRATO_FORMATO_INVALIDO",
    };
  }

  if (!isDataContratoElegivelParaFila(parsed)) {
    return {
      eligible: false,
      dataContratoIso: parsed,
      reason: "DATA_CONTRATO_FORA_DO_CORTE",
      detailReason: "DATA_CONTRATO_FORA_DO_CORTE",
    };
  }

  return {
    eligible: true,
    dataContratoIso: parsed,
    reason: "DATA_CONTRATO_ELEGIVEL",
  };
};
