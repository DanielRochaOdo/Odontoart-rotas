import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { BrushCleaning, Building2, ChevronLeft, ChevronRight, DollarSign, LoaderCircle, Plus, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "../context/AuthContext";
import {
  createCliente,
  deleteCliente,
  fetchClienteById,
  fetchClientesCount,
  fetchClientesByCodigoExact,
  fetchClientesByCnpjExact,
  fetchClientesByEnderecoExact,
  fetchClientesPage,
  fetchClienteHistory,
  updateCliente,
  syncVisitsForCliente,
  upsertClientes,
} from "../lib/clientesApi";
import { fetchSupervisores } from "../lib/agendaApi";
import { supabase } from "../lib/supabase";
import type { ClienteHistoryRow, ClienteRow } from "../types/clientes";
import {
  PERFIL_VISITA_PRESETS,
  extractCustomTimes,
  getSingleTimePerfilBase,
  getSingleTimePerfilValue,
  isPresetPerfilVisita,
  normalizePerfilVisita,
} from "../lib/perfilVisita";
import { formatCep, isCepErrorPayload, mapCepResponse, sanitizeCep } from "../lib/cep";
import {
  extractOdontoartPlanoValores,
  fetchEmpresaByEmpresaId,
  resolveOdontoartValorTitular,
  type OdontoartPlanoValor,
  type OdontoartEmpresaResponseRow,
} from "../lib/odontoartEmpresaApi";
import { fetchEmpresaByCnpjWs } from "../lib/cnpjWsApi";
import { normalizeSearchText } from "../lib/textNormalize";
import { CATEGORIA_OPTIONS } from "../lib/categorias";
import CategoriaLegendPopover from "../components/agenda/CategoriaLegendPopover";

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isDateOnly ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR").format(date);
};

const getDateMs = (value: string | null) => {
  if (!value) return null;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isDateOnly ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
};

const toDateInput = (value: string | null) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const toIsoDateInput = (value: string) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00`).toISOString();
  }
  return parseImportDate(value);
};

const normalizeAddressValue = (value: string | null | undefined) =>
  normalizeSearchText(value);

const debugCreateFlow = (_event?: unknown) => {
  // Intentionally no-op in production build.
};

type AddressIdentity = {
  endereco?: string | null;
  cidade?: string | null;
  uf?: string | null;
  complemento?: string | null;
};

const isSameAddress = (a: AddressIdentity, b: AddressIdentity) => {
  const enderecoA = normalizeAddressValue(a.endereco);
  const enderecoB = normalizeAddressValue(b.endereco);
  if (!enderecoA || !enderecoB) return false;
  if (enderecoA !== enderecoB) return false;
  const cidadeA = normalizeAddressValue(a.cidade);
  const cidadeB = normalizeAddressValue(b.cidade);
  const ufA = normalizeAddressValue(a.uf);
  const ufB = normalizeAddressValue(b.uf);
  if (cidadeA && cidadeB && cidadeA !== cidadeB) return false;
  if (ufA && ufB && ufA !== ufB) return false;
  const complementoA = normalizeAddressValue(a.complemento);
  const complementoB = normalizeAddressValue(b.complemento);
  return complementoA === complementoB;
};

type DuplicateEntry = {
  newCliente: ClienteRow;
  existing: ClienteRow[];
  isTemp?: boolean;
  payload?: ImportPayload;
};

type ClienteSearchMode = "codigo" | "empresa" | "geral";

type CadastroFormState = {
  codigo: string;
  cnpj: string;
  corte: string;
  venc: string;
  valor: string;
  data_da_ultima_visita: string;
  cep: string;
  empresa: string;
  pessoa: string;
  contato: string;
  grupo: string;
  obs_comercial: string;
  obs: string;
  situacao: string;
  categoria: string;
  endereco: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

type FilialConfirmModalState = {
  flowId: number;
  codigo: string;
  empresa: string;
  existingCount: number;
  draft: CadastroFormState;
  source: "codigo" | "cnpj";
  lookupError: string | null;
};

type FilialCadastroModalState = {
  flowId: number;
  form: CadastroFormState;
  existingCount: number;
  error: string | null;
};

type ClientesViewState = {
  search: string;
  searchMode: ClienteSearchMode;
  situacaoFilter: "" | "Ativo" | "Suspenso/Inadimplente" | "Cancelado";
  currentPage: number;
  selectedId: string | null;
  isEditing: boolean;
  historySupervisorId: string;
  historyDateFrom: string;
  historyDateTo: string;
  createFlowId: number;
  form: CadastroFormState;
  perfilCreate: ReturnType<typeof buildPerfilState>;
  createPlanoValores: OdontoartPlanoValor[];
  filialConfirmModal: FilialConfirmModalState | null;
  filialCadastroModal: FilialCadastroModalState | null;
};

type ImportPayload = {
  codigo?: string | null;
  cnpj?: string | null;
  valor?: number | null;
  cep?: string | null;
  empresa?: string | null;
  pessoa?: string | null;
  contato?: string | null;
  grupo?: string | null;
  obs_comercial?: string | null;
  obs?: string | null;
  situacao?: string | null;
  categoria?: string | null;
  perfil_visita?: string | null;
  endereco?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  corte?: number | null;
  venc?: number | null;
  data_da_ultima_visita?: string | null;
};

const buildImportKey = (payload: {
  codigo?: string | null;
  empresa?: string | null;
  endereco?: string | null;
  cidade?: string | null;
  uf?: string | null;
  complemento?: string | null;
}) =>
  [
    normalizeAddressValue(payload.codigo ?? ""),
    normalizeAddressValue(payload.empresa ?? ""),
    normalizeAddressValue(payload.endereco ?? ""),
    normalizeAddressValue(payload.cidade ?? ""),
    normalizeAddressValue(payload.uf ?? ""),
    normalizeAddressValue(payload.complemento ?? ""),
  ].join("|");

const buildClientePayloadFromImport = (payload: ImportPayload) => ({
  codigo: payload.codigo ?? null,
  cnpj: normalizeCnpj(payload.cnpj),
  corte: payload.corte ?? null,
  venc: payload.venc ?? null,
  valor: payload.valor ?? null,
  data_da_ultima_visita: payload.data_da_ultima_visita ?? null,
  cep: payload.cep ?? null,
  empresa: payload.empresa ?? null,
  pessoa: payload.pessoa ?? null,
  contato: normalizeContato(payload.contato ?? ""),
  grupo: payload.grupo ?? null,
  obs_comercial: payload.obs_comercial ?? null,
  obs: payload.obs ?? null,
  complemento: payload.complemento ?? null,
  perfil_visita: payload.perfil_visita ?? null,
  situacao: "Ativo",
  categoria: payload.categoria ?? null,
  endereco: payload.endereco ?? null,
  bairro: payload.bairro ?? null,
  cidade: payload.cidade ?? null,
  uf: payload.uf ?? null,
});

const buildPerfilState = (value: string | null) => {
  const normalized = normalizePerfilVisita(value);
  const customTimes = extractCustomTimes(value);
  const singleTimeBase = normalized.startsWith("ALMOCO")
    ? "ALMOCO"
    : normalized.startsWith("JANTAR")
      ? "JANTAR"
      : "";
  const singleTimeValue = singleTimeBase ? customTimes[0] ?? "" : "";
  if (singleTimeBase) {
    return {
      perfil: singleTimeValue ? `${singleTimeBase} ${singleTimeValue}` : singleTimeBase,
      customEnabled: false,
      customTimes: [],
      singleTimeBase,
      singleTimeValue,
    };
  }
  const isCustom = normalized !== "" && !isPresetPerfilVisita(normalized);
  return {
    perfil: isCustom ? customTimes.join(" â€¢ ") : normalized,
    customEnabled: isCustom,
    customTimes: isCustom ? (customTimes.length ? customTimes : [""]) : [],
    singleTimeBase: "",
    singleTimeValue: "",
  };
};

const SITUACAO_OPTIONS = ["Ativo", "Suspenso/Inadimplente", "Cancelado"] as const;

const normalizeHeader = (value: string) =>
  normalizeSearchText(value);

const IMPORT_NUMERIC_FIELDS = new Set(["corte", "venc"]);
const IMPORT_BATCH_SIZE = 80;
const CLIENTES_DEFAULT_PAGE_SIZE = 50;
const CLIENTES_VIEW_STATE_KEY = "clientesViewStateV2";
const isClienteSearchMode = (value: unknown): value is ClienteSearchMode =>
  value === "codigo" || value === "empresa" || value === "geral";
const isSituacaoFilterValue = (
  value: unknown,
): value is "" | "Ativo" | "Suspenso/Inadimplente" | "Cancelado" =>
  value === "" || value === "Ativo" || value === "Suspenso/Inadimplente" || value === "Cancelado";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const sanitizeDigits = (value: string) => value.replace(/\D/g, "");
const sanitizeCnpjDigits = (value: string) => sanitizeDigits(value).slice(0, 14);
const formatCnpjInput = (value: string) => {
  const digits = sanitizeCnpjDigits(value);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};
const normalizeCnpj = (value: string | null | undefined) => {
  const digits = sanitizeCnpjDigits(value ?? "");
  if (digits.length !== 14) return null;
  return formatCnpjInput(digits);
};
const sanitizeContatoInput = (value: string) =>
  value
    .replace(/\./g, ",")
    .replace(/[^\d,]/g, "")
    .replace(/,+/g, ",")
    .replace(/^,+/, "");

const normalizeContato = (value: string) => {
  const contatos = sanitizeContatoInput(value)
    .replace(/^,+|,+$/g, "")
    .split(",")
    .map((item) => sanitizeDigits(item).slice(0, 11))
    .map((digits) => (digits ? digits : ""))
    .filter(Boolean);
  if (!contatos.length) return null;
  return contatos.join(", ");
};

const parseImportCurrency = (value: string) => {
  const cleaned = value.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatCurrency = (value: number | string | null) => {
  if (value === null || value === "") return "";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(numeric);
};

const resolveCnpjFromEmpresa = (empresa: OdontoartEmpresaResponseRow) => {
  const candidates: Array<string | number | null | undefined> = [
    empresa.CNPJ,
    empresa.Cnpj,
    empresa.cnpj,
    empresa.CnpjCpf,
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const formatted = normalizeCnpj(String(candidate));
    if (formatted) return formatted;
  }
  return "";
};

const resolveEmpresaFromApi = (empresa: OdontoartEmpresaResponseRow) =>
  (empresa.NomeFantazia ?? empresa.NomeFantasia ?? empresa.RazaoSocial ?? "").trim();

const resolveCepFromEmpresa = (empresa: OdontoartEmpresaResponseRow) => {
  const candidates: Array<string | number | null | undefined> = [
    empresa.Cep,
    empresa.CEP,
    empresa.cep,
    empresa.CobrancaCep,
    empresa.cobrancaCep,
    empresa.FaturaCep,
    empresa.faturaCep,
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const formatted = formatCep(String(candidate));
    if (sanitizeCep(formatted).length === 8) return formatted;
  }
  return "";
};

const buildEnderecoWithNumero = (logradouro: string | null, numero: string | null) =>
  [logradouro?.trim(), numero?.trim()].filter(Boolean).join(", ");

const readValueByKeysFromUnknown = (
  value: unknown,
  keys: string[],
  depth = 0,
): unknown => {
  if (depth > 5 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readValueByKeysFromUnknown(item, keys, depth + 1);
      if (found !== undefined && found !== null) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const lowerKeyMap = new Map(Object.keys(record).map((key) => [key.toLowerCase(), key]));
  for (const key of keys) {
    const direct = lowerKeyMap.get(key.toLowerCase());
    if (!direct) continue;
    const candidate = record[direct];
    if (candidate !== undefined && candidate !== null && String(candidate).trim() !== "") {
      return candidate;
    }
  }
  for (const nested of Object.values(record)) {
    const found = readValueByKeysFromUnknown(nested, keys, depth + 1);
    if (found !== undefined && found !== null) return found;
  }
  return undefined;
};

const readStringByKeysFromUnknown = (value: unknown, keys: string[]) => {
  const found = readValueByKeysFromUnknown(value, keys);
  if (typeof found === "string") {
    const trimmed = found.trim();
    return trimmed || "";
  }
  if (typeof found === "number" && Number.isFinite(found)) {
    return String(found).trim();
  }
  return "";
};

const readNumberLikeStringByKeysFromUnknown = (value: unknown, keys: string[]) => {
  const found = readValueByKeysFromUnknown(value, keys);
  if (found === undefined || found === null) return "";
  if (typeof found === "number" && Number.isFinite(found)) return String(found);
  if (typeof found === "string") return found.trim();
  return "";
};

const mapEmpresaApiToClienteForm = (empresa: OdontoartEmpresaResponseRow, codigoFallback: string) => {
  const codigo =
    empresa.Id !== null && empresa.Id !== undefined
      ? String(empresa.Id).trim()
      : codigoFallback.trim();
  const logradouro = (empresa.Logradouro ?? "").trim();
  const numero =
    empresa.Numero !== null && empresa.Numero !== undefined
      ? String(empresa.Numero).trim()
      : "";
  const endereco = buildEnderecoWithNumero(logradouro, numero);
  const valorTitular = resolveOdontoartValorTitular(empresa);
  const situacaoRaw =
    (empresa.NomeSituacao ?? empresa.nomeSituacao ?? "").trim() ||
    readStringByKeysFromUnknown(empresa, [
      "NomeSituacao",
      "nomeSituacao",
      "nome_situacao",
      "situacao",
      "status",
    ]);
  const situacao = normalizeStatus(situacaoRaw) ?? situacaoRaw;
  const corteFromApi =
    (empresa.Corte !== null && empresa.Corte !== undefined
      ? String(empresa.Corte).trim()
      : "") ||
    readNumberLikeStringByKeysFromUnknown(empresa, ["Corte", "corte", "DiaCorte", "diaCorte"]);
  const vencFromApi =
    (empresa.Vencimento !== null && empresa.Vencimento !== undefined
      ? String(empresa.Vencimento).trim()
      : "") ||
    readNumberLikeStringByKeysFromUnknown(empresa, [
      "Vencimento",
      "vencimento",
      "DiaVencimento",
      "diaVencimento",
      "Venc",
      "venc",
    ]);
  const obsComercialFromApi =
    (empresa.ObservacaoComercial ?? "").trim() ||
    readStringByKeysFromUnknown(empresa, [
      "ObservacaoComercial",
      "observacaoComercial",
      "observacao_comercial",
      "ObsComercial",
      "obsComercial",
    ]);
  const grupoFromApi =
    (empresa.EmpresaGrupo ?? empresa.empresaGrupo ?? "").trim() ||
    readStringByKeysFromUnknown(empresa, ["EmpresaGrupo", "empresaGrupo", "Grupo", "grupo"]);

  return {
    codigo,
    cnpj: resolveCnpjFromEmpresa(empresa),
    corte: corteFromApi,
    venc: vencFromApi,
    valor: valorTitular !== null ? formatCurrency(valorTitular) : "",
    data_da_ultima_visita: "",
    cep: resolveCepFromEmpresa(empresa),
    empresa: resolveEmpresaFromApi(empresa),
    pessoa: "",
    contato: "",
    grupo: grupoFromApi,
    obs_comercial: obsComercialFromApi,
    obs: "",
    situacao,
    categoria: "",
    endereco,
    complemento: "",
    bairro: (empresa.BairroNome ?? "").trim(),
    cidade: (empresa.MunicipioNome ?? "").trim(),
    uf: (empresa.UfNome ?? "").trim(),
  };
};

const normalizeCodigoValue = (value: string | null | undefined) => (value ?? "").trim();

const isClienteNotFoundErrorMessage = (message: string | null | undefined) => {
  const normalized = (message ?? "").toLowerCase();
  return normalized.includes("cliente") && normalized.includes("nao encontrado");
};

const enrichFormDataCepByAddress = async (
  formData: ReturnType<typeof mapEmpresaApiToClienteForm>,
) => {
  return formData;
};

const excelSerialToISOString = (serial: number) => {
  if (!Number.isFinite(serial)) return null;
  const utcMs = Date.UTC(1899, 11, 30) + serial * 86400000;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}T12:00:00.000Z`;
};

const parseImportDate = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T12:00:00.000Z`;
  }

  const match = trimmed.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    const dateKey = `${year}-${month}-${day}`;
    return `${dateKey}T12:00:00.000Z`;
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric >= 20000 && numeric <= 60000) {
      const excelDate = excelSerialToISOString(numeric);
      if (excelDate) return excelDate;
    }
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T12:00:00.000Z`;
};

const HEADER_MAP: Record<string, string> = {
  codigo: "codigo",
  cod: "codigo",
  cnpj: "cnpj",
  corte: "corte",
  venc: "venc",
  vencimento: "venc",
  "data ultima visita": "data_da_ultima_visita",
  "data da ultima visita": "data_da_ultima_visita",
  data_ultima_visita: "data_da_ultima_visita",
  data_da_ultima_visita: "data_da_ultima_visita",
  "ultima visita": "data_da_ultima_visita",
  valor: "valor",
  cep: "cep",
  empresa: "empresa",
  pessoa: "pessoa",
  contato: "contato",
  grupo: "grupo",
  "obs comercial": "obs_comercial",
  obs_comercial: "obs_comercial",
  "obs. comercial": "obs_comercial",
  "observacao comercial": "obs_comercial",
  obs: "obs",
  observacao: "obs",
  "obs filial": "obs",
  "observacao filial": "obs",
  situacao: "situacao",
  categoria: "categoria",
  categ: "categoria",
  "perfil visita": "perfil_visita",
  perfil: "perfil_visita",
  perfil_visita: "perfil_visita",
  endereco: "endereco",
  complemento: "complemento",
  bairro: "bairro",
  cidade: "cidade",
  uf: "uf",
};

const normalizeStatus = (value: string) => {
  const cleaned = normalizeSearchText(value);
  if (cleaned.startsWith("ativo")) return "Ativo";
  if (cleaned.startsWith("cancelado")) return "Cancelado";
  if (cleaned.includes("suspenso") || cleaned.includes("inadimplente") || cleaned.includes("inadimlente")) {
    return "Suspenso/Inadimplente";
  }
  return null;
};

const normalizeSituacaoForCadastroGate = (value: string | null | undefined) => {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const normalized = normalizeStatus(raw) ?? raw;
  const cleaned = normalizeSearchText(normalized).replace(/\s*-\s*/g, "/");
  if (cleaned.startsWith("ativo")) return "ATIVO";
  if (
    cleaned.includes("suspenso") &&
    (cleaned.includes("inadimplente") || cleaned.includes("inadimlente"))
  ) {
    return "SUSPENSO/INADIMPLENTE";
  }
  return cleaned.toUpperCase();
};

const isSituacaoAllowedForCadastro = (value: string | null | undefined) => {
  const normalized = normalizeSituacaoForCadastroGate(value);
  return normalized === "ATIVO" || normalized === "SUSPENSO/INADIMPLENTE";
};

const getSituacaoCadastroErrorMessage = (situacao: string | null | undefined) => {
  const raw = (situacao ?? "").trim();
  return `Cadastro permitido apenas para empresas com NomeSituacao ATIVO ou SUSPENSO - INADIMPLENTE.${
    raw ? ` Situacao recebida: ${raw}.` : ""
  }`;
};

const normalizeName = (value: string | null) =>
  normalizeSearchText(value);

const formatPerfilDisplay = (value: string | null) => {
  if (!value) return "Sem perfil";
  const parts = value
    .replace(/â€¢/g, "•")
    .split(/[,\u2022]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0) return "Sem perfil";

  const formatted = parts.map((item) => {
    const base = getSingleTimePerfilBase(item);
    if (base) {
      const time = getSingleTimePerfilValue(item);
      return time ? `${base} - ${time}` : base;
    }
    const normalized = normalizePerfilVisita(item);
    if (normalized === "HORARIO COMERCIAL") return "HORARIO COMERCIAL";
    const customTimes = extractCustomTimes(item);
    if (customTimes.length > 0) {
      return `HORARIO CUSTOMIZADO - ${customTimes.join(", ")}`;
    }
    return normalized || item;
  });

  const unique = Array.from(
    new Set(
      formatted
        .map((item) => item.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  );
  return unique.join(", ");
};

const buildInitialCadastroForm = (): CadastroFormState => ({
  codigo: "",
  cnpj: "",
  corte: "",
  venc: "",
  valor: "",
  data_da_ultima_visita: "",
  cep: "",
  empresa: "",
  pessoa: "",
  contato: "",
  grupo: "",
  obs_comercial: "",
  obs: "",
  situacao: "Ativo",
  categoria: "",
  endereco: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
});

const restoreCadastroForm = (value: unknown): CadastroFormState => {
  const next = buildInitialCadastroForm();
  if (!isRecord(value)) return next;

  for (const key of Object.keys(next) as Array<keyof CadastroFormState>) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      next[key] = candidate;
    }
  }

  return next;
};

const restorePerfilState = (value: unknown) => {
  const next = buildPerfilState(null);
  if (!isRecord(value)) return next;

  if (typeof value.perfil === "string") next.perfil = value.perfil;
  if (typeof value.customEnabled === "boolean") next.customEnabled = value.customEnabled;
  if (Array.isArray(value.customTimes)) {
    next.customTimes = value.customTimes.filter((item): item is string => typeof item === "string");
  }
  if (typeof value.singleTimeBase === "string") next.singleTimeBase = value.singleTimeBase;
  if (typeof value.singleTimeValue === "string") next.singleTimeValue = value.singleTimeValue;

  return next;
};

const restorePlanoValores = (value: unknown): OdontoartPlanoValor[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const planoCodigo = item.planoCodigo;
    const planoNome = item.planoNome;
    const valorTitular = item.valorTitular;
    const valorDependente = item.valorDependente;

    if (
      (planoCodigo !== 2 && planoCodigo !== 18 && planoCodigo !== 19 && planoCodigo !== 20) ||
      (planoNome !== "ODONTOART PJ INDIVIDUAL" &&
        planoNome !== "Multimaster" &&
        planoNome !== "Multiplus" &&
        planoNome !== "Multiprev") ||
      (valorTitular !== null && typeof valorTitular !== "number") ||
      (valorDependente !== null && typeof valorDependente !== "number")
    ) {
      return [];
    }

    return [
      {
        planoCodigo,
        planoNome,
        valorTitular: valorTitular ?? null,
        valorDependente: valorDependente ?? null,
      },
    ];
  });
};

const restoreFilialConfirmModal = (value: unknown): FilialConfirmModalState | null => {
  if (!isRecord(value)) return null;
  return {
    flowId: Number.isInteger(value.flowId) ? Number(value.flowId) : 0,
    codigo: typeof value.codigo === "string" ? value.codigo : "",
    empresa: typeof value.empresa === "string" ? value.empresa : "",
    existingCount: Number.isInteger(value.existingCount) ? Number(value.existingCount) : 0,
    draft: restoreCadastroForm(value.draft),
    source: value.source === "cnpj" ? "cnpj" : "codigo",
    lookupError: typeof value.lookupError === "string" ? value.lookupError : null,
  };
};

const restoreFilialCadastroModal = (value: unknown): FilialCadastroModalState | null => {
  if (!isRecord(value)) return null;
  return {
    flowId: Number.isInteger(value.flowId) ? Number(value.flowId) : 0,
    form: restoreCadastroForm(value.form),
    existingCount: Number.isInteger(value.existingCount) ? Number(value.existingCount) : 0,
    error: typeof value.error === "string" ? value.error : null,
  };
};

const readClientesViewState = (): ClientesViewState | null => {
  try {
    const raw = sessionStorage.getItem(CLIENTES_VIEW_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClientesViewState>;
    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      searchMode: isClienteSearchMode(parsed.searchMode) ? parsed.searchMode : "codigo",
      situacaoFilter: isSituacaoFilterValue(parsed.situacaoFilter) ? parsed.situacaoFilter : "",
      currentPage:
        typeof parsed.currentPage === "number" && Number.isInteger(parsed.currentPage) && parsed.currentPage > 0
          ? parsed.currentPage
          : 1,
      selectedId: typeof parsed.selectedId === "string" ? parsed.selectedId : null,
      isEditing: parsed.isEditing === true,
      historySupervisorId: typeof parsed.historySupervisorId === "string" ? parsed.historySupervisorId : "all",
      historyDateFrom: typeof parsed.historyDateFrom === "string" ? parsed.historyDateFrom : "",
      historyDateTo: typeof parsed.historyDateTo === "string" ? parsed.historyDateTo : "",
      createFlowId:
        typeof parsed.createFlowId === "number" && Number.isInteger(parsed.createFlowId) && parsed.createFlowId >= 0
          ? parsed.createFlowId
          : 0,
      form: restoreCadastroForm(parsed.form),
      perfilCreate: restorePerfilState(parsed.perfilCreate),
      createPlanoValores: restorePlanoValores(parsed.createPlanoValores),
      filialConfirmModal: restoreFilialConfirmModal(parsed.filialConfirmModal),
      filialCadastroModal: restoreFilialCadastroModal(parsed.filialCadastroModal),
    };
  } catch {
    return null;
  }
};

const mergeLookupIntoCadastroForm = (
  current: CadastroFormState,
  incoming: Partial<CadastroFormState>,
  options?: { forceFields?: Array<keyof CadastroFormState> },
): CadastroFormState => {
  const forceFields = new Set(options?.forceFields ?? []);
  const next: CadastroFormState = { ...current };

  for (const [rawKey, rawValue] of Object.entries(incoming)) {
    const key = rawKey as keyof CadastroFormState;
    if (rawValue === undefined || rawValue === null) continue;
    const incomingValue = String(rawValue);
    if (!incomingValue.trim()) continue;
    const currentValue = next[key];
    if (forceFields.has(key) || !currentValue.trim()) {
      next[key] = incomingValue;
    }
  }

  return next;
};

const clearFilialSpecificFields = (base: CadastroFormState): CadastroFormState => ({
  ...buildInitialCadastroForm(),
  codigo: base.codigo.trim(),
  cnpj: formatCnpjInput(base.cnpj),
  empresa: base.empresa.trim(),
  situacao: base.situacao.trim() || "Ativo",
});

const buildEmptyFilialForm = (params: {
  codigo: string;
  cnpj?: string;
  empresa?: string;
  situacao?: string;
}): CadastroFormState =>
  clearFilialSpecificFields({
    ...buildInitialCadastroForm(),
    codigo: params.codigo.trim(),
    cnpj: params.cnpj ? formatCnpjInput(params.cnpj) : "",
    empresa: params.empresa?.trim() ?? "",
    situacao: params.situacao?.trim() || "Ativo",
  });

const applyApiFieldsToFilialForm = (
  base: CadastroFormState,
  apiForm: ReturnType<typeof mapEmpresaApiToClienteForm>,
): CadastroFormState =>
  mergeLookupIntoCadastroForm(
    base,
    {
      cnpj: apiForm.cnpj,
      empresa: apiForm.empresa,
      grupo: apiForm.grupo,
      obs_comercial: apiForm.obs_comercial,
      corte: apiForm.corte,
      venc: apiForm.venc,
      valor: apiForm.valor,
      situacao: apiForm.situacao,
    },
    { forceFields: ["cnpj", "empresa", "grupo", "obs_comercial", "corte", "venc", "valor", "situacao"] },
  );

const preserveFilialCommonFields = (
  draft: CadastroFormState,
  codigoOverride?: string,
): CadastroFormState => ({
  ...buildInitialCadastroForm(),
  codigo: (codigoOverride ?? draft.codigo).trim(),
  cnpj: formatCnpjInput(draft.cnpj),
  empresa: draft.empresa.trim(),
  obs_comercial: draft.obs_comercial.trim(),
  corte: draft.corte.trim(),
  venc: draft.venc.trim(),
  valor: draft.valor.trim(),
  situacao: draft.situacao.trim() || "Ativo",
});

export default function Clientes() {
  const initialViewState = useMemo(() => readClientesViewState(), []);
  const { role, session } = useAuth();
  const canView = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canCreate = canView;
  const canEdit = role === "SUPERVISOR";
  const canUseLocalResetTool = role === "ASSISTENTE";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [search, setSearch] = useState(() => initialViewState?.search ?? "");
  const [searchMode, setSearchMode] = useState<ClienteSearchMode>(() => initialViewState?.searchMode ?? "codigo");
  const [situacaoFilter, setSituacaoFilter] = useState<"" | "Ativo" | "Suspenso/Inadimplente" | "Cancelado">(
    () => initialViewState?.situacaoFilter ?? "",
  );

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CadastroFormState>(() => initialViewState?.form ?? buildInitialCadastroForm());
  const [perfilCreate, setPerfilCreate] = useState(() => initialViewState?.perfilCreate ?? buildPerfilState(null));
  const [createPlanoValores, setCreatePlanoValores] = useState<OdontoartPlanoValor[]>(
    () => initialViewState?.createPlanoValores ?? [],
  );

  const [selected, setSelected] = useState<ClienteRow | null>(null);
  const [history, setHistory] = useState<ClienteHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySupervisores, setHistorySupervisores] = useState<
    { user_id: string; display_name: string | null }[]
  >([]);
  const [historySupervisorId, setHistorySupervisorId] = useState<string>(
    () => initialViewState?.historySupervisorId ?? "all",
  );
  const [historyDateFrom, setHistoryDateFrom] = useState(() => initialViewState?.historyDateFrom ?? "");
  const [historyDateTo, setHistoryDateTo] = useState(() => initialViewState?.historyDateTo ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(() => initialViewState?.selectedId ?? null);
  const pendingEditRestoreRef = useRef<boolean | null>(initialViewState?.isEditing ?? null);
  const skipInitialFilterResetRef = useRef(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<CadastroFormState>(buildInitialCadastroForm);
  const [perfilEdit, setPerfilEdit] = useState(() => buildPerfilState(null));
  const [editPlanoValores, setEditPlanoValores] = useState<OdontoartPlanoValor[]>([]);
  const [planosModalState, setPlanosModalState] = useState<{
    title: string;
    source: "create" | "edit";
    codigo: string;
    empresa: string;
    valores: OdontoartPlanoValor[];
    loading: boolean;
    error: string | null;
  } | null>(null);

  const applyPerfilTimes = (
    setter: Dispatch<
      SetStateAction<{
        perfil: string;
        customEnabled: boolean;
        customTimes: string[];
        singleTimeBase: string;
        singleTimeValue: string;
      }>
    >,
    times: string[],
  ) => {
    const cleaned = times.map((time) => time.trim()).filter(Boolean);
    setter((prev) => ({
      ...prev,
      customTimes: times,
      perfil: cleaned.join(" • "),
      singleTimeBase: "",
      singleTimeValue: "",
    }));
  };
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletePasswordEdit, setDeletePasswordEdit] = useState("");
  const [deletingEdit, setDeletingEdit] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [codigoLoading, setCodigoLoading] = useState(false);
  const [codigoError, setCodigoError] = useState<string | null>(null);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjError, setCnpjError] = useState<string | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  const [bairroLoading, setBairroLoading] = useState(false);
  const [cnpjLoadingEdit, setCnpjLoadingEdit] = useState(false);
  const [cnpjErrorEdit, setCnpjErrorEdit] = useState<string | null>(null);
  const [cepLoadingEdit, setCepLoadingEdit] = useState(false);
  const [bairroLoadingEdit, setBairroLoadingEdit] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importInserted, setImportInserted] = useState(0);
  const [importStageLabel, setImportStageLabel] = useState("Aguardando arquivo");
  const [importStartedAt, setImportStartedAt] = useState<number | null>(null);
  const [importTick, setImportTick] = useState(0);
  const [currentPage, setCurrentPage] = useState(() => initialViewState?.currentPage ?? 1);
  const [duplicateModal, setDuplicateModal] = useState<DuplicateEntry | null>(null);
  const [duplicateQueue, setDuplicateQueue] = useState<DuplicateEntry[]>([]);
  const [duplicateResolving, setDuplicateResolving] = useState(false);
  const [duplicateComplemento, setDuplicateComplemento] = useState("");
  const [duplicateExistingPage, setDuplicateExistingPage] = useState(1);
  const [filialConfirmModal, setFilialConfirmModal] = useState<FilialConfirmModalState | null>(
    () => initialViewState?.filialConfirmModal ?? null,
  );
  const [filialCadastroModal, setFilialCadastroModal] = useState<FilialCadastroModalState | null>(
    () => initialViewState?.filialCadastroModal ?? null,
  );
  const filialConfirmModalRef = useRef<HTMLDivElement | null>(null);
  const filialCadastroModalRef = useRef<HTMLDivElement | null>(null);
  const [filialCnpjLoading, setFilialCnpjLoading] = useState(false);
  const [filialCepLoading, setFilialCepLoading] = useState(false);
  const [filialBairroLoading, setFilialBairroLoading] = useState(false);
  const [localResetLoading, setLocalResetLoading] = useState(false);
  const createCepLookupRequestRef = useRef(0);
  const createEnderecoLookupRequestRef = useRef(0);
  const createCnpjLookupRequestRef = useRef(0);
  const createCodigoLookupRequestRef = useRef(0);
  const editCepLookupRequestRef = useRef(0);
  const editEnderecoLookupRequestRef = useRef(0);
  const editCnpjLookupRequestRef = useRef(0);
  const filialCnpjLookupRequestRef = useRef(0);
  const filialCepLookupRequestRef = useRef(0);
  const filialEnderecoLookupRequestRef = useRef(0);
  const createFlowIdRef = useRef(
    Math.max(
      initialViewState?.createFlowId ?? 0,
      initialViewState?.filialConfirmModal?.flowId ?? 0,
      initialViewState?.filialCadastroModal?.flowId ?? 0,
    ),
  );

  const startNewCreateFlow = () => {
    createFlowIdRef.current += 1;
    return createFlowIdRef.current;
  };

  const invalidateCreateFlow = () => {
    createFlowIdRef.current += 1;
  };

  const isActiveCreateFlow = (flowId: number) => flowId === createFlowIdRef.current;

  const cancelPendingCreateLookups = () => {
    createCodigoLookupRequestRef.current += 1;
    createCepLookupRequestRef.current += 1;
    createEnderecoLookupRequestRef.current += 1;
    createCnpjLookupRequestRef.current += 1;
    filialCnpjLookupRequestRef.current += 1;
    filialCepLookupRequestRef.current += 1;
    filialEnderecoLookupRequestRef.current += 1;
    setFilialCnpjLoading(false);
    setFilialCepLoading(false);
    setFilialBairroLoading(false);
    setCodigoLoading(false);
    setCnpjLoading(false);
    setCepLoading(false);
    setBairroLoading(false);
  };

  const resetCreateFlow = (reason = "manual-reset") => {
    cancelPendingCreateLookups();
    invalidateCreateFlow();
    debugCreateFlow({
      action: "reset-create-flow",
      reason,
      activeFlowId: createFlowIdRef.current,
    });
    setForm(buildInitialCadastroForm());
    setPerfilCreate(buildPerfilState(null));
    setCreatePlanoValores([]);
    setCodigoError(null);
    setCnpjError(null);
    setFilialConfirmModal(null);
    setFilialCadastroModal(null);
    setCreating(false);
    setError(null);
  };

  const safeSetCadastroForm = (
    reason: string,
    updater: (prev: CadastroFormState) => CadastroFormState,
    options?: {
      flowId?: number;
      requestId?: number;
      requestRef?: { current: number };
    },
  ) => {
    setForm((prev) => {
      if (options?.flowId !== undefined && !isActiveCreateFlow(options.flowId)) {
        debugCreateFlow({
          action: "skip-create-form-update-inactive-flow",
          reason,
          flowId: options.flowId,
          activeFlowId: createFlowIdRef.current,
        });
        return prev;
      }
      if (
        options?.requestRef &&
        options.requestId !== undefined &&
        options.requestRef.current !== options.requestId
      ) {
        return prev;
      }
      const next = updater(prev);
      return next;
    });
  };

  const loadClientesPage = async (showLoading = true) => {
    if (!canView) return;
    if (showLoading) setLoading(true);
    setError(null);
    const listStart = performance.now();
    try {
      const pageData = await fetchClientesPage({
        page: currentPage,
        pageSize: CLIENTES_DEFAULT_PAGE_SIZE,
        search,
        searchMode,
        situacao: situacaoFilter,
      });
      setClientes(pageData as unknown as ClienteRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar empresas.");
      setClientes([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const loadClientesCount = async () => {
    if (!canView) return;
    try {
      const count = await fetchClientesCount({
        search,
        searchMode,
        situacao: situacaoFilter,
      });
      setTotalCount(count);
    } catch (err) {
      setTotalCount(null);
    }
  };

  const refreshClientesData = async () => {
    await Promise.all([loadClientesPage(false), loadClientesCount()]);
  };

  useEffect(() => {
    if (!canView) return;
    let active = true;
    setLoading(true);
    setError(null);

    fetchClientesPage({
      page: currentPage,
      pageSize: CLIENTES_DEFAULT_PAGE_SIZE,
      search,
      searchMode,
      situacao: situacaoFilter,
    })
      .then((pageData) => {
        if (!active) return;
        setClientes(pageData as unknown as ClienteRow[]);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Erro ao carregar empresas.");
        setClientes([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canView, currentPage, search, searchMode, situacaoFilter]);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    fetchClientesCount({
      search,
      searchMode,
      situacao: situacaoFilter,
    })
      .then((count) => {
        if (!active) return;
        setTotalCount(count);
      })
      .catch((err) => {
        if (!active) return;
        setTotalCount(null);
      });
    return () => {
      active = false;
    };
  }, [canView, search, searchMode, situacaoFilter]);

  useEffect(() => {
    if (!canView) return;
    const handleFocus = () => {
      void loadClientesPage(false);
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [canView, currentPage, search, searchMode, situacaoFilter]);

  useEffect(() => {
    if (duplicateModal || duplicateQueue.length === 0) return;
    setDuplicateModal(duplicateQueue[0]);
    setDuplicateQueue((prev) => prev.slice(1));
  }, [duplicateModal, duplicateQueue]);

  useEffect(() => {
    if (!duplicateModal) {
      setDuplicateComplemento("");
      setDuplicateExistingPage(1);
      return;
    }
    setDuplicateComplemento(
      duplicateModal.payload?.complemento ??
        duplicateModal.newCliente.complemento ??
        "",
    );
    setDuplicateExistingPage(1);
  }, [duplicateModal]);

  useEffect(() => {
    const payload: ClientesViewState = {
      search,
      searchMode,
      situacaoFilter,
      currentPage,
      selectedId,
      isEditing,
      historySupervisorId,
      historyDateFrom,
      historyDateTo,
      createFlowId: createFlowIdRef.current,
      form,
      perfilCreate,
      createPlanoValores,
      filialConfirmModal,
      filialCadastroModal,
    };
    try {
      sessionStorage.setItem(CLIENTES_VIEW_STATE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [
    createPlanoValores,
    currentPage,
    filialCadastroModal,
    filialConfirmModal,
    form,
    historyDateFrom,
    historyDateTo,
    historySupervisorId,
    isEditing,
    perfilCreate,
    search,
    searchMode,
    selectedId,
    situacaoFilter,
  ]);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    fetchSupervisores()
      .then((data) => {
        if (active) setHistorySupervisores(data);
      })
      .catch((err) => {
      });
    return () => {
      active = false;
    };
  }, [canView]);

  useEffect(() => {
    if (!selected) return;
    setIsEditing(false);
    setEditPlanoValores([]);
    setDeletePasswordEdit("");
    setHistorySupervisorId("all");
    setHistoryDateFrom("");
    setHistoryDateTo("");
    setEditForm({
      codigo: selected.codigo ?? "",
      cnpj: selected.cnpj ?? "",
      corte: selected.corte !== null && selected.corte !== undefined ? String(selected.corte) : "",
      venc: selected.venc !== null && selected.venc !== undefined ? String(selected.venc) : "",
      valor: selected.valor !== null && selected.valor !== undefined ? formatCurrency(selected.valor) : "",
      data_da_ultima_visita: toDateInput(selected.data_da_ultima_visita),
      cep: selected.cep ?? "",
      empresa: selected.empresa ?? "",
      pessoa: selected.pessoa ?? "",
      contato: sanitizeContatoInput(selected.contato ?? ""),
      grupo: selected.grupo ?? "",
      obs_comercial: selected.obs_comercial ?? "",
      obs: selected.obs ?? "",
      situacao: selected.situacao ?? "Ativo",
      categoria: selected.categoria ?? "",
      endereco: selected.endereco ?? "",
      complemento: selected.complemento ?? "",
      bairro: selected.bairro ?? "",
      cidade: selected.cidade ?? "",
      uf: selected.uf ?? "",
    });
    setPerfilEdit(buildPerfilState(selected.perfil_visita));
    setHistory([]);
    setHistoryLoading(true);
    fetchClienteHistory(selected)
      .then((data) => setHistory(data))
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar historico."))
      .finally(() => setHistoryLoading(false));
  }, [selected]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    if (selected?.id === selectedId) return;

    let active = true;
    fetchClienteById(selectedId)
      .then((cliente) => {
        if (!active) return;
        setSelected(cliente);
        if (pendingEditRestoreRef.current !== null) {
          setIsEditing(pendingEditRestoreRef.current);
          pendingEditRestoreRef.current = null;
        }
      })
      .catch((err) => {
        if (!active) return;
        const message = err instanceof Error ? err.message : String(err ?? "");
        if (isClienteNotFoundErrorMessage(message)) {
          pendingEditRestoreRef.current = null;
          setSelectedId(null);
          setSelected(null);
          setHistory([]);
          setError(null);
          return;
        }
        setError(message || "Erro ao carregar empresa selecionada.");
      });
    return () => {
      active = false;
    };
  }, [selected?.id, selectedId]);

  const filialModalOpen = Boolean(filialConfirmModal || filialCadastroModal);

  useEffect(() => {
    if (!filialModalOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [filialModalOpen]);

  const filteredHistory = useMemo(() => {
    let next = history;

    if (historySupervisorId !== "all") {
      const supervisor = historySupervisores.find(
        (item) => item.user_id === historySupervisorId,
      );
      const supervisorName = normalizeName(supervisor?.display_name ?? "");
      if (supervisorName) {
        next = next.filter((visit) => normalizeName(visit.supervisor) === supervisorName);
      }
    }

    const fromMs = historyDateFrom ? getDateMs(historyDateFrom) : null;
    const toMs = historyDateTo ? getDateMs(historyDateTo) : null;
    if (fromMs === null && toMs === null) return next;

    return next.filter((visit) => {
      const visitMs = getDateMs(visit.visit_date);
      if (visitMs === null) return false;
      if (fromMs !== null && visitMs < fromMs) return false;
      if (toMs !== null && visitMs > toMs) return false;
      return true;
    });
  }, [history, historyDateFrom, historyDateTo, historySupervisorId, historySupervisores]);

  const isSearching = Boolean(search.trim());
  const displayClientes = clientes;
  const resultCount = totalCount;
  const totalPages = Math.max(1, Math.ceil((totalCount ?? 0) / CLIENTES_DEFAULT_PAGE_SIZE));
  const resetClientesListView = () => {
    setSearch("");
    setSearchMode("codigo");
    setSituacaoFilter("");
    setCurrentPage(1);
  };

  useEffect(() => {
    if (!skipInitialFilterResetRef.current) {
      skipInitialFilterResetRef.current = true;
      return;
    }
    setCurrentPage(1);
  }, [search, searchMode, situacaoFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const findClientesByCodigo = async (codigo: string, excludeId?: string | null) => {
    const normalized = normalizeCodigoValue(codigo);
    if (!normalized) return [] as ClienteRow[];
    const fetched = await fetchClientesByCodigoExact(normalized);
    return fetched.filter((cliente) => {
      if (excludeId && cliente.id === excludeId) return false;
      return normalizeCodigoValue(cliente.codigo) === normalized;
    });
  };

  const findClientesByCnpj = async (cnpj: string, excludeId?: string | null) => {
    const normalized = cnpj.trim();
    if (!normalized) return [] as ClienteRow[];
    const targetDigits = sanitizeCnpjDigits(normalized);
    const fetched = await fetchClientesByCnpjExact(normalized);
    return fetched.filter((cliente) => {
      if (excludeId && cliente.id === excludeId) return false;
      const clienteDigits = sanitizeCnpjDigits(cliente.cnpj ?? "");
      if (targetDigits.length === 14) {
        return clienteDigits === targetDigits;
      }
      return (cliente.cnpj ?? "").trim() === normalized;
    });
  };

  const findClientesByAddress = async ({
    endereco,
    cidade,
    uf,
    complemento,
    excludeId,
  }: {
    endereco?: string | null;
    cidade?: string | null;
    uf?: string | null;
    complemento?: string | null;
    excludeId?: string | null;
  }) => {
    const normalizedAddress = normalizeAddressValue(endereco);
    if (!normalizedAddress) return [] as ClienteRow[];
    const fetched = await fetchClientesByEnderecoExact({
      endereco: endereco?.trim() ?? "",
      excludeId,
    });
    return fetched.filter((cliente) =>
      isSameAddress(
        {
          endereco,
          cidade,
          uf,
          complemento,
        },
        cliente,
      ),
    );
  };

  const persistClienteFromForm = async (
    sourceForm: CadastroFormState,
    perfilVisita: string | null,
  ) => {
    if (!isSituacaoAllowedForCadastro(sourceForm.situacao)) {
      throw new Error(getSituacaoCadastroErrorMessage(sourceForm.situacao));
    }
    const normalizedCodigo = normalizeCodigoValue(sourceForm.codigo);
    const normalizedCnpj = normalizeCnpj(sourceForm.cnpj);
    const [addressMatches, codeMatches] = await Promise.all([
      findClientesByAddress({
        endereco: sourceForm.endereco,
        cidade: sourceForm.cidade,
        uf: sourceForm.uf,
        complemento: sourceForm.complemento,
      }),
      normalizedCodigo ? findClientesByCodigo(normalizedCodigo) : Promise.resolve([]),
    ]);
    const cnpjMatches = normalizedCnpj
      ? codeMatches.filter((cliente) => normalizeCnpj(cliente.cnpj) === normalizedCnpj)
      : [];
    const existingMatches = Array.from(
      new Map(
        [...addressMatches, ...cnpjMatches].map((cliente) => [cliente.id, cliente]),
      ).values(),
    );
    const corteValue = sourceForm.corte ? Number(sourceForm.corte) : null;
    const vencValue = sourceForm.venc ? Number(sourceForm.venc) : null;
    const parsedCorte = Number.isFinite(corteValue ?? NaN) ? corteValue : null;
    const parsedVenc = Number.isFinite(vencValue ?? NaN) ? vencValue : null;
    const parsedDataUltimaVisita = toIsoDateInput(sourceForm.data_da_ultima_visita);
    const created = await createCliente({
      codigo: sourceForm.codigo.trim() || null,
      cnpj: normalizeCnpj(sourceForm.cnpj),
      corte: parsedCorte,
      venc: parsedVenc,
      valor: sourceForm.valor ? parseImportCurrency(sourceForm.valor) : null,
      data_da_ultima_visita: parsedDataUltimaVisita,
      cep: sourceForm.cep.trim() || null,
      empresa: sourceForm.empresa.trim() || null,
      pessoa: sourceForm.pessoa.trim() || null,
      contato: normalizeContato(sourceForm.contato),
      grupo: sourceForm.grupo.trim() || null,
      obs_comercial: sourceForm.obs_comercial.trim() || null,
      obs: sourceForm.obs.trim() || null,
      perfil_visita: perfilVisita,
      situacao: sourceForm.situacao.trim() || "Ativo",
      categoria: sourceForm.categoria.trim() || null,
      endereco: sourceForm.endereco.trim() || null,
      complemento: sourceForm.complemento.trim() || null,
      bairro: sourceForm.bairro.trim() || null,
      cidade: sourceForm.cidade.trim() || null,
      uf: sourceForm.uf.trim() || null,
    });
    if (existingMatches.length > 0) {
      setDuplicateModal({ newCliente: created, existing: existingMatches });
    }
  };

  const openFilialConfirm = (params: {
    flowId: number;
    codigo: string;
    matchesByCode: ClienteRow[];
    draft: CadastroFormState;
    lookupError?: string | null;
    source?: "codigo" | "cnpj";
  }) => {
    const source = params.source ?? "codigo";
    const cleanDraft = preserveFilialCommonFields(params.draft, params.codigo);
    debugCreateFlow({
      action: "open-filial-confirm",
      source,
      flowId: params.flowId,
      codigo: params.codigo.trim(),
      draft: cleanDraft,
      matchesCount: params.matchesByCode.length,
      lookupError: params.lookupError ?? null,
    });
    setFilialConfirmModal({
      flowId: params.flowId,
      codigo: params.codigo.trim(),
      empresa: cleanDraft.empresa || "Nova filial",
      existingCount: params.matchesByCode.length,
      draft: cleanDraft,
      source,
      lookupError: params.lookupError ?? null,
    });
  };

  const handleAcceptFilialConfirm = async () => {
    if (!filialConfirmModal) return;
    if (creating) return;
    const snapshot = {
      ...filialConfirmModal,
      draft: { ...filialConfirmModal.draft },
    };
    if (!isActiveCreateFlow(snapshot.flowId)) return;
    let cleanFilialForm = preserveFilialCommonFields(snapshot.draft, snapshot.codigo);
    let apiLookupError = snapshot.lookupError ?? null;
    setCodigoLoading(true);
    try {
      const empresaApi = await fetchEmpresaByEmpresaId(snapshot.codigo);
      if (!isActiveCreateFlow(snapshot.flowId)) return;
      if (empresaApi) {
        const apiForm = mapEmpresaApiToClienteForm(empresaApi, snapshot.codigo);
        cleanFilialForm = applyApiFieldsToFilialForm(cleanFilialForm, apiForm);
        const planoValores = extractOdontoartPlanoValores(empresaApi);
        setCreatePlanoValores(planoValores);
      } else {
        apiLookupError = apiLookupError ?? "Empresa nao encontrada na API.";
      }
    } catch (err) {
      if (!isActiveCreateFlow(snapshot.flowId)) return;
      apiLookupError =
        err instanceof Error
          ? `Nao foi possivel consultar dados da empresa na API: ${err.message}`
          : "Nao foi possivel consultar dados da empresa na API.";
    } finally {
      if (isActiveCreateFlow(snapshot.flowId)) {
        setCodigoLoading(false);
      }
    }
    if (!isActiveCreateFlow(snapshot.flowId)) return;
    setPerfilCreate(buildPerfilState(null));
    debugCreateFlow({
      action: "open-filial-cadastro",
      flowId: snapshot.flowId,
      form: cleanFilialForm,
      lookupError: apiLookupError,
    });
    setFilialCadastroModal({
      flowId: snapshot.flowId,
      form: cleanFilialForm,
      existingCount: snapshot.existingCount,
      error: apiLookupError,
    });
    setFilialConfirmModal((prev) =>
      prev && prev.flowId === snapshot.flowId ? null : prev,
    );
  };

  const handleCancelFilialFlow = () => {
    resetCreateFlow("cancel-filial-flow");
  };

  const hasFilledValue = (value: string | null | undefined) =>
    typeof value === "string" && value.trim().length > 0;

  const mergeCepMappedIntoForm = (
    current: CadastroFormState,
    mapped: ReturnType<typeof mapCepResponse>,
  ): CadastroFormState =>
    mergeLookupIntoCadastroForm(
      current,
      {
        cep: hasFilledValue(mapped.cep) ? formatCep(mapped.cep as string) : undefined,
        endereco: hasFilledValue(mapped.endereco) ? (mapped.endereco as string) : undefined,
        bairro: hasFilledValue(mapped.bairro) ? (mapped.bairro as string) : undefined,
        cidade: hasFilledValue(mapped.cidade) ? (mapped.cidade as string) : undefined,
        uf: hasFilledValue(mapped.uf)
          ? (mapped.uf as string).toUpperCase().slice(0, 3)
          : undefined,
        complemento: hasFilledValue(mapped.complemento)
          ? (mapped.complemento as string)
          : undefined,
      },
      {
        forceFields: ["cep", "endereco", "bairro", "cidade", "uf", "complemento"],
      },
    );

  const applyFilialCepResult = (flowId: number, payload: Record<string, unknown>) => {
    if (!isActiveCreateFlow(flowId)) return;
    if (isCepErrorPayload(payload)) {
      throw new Error("CEP nao encontrado.");
    }
    const mapped = mapCepResponse(payload);
    setFilialCadastroModal((prev) =>
      prev && prev.flowId === flowId
        ? {
            ...prev,
            form: mergeCepMappedIntoForm(prev.form, mapped),
            error: null,
          }
        : prev,
    );
  };

  const handleFilialCnpjLookup = async () => {
    if (!filialCadastroModal) return;
    if (creating) return;
    const modalSnapshot = {
      ...filialCadastroModal,
      form: { ...filialCadastroModal.form },
    };
    const flowId = modalSnapshot.flowId;
    if (!isActiveCreateFlow(flowId)) return;
    const cnpj = sanitizeCnpjDigits(modalSnapshot.form.cnpj);
    if (cnpj.length !== 14) {
      setFilialCadastroModal((prev) =>
        prev && prev.flowId === flowId
          ? {
              ...prev,
              error: "Informe um CNPJ valido.",
            }
          : prev,
      );
      return;
    }

    const requestId = ++filialCnpjLookupRequestRef.current;
    setFilialCnpjLoading(true);
    setFilialCadastroModal((prev) =>
      prev && prev.flowId === flowId ? { ...prev, error: null } : prev,
    );
    try {
      const empresaApi = await fetchEmpresaByCnpjWs(cnpj);
      if (requestId !== filialCnpjLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      const endereco = buildEnderecoWithNumero(empresaApi.logradouro, empresaApi.numero);
      setFilialCadastroModal((prev) =>
        prev && prev.flowId === flowId
          ? {
              ...prev,
              form: {
                ...prev.form,
                cnpj: formatCnpjInput(cnpj),
                empresa: empresaApi.razao_social ?? prev.form.empresa,
                endereco: endereco || prev.form.endereco,
                cep: empresaApi.cep ? formatCep(empresaApi.cep) : prev.form.cep,
                bairro: empresaApi.bairro ?? prev.form.bairro,
                cidade: empresaApi.cidade ?? prev.form.cidade,
                uf: empresaApi.estado
                  ? empresaApi.estado.toUpperCase().slice(0, 3)
                  : prev.form.uf,
              },
              error: null,
            }
          : prev,
      );
    } catch (err) {
      if (requestId !== filialCnpjLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      setFilialCadastroModal((prev) =>
        prev && prev.flowId === flowId
          ? {
              ...prev,
              error: err instanceof Error ? err.message : "Erro ao buscar CNPJ na API.",
            }
          : prev,
      );
    } finally {
      if (requestId === filialCnpjLookupRequestRef.current) {
        setFilialCnpjLoading(false);
      }
    }
  };

  const handleFilialCepLookup = async () => {
    if (!filialCadastroModal) return;
    if (creating) return;
    const modalSnapshot = {
      ...filialCadastroModal,
      form: { ...filialCadastroModal.form },
    };
    const flowId = modalSnapshot.flowId;
    if (!isActiveCreateFlow(flowId)) return;
    const cep = sanitizeCep(modalSnapshot.form.cep);
    if (cep.length !== 8) {
      setFilialCadastroModal((prev) =>
        prev && prev.flowId === flowId
          ? {
              ...prev,
              error: "Informe um CEP valido com 8 digitos.",
            }
          : prev,
      );
      return;
    }

    const requestId = ++filialCepLookupRequestRef.current;
    setFilialCepLoading(true);
    setFilialCadastroModal((prev) =>
      prev && prev.flowId === flowId ? { ...prev, error: null } : prev,
    );
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Falha ao consultar CEP (${response.status}).`);
      }
      const payload = (await response.json()) as Record<string, unknown>;
      if (requestId !== filialCepLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      applyFilialCepResult(flowId, payload);
    } catch (err) {
      if (requestId !== filialCepLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      setFilialCadastroModal((prev) =>
        prev && prev.flowId === flowId
          ? {
              ...prev,
              error: err instanceof Error ? err.message : "Erro ao buscar por CEP.",
            }
          : prev,
      );
    } finally {
      if (requestId === filialCepLookupRequestRef.current) {
        setFilialCepLoading(false);
      }
    }
  };

  const handleFilialBairroLookup = async () => {
    if (!filialCadastroModal) return;
    if (creating) return;
    const modalSnapshot = {
      ...filialCadastroModal,
      form: { ...filialCadastroModal.form },
    };
    const flowId = modalSnapshot.flowId;
    if (!isActiveCreateFlow(flowId)) return;
    const endereco = modalSnapshot.form.endereco.trim();
    const cidade = modalSnapshot.form.cidade.trim();
    const uf = modalSnapshot.form.uf.trim().toUpperCase();
    if (!endereco || !cidade || !uf) {
      setFilialCadastroModal((prev) =>
        prev && prev.flowId === flowId
          ? {
              ...prev,
              error: "Para buscar por endereco, informe Endereco, Cidade e UF.",
            }
          : prev,
      );
      return;
    }

    const requestId = ++filialEnderecoLookupRequestRef.current;
    setFilialBairroLoading(true);
    setFilialCadastroModal((prev) =>
      prev && prev.flowId === flowId ? { ...prev, error: null } : prev,
    );
    try {
      const response = await fetch(
        `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(cidade)}/${encodeURIComponent(endereco)}/json/`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Falha ao buscar por endereco (${response.status}).`);
      }
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload) || payload.length === 0) {
        throw new Error("Nenhum resultado encontrado para este endereco.");
      }
      const firstMatch = payload.find(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
      );
      if (!firstMatch) {
        throw new Error("Nenhum resultado valido encontrado para este endereco.");
      }
      if (requestId !== filialEnderecoLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      applyFilialCepResult(flowId, firstMatch);
    } catch (err) {
      if (requestId !== filialEnderecoLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      setFilialCadastroModal((prev) =>
        prev && prev.flowId === flowId
          ? {
              ...prev,
              error: err instanceof Error ? err.message : "Erro ao buscar por endereco.",
            }
          : prev,
      );
    } finally {
      if (requestId === filialEnderecoLookupRequestRef.current) {
        setFilialBairroLoading(false);
      }
    }
  };

  const handleCepLookup = async () => {
    if (creating || codigoLoading || cnpjLoading) return;
    const flowId = createFlowIdRef.current;
    const cep = sanitizeCep(form.cep);
    if (cep.length !== 8) {
      if (isActiveCreateFlow(flowId)) {
        setError("Informe um CEP valido com 8 digitos.");
      }
      return;
    }

    const requestId = ++createCepLookupRequestRef.current;
    setCepLoading(true);
    setError(null);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Falha ao consultar CEP (${response.status}).`);
      }
      const payload = (await response.json()) as Record<string, unknown>;
      if (isCepErrorPayload(payload)) {
        throw new Error("CEP nao encontrado.");
      }
      const mapped = mapCepResponse(payload);
      if (requestId !== createCepLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      safeSetCadastroForm("cep-lookup", (prev) => mergeCepMappedIntoForm(prev, mapped), {
        flowId,
        requestId,
        requestRef: createCepLookupRequestRef,
      });
    } catch (err) {
      if (requestId !== createCepLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      setError(err instanceof Error ? err.message : "Erro ao buscar por CEP.");
    } finally {
      if (requestId === createCepLookupRequestRef.current && isActiveCreateFlow(flowId)) {
        setCepLoading(false);
      }
    }
  };

  const handleBairroLookup = async () => {
    if (creating || codigoLoading || cnpjLoading) return;
    const flowId = createFlowIdRef.current;
    const endereco = form.endereco.trim();
    const cidade = form.cidade.trim();
    const uf = form.uf.trim().toUpperCase();
    if (!endereco || !cidade || !uf) {
      if (isActiveCreateFlow(flowId)) {
        setError("Para buscar por endereco, informe Endereco, Cidade e UF.");
      }
      return;
    }

    const requestId = ++createEnderecoLookupRequestRef.current;
    setBairroLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(cidade)}/${encodeURIComponent(endereco)}/json/`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Falha ao buscar por endereco (${response.status}).`);
      }
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload) || payload.length === 0) {
        throw new Error("Nenhum resultado encontrado para este endereco.");
      }
      const firstMatch = payload.find(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
      );
      if (!firstMatch) {
        throw new Error("Nenhum resultado valido encontrado para este endereco.");
      }
      if (isCepErrorPayload(firstMatch)) {
        throw new Error("Nenhum resultado encontrado para este endereco.");
      }
      const mapped = mapCepResponse(firstMatch);
      if (requestId !== createEnderecoLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      safeSetCadastroForm("endereco-lookup", (prev) => mergeCepMappedIntoForm(prev, mapped), {
        flowId,
        requestId,
        requestRef: createEnderecoLookupRequestRef,
      });
    } catch (err) {
      if (requestId !== createEnderecoLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      setError(err instanceof Error ? err.message : "Erro ao buscar por endereco.");
    } finally {
      if (requestId === createEnderecoLookupRequestRef.current && isActiveCreateFlow(flowId)) {
        setBairroLoading(false);
      }
    }
  };

  const handleCepLookupEdit = async () => {
    const cep = sanitizeCep(editForm.cep);
    if (cep.length !== 8) {
      setError("Informe um CEP valido com 8 digitos.");
      return;
    }

    const requestId = ++editCepLookupRequestRef.current;
    setCepLoadingEdit(true);
    setError(null);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Falha ao consultar CEP (${response.status}).`);
      }
      const payload = (await response.json()) as Record<string, unknown>;
      if (isCepErrorPayload(payload)) {
        throw new Error("CEP nao encontrado.");
      }
      const mapped = mapCepResponse(payload);
      if (requestId !== editCepLookupRequestRef.current) return;
      setEditForm((prev) => mergeCepMappedIntoForm(prev, mapped));
    } catch (err) {
      if (requestId !== editCepLookupRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Erro ao buscar por CEP.");
    } finally {
      if (requestId === editCepLookupRequestRef.current) {
        setCepLoadingEdit(false);
      }
    }
  };

  const handleBairroLookupEdit = async () => {
    const endereco = editForm.endereco.trim();
    const cidade = editForm.cidade.trim();
    const uf = editForm.uf.trim().toUpperCase();
    if (!endereco || !cidade || !uf) {
      setError("Para buscar por endereco, informe Endereco, Cidade e UF.");
      return;
    }

    const requestId = ++editEnderecoLookupRequestRef.current;
    setBairroLoadingEdit(true);
    setError(null);
    try {
      const response = await fetch(
        `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(cidade)}/${encodeURIComponent(endereco)}/json/`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Falha ao buscar por endereco (${response.status}).`);
      }
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload) || payload.length === 0) {
        throw new Error("Nenhum resultado encontrado para este endereco.");
      }
      const firstMatch = payload.find(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
      );
      if (!firstMatch) {
        throw new Error("Nenhum resultado valido encontrado para este endereco.");
      }
      if (isCepErrorPayload(firstMatch)) {
        throw new Error("Nenhum resultado encontrado para este endereco.");
      }
      const mapped = mapCepResponse(firstMatch);
      if (requestId !== editEnderecoLookupRequestRef.current) return;
      setEditForm((prev) => mergeCepMappedIntoForm(prev, mapped));
    } catch (err) {
      if (requestId !== editEnderecoLookupRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Erro ao buscar por endereco.");
    } finally {
      if (requestId === editEnderecoLookupRequestRef.current) {
        setBairroLoadingEdit(false);
      }
    }
  };

  const handleSaveFilialCadastro = async () => {
    if (!filialCadastroModal) return;
    if (creating) return;
    const modalSnapshot = {
      ...filialCadastroModal,
      form: { ...filialCadastroModal.form },
    };
    const flowId = modalSnapshot.flowId;
    if (!isActiveCreateFlow(flowId)) return;
    const modalForm = modalSnapshot.form;
    if (!isSituacaoAllowedForCadastro(modalForm.situacao)) {
      const situacaoError = getSituacaoCadastroErrorMessage(modalForm.situacao);
      setFilialCadastroModal((prev) =>
        prev && prev.flowId === flowId
          ? {
              ...prev,
              error: situacaoError,
            }
          : prev,
      );
      return;
    }
    if (!modalForm.empresa.trim()) {
      setFilialCadastroModal((prev) =>
        prev && prev.flowId === flowId
          ? {
              ...prev,
              error: "Informe o nome da empresa.",
            }
          : prev,
      );
      return;
    }
    if (!modalForm.obs.trim()) {
      setFilialCadastroModal((prev) =>
        prev && prev.flowId === flowId
          ? {
              ...prev,
              error: "Para filial, o campo Obs e obrigatorio.",
            }
          : prev,
      );
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const perfilSnapshot = perfilCreate.perfil || null;
      await persistClienteFromForm(modalForm, perfilSnapshot);
      if (!isActiveCreateFlow(flowId)) return;
      resetCreateFlow("save-filial-success");
      await refreshClientesData();
    } catch (err) {
      if (!isActiveCreateFlow(flowId)) return;
      setFilialCadastroModal((prev) =>
        prev && prev.flowId === flowId
          ? {
              ...prev,
              error: err instanceof Error ? err.message : "Erro ao cadastrar filial.",
            }
          : prev,
      );
    } finally {
      if (isActiveCreateFlow(flowId)) {
        setCreating(false);
      }
    }
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate || creating || codigoLoading || cnpjLoading) return;
    if (!isSituacaoAllowedForCadastro(form.situacao)) return;
    const flowId = startNewCreateFlow();
    const formSnapshot: CadastroFormState = { ...form };
    const perfilSnapshot = perfilCreate.perfil || null;
    const codigoInformado = formSnapshot.codigo.trim();
    if (codigoInformado) {
      const matchesByCode = await findClientesByCodigo(codigoInformado);
      if (!isActiveCreateFlow(flowId)) return;
      if (matchesByCode.length > 0) {
        let draft: CadastroFormState = { ...formSnapshot, codigo: codigoInformado };
        let lookupError: string | null = null;
        try {
          const empresaApi = await fetchEmpresaByEmpresaId(codigoInformado);
          if (!isActiveCreateFlow(flowId)) return;
          if (empresaApi) {
            const apiForm = mapEmpresaApiToClienteForm(empresaApi, codigoInformado);
            draft = applyApiFieldsToFilialForm(
              buildEmptyFilialForm({
                codigo: codigoInformado,
                cnpj: draft.cnpj,
                empresa: draft.empresa,
              }),
              apiForm,
            );
          } else {
            lookupError = "Empresa nao encontrada na API.";
          }
        } catch (err) {
          if (!isActiveCreateFlow(flowId)) return;
          lookupError =
            err instanceof Error
              ? `Nao foi possivel consultar dados da empresa na API: ${err.message}`
              : "Nao foi possivel consultar dados da empresa na API.";
        }
        setCreatePlanoValores([]);
        setPerfilCreate(buildPerfilState(null));
        openFilialConfirm({
          flowId,
          codigo: codigoInformado,
          matchesByCode,
          draft,
          lookupError,
          source: "codigo",
        });
        return;
      }
    }
    if (!formSnapshot.empresa.trim()) {
      if (isActiveCreateFlow(flowId)) {
        setError("Informe o nome da empresa.");
      }
      return;
    }

    setCreating(true);
    setError(null);
    try {
      await persistClienteFromForm(formSnapshot, perfilSnapshot);
      if (!isActiveCreateFlow(flowId)) return;
      resetCreateFlow("save-create-success");
      await refreshClientesData();
    } catch (err) {
      if (!isActiveCreateFlow(flowId)) return;
      setError(err instanceof Error ? err.message : "Erro ao criar cliente.");
    } finally {
      if (isActiveCreateFlow(flowId)) {
        setCreating(false);
      }
    }
  };

  const handleDuplicateKeepOld = async () => {
    if (!duplicateModal) return;
    setDuplicateResolving(true);
    setError(null);
    try {
      if (!duplicateModal.isTemp) {
        await deleteCliente(duplicateModal.newCliente.id);
        if (selectedId === duplicateModal.newCliente.id) {
          setSelected(null);
          setSelectedId(null);
        }
      }
      await refreshClientesData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover cliente duplicado.");
    } finally {
      setDuplicateResolving(false);
      setDuplicateModal(null);
    }
  };

  const handleDuplicateSubstitute = async () => {
    if (!duplicateModal) return;
    setDuplicateResolving(true);
    setError(null);
    try {
      if (duplicateModal.isTemp && duplicateModal.payload) {
        const updatePayload = buildClientePayloadFromImport({
          ...duplicateModal.payload,
          complemento: duplicateComplemento,
        });
        await Promise.all(
          duplicateModal.existing.map((item) => updateCliente(item.id, updatePayload)),
        );
      } else {
        const oldIds = duplicateModal.existing.map((item) => item.id);
        await Promise.all(oldIds.map((id) => deleteCliente(id)));
        if (selectedId && oldIds.includes(selectedId)) {
          setSelected(null);
          setSelectedId(null);
        }
        await updateCliente(duplicateModal.newCliente.id, {
          complemento: duplicateComplemento.trim() || null,
        });
      }
      await refreshClientesData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao substituir cliente.");
    } finally {
      setDuplicateResolving(false);
      setDuplicateModal(null);
    }
  };

  const handleDuplicateKeepBoth = async () => {
    if (!duplicateModal) return;
    setDuplicateResolving(true);
    setError(null);
    try {
      if (duplicateModal.isTemp && duplicateModal.payload) {
        await createCliente(
          buildClientePayloadFromImport({
            ...duplicateModal.payload,
            complemento: duplicateComplemento,
          }),
        );
      } else {
        await updateCliente(duplicateModal.newCliente.id, {
          complemento: duplicateComplemento.trim() || null,
        });
      }
      await refreshClientesData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao manter as duas empresas.");
    } finally {
      setDuplicateResolving(false);
      setDuplicateModal(null);
    }
  };

  const handleCodigoLookup = async () => {
    if (creating || codigoLoading || cnpjLoading) return;
    const empresaId = form.codigo.trim();
    if (!empresaId) {
      setCodigoError("Informe o codigo da empresa.");
      return;
    }
    const flowId = startNewCreateFlow();
    const requestId = ++createCodigoLookupRequestRef.current;
    const isStaleCodigoLookup = () => {
      const stale =
        requestId !== createCodigoLookupRequestRef.current || !isActiveCreateFlow(flowId);
      if (stale) {
        debugCreateFlow({
          action: "codigo-lookup-stale-response",
          flowId,
          requestId,
          currentRequestId: createCodigoLookupRequestRef.current,
          activeFlowId: createFlowIdRef.current,
          codigo: empresaId,
        });
      }
      return stale;
    };
    debugCreateFlow({
      action: "codigo-lookup-start",
      flowId,
      requestId,
      codigo: empresaId,
    });
    setCodigoLoading(true);
    setCodigoError(null);
    setCnpjError(null);
    setCreatePlanoValores([]);
    setPerfilCreate(buildPerfilState(null));
    setFilialConfirmModal(null);
    setFilialCadastroModal(null);
    try {
      const matchesByCode = await findClientesByCodigo(empresaId);
      if (isStaleCodigoLookup()) return;
      debugCreateFlow({
        action: "codigo-lookup-after-find",
        flowId,
        requestId,
        codigo: empresaId,
        matchesCount: matchesByCode.length,
      });
      if (matchesByCode.length > 0) {
        let draft = buildEmptyFilialForm({ codigo: empresaId });
        let lookupError: string | null = null;
        try {
          const empresaApi = await fetchEmpresaByEmpresaId(empresaId);
          if (isStaleCodigoLookup()) return;
          if (empresaApi) {
            const apiForm = mapEmpresaApiToClienteForm(empresaApi, empresaId);
            draft = applyApiFieldsToFilialForm(draft, apiForm);
          } else {
            lookupError = "Empresa nao encontrada na API.";
          }
        } catch (err) {
          if (isStaleCodigoLookup()) return;
          lookupError =
            err instanceof Error
              ? `Nao foi possivel consultar dados da empresa na API: ${err.message}`
              : "Nao foi possivel consultar dados da empresa na API.";
        }
        setCreatePlanoValores([]);
        setPerfilCreate(buildPerfilState(null));
        debugCreateFlow({
          action: "codigo-lookup-open-filial-confirm",
          flowId,
          requestId,
          codigo: empresaId,
          lookupError,
          draft,
          matchesCount: matchesByCode.length,
        });
        openFilialConfirm({
          flowId,
          codigo: empresaId,
          matchesByCode,
          draft,
          lookupError,
          source: "codigo",
        });
        return;
      }

      const empresaApi = await fetchEmpresaByEmpresaId(empresaId);
      if (isStaleCodigoLookup()) return;
      if (!empresaApi) {
        throw new Error("Empresa nao encontrada na API.");
      }
      const planoValores = extractOdontoartPlanoValores(empresaApi);
      const formData = await enrichFormDataCepByAddress(
        mapEmpresaApiToClienteForm(empresaApi, empresaId),
      );
      if (isStaleCodigoLookup()) return;
      debugCreateFlow({
        action: "codigo-lookup-apply-form",
        flowId,
        requestId,
        codigo: empresaId,
        formData,
      });
      safeSetCadastroForm(
        "codigo-lookup",
        (prev) =>
          mergeLookupIntoCadastroForm(prev, formData, {
            forceFields: [
              "codigo",
              "cnpj",
              "corte",
              "venc",
              "valor",
              "cep",
              "empresa",
              "obs_comercial",
              "situacao",
              "endereco",
              "bairro",
              "cidade",
              "uf",
            ],
          }),
        {
          flowId,
          requestId,
          requestRef: createCodigoLookupRequestRef,
        },
      );
      setCreatePlanoValores(planoValores);
      setPerfilCreate(buildPerfilState(null));
    } catch (err) {
      if (isStaleCodigoLookup()) return;
      setCodigoError(err instanceof Error ? err.message : "Erro ao buscar codigo na API.");
    } finally {
      if (requestId === createCodigoLookupRequestRef.current) {
        setCodigoLoading(false);
      }
    }
  };

  const handleLocalTechnicalReset = async () => {
    if (localResetLoading) return;
    const confirmed = window.confirm(
      "Isso vai limpar cache local do app neste dispositivo e recarregar a pagina. Deseja continuar?",
    );
    if (!confirmed) return;

    setLocalResetLoading(true);
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }

      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

      sessionStorage.removeItem("odontoartRouteFormDraftsV1");
      sessionStorage.removeItem(CLIENTES_VIEW_STATE_KEY);

      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao limpar cache local.");
    } finally {
      setLocalResetLoading(false);
    }
  };

  const handleCnpjLookup = async () => {
    if (creating || codigoLoading || cnpjLoading) return;
    const cnpj = sanitizeCnpjDigits(form.cnpj);
    if (cnpj.length !== 14) {
      setCnpjError("Informe um CNPJ valido.");
      return;
    }

    const flowId = startNewCreateFlow();
    const requestId = ++createCnpjLookupRequestRef.current;
    const codigoDigitado = form.codigo.trim();
    setCnpjLoading(true);
    setCnpjError(null);
    setCodigoError(null);
    setCreatePlanoValores([]);
    setPerfilCreate(buildPerfilState(null));
    setFilialConfirmModal(null);
    setFilialCadastroModal(null);
    try {
      const formattedCnpj = formatCnpjInput(cnpj);
      const matchesByCnpj = await findClientesByCnpj(formattedCnpj);
      if (requestId !== createCnpjLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      if (matchesByCnpj.length > 0) {
        setCnpjError(
          "Este CNPJ ja esta cadastrado. Se deseja alterar os dados, abra o cadastro existente.",
        );
        const firstMatch = matchesByCnpj[0];
        if (firstMatch) {
          setSelected(null);
          setSelectedId(firstMatch.id);
          setIsEditing(false);
        }
        return;
      }

      const empresaApi = await fetchEmpresaByCnpjWs(cnpj);
      if (requestId !== createCnpjLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      const endereco = buildEnderecoWithNumero(empresaApi.logradouro, empresaApi.numero);

      const incomingFromCnpjApi: Partial<CadastroFormState> = {
        codigo: codigoDigitado || undefined,
        cnpj: formattedCnpj,
        empresa: (empresaApi.razao_social ?? "").trim(),
        endereco: endereco || undefined,
        cep: empresaApi.cep ? formatCep(empresaApi.cep) : undefined,
        bairro: empresaApi.bairro ?? undefined,
        cidade: empresaApi.cidade ?? undefined,
        uf: empresaApi.estado ? empresaApi.estado.toUpperCase().slice(0, 3) : undefined,
        situacao: "Ativo",
      };
      debugCreateFlow({
        action: "cnpj-lookup-incoming",
        flowId,
        incoming: incomingFromCnpjApi,
      });
      setCreatePlanoValores([]);
      setPerfilCreate(buildPerfilState(null));
      if (requestId !== createCnpjLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      safeSetCadastroForm(
        "cnpj-lookup",
        (prev) =>
          mergeLookupIntoCadastroForm(prev, incomingFromCnpjApi, {
            forceFields: ["cnpj", "empresa", "endereco", "cep", "bairro", "cidade", "uf", "situacao"],
          }),
        {
          flowId,
          requestId,
          requestRef: createCnpjLookupRequestRef,
        },
      );
    } catch (err) {
      if (requestId !== createCnpjLookupRequestRef.current || !isActiveCreateFlow(flowId)) return;
      setCnpjError(err instanceof Error ? err.message : "Erro ao buscar CNPJ na API.");
    } finally {
      if (requestId === createCnpjLookupRequestRef.current && isActiveCreateFlow(flowId)) {
        setCnpjLoading(false);
      }
    }
  };

  const handleSaveEdit = async () => {
    if (!selected || !canEdit) return;
    const codigoInformado = editForm.codigo.trim();
    if (codigoInformado) {
      const matchesByCode = await findClientesByCodigo(codigoInformado, selected.id);
      if (matchesByCode.length > 0) {
        if (!editForm.obs.trim()) {
          setError("Para filial, o campo Obs e obrigatorio.");
          return;
        }
      }
    }
    if (!editForm.empresa.trim()) {
      setError("Informe o nome da empresa.");
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      const corteValue = editForm.corte ? Number(editForm.corte) : null;
      const vencValue = editForm.venc ? Number(editForm.venc) : null;
      const parsedCorte = Number.isFinite(corteValue ?? NaN) ? corteValue : null;
      const parsedVenc = Number.isFinite(vencValue ?? NaN) ? vencValue : null;
      const parsedDataUltimaVisita = toIsoDateInput(editForm.data_da_ultima_visita);
      const updated = await updateCliente(selected.id, {
        codigo: editForm.codigo.trim() || null,
        cnpj: normalizeCnpj(editForm.cnpj),
        corte: parsedCorte,
        venc: parsedVenc,
        valor: editForm.valor ? parseImportCurrency(editForm.valor) : null,
        data_da_ultima_visita: parsedDataUltimaVisita,
        cep: editForm.cep.trim() || null,
        empresa: editForm.empresa.trim() || null,
        pessoa: editForm.pessoa.trim() || null,
        contato: normalizeContato(editForm.contato),
        grupo: editForm.grupo.trim() || null,
        obs_comercial: editForm.obs_comercial.trim() || null,
        obs: editForm.obs.trim() || null,
        perfil_visita: perfilEdit.perfil || null,
        situacao: editForm.situacao.trim() || "Ativo",
        categoria: editForm.categoria.trim() || null,
        endereco: editForm.endereco.trim() || null,
        complemento: editForm.complemento.trim() || null,
        bairro: editForm.bairro.trim() || null,
        cidade: editForm.cidade.trim() || null,
        uf: editForm.uf.trim() || null,
      });
      await syncVisitsForCliente(updated);
      setSelected(updated);
      setIsEditing(false);
      await refreshClientesData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar cliente.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (!selected || !canEdit) return;
    if (!deletePasswordEdit.trim()) {
      setError("Informe sua senha para excluir a empresa.");
      return;
    }
    const userEmail = session?.user?.email ?? null;
    if (!userEmail) {
      setError("Email do usuario nao encontrado para confirmacao.");
      return;
    }

    setDeletingEdit(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: deletePasswordEdit,
      });
      if (authError) {
        setError("Senha invalida.");
        return;
      }

      await deleteCliente(selected.id);
      setSelected(null);
      setSelectedId(null);
      setIsEditing(false);
      setDeletePasswordEdit("");
      await refreshClientesData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir empresa.");
    } finally {
      setDeletingEdit(false);
    }
  };

  const handleCnpjLookupEdit = async () => {
    const cnpj = sanitizeCnpjDigits(editForm.cnpj);
    if (cnpj.length !== 14) {
      setCnpjErrorEdit("Informe um CNPJ valido.");
      return;
    }

    const requestId = ++editCnpjLookupRequestRef.current;
    setCnpjLoadingEdit(true);
    setCnpjErrorEdit(null);
    try {
      const empresaApi = await fetchEmpresaByCnpjWs(cnpj);
      if (requestId !== editCnpjLookupRequestRef.current) return;
      const endereco = buildEnderecoWithNumero(empresaApi.logradouro, empresaApi.numero);
      setEditPlanoValores([]);
      setEditForm((prev) => ({
        ...prev,
        empresa: empresaApi.razao_social ?? prev.empresa,
        endereco: endereco || prev.endereco,
        cep: empresaApi.cep ? formatCep(empresaApi.cep) : prev.cep,
        bairro: empresaApi.bairro ?? prev.bairro,
        cidade: empresaApi.cidade ?? prev.cidade,
        uf: empresaApi.estado ?? prev.uf,
      }));
    } catch (err) {
      if (requestId !== editCnpjLookupRequestRef.current) return;
      setCnpjErrorEdit(err instanceof Error ? err.message : "Erro ao buscar CNPJ na API.");
    } finally {
      if (requestId === editCnpjLookupRequestRef.current) {
        setCnpjLoadingEdit(false);
      }
    }
  };

  const handleDownloadTemplate = () => {
    const headers = [
      "codigo",
      "obs",
      "empresa",
      "pessoa",
      "contato",
      "grupo",
      "categoria",
      "obs_comercial",
      "corte",
      "vencimento",
      "valor",
      "data_ultima_visita",
      "perfil_visita",
      "cidade",
      "uf",
      "endereco",
      "complemento",
      "bairro",
      "cep",
    ];
    const sampleRow = [
      "",
      "",
      "",
      "",
      "85999999999,85988888888",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ];
    const sheet = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "CLIENTES");
    XLSX.writeFile(workbook, "modelo_clientes.xlsx");
  };

  useEffect(() => {
    if (!importing) return;
    setImportTick(Date.now());
    const interval = window.setInterval(() => {
      setImportTick(Date.now());
    }, 500);
    return () => window.clearInterval(interval);
  }, [importing]);

  const formatDuration = (totalSeconds: number) => {
    const clamped = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const isStatementTimeoutError = (error: unknown) => {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
      message.includes("statement timeout") ||
      message.includes("canceling statement due to statement timeout") ||
      message.includes("canceling statement due to user request")
    );
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMessage(null);
    setImportStageLabel("Lendo arquivo...");
    setImportProgress(0);
    setImportTotal(0);
    setImportInserted(0);
    setImportStartedAt(Date.now());
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (!rows.length) {
        setImportMessage("Arquivo sem registros.");
        return;
      }

      const payloads = rows
        .map((raw) => {
          const record: Record<string, string> = {};
          Object.entries(raw).forEach(([key, value]) => {
            const normalized = normalizeHeader(key);
            const target = HEADER_MAP[normalized];
            if (!target) return;
            const text = String(value ?? "").trim();
            if (!text) return;
            const cleaned = IMPORT_NUMERIC_FIELDS.has(target) ? sanitizeDigits(text) : text;
            if (!cleaned) return;
            record[target] = target === "cep" ? formatCep(cleaned) : cleaned;
          });

          const corteValue = record.corte ? Number(record.corte) : null;
          const vencValue = record.venc ? Number(record.venc) : null;
          const parsedCorte = Number.isFinite(corteValue ?? NaN) ? corteValue : null;
          const parsedVenc = Number.isFinite(vencValue ?? NaN) ? vencValue : null;
          const parsedDataUltimaVisita = record.data_da_ultima_visita
            ? parseImportDate(record.data_da_ultima_visita)
            : null;
          const parsedValor = record.valor ? parseImportCurrency(record.valor) : null;

          return {
	            codigo: record.codigo ?? null,
	            cnpj: normalizeCnpj(record.cnpj),
	            corte: parsedCorte,
            venc: parsedVenc,
            valor: parsedValor,
            data_da_ultima_visita: parsedDataUltimaVisita,
            cep: record.cep ?? null,
            empresa: record.empresa ?? null,
            pessoa: record.pessoa ?? null,
            contato: normalizeContato(record.contato ?? ""),
            grupo: record.grupo ?? null,
            obs_comercial: record.obs_comercial ?? null,
            obs: record.obs ?? null,
            situacao: "Ativo",
            categoria: record.categoria ?? null,
            perfil_visita: record.perfil_visita ?? null,
            endereco: record.endereco ?? null,
            complemento: record.complemento ?? null,
            bairro: record.bairro ?? null,
            cidade: record.cidade ?? null,
            uf: record.uf ?? null,
          };
        })
        .filter((record) => Boolean(record.empresa));

      if (payloads.length === 0) {
        setImportMessage("Nenhum cliente valido encontrado.");
        return;
      }

      setImportTotal(payloads.length);
      setImportProgress(0);
      setImportInserted(0);

      setImportStageLabel("Importando registros");
      setImportMessage("Importando registros...");
      const created: ClienteRow[] = [];
      let processedImport = 0;
      const totalBatches = Math.ceil(payloads.length / IMPORT_BATCH_SIZE);
      const upsertBatchWithFallback = async (
        batch: Array<{
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
          obs: string | null;
          situacao: string;
          perfil_visita: string | null;
          endereco: string | null;
          complemento: string | null;
          bairro: string | null;
          cidade: string | null;
          uf: string | null;
        }>,
      ): Promise<ClienteRow[]> => {
        try {
          return await upsertClientes(batch, { skipDataUltimaVisitaSync: true });
        } catch (error) {
          if (!isStatementTimeoutError(error) || batch.length <= 1) {
            throw error;
          }
          const half = Math.ceil(batch.length / 2);
          setImportMessage(`Timeout no lote (${batch.length}). Tentando sublotes menores...`);
          await delay(150);
          const first = await upsertBatchWithFallback(batch.slice(0, half));
          const second = await upsertBatchWithFallback(batch.slice(half));
          return [...first, ...second];
        }
      };

      for (let index = 0; index < payloads.length; index += IMPORT_BATCH_SIZE) {
        const batchNumber = Math.floor(index / IMPORT_BATCH_SIZE) + 1;
        const batch = payloads.slice(index, index + IMPORT_BATCH_SIZE);
        setImportMessage(`Importando lote ${batchNumber}/${totalBatches}...`);
        const createdBatch = await upsertBatchWithFallback(batch);
        created.push(...createdBatch);
        processedImport += batch.length;
        setImportProgress(processedImport);
        setImportInserted(created.length);
      }

      const duplicatesFromCreated: DuplicateEntry[] = [];
      if (created.length > 0) {
        const seen: ClienteRow[] = [];
        created.forEach((cliente) => {
          const matches = seen.filter((item) => isSameAddress(item, cliente));
          if (matches.length) {
            duplicatesFromCreated.push({ newCliente: cliente, existing: matches });
          }
          seen.push(cliente);
        });

        const existingMatchesFromDb = await Promise.all(
          created.map(async (cliente) => {
            const matches = await findClientesByAddress({
              endereco: cliente.endereco,
              cidade: cliente.cidade,
              uf: cliente.uf,
              complemento: cliente.complemento,
              excludeId: cliente.id,
            });
            return { cliente, matches };
          }),
        );
        existingMatchesFromDb.forEach(({ cliente, matches }) => {
          if (!matches.length) return;
          duplicatesFromCreated.push({ newCliente: cliente, existing: matches });
        });
      }

      let mergedDuplicates: DuplicateEntry[] = [];
      if (duplicatesFromCreated.length) {
        const merged = new Map<string, DuplicateEntry>();
        duplicatesFromCreated.forEach((entry) => {
          const key = buildImportKey(entry.newCliente);
          if (!merged.has(key)) {
            merged.set(key, entry);
          }
        });
        mergedDuplicates = Array.from(merged.values());
        setDuplicateQueue((prev) => [...prev, ...mergedDuplicates]);
      }
      await refreshClientesData();
      if (mergedDuplicates.length > 0) {
        setImportMessage("Existem duplicidades. Escolha o que fazer.");
      } else if (created.length > 0) {
        setImportMessage(`Importacao concluida. ${created.length} empresa(s) adicionadas.`);
      } else {
        setImportMessage("Importacao concluida. Nenhum cliente novo encontrado.");
      }
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : "Erro ao importar arquivo.");
    } finally {
      setImporting(false);
      setImportStartedAt(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const canEditEndereco = Boolean(form.cidade.trim() && form.uf.trim());
  const canEditEnderecoEdit = Boolean(editForm.cidade.trim() && editForm.uf.trim());
  const canEditEnderecoFilial = Boolean(
    filialCadastroModal?.form.cidade.trim() && filialCadastroModal?.form.uf.trim(),
  );
  const createSituacaoBlockedMessage = isSituacaoAllowedForCadastro(form.situacao)
    ? null
    : getSituacaoCadastroErrorMessage(form.situacao);
  const filialSituacaoBlockedMessage =
    filialCadastroModal && !isSituacaoAllowedForCadastro(filialCadastroModal.form.situacao)
      ? getSituacaoCadastroErrorMessage(filialCadastroModal.form.situacao)
      : null;
  const createFlowBusy =
    creating || codigoLoading || cnpjLoading || filialCnpjLoading || filialCepLoading || filialBairroLoading;
  const hasPlanoValores = (valores: OdontoartPlanoValor[]) =>
    valores.some((plano) => plano.valorTitular !== null || plano.valorDependente !== null);

  const openPlanoValoresModal = async ({
    title,
    source,
    codigo,
    empresa,
    valores,
  }: {
    title: string;
    source: "create" | "edit";
    codigo: string;
    empresa: string;
    valores: OdontoartPlanoValor[];
  }) => {
    const codigoNormalizado = codigo.trim();
    const empresaNormalizada = empresa.trim();

    if (valores.length > 0) {
      setPlanosModalState({
        title,
        source,
        codigo: codigoNormalizado,
        empresa: empresaNormalizada,
        valores,
        loading: false,
        error: null,
      });
      return;
    }

    if (!codigoNormalizado) {
      setPlanosModalState({
        title,
        source,
        codigo: "",
        empresa: empresaNormalizada,
        valores: [],
        loading: false,
        error: "Informe o codigo da empresa para consultar os planos.",
      });
      return;
    }

    setPlanosModalState({
      title,
      source,
      codigo: codigoNormalizado,
      empresa: empresaNormalizada,
      valores: [],
      loading: true,
      error: null,
    });

    try {
      const empresaApi = await fetchEmpresaByEmpresaId(codigoNormalizado);
      if (!empresaApi) {
        setPlanosModalState((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                error: "Empresa nao encontrada na API.",
              }
            : prev,
        );
        return;
      }

      const valoresApi = extractOdontoartPlanoValores(empresaApi);
      if (source === "create") {
        setCreatePlanoValores(valoresApi);
      } else {
        setEditPlanoValores(valoresApi);
      }

      const empresaApiNome = (
        empresaApi.NomeFantazia ??
        empresaApi.NomeFantasia ??
        empresaApi.RazaoSocial ??
        empresaNormalizada
      )
        ?.trim();

      setPlanosModalState((prev) =>
        prev
          ? {
              ...prev,
              codigo: codigoNormalizado,
              empresa: empresaApiNome || empresaNormalizada,
              valores: valoresApi,
              loading: false,
              error: null,
            }
          : prev,
      );
    } catch (err) {
      setPlanosModalState((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error: err instanceof Error ? err.message : "Erro ao consultar valores por plano.",
            }
          : prev,
      );
    }
  };
  const createValoresLoading = planosModalState?.loading && planosModalState.source === "create";
  const editValoresLoading = planosModalState?.loading && planosModalState.source === "edit";
  const hasPendingDuplicates = Boolean(duplicateModal || duplicateQueue.length > 0);
  const DUPLICATE_EXISTING_PAGE_SIZE = 3;
  const duplicateExistingTotalPages = duplicateModal
    ? Math.max(1, Math.ceil(duplicateModal.existing.length / DUPLICATE_EXISTING_PAGE_SIZE))
    : 1;
  const duplicateExistingStart = (duplicateExistingPage - 1) * DUPLICATE_EXISTING_PAGE_SIZE;
  const duplicateExistingItems = duplicateModal
    ? duplicateModal.existing.slice(
        duplicateExistingStart,
        duplicateExistingStart + DUPLICATE_EXISTING_PAGE_SIZE,
      )
    : [];
  const importElapsedSeconds = importStartedAt ? Math.max(0, (importTick - importStartedAt) / 1000) : 0;
  const importRemaining = Math.max(0, importTotal - importProgress);
  const importEstimatedSeconds = importProgress > 0 ? (importElapsedSeconds / importProgress) * importRemaining : null;

  if (!canView) {
    return (
      <div className="glass-pane rounded-2xl p-4 text-sm text-ink/70 md:p-6">
        Este modulo e restrito a supervisao e assistencia.
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">Empresas</h2>
          <p className="mt-2 text-sm text-ink/60">
            Gestao de empresas cadastradas e historico de visitas.
          </p>
        </div>
        {canUseLocalResetTool && (
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleLocalTechnicalReset()}
              disabled={localResetLoading}
              title="Reset tecnico local deste dispositivo"
              aria-label="Reset tecnico local deste dispositivo"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-ink/70 hover:border-sea hover:text-sea disabled:opacity-50"
            >
              {localResetLoading ? <LoaderCircle size={16} className="animate-spin" /> : <BrushCleaning size={16} />}
            </button>
            <span className="rounded-md border border-yellow-400 bg-yellow-100 px-2 py-1 text-xs font-semibold text-red-700 dark:border-yellow-300 dark:bg-yellow-200 dark:text-red-800">
              se a busca pelo codigo falhar, clique aqui
            </span>
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      {canCreate && (
        <form
          onSubmit={handleCreate}
          className="grid gap-3 rounded-2xl border border-sea/20 bg-sand/30 p-3 md:grid-cols-6 md:p-4"
        >
          <label className="min-w-0 flex w-full flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
            Codigo
            <div className="min-w-0 flex items-end gap-1">
              <input
                value={form.codigo}
                onChange={(event) => {
                  cancelPendingCreateLookups();
                  setCodigoError(null);
                  setCnpjError(null);
                  setForm((prev) => ({ ...prev, codigo: event.target.value }));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCodigoLookup();
                  }
                }}
                className="min-w-0 w-full flex-1 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
              />
              <button
                type="button"
                onClick={() => void handleCodigoLookup()}
                disabled={createFlowBusy || codigoLoading || !form.codigo.trim()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"
                title={codigoLoading ? "Buscando codigo..." : "Buscar por codigo"}
                aria-label={codigoLoading ? "Buscando codigo..." : "Buscar por codigo"}
              >
                <Search size={15} className={codigoLoading ? "animate-pulse" : ""} />
              </button>
            </div>
            {codigoLoading && <span className="text-[11px] text-ink/60">Consultando codigo...</span>}
            {codigoError && <span className="text-[11px] text-red-600">{codigoError}</span>}
          </label>
          <label className="min-w-0 flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
            CNPJ
            <div className="relative">
              <input
                value={form.cnpj}
                onChange={(event) => {
                  cancelPendingCreateLookups();
                  setCnpjError(null);
                  setCodigoError(null);
                  setForm((prev) => ({ ...prev, cnpj: formatCnpjInput(event.target.value) }));
                }}
                inputMode="numeric"
                maxLength={18}
                placeholder="00.000.000/0000-00"
                className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 pr-11 text-sm text-ink outline-none focus:border-sea"
              />
              <button
                type="button"
                onClick={handleCnpjLookup}
                disabled={createFlowBusy || cnpjLoading || sanitizeCnpjDigits(form.cnpj).length !== 14}
                className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-r-lg border-l border-sea/30 bg-white text-sea hover:text-seaLight disabled:opacity-50"
                title={cnpjLoading ? "Buscando CNPJ..." : "Buscar por CNPJ"}
                aria-label={cnpjLoading ? "Buscando CNPJ..." : "Buscar por CNPJ"}
              >
                <Building2 size={15} className={cnpjLoading ? "animate-pulse" : ""} />
              </button>
            </div>
            {cnpjLoading && <span className="text-[11px] text-ink/60">Consultando CNPJ...</span>}
            {cnpjError && <span className="text-[11px] text-red-600">{cnpjError}</span>}
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Empresa
            <input
              value={form.empresa}
              onChange={(event) => setForm((prev) => ({ ...prev, empresa: event.target.value }))}
              className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
            Pessoa
            <input
              value={form.pessoa}
              onChange={(event) => setForm((prev) => ({ ...prev, pessoa: event.target.value }))}
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
            Contato
            <input
              value={form.contato}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, contato: sanitizeContatoInput(event.target.value) }))
              }
              placeholder="85999999999,85988888888"
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Grupo
            <input
              value={form.grupo}
              onChange={(event) => setForm((prev) => ({ ...prev, grupo: event.target.value }))}
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Obs comercial
            <input
              value={form.obs_comercial}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, obs_comercial: event.target.value }))
              }
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Obs
            <input
              value={form.obs}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, obs: event.target.value }))
              }
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <div className="md:col-span-6 flex flex-wrap items-end gap-2">
            <label className="w-16 flex flex-col gap-1 text-xs font-semibold text-ink/70">
              Corte
              <input
                value={form.corte}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, corte: sanitizeDigits(event.target.value).slice(0, 2) }))
                }
                inputMode="numeric"
                maxLength={2}
                className="w-full rounded-lg border border-sea/20 bg-white px-2 py-2 text-sm text-ink outline-none focus:border-sea"
              />
            </label>
            <label className="w-16 flex flex-col gap-1 text-xs font-semibold text-ink/70">
              Venc
              <input
                value={form.venc}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, venc: sanitizeDigits(event.target.value).slice(0, 2) }))
                }
                inputMode="numeric"
                maxLength={2}
                className="w-full rounded-lg border border-sea/20 bg-white px-2 py-2 text-sm text-ink outline-none focus:border-sea"
              />
            </label>
            <label className="w-16 flex flex-col gap-1 text-xs font-semibold text-ink/70">
              <span>Valor</span>
              <div className="flex h-10 w-full items-center">
                <button
                  type="button"
                  onClick={() =>
                    void openPlanoValoresModal({
                      title: "Valores por plano (cadastro)",
                      source: "create",
                      codigo: form.codigo,
                      empresa: form.empresa,
                      valores: createPlanoValores,
                    })
                  }
                  title="Ver valores Titular/Dependente"
                  aria-label="Ver valores Titular e Dependente"
                  className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight"
                >
                  {createValoresLoading ? <LoaderCircle size={14} className="animate-spin" /> : <DollarSign size={14} />}
                </button>
              </div>
            </label>
            <label className="w-40 flex flex-col gap-1 text-xs font-semibold text-ink/70">
              Data da ultima visita
              <input
                type="date"
                value={form.data_da_ultima_visita}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, data_da_ultima_visita: event.target.value }))
                }
                className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
              />
            </label>
            <label className="w-36 flex flex-col gap-1 text-xs font-semibold text-ink/70">
              Perfil visita
              <select
                value={
                  perfilCreate.customEnabled
                    ? "__custom__"
                    : perfilCreate.singleTimeBase || perfilCreate.perfil
                }
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "__custom__") {
                    setPerfilCreate((prev) => ({
                      ...prev,
                      customEnabled: true,
                      customTimes: prev.customTimes.length ? prev.customTimes : [""],
                      singleTimeBase: "",
                      singleTimeValue: "",
                      perfil: prev.customEnabled ? prev.perfil : "",
                    }));
                  } else if (value === "ALMOCO" || value === "JANTAR") {
                    setPerfilCreate((prev) => ({
                      ...prev,
                      customEnabled: false,
                      customTimes: [],
                      singleTimeBase: value,
                      singleTimeValue: "",
                      perfil: value,
                    }));
                  } else {
                    setPerfilCreate({
                      perfil: value,
                      customEnabled: false,
                      customTimes: [],
                      singleTimeBase: "",
                      singleTimeValue: "",
                    });
                  }
                }}
                className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
              >
                <option value="">Selecione</option>
                {PERFIL_VISITA_PRESETS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value="__custom__">Horario customizado</option>
              </select>
            </label>
            {(perfilCreate.singleTimeBase === "ALMOCO" || perfilCreate.singleTimeBase === "JANTAR") && (
              <label className="w-28 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                HH:MM
                <input
                  type="time"
                  value={perfilCreate.singleTimeValue}
                  onChange={(event) =>
                    setPerfilCreate((prev) => ({
                      ...prev,
                      singleTimeValue: event.target.value,
                      perfil: event.target.value
                        ? `${prev.singleTimeBase} ${event.target.value}`
                        : prev.singleTimeBase,
                    }))
                  }
                  className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
            )}
            {perfilCreate.customEnabled && (
              <div className="shrink-0 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                <span>Horarios customizados</span>
                <div className="flex w-fit max-w-[24rem] items-end gap-2 overflow-x-auto pb-1 pr-1">
                {perfilCreate.customTimes.map((time, index) => (
                  <div key={`${time}-${index}`} className="shrink-0 flex items-center gap-2">
                    <input
                      type="time"
                      value={time}
                      onChange={(event) => {
                        const next = [...perfilCreate.customTimes];
                        next[index] = event.target.value;
                        applyPerfilTimes(setPerfilCreate, next);
                      }}
                      className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    />
                    {index === perfilCreate.customTimes.length - 1 && (
                      <button
                        type="button"
                        onClick={() => applyPerfilTimes(setPerfilCreate, [...perfilCreate.customTimes, ""])}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight"
                        title="Adicionar horario"
                        aria-label="Adicionar horario"
                      >
                        <Plus size={14} />
                      </button>
                    )}
                    {perfilCreate.customTimes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = perfilCreate.customTimes.filter((_, idx) => idx !== index);
                          applyPerfilTimes(setPerfilCreate, next.length ? next : [""]);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight"
                        title="Remover horario"
                        aria-label="Remover horario"
                      >
                        <span className="text-base leading-none">-</span>
                      </button>
                    )}
                  </div>
                ))}
                </div>
              </div>
            )}
            <label className="w-36 shrink-0 flex flex-col gap-1 text-xs font-semibold text-ink/70">
              Situacao
              <select
                value={form.situacao}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, situacao: event.target.value }))
                }
                className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
              >
                <option value="">Selecione</option>
                {form.situacao && !SITUACAO_OPTIONS.some((option) => option === form.situacao) && (
                  <option value={form.situacao}>{form.situacao}</option>
                )}
                {SITUACAO_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-36 shrink-0 flex flex-col gap-1 text-xs font-semibold text-ink/70">
              <span className="inline-flex items-center gap-1">
                Categoria
                <CategoriaLegendPopover />
              </span>
              <select
                value={form.categoria}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, categoria: event.target.value }))
                }
                className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
              >
                <option value="">Selecione</option>
                {form.categoria && !CATEGORIA_OPTIONS.some((option) => option === form.categoria) && (
                  <option value={form.categoria}>{form.categoria}</option>
                )}
                {CATEGORIA_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Cidade
            <input
              value={form.cidade}
              onChange={(event) => setForm((prev) => ({ ...prev, cidade: event.target.value }))}
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <div className="md:col-span-4 grid gap-3 md:grid-cols-[80px_minmax(0,1fr)] md:items-start">
            <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
              UF
              <input
                value={form.uf}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, uf: event.target.value.toUpperCase().slice(0, 3) }))
                }
                maxLength={3}
                className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm uppercase tracking-wide text-ink outline-none focus:border-sea"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
              <span>
                Endereco + Nº
                {!canEditEndereco && (
                  <span className="font-normal text-ink/50"> (Informe cidade e UF para editar o endereco.)</span>
                )}
              </span>
              <div className="flex items-end gap-1">
                <input
                  value={form.endereco}
                  onChange={(event) => setForm((prev) => ({ ...prev, endereco: event.target.value }))}
                  disabled={!canEditEndereco}
                  className="flex-1 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
                <button
                  type="button"
                  onClick={handleBairroLookup}
                  disabled={createFlowBusy || bairroLoading || !form.endereco.trim() || !form.cidade.trim() || !form.uf.trim()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"
                  title={bairroLoading ? "Buscando endereco..." : "Buscar por endereco"}
                  aria-label={bairroLoading ? "Buscando endereco..." : "Buscar por endereco"}
                >
                  <Search size={15} className={bairroLoading ? "animate-pulse" : ""} />
                </button>
              </div>
              {bairroLoading && <span className="text-[11px] text-ink/60">Consultando endereco...</span>}
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Complemento
            <input
              value={form.complemento}
              onChange={(event) => setForm((prev) => ({ ...prev, complemento: event.target.value }))}
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Bairro
            <input
              value={form.bairro}
              onChange={(event) => setForm((prev) => ({ ...prev, bairro: event.target.value }))}
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            CEP
            <div className="flex items-end gap-1">
              <input
                value={form.cep}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, cep: formatCep(event.target.value) }))
                }
                placeholder="00000-000"
                className="flex-1 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
              />
              <button
                type="button"
                onClick={handleCepLookup}
                disabled={createFlowBusy || cepLoading || sanitizeCep(form.cep).length !== 8}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"
                title={cepLoading ? "Buscando CEP..." : "Buscar por CEP"}
                aria-label={cepLoading ? "Buscando CEP..." : "Buscar por CEP"}
              >
                <Search size={15} className={cepLoading ? "animate-pulse" : ""} />
              </button>
            </div>
            {cepLoading && <span className="text-[11px] text-ink/60">Consultando CEP...</span>}
          </label>
          <div className="flex items-end md:col-span-2">
            <button
              type="submit"
              disabled={createFlowBusy || Boolean(createSituacaoBlockedMessage)}
              className="inline-flex items-center gap-2 rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
            >
              <Plus size={14} />
              {creating ? "Criando" : "Adicionar cliente"}
            </button>
            {createSituacaoBlockedMessage && (
              <span className="ml-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600">
                {createSituacaoBlockedMessage}
              </span>
            )}
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg text-ink">Empresas cadastradas</h3>
          <p className="text-xs text-ink/60">
            {resultCount ?? "..."} empresa(s).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={resetClientesListView}
            className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-sm text-ink/70 hover:border-sea hover:text-sea"
          >
            Mostrar todas
          </button>
          <select
            value={situacaoFilter}
            onChange={(event) => setSituacaoFilter(event.target.value as "" | "Ativo" | "Suspenso/Inadimplente" | "Cancelado")}
            className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
          >
            <option value="">Todas situacoes</option>
            {SITUACAO_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={searchMode}
            onChange={(event) => setSearchMode(event.target.value as ClienteSearchMode)}
            className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
          >
            <option value="codigo">Buscar por codigo</option>
            <option value="empresa">Buscar por empresa</option>
            <option value="geral">Busca geral</option>
          </select>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              searchMode === "codigo"
                ? "Buscar codigo..."
                : searchMode === "empresa"
                  ? "Buscar empresa..."
                  : "Busca geral (empresa, cidade, bairro...)"
            }
            className="w-64 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
          />
        </div>
      </div>

      {loading ? (
        <div className="glass-pane rounded-2xl p-4 text-sm text-ink/70 md:p-6">
          Carregando empresas...
        </div>
      ) : (
        <div className="rounded-2xl border border-sea/15 bg-white/95">
          <div className="divide-y divide-sea/10">
            {displayClientes.length === 0 ? (
              <div className="px-4 py-6 text-sm text-ink/60">
                {isSearching ? "Termo nao encontrado." : "Nenhum cliente encontrado."}
              </div>
            ) : (
              displayClientes.map((cliente) => (
                <button
                  key={cliente.id}
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setSelectedId(cliente.id);
                  }}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm hover:bg-sand/40"
                >
                  <div>
                    <p className="font-semibold text-ink">
                      {cliente.empresa ?? "Sem nome"}
                    </p>
                    <p className="text-xs text-ink/60">
                      {cliente.cidade ? `${cliente.cidade} / ${cliente.uf ?? ""}` : ""}
                    </p>
                  </div>
                  <div className="text-right text-xs text-ink/60">
                    <div>{formatPerfilDisplay(cliente.perfil_visita)}</div>
                    {cliente.pessoa ? (
                      <div className="mt-1 text-[11px] text-ink/50">Pessoa: {cliente.pessoa}</div>
                    ) : null}
                    {cliente.contato ? (
                      <div className="text-[11px] text-ink/50">Contato: {cliente.contato}</div>
                    ) : null}
                    {cliente.grupo ? (
                      <div className="text-[11px] text-ink/50">Grupo: {cliente.grupo}</div>
                    ) : null}
                    {cliente.obs_comercial ? (
                      <div className="text-[11px] text-ink/50">
                        Obs comercial: {cliente.obs_comercial}
                      </div>
                    ) : null}
                    {cliente.obs ? (
                      <div className="text-[11px] text-ink/50">
                        Obs: {cliente.obs}
                      </div>
                    ) : null}
                    {cliente.situacao ? (
                      <div className="mt-1 text-[11px] text-ink/50">
                        Situacao: {cliente.situacao}
                      </div>
                    ) : null}
                    <div className="text-[10px] text-ink/50">
                      Codigo: {cliente.codigo ?? "-"}
                    </div>
                    {cliente.cep ? (
                      <div className="text-[10px] text-ink/50">CEP: {cliente.cep}</div>
                    ) : null}
                  </div>
                </button>
              ))
            )}
          </div>
          {displayClientes.length > 0 && (
            <div className="flex items-center justify-between border-t border-sea/10 px-4 py-3 text-xs text-ink/60">
              <span>
                Pagina {currentPage} de {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  className="rounded-lg border border-sea/30 bg-white px-3 py-1 font-semibold text-ink/70 hover:border-sea disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  className="rounded-lg border border-sea/30 bg-white px-3 py-1 font-semibold text-ink/70 hover:border-sea disabled:opacity-50"
                >
                  Proxima
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {selected && (
        <div
          className={`fixed inset-0 z-50 flex ${isEditing ? "items-start justify-center px-4 pt-6" : "justify-end"}`}
        >
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => {
              setIsEditing(false);
              setSelected(null);
              setSelectedId(null);
            }}
          />
          <div
            className={`relative w-full overflow-y-auto bg-white shadow-2xl ${
              isEditing
                ? "max-h-[92vh] max-w-6xl rounded-2xl p-6"
                : "h-full max-w-xl p-6"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Cliente</p>
                <h3 className="mt-2 font-display text-xl text-ink">
                  {selected.empresa ?? "Sem nome"}
                </h3>
                <p className="text-sm text-muted">
                  {selected.cidade ? `${selected.cidade} / ${selected.uf ?? ""}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setIsEditing((prev) => !prev)}
                    className="rounded-full border border-mist px-3 py-1 text-xs text-muted hover:border-sea hover:text-sea"
                  >
                    {isEditing ? "Cancelar edicao" : "Editar"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setSelected(null);
                    setSelectedId(null);
                  }}
                  className="rounded-full border border-mist px-3 py-1 text-xs text-muted"
                >
                  Fechar
                </button>
              </div>
            </div>

            {isEditing ? (
              <div className="mt-6 grid gap-3 rounded-2xl border border-sea/20 bg-sand/30 p-3 md:grid-cols-6 md:p-4">
                <label className="min-w-0 flex w-full flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
                  Codigo
                  <input
                    value={editForm.codigo}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, codigo: event.target.value }))
                    }
                    className="min-w-0 w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="min-w-0 flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
                  CNPJ
                  <div className="relative">
                    <input
                      value={editForm.cnpj}
                      onChange={(event) => {
                        setCnpjErrorEdit(null);
                        setEditForm((prev) => ({ ...prev, cnpj: formatCnpjInput(event.target.value) }));
                      }}
                      inputMode="numeric"
                      maxLength={18}
                      placeholder="00.000.000/0000-00"
                      className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 pr-11 text-sm text-ink outline-none focus:border-sea"
                    />
                    <button
                      type="button"
                      onClick={handleCnpjLookupEdit}
                      disabled={cnpjLoadingEdit || sanitizeCnpjDigits(editForm.cnpj).length !== 14}
                      className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-r-lg border-l border-sea/30 bg-white text-sea hover:text-seaLight disabled:opacity-50"
                      title={cnpjLoadingEdit ? "Buscando CNPJ..." : "Buscar por CNPJ"}
                      aria-label={cnpjLoadingEdit ? "Buscando CNPJ..." : "Buscar por CNPJ"}
                    >
                      <Building2 size={15} className={cnpjLoadingEdit ? "animate-pulse" : ""} />
                    </button>
                  </div>
                  {cnpjLoadingEdit && (
                    <span className="text-[11px] font-normal text-ink/60">Consultando CNPJ...</span>
                  )}
                  {cnpjErrorEdit && (
                    <span className="text-[11px] font-normal text-red-600">{cnpjErrorEdit}</span>
                  )}
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                  Empresa
                  <input
                    value={editForm.empresa}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, empresa: event.target.value }))
                    }
                    className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
                  Pessoa
                  <input
                    value={editForm.pessoa}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, pessoa: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
                  Contato
                  <input
                    value={editForm.contato}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        contato: sanitizeContatoInput(event.target.value),
                      }))
                    }
                    placeholder="85999999999,85988888888"
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                  Grupo
                  <input
                    value={editForm.grupo}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, grupo: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                  Obs comercial
                  <input
                    value={editForm.obs_comercial}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, obs_comercial: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                  Obs
                  <input
                    value={editForm.obs}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, obs: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <div className="md:col-span-6 flex flex-wrap items-end gap-2">
                  <label className="w-16 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    Corte
                    <input
                      value={editForm.corte}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, corte: sanitizeDigits(event.target.value).slice(0, 2) }))
                      }
                      inputMode="numeric"
                      maxLength={2}
                      className="w-full rounded-lg border border-sea/20 bg-white px-2 py-2 text-sm text-ink outline-none focus:border-sea"
                    />
                  </label>
                  <label className="w-16 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    Venc
                    <input
                      value={editForm.venc}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, venc: sanitizeDigits(event.target.value).slice(0, 2) }))
                      }
                      inputMode="numeric"
                      maxLength={2}
                      className="w-full rounded-lg border border-sea/20 bg-white px-2 py-2 text-sm text-ink outline-none focus:border-sea"
                    />
                  </label>
                  <label className="w-16 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    <span>Valor</span>
                    <div className="flex h-10 w-full items-center">
                      <button
                        type="button"
                        onClick={() =>
                          void openPlanoValoresModal({
                            title: "Valores por plano (edicao)",
                            source: "edit",
                            codigo: editForm.codigo,
                            empresa: editForm.empresa,
                            valores: editPlanoValores,
                          })
                        }
                        title="Ver valores Titular/Dependente"
                        aria-label="Ver valores Titular e Dependente"
                        className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight"
                      >
                        {editValoresLoading ? <LoaderCircle size={14} className="animate-spin" /> : <DollarSign size={14} />}
                      </button>
                    </div>
                  </label>
                  <label className="w-40 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    Data da ultima visita
                    <input
                      type="date"
                      value={editForm.data_da_ultima_visita}
                      onChange={(event) =>
                        setEditForm((prev) => ({
                          ...prev,
                          data_da_ultima_visita: event.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    />
                  </label>
                  <label className="w-36 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    Perfil visita
                    <select
                      value={
                        perfilEdit.customEnabled
                          ? "__custom__"
                          : perfilEdit.singleTimeBase || perfilEdit.perfil
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "__custom__") {
                          setPerfilEdit((prev) => ({
                            ...prev,
                            customEnabled: true,
                            customTimes: prev.customTimes.length ? prev.customTimes : [""],
                            singleTimeBase: "",
                            singleTimeValue: "",
                            perfil: prev.customEnabled ? prev.perfil : "",
                          }));
                        } else if (value === "ALMOCO" || value === "JANTAR") {
                          setPerfilEdit((prev) => ({
                            ...prev,
                            customEnabled: false,
                            customTimes: [],
                            singleTimeBase: value,
                            singleTimeValue: "",
                            perfil: value,
                          }));
                        } else {
                          setPerfilEdit({
                            perfil: value,
                            customEnabled: false,
                            customTimes: [],
                            singleTimeBase: "",
                            singleTimeValue: "",
                          });
                        }
                      }}
                      className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    >
                      <option value="">Selecione</option>
                      {PERFIL_VISITA_PRESETS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      <option value="__custom__">Horario customizado</option>
                    </select>
                  </label>
                  <label className="w-36 shrink-0 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    Situacao
                    <select
                      value={editForm.situacao}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, situacao: event.target.value }))
                      }
                      className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    >
                      <option value="">Selecione</option>
                      {editForm.situacao && !SITUACAO_OPTIONS.some((option) => option === editForm.situacao) && (
                        <option value={editForm.situacao}>{editForm.situacao}</option>
                      )}
                      {SITUACAO_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="w-36 shrink-0 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    <span className="inline-flex items-center gap-1">
                      Categoria
                      <CategoriaLegendPopover />
                    </span>
                    <select
                      value={editForm.categoria}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, categoria: event.target.value }))
                      }
                      className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    >
                      <option value="">Selecione</option>
                      {editForm.categoria && !CATEGORIA_OPTIONS.some((option) => option === editForm.categoria) && (
                        <option value={editForm.categoria}>{editForm.categoria}</option>
                      )}
                      {CATEGORIA_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="md:col-span-6">
                  {(perfilEdit.singleTimeBase === "ALMOCO" || perfilEdit.singleTimeBase === "JANTAR") && (
                    <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                      HH:MM
                      <input
                        type="time"
                        value={perfilEdit.singleTimeValue}
                        onChange={(event) =>
                          setPerfilEdit((prev) => ({
                            ...prev,
                            singleTimeValue: event.target.value,
                            perfil: event.target.value
                              ? `${prev.singleTimeBase} ${event.target.value}`
                              : prev.singleTimeBase,
                          }))
                        }
                        className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                      />
                    </label>
                  )}
                  {perfilEdit.customEnabled && (
                    <div className="shrink-0 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                      <span>Horarios customizados</span>
                      <div className="flex w-fit max-w-[24rem] items-end gap-2 overflow-x-auto pb-1 pr-1">
                      {perfilEdit.customTimes.map((time, index) => (
                        <div key={`${time}-${index}`} className="shrink-0 flex items-center gap-2">
                          <input
                            type="time"
                            value={time}
                            onChange={(event) => {
                              const next = [...perfilEdit.customTimes];
                              next[index] = event.target.value;
                              applyPerfilTimes(setPerfilEdit, next);
                            }}
                            className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                          />
                          {index === perfilEdit.customTimes.length - 1 && (
                            <button
                              type="button"
                              onClick={() => applyPerfilTimes(setPerfilEdit, [...perfilEdit.customTimes, ""])}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight"
                              title="Adicionar horario"
                              aria-label="Adicionar horario"
                            >
                              <Plus size={14} />
                            </button>
                          )}
                          {perfilEdit.customTimes.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = perfilEdit.customTimes.filter((_, idx) => idx !== index);
                                applyPerfilTimes(setPerfilEdit, next.length ? next : [""]);
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight"
                              title="Remover horario"
                              aria-label="Remover horario"
                            >
                              <span className="text-base leading-none">-</span>
                            </button>
                          )}
                        </div>
                      ))}
                      </div>
                    </div>
                  )}
                </div>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                  Cidade
                  <input
                    value={editForm.cidade}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, cidade: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <div className="md:col-span-4 grid gap-3 md:grid-cols-[80px_minmax(0,1fr)] md:items-start">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    UF
                    <input
                      value={editForm.uf}
                      onChange={(event) =>
                        setEditForm((prev) => ({
                          ...prev,
                          uf: event.target.value.toUpperCase().slice(0, 3),
                        }))
                      }
                      maxLength={3}
                      className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm uppercase tracking-wide text-ink outline-none focus:border-sea"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    <span>
                      Endereco + Nº
                      {!canEditEnderecoEdit && (
                        <span className="font-normal text-ink/50"> (Informe cidade e UF para editar o endereco.)</span>
                      )}
                    </span>
                    <div className="flex items-end gap-1">
                      <input
                        value={editForm.endereco}
                        onChange={(event) =>
                          setEditForm((prev) => ({ ...prev, endereco: event.target.value }))
                        }
                        disabled={!canEditEnderecoEdit}
                        className="flex-1 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                      />
                      <button
                        type="button"
                        onClick={handleBairroLookupEdit}
                        disabled={
                          bairroLoadingEdit ||
                          !editForm.endereco.trim() ||
                          !editForm.cidade.trim() ||
                          !editForm.uf.trim()
                        }
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"
                        title={bairroLoadingEdit ? "Buscando endereco..." : "Buscar por endereco"}
                        aria-label={bairroLoadingEdit ? "Buscando endereco..." : "Buscar por endereco"}
                      >
                        <Search size={15} className={bairroLoadingEdit ? "animate-pulse" : ""} />
                      </button>
                    </div>
                    {bairroLoadingEdit && <span className="text-[11px] text-ink/60">Consultando endereco...</span>}
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                  Complemento
                  <input
                    value={editForm.complemento}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, complemento: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                  Bairro
                  <input
                    value={editForm.bairro}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, bairro: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                  CEP
                  <div className="flex items-end gap-1">
                    <input
                      value={editForm.cep}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, cep: formatCep(event.target.value) }))
                      }
                      placeholder="00000-000"
                      className="flex-1 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    />
                    <button
                      type="button"
                      onClick={handleCepLookupEdit}
                      disabled={cepLoadingEdit || sanitizeCep(editForm.cep).length !== 8}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"
                      title={cepLoadingEdit ? "Buscando CEP..." : "Buscar por CEP"}
                      aria-label={cepLoadingEdit ? "Buscando CEP..." : "Buscar por CEP"}
                    >
                      <Search size={15} className={cepLoadingEdit ? "animate-pulse" : ""} />
                    </button>
                  </div>
                  {cepLoadingEdit && <span className="text-[11px] text-ink/60">Consultando CEP...</span>}
                </label>
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {[
                  ["Codigo", selected.codigo],
                  ["Corte", selected.corte ?? null],
                  ["Venc", selected.venc ?? null],
                  ["Valor", null],
                  ["Data da ultima visita", formatDate(selected.data_da_ultima_visita)],
                  ["CEP", selected.cep],
                  ["CNPJ", selected.cnpj],
                  ["Empresa", selected.empresa],
                  ["Pessoa", selected.pessoa],
                  ["Contato", selected.contato],
                  ["Grupo", selected.grupo],
                  ["Obs comercial", selected.obs_comercial],
                  ["Obs", selected.obs],
                  ["Situacao", selected.situacao ?? "Ativo"],
                  ["Categoria", selected.categoria ?? "-"],
                  ["Perfil visita", formatPerfilDisplay(selected.perfil_visita)],
                  ["Endereco", selected.endereco],
                  ["Complemento", selected.complemento],
                  ["Bairro", selected.bairro],
                  ["Cidade", selected.cidade],
                  ["UF", selected.uf],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between border-b border-mist/50 pb-2">
                    <span className="text-xs font-semibold text-muted">{label}</span>
                    {label === "Valor" ? (
                      <button
                        type="button"
                        onClick={() =>
                          void openPlanoValoresModal({
                            title: "Valores por plano",
                            source: "edit",
                            codigo: selected.codigo ?? "",
                            empresa: selected.empresa ?? "",
                            valores: [],
                          })
                        }
                        title="Ver valores Titular/Dependente"
                        aria-label="Ver valores Titular e Dependente"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight"
                      >
                        {editValoresLoading ? (
                          <LoaderCircle size={12} className="animate-spin" />
                        ) : (
                          <DollarSign size={12} />
                        )}
                      </button>
                    ) : (
                      <span className="text-sm text-ink">{value ?? "-"}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canEdit && isEditing && (
              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                >
                  {savingEdit ? "Salvando..." : "Salvar"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
                >
                  Cancelar
                </button>
              </div>
            )}

            {canEdit && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50/40 p-3">
                <p className="text-xs font-semibold text-red-600">Excluir empresa</p>
                <p className="mt-1 text-[11px] text-red-500">
                  Para excluir, confirme com sua senha de usuario.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    value={deletePasswordEdit}
                    onChange={(event) => setDeletePasswordEdit(event.target.value)}
                    placeholder="Senha"
                    className="w-48 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-ink outline-none focus:border-red-300"
                  />
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    disabled={deletingEdit || !selected}
                    className="rounded-lg border border-red-300 bg-red-500 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                  >
                    {deletingEdit ? "Excluindo..." : "Excluir"}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-8 border-t border-mist/40 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="font-display text-lg text-ink">Historico de visitas</h4>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-ink/70">
                    Supervisor
                    <select
                      value={historySupervisorId}
                      onChange={(event) => setHistorySupervisorId(event.target.value)}
                      className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                    >
                      <option value="all">Todos</option>
                      {historySupervisores.map((supervisor) => (
                        <option key={supervisor.user_id} value={supervisor.user_id}>
                          {supervisor.display_name ?? "Supervisor"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-ink/70">
                    De
                    <input
                      type="date"
                      value={historyDateFrom}
                      onChange={(event) => setHistoryDateFrom(event.target.value)}
                      className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-ink/70">
                    Ate
                    <input
                      type="date"
                      value={historyDateTo}
                      onChange={(event) => setHistoryDateTo(event.target.value)}
                      className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                    />
                  </label>
                </div>
              </div>
              {historyLoading ? (
                <p className="mt-2 text-sm text-ink/60">Carregando historico...</p>
              ) : filteredHistory.length === 0 ? (
                <p className="mt-2 text-sm text-ink/60">Nenhum historico para este cliente.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {filteredHistory.map((visit) => (
                    <div key={visit.id} className="rounded-xl border border-sea/15 bg-white/90 p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-ink">
                          {visit.assigned_to_name ?? visit.assigned_to_user_id ?? "Sem vendedor"}
                        </span>
                        <span className="text-xs text-ink/60">
                          {formatDate(visit.visit_date)}
                        </span>
                      </div>
                      {visit.supervisor ? (
                        <div className="mt-1 text-xs text-ink/60">
                          Supervisor: {visit.supervisor}
                        </div>
                      ) : null}
                      <div className="mt-1 text-xs text-ink/60">
                        {visit.situacao ? `Situacao: ${visit.situacao}` : "Situacao nao informada"}
                      </div>
                      {visit.perfil_visita || visit.perfil_visita_opcoes ? (
                        <div className="mt-1 text-xs text-ink/60">
                          Perfil:{" "}
                          {formatPerfilDisplay(visit.perfil_visita ?? visit.perfil_visita_opcoes)}
                        </div>
                      ) : null}
                      {visit.completed_at ? (
                        <div className="mt-1 text-[11px] text-ink/50">
                          Concluida em {formatDate(visit.completed_at)}
                          {typeof visit.completed_vidas === "number"
                            ? ` â€¢ Vidas: ${visit.completed_vidas}`
                            : ""}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {planosModalState && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-6">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setPlanosModalState(null)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">{planosModalState.title}</h3>
            <p className="mt-2 text-xs text-ink/60">
              Planos consultados: 2 (ODONTOART PJ INDIVIDUAL), 18 (Multiprev), 19 (Multiplus) e 20 (Multimaster).
            </p>
            <p className="mt-1 text-[11px] text-ink/50">
              Empresa: {planosModalState.empresa || "-"} | COD {planosModalState.codigo || "-"}
            </p>

            {planosModalState.loading ? (
              <div className="mt-4 flex items-center gap-2 text-xs text-ink/60">
                <LoaderCircle size={14} className="animate-spin" />
                Carregando valores...
              </div>
            ) : planosModalState.error ? (
              <p className="mt-4 text-xs text-red-600">{planosModalState.error}</p>
            ) : (
              <div className="mt-4 space-y-2">
                {planosModalState.valores.map((plano) => (
                  <div key={plano.planoCodigo} className="rounded-xl border border-sea/15 bg-sand/30 p-3">
                    <p className="text-xs font-semibold text-ink">
                      {plano.planoCodigo} - {plano.planoNome}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-ink/70">
                      <p>Titular: {plano.valorTitular !== null ? formatCurrency(plano.valorTitular) : "-"}</p>
                      <p>Dependente: {plano.valorDependente !== null ? formatCurrency(plano.valorDependente) : "-"}</p>
                    </div>
                  </div>
                ))}
                {!hasPlanoValores(planosModalState.valores) ? (
                  <p className="text-xs text-ink/60">
                    Nenhum valor encontrado para os planos 2, 18, 19 e 20 nesta empresa.
                  </p>
                ) : null}
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setPlanosModalState(null)}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {filialConfirmModal &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-start justify-center px-4 pt-6">
            <button
              type="button"
              className="absolute inset-0 bg-ink/30"
              onClick={handleCancelFilialFlow}
              aria-label="Fechar modal de filial"
            />
            <div
              ref={filialConfirmModalRef}
              className="relative z-10 w-full max-w-lg rounded-3xl border border-sea/20 bg-white p-6 shadow-card"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 className="font-display text-lg text-ink">Codigo ja cadastrado</h3>
              <p className="mt-2 text-sm text-ink/70">
                Ja existe empresa cadastrada com este codigo. Deseja cadastrar como filial?
              </p>
              <div className="mt-4 grid gap-2 rounded-xl border border-sea/15 bg-sand/30 p-3 text-sm text-ink/80">
                <p>
                  <span className="font-semibold">Codigo:</span> {filialConfirmModal.codigo}
                </p>
                <p>
                  <span className="font-semibold">Empresa:</span> {filialConfirmModal.empresa}
                </p>
                <p>
                  <span className="font-semibold">Cadastros com este codigo:</span> {filialConfirmModal.existingCount}
                </p>
              </div>
              {filialConfirmModal.lookupError && (
                <p className="mt-3 text-xs font-semibold text-amber-700">
                  Aviso: {filialConfirmModal.lookupError}
                </p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCancelFilialFlow}
                  className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
                >
                  Nao
                </button>
                <button
                  type="button"
                  onClick={handleAcceptFilialConfirm}
                  disabled={createFlowBusy}
                  className="rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight"
                >
                  Sim, cadastrar filial
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {filialCadastroModal &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto px-4 pt-6">
            <button
              type="button"
              className="absolute inset-0 bg-ink/30"
              onClick={handleCancelFilialFlow}
              aria-label="Fechar modal de cadastro de filial"
            />
            <div
              ref={filialCadastroModalRef}
              className="relative z-10 my-0 max-h-[calc(100vh-2rem)] w-[98vw] max-w-[96rem] overflow-y-auto overflow-x-hidden rounded-3xl border border-sea/20 bg-white p-6 shadow-card md:max-h-[calc(100vh-4rem)]"
              onClick={(event) => event.stopPropagation()}
            >
            <h3 className="font-display text-lg text-ink">Cadastro de filial</h3>
            <p className="mt-2 text-sm text-ink/70">
              Preencha os dados da filial. O codigo ja esta definido e nao pode ser alterado.
            </p>
            <p className="mt-1 text-xs text-ink/60">
              Ja existem {filialCadastroModal.existingCount} cadastro(s) com este codigo.
            </p>
            <div className="mt-4 grid gap-3 rounded-2xl border border-sea/20 bg-sand/30 p-3 md:grid-cols-6 md:p-4">
              <label className="min-w-0 flex w-full flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
                Codigo
                <div className="min-w-0 flex items-end gap-1">
                  <input
                    value={filialCadastroModal.form.codigo}
                    disabled
                    className="min-w-0 w-full flex-1 rounded-lg border border-sea/20 bg-sand/40 px-3 py-2 text-sm text-ink/70 outline-none"
                  />
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-sand/40 text-sea/40"
                    title="Codigo bloqueado para filial"
                    aria-label="Codigo bloqueado para filial"
                  >
                    <Search size={15} />
                  </button>
                </div>
              </label>
              <label className="min-w-0 flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
                CNPJ
                <div className="relative">
                  <input
                    value={filialCadastroModal.form.cnpj}
                    onChange={(event) =>
                      setFilialCadastroModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              form: { ...prev.form, cnpj: formatCnpjInput(event.target.value) },
                              error: null,
                            }
                          : prev,
                      )
                    }
                    inputMode="numeric"
                    maxLength={18}
                    placeholder="00.000.000/0000-00"
                    className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 pr-11 text-sm text-ink outline-none focus:border-sea"
                  />
                  <button
                    type="button"
                    onClick={handleFilialCnpjLookup}
                    disabled={createFlowBusy || filialCnpjLoading || sanitizeCnpjDigits(filialCadastroModal.form.cnpj).length !== 14}
                    className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-r-lg border-l border-sea/30 bg-white text-sea hover:text-seaLight disabled:opacity-50"
                    title={filialCnpjLoading ? "Buscando CNPJ..." : "Buscar por CNPJ"}
                    aria-label={filialCnpjLoading ? "Buscando CNPJ..." : "Buscar por CNPJ"}
                  >
                    <Building2 size={15} className={filialCnpjLoading ? "animate-pulse" : ""} />
                  </button>
                </div>
                {filialCnpjLoading && <span className="text-[11px] text-ink/60">Consultando CNPJ...</span>}
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                Empresa
                <input
                  value={filialCadastroModal.form.empresa}
                  onChange={(event) =>
                    setFilialCadastroModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            form: { ...prev.form, empresa: event.target.value },
                            error: null,
                          }
                        : prev,
                    )
                  }
                  className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
                Pessoa
                <input
                  value={filialCadastroModal.form.pessoa}
                  onChange={(event) =>
                    setFilialCadastroModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            form: { ...prev.form, pessoa: event.target.value },
                          }
                        : prev,
                    )
                  }
                  className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
                Contato
                <input
                  value={filialCadastroModal.form.contato}
                  onChange={(event) =>
                    setFilialCadastroModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            form: { ...prev.form, contato: sanitizeContatoInput(event.target.value) },
                          }
                        : prev,
                    )
                  }
                  placeholder="85999999999,85988888888"
                  className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                Grupo
                <input
                  value={filialCadastroModal.form.grupo}
                  onChange={(event) =>
                    setFilialCadastroModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            form: { ...prev.form, grupo: event.target.value },
                          }
                        : prev,
                    )
                  }
                  className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                Obs comercial
                <input
                  value={filialCadastroModal.form.obs_comercial}
                  onChange={(event) =>
                    setFilialCadastroModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            form: { ...prev.form, obs_comercial: event.target.value },
                          }
                        : prev,
                    )
                  }
                  className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                Obs (obrigatorio para filial)
                <input
                  value={filialCadastroModal.form.obs}
                  onChange={(event) =>
                    setFilialCadastroModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            form: { ...prev.form, obs: event.target.value },
                            error: null,
                          }
                        : prev,
                    )
                  }
                  className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
              <div className="md:col-span-6 flex flex-wrap items-end gap-2">
                <label className="w-16 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Corte
                  <input
                    value={filialCadastroModal.form.corte}
                    onChange={(event) =>
                      setFilialCadastroModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              form: {
                                ...prev.form,
                                corte: sanitizeDigits(event.target.value).slice(0, 2),
                              },
                            }
                          : prev,
                      )
                    }
                    inputMode="numeric"
                    maxLength={2}
                    className="w-full rounded-lg border border-sea/20 bg-white px-2 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="w-16 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Venc
                  <input
                    value={filialCadastroModal.form.venc}
                    onChange={(event) =>
                      setFilialCadastroModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              form: {
                                ...prev.form,
                                venc: sanitizeDigits(event.target.value).slice(0, 2),
                              },
                            }
                          : prev,
                      )
                    }
                    inputMode="numeric"
                    maxLength={2}
                    className="w-full rounded-lg border border-sea/20 bg-white px-2 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="w-16 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  <span>Valor</span>
                  <div className="flex h-10 w-full items-center">
                    <button
                      type="button"
                      onClick={() =>
                        void openPlanoValoresModal({
                          title: "Valores por plano (filial)",
                          source: "create",
                          codigo: filialCadastroModal.form.codigo,
                          empresa: filialCadastroModal.form.empresa,
                          valores: createPlanoValores,
                        })
                      }
                      title="Ver valores Titular/Dependente"
                      aria-label="Ver valores Titular e Dependente"
                      className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight"
                    >
                      {createValoresLoading ? <LoaderCircle size={14} className="animate-spin" /> : <DollarSign size={14} />}
                    </button>
                  </div>
                </label>
                <label className="w-40 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Data da ultima visita
                  <input
                    type="date"
                    value={filialCadastroModal.form.data_da_ultima_visita}
                    onChange={(event) =>
                      setFilialCadastroModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              form: { ...prev.form, data_da_ultima_visita: event.target.value },
                            }
                          : prev,
                      )
                    }
                    className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="w-36 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Perfil visita
                  <select
                    value={perfilCreate.perfil}
                    onChange={(event) =>
                      setPerfilCreate({
                        perfil: event.target.value,
                        customEnabled: false,
                        customTimes: [],
                        singleTimeBase: "",
                        singleTimeValue: "",
                      })
                    }
                    className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  >
                    <option value="">Selecione</option>
                    {PERFIL_VISITA_PRESETS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="w-36 shrink-0 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Situacao
                  <select
                    value={filialCadastroModal.form.situacao}
                    onChange={(event) =>
                      setFilialCadastroModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              form: { ...prev.form, situacao: event.target.value },
                            }
                          : prev,
                      )
                    }
                    className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  >
                    <option value="">Selecione</option>
                    {filialCadastroModal.form.situacao &&
                      !SITUACAO_OPTIONS.some((option) => option === filialCadastroModal.form.situacao) && (
                        <option value={filialCadastroModal.form.situacao}>
                          {filialCadastroModal.form.situacao}
                        </option>
                      )}
                    {SITUACAO_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="w-36 shrink-0 flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  <span className="inline-flex items-center gap-1">
                    Categoria
                    <CategoriaLegendPopover />
                  </span>
                  <select
                    value={filialCadastroModal.form.categoria}
                    onChange={(event) =>
                      setFilialCadastroModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              form: { ...prev.form, categoria: event.target.value },
                            }
                          : prev,
                      )
                    }
                    className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  >
                    <option value="">Selecione</option>
                    {filialCadastroModal.form.categoria &&
                      !CATEGORIA_OPTIONS.some((option) => option === filialCadastroModal.form.categoria) && (
                        <option value={filialCadastroModal.form.categoria}>
                          {filialCadastroModal.form.categoria}
                        </option>
                      )}
                    {CATEGORIA_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                Cidade
                <input
                  value={filialCadastroModal.form.cidade}
                  onChange={(event) =>
                    setFilialCadastroModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            form: { ...prev.form, cidade: event.target.value },
                            error: null,
                          }
                        : prev,
                    )
                  }
                  className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
              <div className="md:col-span-4 grid gap-3 md:grid-cols-[80px_minmax(0,1fr)] md:items-start">
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  UF
                  <input
                    value={filialCadastroModal.form.uf}
                    onChange={(event) =>
                      setFilialCadastroModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              form: { ...prev.form, uf: event.target.value.toUpperCase().slice(0, 3) },
                              error: null,
                            }
                          : prev,
                      )
                    }
                    maxLength={3}
                    className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm uppercase tracking-wide text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  <span>
                    Endereco + Nº
                    {!canEditEnderecoFilial && (
                      <span className="font-normal text-ink/50"> (Informe cidade e UF para editar o endereco.)</span>
                    )}
                  </span>
                  <div className="flex items-end gap-1">
                    <input
                      value={filialCadastroModal.form.endereco}
                      onChange={(event) =>
                        setFilialCadastroModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                form: { ...prev.form, endereco: event.target.value },
                              }
                            : prev,
                        )
                      }
                      disabled={!canEditEnderecoFilial}
                      className="flex-1 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    />
                    <button
                      type="button"
                      onClick={handleFilialBairroLookup}
                      disabled={
                        createFlowBusy ||
                        filialBairroLoading ||
                        !filialCadastroModal.form.endereco.trim() ||
                        !filialCadastroModal.form.cidade.trim() ||
                        !filialCadastroModal.form.uf.trim()
                      }
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"
                      title={filialBairroLoading ? "Buscando endereco..." : "Buscar por endereco"}
                      aria-label={filialBairroLoading ? "Buscando endereco..." : "Buscar por endereco"}
                    >
                      <Search size={15} className={filialBairroLoading ? "animate-pulse" : ""} />
                    </button>
                  </div>
                  {filialBairroLoading && <span className="text-[11px] text-ink/60">Consultando endereco...</span>}
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                Complemento
                <input
                  value={filialCadastroModal.form.complemento}
                  onChange={(event) =>
                    setFilialCadastroModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            form: { ...prev.form, complemento: event.target.value },
                          }
                        : prev,
                    )
                  }
                  className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                Bairro
                <input
                  value={filialCadastroModal.form.bairro}
                  onChange={(event) =>
                    setFilialCadastroModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            form: { ...prev.form, bairro: event.target.value },
                            error: null,
                          }
                        : prev,
                    )
                  }
                  className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                CEP
                <div className="flex items-end gap-1">
                  <input
                    value={filialCadastroModal.form.cep}
                    onChange={(event) =>
                      setFilialCadastroModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              form: { ...prev.form, cep: formatCep(event.target.value) },
                              error: null,
                            }
                          : prev,
                      )
                    }
                    placeholder="00000-000"
                    className="flex-1 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                  <button
                    type="button"
                    onClick={handleFilialCepLookup}
                    disabled={createFlowBusy || filialCepLoading || sanitizeCep(filialCadastroModal.form.cep).length !== 8}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"
                    title={filialCepLoading ? "Buscando CEP..." : "Buscar por CEP"}
                    aria-label={filialCepLoading ? "Buscando CEP..." : "Buscar por CEP"}
                  >
                    <Search size={15} className={filialCepLoading ? "animate-pulse" : ""} />
                  </button>
                </div>
                {filialCepLoading && <span className="text-[11px] text-ink/60">Consultando CEP...</span>}
              </label>
            </div>
            {filialCadastroModal.error && (
              <p className="mt-3 text-xs font-semibold text-red-600">{filialCadastroModal.error}</p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelFilialFlow}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveFilialCadastro}
                disabled={
                  createFlowBusy ||
                  !filialCadastroModal.form.obs.trim() ||
                  Boolean(filialSituacaoBlockedMessage)
                }
                className="rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {creating ? "Salvando..." : "Cadastrar filial"}
              </button>
              {filialSituacaoBlockedMessage && (
                <span className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600">
                  {filialSituacaoBlockedMessage}
                </span>
              )}
            </div>
            </div>
          </div>,
          document.body,
        )}

      {duplicateModal &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto px-4 pt-6">
            <div className="absolute inset-0 bg-ink/30" />
            <div
              className="relative z-10 my-0 w-full max-w-lg rounded-3xl border border-sea/20 bg-white p-6 shadow-card"
              onClick={(event) => event.stopPropagation()}
            >
            <h3 className="font-display text-lg text-ink">Endereco duplicado</h3>
            <p className="mt-2 text-sm text-ink/70">
              O endereco informado ja existe para {duplicateModal.existing.length} empresa(s).
              Escolha o que fazer com o cliente da planilha.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-sea/15 bg-sand/30 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">Novo cadastro</p>
                <p className="mt-2 text-sm font-semibold text-ink">
                  {duplicateModal.newCliente.empresa ?? "Sem nome"}
                </p>
                <p className="text-xs text-ink/60">
                  {duplicateModal.newCliente.endereco ?? "-"}
                </p>
                <p className="text-[11px] text-ink/50">
                  {duplicateModal.newCliente.cidade
                    ? `${duplicateModal.newCliente.cidade} / ${duplicateModal.newCliente.uf ?? ""}`
                    : "-"}
                </p>
              </div>
              <div className="rounded-2xl border border-sea/15 bg-white/90 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">Cadastro existente</p>
                {duplicateExistingItems.map((item) => (
                  <div key={item.id} className="mt-2">
                    <p className="text-sm font-semibold text-ink">
                      {item.empresa ?? "Sem nome"}
                    </p>
                    <p className="text-xs text-ink/60">{item.endereco ?? "-"}</p>
                    <p className="text-[11px] text-ink/50">
                      {item.cidade ? `${item.cidade} / ${item.uf ?? ""}` : "-"}
                    </p>
                  </div>
                ))}
                {duplicateModal.existing.length > DUPLICATE_EXISTING_PAGE_SIZE && (
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-sea/10 pt-3">
                    <button
                      type="button"
                      onClick={() => setDuplicateExistingPage((prev) => Math.max(1, prev - 1))}
                      disabled={duplicateExistingPage === 1 || duplicateResolving}
                      aria-label="Pagina anterior"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sea/30 bg-white text-ink/70 hover:border-sea disabled:opacity-60"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-[11px] text-ink/50">
                      Pagina {duplicateExistingPage} de {duplicateExistingTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setDuplicateExistingPage((prev) =>
                          Math.min(duplicateExistingTotalPages, prev + 1),
                        )}
                      disabled={
                        duplicateExistingPage === duplicateExistingTotalPages || duplicateResolving
                      }
                      aria-label="Proxima pagina"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sea/30 bg-white text-ink/70 hover:border-sea disabled:opacity-60"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <label className="mt-4 flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
              Complemento (ao manter os dois)
              <input
                value={duplicateComplemento}
                onChange={(event) => setDuplicateComplemento(event.target.value)}
                className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
              />
            </label>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleDuplicateKeepOld}
                disabled={duplicateResolving}
                className="rounded-full border border-sea/30 bg-white px-4 py-2 text-xs font-semibold text-ink/70 hover:border-sea disabled:opacity-60"
              >
                Manter cliente do sistema
              </button>
              <button
                type="button"
                onClick={handleDuplicateSubstitute}
                disabled={duplicateResolving}
                className="rounded-full bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                Substituir cliente
              </button>
              <button
                type="button"
                onClick={handleDuplicateKeepBoth}
                disabled={duplicateResolving}
                className="rounded-full border border-sea/30 bg-white px-4 py-2 text-xs font-semibold text-ink/70 hover:border-sea disabled:opacity-60"
              >
                Manter os dois
              </button>
            </div>
            </div>
          </div>,
          document.body,
        )}

      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-6">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => (importing ? null : setShowImportModal(false))}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Importar empresas (XLSX)</h3>
            <p className="mt-1 text-xs text-ink/60">
              Baixe o modelo, preencha as empresas e envie para importar.
            </p>
            <p className="mt-1 text-xs text-ink/60">
              Para codigos repetidos, preencha a coluna <strong>obs</strong> para diferenciar as filiais.
            </p>

            {importMessage && (
              <div className="mt-3 rounded-lg border border-sea/20 bg-sand/30 px-3 py-2 text-xs text-ink/70">
                {importMessage}
              </div>
            )}
            {importing && importTotal > 0 && (
              <div className="mt-4 space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-sea/10">
                  <div
                    className="h-full rounded-full bg-sea transition-all"
                    style={{ width: `${Math.min(100, Math.round((importProgress / importTotal) * 100))}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink/60">
                  <span>
                    {importStageLabel}: {importProgress}/{importTotal}
                  </span>
                  <span>
                    Importados: {importInserted}
                  </span>
                  <span>
                    Faltam: {importRemaining}
                  </span>
                  <span>
                    Tempo corrido: {formatDuration(importElapsedSeconds)}
                  </span>
                  <span>
                    Tempo estimado: {importEstimatedSeconds === null ? "--:--" : formatDuration(importEstimatedSeconds)}
                  </span>
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Baixar modelo
              </button>
              {!importing && importMessage && !hasPendingDuplicates && (
                <button
                  type="button"
                  onClick={() => {
                    setShowImportModal(false);
                    setImportMessage(null);
                  }}
                  className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
                >
                  Ok
                </button>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {importing ? "Importando..." : "Importar arquivo"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

