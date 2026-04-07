import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Building2, DollarSign, LoaderCircle, MapPin, Plus, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "../context/AuthContext";
import {
  createCliente,
  deleteCliente,
  fetchClientesByCodigoExact,
  fetchClienteHistory,
  fetchClientes,
  updateCliente,
  syncAgendaForCliente,
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
import { formatCep, sanitizeCep } from "../lib/cep";
import { fetchNominatimByAddress, fetchNominatimByCep } from "../lib/nominatim";
import {
  extractOdontoartPlanoValores,
  fetchEmpresaByEmpresaId,
  fetchObservacaoComercialByEmpresaId,
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

type CodigoDuplicadoOrigem = "create" | "edit";
type ClienteSearchMode = "codigo" | "empresa" | "geral";

type CodigoDuplicadoModalState = {
  codigo: string;
  empresa: string;
  obs: string;
  origem: CodigoDuplicadoOrigem;
  existingObs: string[];
  error: string | null;
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
const BAIRRO_LOOKUP_DELAY_MS = 450;
const CLIENTES_PER_PAGE = 50;
const CLIENTE_API_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const CLIENTES_VIEW_STATE_KEY = "clientesViewStateV2";
let clientesMemoryCache: ClienteRow[] | null = null;
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

const parseNumberFromUnknown = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/\./g, "").replace(",", ".").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
  const situacaoRaw = (empresa.NomeSituacao ?? empresa.nomeSituacao ?? "").trim();
  const situacao = normalizeStatus(situacaoRaw) ?? situacaoRaw;

  return {
    codigo,
    cnpj: resolveCnpjFromEmpresa(empresa),
    corte:
      empresa.Corte !== null && empresa.Corte !== undefined
        ? String(empresa.Corte).trim()
        : "",
    venc:
      empresa.Vencimento !== null && empresa.Vencimento !== undefined
        ? String(empresa.Vencimento).trim()
        : "",
    valor: valorTitular !== null ? formatCurrency(valorTitular) : "",
    data_da_ultima_visita: "",
    cep: resolveCepFromEmpresa(empresa),
    empresa: resolveEmpresaFromApi(empresa),
    pessoa: "",
    contato: "",
    grupo: "",
    obs_comercial: (empresa.ObservacaoComercial ?? "").trim(),
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
const normalizeObsValue = (value: string | null | undefined) =>
  normalizeSearchText(value);

const isClientesDedupeConflictError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("clientes_dedupe_key_unique");
};
const isClienteSyncNoResultError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("Cannot coerce the result to a single JSON object") ||
    message.includes("nao encontrado")
  );
};
const buildClientesDedupeKey = (
  empresa: string | null | undefined,
  nomeFantasia: string | null | undefined,
) => `${(empresa ?? "").toLowerCase()}|${(nomeFantasia ?? "").toLowerCase()}`;
const normalizeNullableText = (value: string | null | undefined) => {
  const cleaned = (value ?? "").trim();
  return cleaned ? cleaned : null;
};
const normalizeNullableNumber = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

type ClienteApiSyncPayload = Partial<
  Pick<
    ClienteRow,
    | "codigo"
    | "cnpj"
    | "corte"
    | "venc"
    | "valor"
    | "cep"
    | "empresa"
    | "obs_comercial"
    | "situacao"
    | "endereco"
    | "bairro"
    | "cidade"
    | "uf"
  >
>;

const mapEmpresaApiToClienteSyncPayload = async (
  empresa: OdontoartEmpresaResponseRow,
  codigoFallback: string,
): Promise<ClienteApiSyncPayload> => {
  const codigoFromApi =
    empresa.Id !== null && empresa.Id !== undefined
      ? String(empresa.Id).trim()
      : codigoFallback.trim();
  const logradouro = (empresa.Logradouro ?? "").trim();
  const numero =
    empresa.Numero !== null && empresa.Numero !== undefined
      ? String(empresa.Numero).trim()
      : "";
  const endereco = [logradouro, numero].filter(Boolean).join(", ");
  const situacaoRaw = normalizeNullableText(empresa.NomeSituacao ?? empresa.nomeSituacao ?? null);
  const situacao = normalizeNullableText(situacaoRaw ? normalizeStatus(situacaoRaw) ?? situacaoRaw : null);
  let obsComercial = normalizeNullableText(empresa.ObservacaoComercial ?? null);

  if (!obsComercial && codigoFallback.trim()) {
    try {
      const fallbackObs = await fetchObservacaoComercialByEmpresaId(codigoFallback.trim());
      obsComercial = normalizeNullableText(fallbackObs);
    } catch {
      // Ignore fallback errors; we still sync the remaining fields.
    }
  }

  return {
    codigo: normalizeNullableText(codigoFromApi) ?? normalizeNullableText(codigoFallback),
    cnpj: normalizeCnpj(resolveCnpjFromEmpresa(empresa)),
    corte: parseNumberFromUnknown(empresa.Corte),
    venc: parseNumberFromUnknown(empresa.Vencimento),
    valor: resolveOdontoartValorTitular(empresa),
    cep: normalizeNullableText(resolveCepFromEmpresa(empresa)),
    empresa: normalizeNullableText(resolveEmpresaFromApi(empresa)),
    obs_comercial: obsComercial,
    situacao,
    endereco: normalizeNullableText(endereco),
    bairro: normalizeNullableText(empresa.BairroNome ?? null),
    cidade: normalizeNullableText(empresa.MunicipioNome ?? null),
    uf: normalizeNullableText(empresa.UfNome ?? null),
  };
};

const pickChangedApiFields = (cliente: ClienteRow, apiPayload: ClienteApiSyncPayload): ClienteApiSyncPayload => {
  const changes: ClienteApiSyncPayload = {};

  const textFields = [
    "codigo",
    "cnpj",
    "cep",
    "empresa",
    "obs_comercial",
    "situacao",
    "endereco",
    "bairro",
    "cidade",
    "uf",
  ] as const;
  textFields.forEach((field) => {
    const current = normalizeNullableText(cliente[field]);
    const incoming = normalizeNullableText(apiPayload[field] ?? null);
    if (current !== incoming) {
      changes[field] = incoming;
    }
  });

  const numberFields = ["corte", "venc", "valor"] as const;
  numberFields.forEach((field) => {
    const current = normalizeNullableNumber(cliente[field]);
    const incoming = normalizeNullableNumber(apiPayload[field] ?? null);
    if (current !== incoming) {
      changes[field] = incoming;
    }
  });

  return changes;
};

const enrichFormDataCepByAddress = async (
  formData: ReturnType<typeof mapEmpresaApiToClienteForm>,
) => {
  if (sanitizeCep(formData.cep).length === 8) return formData;
  const endereco = formData.endereco.trim();
  const cidade = formData.cidade.trim();
  const uf = formData.uf.trim();
  if (!endereco || !cidade || !uf) return formData;

  try {
    const mapped = await fetchNominatimByAddress(endereco, cidade, uf);
    if (mapped?.cep) {
      return {
        ...formData,
        cep: formatCep(mapped.cep),
      };
    }
  } catch {
    // Ignore fallback errors; this enrichment is best-effort only.
  }

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

export default function Clientes() {
  const { role, session } = useAuth();
  const canView = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canCreate = canView;
  const canEdit = role === "SUPERVISOR";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<ClienteSearchMode>("codigo");
  const [situacaoFilter, setSituacaoFilter] = useState<"" | "Ativo" | "Suspenso/Inadimplente" | "Cancelado">("");

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
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
  const [perfilCreate, setPerfilCreate] = useState(() => buildPerfilState(null));
  const [createPlanoValores, setCreatePlanoValores] = useState<OdontoartPlanoValor[]>([]);

  const [selected, setSelected] = useState<ClienteRow | null>(null);
  const [history, setHistory] = useState<ClienteHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySupervisores, setHistorySupervisores] = useState<
    { user_id: string; display_name: string | null }[]
  >([]);
  const [historySupervisorId, setHistorySupervisorId] = useState<string>("all");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const restoredViewRef = useRef(false);
  const pendingEditRestoreRef = useRef<boolean | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
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
    situacao: "",
    categoria: "",
    endereco: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
  });
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
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const [codigoLoading, setCodigoLoading] = useState(false);
  const [codigoError, setCodigoError] = useState<string | null>(null);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjError, setCnpjError] = useState<string | null>(null);
  const [cepLoadingEdit, setCepLoadingEdit] = useState(false);
  const [cepErrorEdit, setCepErrorEdit] = useState<string | null>(null);
  const [cnpjLoadingEdit, setCnpjLoadingEdit] = useState(false);
  const [cnpjErrorEdit, setCnpjErrorEdit] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importInserted, setImportInserted] = useState(0);
  const [importStageLabel, setImportStageLabel] = useState("Aguardando arquivo");
  const [importStartedAt, setImportStartedAt] = useState<number | null>(null);
  const [importTick, setImportTick] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [addressLookupLoading, setAddressLookupLoading] = useState(false);
  const [addressLookupError, setAddressLookupError] = useState<string | null>(null);
  const [addressLookupLoadingEdit, setAddressLookupLoadingEdit] = useState(false);
  const [addressLookupErrorEdit, setAddressLookupErrorEdit] = useState<string | null>(null);
  const [duplicateModal, setDuplicateModal] = useState<DuplicateEntry | null>(null);
  const [duplicateQueue, setDuplicateQueue] = useState<DuplicateEntry[]>([]);
  const [duplicateResolving, setDuplicateResolving] = useState(false);
  const [duplicateComplemento, setDuplicateComplemento] = useState("");
  const [codigoDuplicadoModal, setCodigoDuplicadoModal] = useState<CodigoDuplicadoModalState | null>(null);
  const [codigoDuplicadoAprovado, setCodigoDuplicadoAprovado] = useState<{
    codigo: string;
    obs: string;
    origem: CodigoDuplicadoOrigem;
  } | null>(null);
  const [codigoSearchResults, setCodigoSearchResults] = useState<ClienteRow[] | null>(null);
  const clientesRef = useRef<ClienteRow[]>([]);
  const apiSyncInFlightRef = useRef(false);
  const searchRefreshKeyRef = useRef("");

  const syncClienteApiFields = async (baseClientes: ClienteRow[] = clientesRef.current) => {
    if (!canEdit || apiSyncInFlightRef.current) return;

    const candidates = baseClientes.filter((cliente) => Boolean(normalizeCodigoValue(cliente.codigo)));
    if (candidates.length === 0) return;

    const codigos = Array.from(
      new Set(
        candidates
          .map((cliente) => normalizeCodigoValue(cliente.codigo))
          .filter(Boolean),
      ),
    );
    if (codigos.length === 0) return;

    apiSyncInFlightRef.current = true;
    try {
      const updatesById = new Map<string, ClienteRow>();
      const dedupeOwnersByKey = new Map<string, Set<string>>();

      candidates.forEach((cliente) => {
        const key = buildClientesDedupeKey(cliente.empresa, cliente.nome_fantasia);
        const owners = dedupeOwnersByKey.get(key);
        if (owners) {
          owners.add(cliente.id);
          return;
        }
        dedupeOwnersByKey.set(key, new Set([cliente.id]));
      });

      for (const codigo of codigos) {
        let empresaApi: OdontoartEmpresaResponseRow | null = null;
        try {
          empresaApi = await fetchEmpresaByEmpresaId(codigo);
        } catch (err) {
          console.error(`Erro ao sincronizar dados da API para o codigo ${codigo}.`, err);
          continue;
        }
        if (!empresaApi) continue;

        const apiPayload = await mapEmpresaApiToClienteSyncPayload(empresaApi, codigo);

        const matches = candidates.filter(
          (cliente) => normalizeCodigoValue(cliente.codigo) === codigo,
        );
        for (const cliente of matches) {
          const updatePayload = pickChangedApiFields(cliente, apiPayload);
          if (updatePayload.empresa !== undefined) {
            const targetKey = buildClientesDedupeKey(updatePayload.empresa, cliente.nome_fantasia);
            const targetOwners = dedupeOwnersByKey.get(targetKey);
            const hasOtherOwner = Boolean(
              targetOwners &&
                Array.from(targetOwners).some((ownerId) => ownerId !== cliente.id),
            );
            if (hasOtherOwner) {
              delete updatePayload.empresa;
            }
          }
          if (Object.keys(updatePayload).length === 0) continue;

          try {
            const updated = await updateCliente(cliente.id, updatePayload);
            await syncAgendaForCliente(updated);
            updatesById.set(updated.id, updated);
            const previousKey = buildClientesDedupeKey(cliente.empresa, cliente.nome_fantasia);
            const nextKey = buildClientesDedupeKey(updated.empresa, updated.nome_fantasia);
            if (previousKey !== nextKey) {
              const previousOwners = dedupeOwnersByKey.get(previousKey);
              if (previousOwners) {
                previousOwners.delete(cliente.id);
                if (previousOwners.size === 0) {
                  dedupeOwnersByKey.delete(previousKey);
                }
              }
              const nextOwners = dedupeOwnersByKey.get(nextKey);
              if (nextOwners) {
                nextOwners.add(updated.id);
              } else {
                dedupeOwnersByKey.set(nextKey, new Set([updated.id]));
              }
            }
          } catch (err) {
            if (isClientesDedupeConflictError(err)) {
              if (updatePayload.empresa === undefined) {
                continue;
              }
              const retryPayload: Partial<ClienteRow> = { ...updatePayload };
              delete retryPayload.empresa;
              if (Object.keys(retryPayload).length > 0) {
                try {
                  const updated = await updateCliente(cliente.id, retryPayload);
                  await syncAgendaForCliente(updated);
                  updatesById.set(updated.id, updated);
                  const previousKey = buildClientesDedupeKey(cliente.empresa, cliente.nome_fantasia);
                  const nextKey = buildClientesDedupeKey(updated.empresa, updated.nome_fantasia);
                  if (previousKey !== nextKey) {
                    const previousOwners = dedupeOwnersByKey.get(previousKey);
                    if (previousOwners) {
                      previousOwners.delete(cliente.id);
                      if (previousOwners.size === 0) {
                        dedupeOwnersByKey.delete(previousKey);
                      }
                    }
                    const nextOwners = dedupeOwnersByKey.get(nextKey);
                    if (nextOwners) {
                      nextOwners.add(updated.id);
                    } else {
                      dedupeOwnersByKey.set(nextKey, new Set([updated.id]));
                    }
                  }
                  continue;
                } catch (retryError) {
                  if (
                    !isClientesDedupeConflictError(retryError) &&
                    !isClienteSyncNoResultError(retryError)
                  ) {
                    console.error(
                      `Erro ao atualizar dados da API para o cliente ${cliente.id} apos retry sem nome.`,
                      retryError,
                    );
                  }
                  continue;
                }
              }
              continue;
            }
            if (isClienteSyncNoResultError(err)) {
              continue;
            }
            console.error(`Erro ao atualizar dados da API para o cliente ${cliente.id}.`, err);
          }
        }
      }

      if (updatesById.size > 0) {
        setClientes((prev) => prev.map((cliente) => updatesById.get(cliente.id) ?? cliente));
        setSelected((prev) => (prev ? updatesById.get(prev.id) ?? prev : prev));
      }
    } finally {
      apiSyncInFlightRef.current = false;
    }
  };

  const loadClientes = async () => {
    const cached = clientesMemoryCache;
    if (cached && cached.length > 0) {
      setClientes(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await fetchClientes();
      clientesMemoryCache = data;
      setClientes(data);
      if (canEdit) {
        void syncClienteApiFields(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar empresas.");
    } finally {
      setLoading(false);
    }
  };

  const refreshClientesSilently = async () => {
    try {
      const data = await fetchClientes();
      clientesMemoryCache = data;
      setClientes(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!canView) return;
    loadClientes();
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    const handleFocus = () => {
      void refreshClientesSilently();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [canView]);

  useEffect(() => {
    const mode: ClienteSearchMode =
      searchMode === "empresa" || searchMode === "geral" ? searchMode : "codigo";
    const term = normalizeCodigoValue(search);
    if (!canView || mode !== "codigo" || !term) {
      setCodigoSearchResults(null);
      return;
    }

    let active = true;
    setCodigoSearchResults([]);
    fetchClientesByCodigoExact(term)
      .then((data) => {
        if (!active) return;
        setCodigoSearchResults(data);
      })
      .catch((err) => {
        console.error(err);
        if (!active) return;
        setCodigoSearchResults([]);
      });

    return () => {
      active = false;
    };
  }, [canView, search, searchMode]);

  useEffect(() => {
    clientesRef.current = clientes;
    clientesMemoryCache = clientes;
  }, [clientes]);

  useEffect(() => {
    if (!canEdit) return;
    const intervalId = window.setInterval(() => {
      void syncClienteApiFields();
    }, CLIENTE_API_AUTO_SYNC_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [canEdit]);

  useEffect(() => {
    if (restoredViewRef.current) return;
    try {
      const raw = sessionStorage.getItem(CLIENTES_VIEW_STATE_KEY);
      if (!raw) {
        restoredViewRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as Partial<{
        search: string;
        searchMode: ClienteSearchMode;
        situacaoFilter: "" | "Ativo" | "Suspenso/Inadimplente" | "Cancelado";
        selectedId: string | null;
        isEditing: boolean;
        historySupervisorId: string;
        historyDateFrom: string;
        historyDateTo: string;
      }>;
      if (typeof parsed.search === "string") setSearch(parsed.search);
      if (parsed.searchMode === "codigo" || parsed.searchMode === "empresa" || parsed.searchMode === "geral") {
        setSearchMode(parsed.searchMode);
      }
      if (parsed.situacaoFilter) setSituacaoFilter(parsed.situacaoFilter);
      if (typeof parsed.selectedId === "string") setSelectedId(parsed.selectedId);
      if (typeof parsed.historySupervisorId === "string") {
        setHistorySupervisorId(parsed.historySupervisorId);
      }
      if (typeof parsed.historyDateFrom === "string") {
        setHistoryDateFrom(parsed.historyDateFrom);
      }
      if (typeof parsed.historyDateTo === "string") {
        setHistoryDateTo(parsed.historyDateTo);
      }
      if (typeof parsed.isEditing === "boolean") {
        pendingEditRestoreRef.current = parsed.isEditing;
      }
      restoredViewRef.current = true;
    } catch {
      restoredViewRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (duplicateModal || duplicateQueue.length === 0) return;
    setDuplicateModal(duplicateQueue[0]);
    setDuplicateQueue((prev) => prev.slice(1));
  }, [duplicateModal, duplicateQueue]);

  useEffect(() => {
    if (!duplicateModal) {
      setDuplicateComplemento("");
      return;
    }
    setDuplicateComplemento(
      duplicateModal.payload?.complemento ??
        duplicateModal.newCliente.complemento ??
        "",
    );
  }, [duplicateModal]);

  useEffect(() => {
    if (!restoredViewRef.current) return;
    const payload = {
      search,
      searchMode,
      situacaoFilter,
      selectedId,
      isEditing,
      historySupervisorId,
      historyDateFrom,
      historyDateTo,
    };
    try {
      sessionStorage.setItem(CLIENTES_VIEW_STATE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [historyDateFrom, historyDateTo, historySupervisorId, isEditing, search, searchMode, selectedId, situacaoFilter]);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    fetchSupervisores()
      .then((data) => {
        if (active) setHistorySupervisores(data);
      })
      .catch((err) => {
        console.error(err);
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
    if (!selectedId || selected) return;
    const found = clientes.find((cliente) => cliente.id === selectedId);
    if (found) {
      setSelected(found);
      if (pendingEditRestoreRef.current !== null) {
        setIsEditing(pendingEditRestoreRef.current);
        pendingEditRestoreRef.current = null;
      }
    }
  }, [clientes, selected, selectedId]);

  useEffect(() => {
    if (!codigoDuplicadoAprovado || codigoDuplicadoAprovado.origem !== "create") return;
    if (
      normalizeCodigoValue(codigoDuplicadoAprovado.codigo) !== normalizeCodigoValue(form.codigo) ||
      normalizeObsValue(codigoDuplicadoAprovado.obs) !== normalizeObsValue(form.obs)
    ) {
      setCodigoDuplicadoAprovado(null);
    }
  }, [codigoDuplicadoAprovado, form.codigo, form.obs]);

  useEffect(() => {
    if (!codigoDuplicadoAprovado || codigoDuplicadoAprovado.origem !== "edit") return;
    if (
      normalizeCodigoValue(codigoDuplicadoAprovado.codigo) !== normalizeCodigoValue(editForm.codigo) ||
      normalizeObsValue(codigoDuplicadoAprovado.obs) !== normalizeObsValue(editForm.obs)
    ) {
      setCodigoDuplicadoAprovado(null);
    }
  }, [codigoDuplicadoAprovado, editForm.codigo, editForm.obs]);

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

  const effectiveSearchMode: ClienteSearchMode =
    searchMode === "empresa" || searchMode === "geral" ? searchMode : "codigo";
  const normalizedSearchTerm = normalizeCodigoValue(search);
  const isSearching = Boolean(normalizedSearchTerm);
  const sourceClientes =
    effectiveSearchMode === "codigo" && isSearching && codigoSearchResults !== null
      ? codigoSearchResults
      : clientes;

  const filteredClientes = useMemo(() => {
    const base = isSearching
      ? sourceClientes.filter((cliente) => {
          if (effectiveSearchMode === "codigo") {
            return normalizeCodigoValue(cliente.codigo) === normalizedSearchTerm;
          }
          const term = normalizeSearchText(normalizedSearchTerm);
          if (effectiveSearchMode === "empresa") {
            return normalizeSearchText(cliente.empresa).includes(term);
          }
          const fields = normalizeSearchText(
            [
            cliente.codigo,
            cliente.cep,
            cliente.empresa,
            cliente.nome_fantasia,
            cliente.pessoa,
            cliente.contato,
            cliente.grupo,
            cliente.obs_comercial,
            cliente.obs,
            cliente.situacao,
            cliente.cidade,
            cliente.uf,
            cliente.bairro,
          ]
              .filter(Boolean)
              .join(" "),
          );
          return fields.includes(term);
        })
      : sourceClientes;

    const filteredByStatus = situacaoFilter
      ? base.filter((cliente) => {
          const normalized = normalizeStatus(cliente.situacao ?? "Ativo") ?? "Ativo";
          return normalized === situacaoFilter;
        })
      : base;

    const uniqueById = new Map<string, ClienteRow>();
    filteredByStatus.forEach((cliente) => {
      if (!uniqueById.has(cliente.id)) {
        uniqueById.set(cliente.id, cliente);
      }
    });

    return [...uniqueById.values()].sort((a, b) => {
      const nameA = (a.empresa ?? "").toLocaleLowerCase("pt-BR");
      const nameB = (b.empresa ?? "").toLocaleLowerCase("pt-BR");
      return nameA.localeCompare(nameB, "pt-BR");
    });
  }, [effectiveSearchMode, isSearching, normalizedSearchTerm, situacaoFilter, sourceClientes]);

  useEffect(() => {
    if (!canView || loading) return;
    if (effectiveSearchMode === "codigo" && isSearching) return;
    if (!normalizedSearchTerm) {
      searchRefreshKeyRef.current = "";
      return;
    }
    if (filteredClientes.length > 0) return;

    const key = `${effectiveSearchMode}|${situacaoFilter}|${normalizeSearchText(normalizedSearchTerm)}`;
    if (searchRefreshKeyRef.current === key) return;
    searchRefreshKeyRef.current = key;

    const timer = window.setTimeout(() => {
      void refreshClientesSilently();
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [canView, effectiveSearchMode, filteredClientes.length, isSearching, loading, normalizedSearchTerm, situacaoFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredClientes.length / CLIENTES_PER_PAGE));
  const paginatedClientes = useMemo(() => {
    const start = (currentPage - 1) * CLIENTES_PER_PAGE;
    return filteredClientes.slice(start, start + CLIENTES_PER_PAGE);
  }, [filteredClientes, currentPage]);
  const displayClientes = useMemo(() => {
    if (!isSearching) return paginatedClientes;
    if (effectiveSearchMode === "codigo") {
      return filteredClientes.filter(
        (cliente) => normalizeCodigoValue(cliente.codigo) === normalizedSearchTerm,
      );
    }
    return filteredClientes;
  }, [effectiveSearchMode, filteredClientes, isSearching, normalizedSearchTerm, paginatedClientes]);
  const resultCount = isSearching ? displayClientes.length : filteredClientes.length;

  useEffect(() => {
    setCurrentPage(1);
  }, [search, searchMode, situacaoFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const findClientesByCodigo = (codigo: string, excludeId?: string | null) => {
    const normalized = normalizeCodigoValue(codigo);
    if (!normalized) return [] as ClienteRow[];
    return clientes.filter((cliente) => {
      if (excludeId && cliente.id === excludeId) return false;
      return normalizeCodigoValue(cliente.codigo) === normalized;
    });
  };

  const hasObsConflictForCodigo = (codigo: string, obs: string, excludeId?: string | null) => {
    const normalizedObs = normalizeObsValue(obs);
    if (!normalizedObs) return false;
    return findClientesByCodigo(codigo, excludeId).some(
      (cliente) => normalizeObsValue(cliente.obs) === normalizedObs,
    );
  };

  const openCodigoDuplicadoModal = ({
    codigo,
    origem,
    excludeId,
    obsAtual,
  }: {
    codigo: string;
    origem: CodigoDuplicadoOrigem;
    excludeId?: string | null;
    obsAtual: string;
  }) => {
    const matches = findClientesByCodigo(codigo, excludeId);
    if (!matches.length) return;
    const existingObs = Array.from(
      new Set(
        matches
          .map((cliente) => (cliente.obs ?? "").trim())
          .filter(Boolean),
      ),
    );
    setCodigoDuplicadoModal({
      codigo: codigo.trim(),
      empresa: matches[0]?.empresa ?? "Sem nome",
      obs: obsAtual,
      origem,
      existingObs,
      error: null,
    });
  };

  const handleSaveCodigoDuplicadoModal = async () => {
    if (!codigoDuplicadoModal) return;
    const modalState = codigoDuplicadoModal;
    const obsValue = modalState.obs.trim();
    if (!obsValue) {
      setCodigoDuplicadoModal((prev) =>
        prev
          ? {
              ...prev,
              error: "Informe uma obs para este codigo.",
            }
          : prev,
      );
      return;
    }

    const excludeId = modalState.origem === "edit" ? selected?.id ?? null : null;
    if (hasObsConflictForCodigo(modalState.codigo, obsValue, excludeId)) {
      setCodigoDuplicadoModal((prev) =>
        prev
          ? {
              ...prev,
              error: "Esta obs ja existe para este codigo. Informe uma obs diferente.",
            }
          : prev,
      );
      return;
    }

    let apiFormData: ReturnType<typeof mapEmpresaApiToClienteForm> | null = null;
    let apiSyncPayload: ClienteApiSyncPayload | null = null;
    let obsComercialApi: string | null = null;
    let planoValoresApi: OdontoartPlanoValor[] = [];
    const codigoValue = modalState.codigo.trim();
    if (codigoValue) {
      try {
        const empresaApi = await fetchEmpresaByEmpresaId(codigoValue);
        if (!empresaApi) {
          setCodigoDuplicadoModal((prev) =>
            prev
              ? {
                  ...prev,
                  error: "Empresa nao encontrada na API.",
                }
              : prev,
          );
          return;
        }
        planoValoresApi = extractOdontoartPlanoValores(empresaApi);
        apiFormData = await enrichFormDataCepByAddress(
          mapEmpresaApiToClienteForm(empresaApi, codigoValue),
        );
        apiSyncPayload = await mapEmpresaApiToClienteSyncPayload(empresaApi, codigoValue);
        obsComercialApi = apiSyncPayload.obs_comercial ?? null;
      } catch (err) {
        setCodigoDuplicadoModal((prev) =>
          prev
            ? {
                ...prev,
                error: err instanceof Error ? err.message : "Erro ao consultar obs comercial na API.",
              }
            : prev,
        );
        return;
      }
      if (!obsComercialApi?.trim()) {
        setCodigoDuplicadoModal((prev) =>
          prev
            ? {
                ...prev,
                error: "Nao foi possivel obter obs comercial da API para este codigo.",
              }
            : prev,
        );
        return;
      }
    }

    if (modalState.origem === "edit") {
      setEditForm((prev) => ({
        ...prev,
        codigo: apiFormData?.codigo ?? prev.codigo,
        cnpj: apiFormData?.cnpj ?? prev.cnpj,
        corte: apiFormData?.corte ?? prev.corte,
        venc: apiFormData?.venc ?? prev.venc,
        valor: apiFormData?.valor ?? prev.valor,
        cep: apiFormData?.cep ?? prev.cep,
        empresa: apiFormData?.empresa ?? prev.empresa,
        obs: obsValue,
        obs_comercial: obsComercialApi ?? prev.obs_comercial,
        situacao: apiFormData?.situacao ?? prev.situacao,
        endereco: apiFormData?.endereco ?? prev.endereco,
        bairro: apiFormData?.bairro ?? prev.bairro,
        cidade: apiFormData?.cidade ?? prev.cidade,
        uf: apiFormData?.uf ?? prev.uf,
      }));
      setEditPlanoValores(planoValoresApi);
    } else {
      setForm((prev) => ({
        ...prev,
        codigo: apiFormData?.codigo ?? prev.codigo,
        cnpj: apiFormData?.cnpj ?? prev.cnpj,
        corte: apiFormData?.corte ?? prev.corte,
        venc: apiFormData?.venc ?? prev.venc,
        valor: apiFormData?.valor ?? prev.valor,
        cep: apiFormData?.cep ?? prev.cep,
        empresa: apiFormData?.empresa ?? prev.empresa,
        obs: obsValue,
        obs_comercial: obsComercialApi ?? prev.obs_comercial,
        situacao: apiFormData?.situacao ?? prev.situacao,
        endereco: apiFormData?.endereco ?? prev.endereco,
        bairro: apiFormData?.bairro ?? prev.bairro,
        cidade: apiFormData?.cidade ?? prev.cidade,
        uf: apiFormData?.uf ?? prev.uf,
      }));
      setCreatePlanoValores(planoValoresApi);
    }

    setCodigoDuplicadoAprovado({
      codigo: modalState.codigo,
      obs: obsValue,
      origem: modalState.origem,
    });
    setCodigoDuplicadoModal(null);
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) return;
    const codigoInformado = form.codigo.trim();
    if (codigoInformado) {
      const matchesByCode = findClientesByCodigo(codigoInformado);
      if (matchesByCode.length > 0) {
        const obsInformada = form.obs.trim();
        const alreadyApproved =
          codigoDuplicadoAprovado?.origem === "create" &&
          normalizeCodigoValue(codigoDuplicadoAprovado.codigo) === normalizeCodigoValue(codigoInformado) &&
          normalizeObsValue(codigoDuplicadoAprovado.obs) === normalizeObsValue(obsInformada);
        const hasConflict = hasObsConflictForCodigo(codigoInformado, obsInformada);
        if (!alreadyApproved || !obsInformada || hasConflict) {
          openCodigoDuplicadoModal({
            codigo: codigoInformado,
            origem: "create",
            obsAtual: obsInformada,
          });
          return;
        }
      }
    }
    if (codigoDuplicadoAprovado?.origem === "create" && !form.codigo.trim()) {
      setCodigoDuplicadoAprovado(null);
    }
    const codigoCreate = form.codigo.trim();
    const obsCreate = form.obs.trim();
    const duplicateCodigoApprovedForCreate =
      Boolean(codigoCreate) &&
      Boolean(obsCreate) &&
      codigoDuplicadoAprovado?.origem === "create" &&
      normalizeCodigoValue(codigoDuplicadoAprovado.codigo) === normalizeCodigoValue(codigoCreate) &&
      normalizeObsValue(codigoDuplicadoAprovado.obs) === normalizeObsValue(obsCreate);
    if (!form.empresa.trim() && !duplicateCodigoApprovedForCreate) {
      setError("Informe o nome da empresa.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const existingMatches = clientes.filter((cliente) =>
        isSameAddress(
          {
            endereco: form.endereco,
            cidade: form.cidade,
            uf: form.uf,
            complemento: form.complemento,
          },
          {
            endereco: cliente.endereco,
            cidade: cliente.cidade,
            uf: cliente.uf,
            complemento: cliente.complemento,
          },
        ),
      );
      const corteValue = form.corte ? Number(form.corte) : null;
      const vencValue = form.venc ? Number(form.venc) : null;
      const parsedCorte = Number.isFinite(corteValue ?? NaN) ? corteValue : null;
      const parsedVenc = Number.isFinite(vencValue ?? NaN) ? vencValue : null;
      const parsedDataUltimaVisita = toIsoDateInput(form.data_da_ultima_visita);
      const created = await createCliente({
        codigo: form.codigo.trim() || null,
        cnpj: normalizeCnpj(form.cnpj),
        corte: parsedCorte,
        venc: parsedVenc,
        valor: form.valor ? parseImportCurrency(form.valor) : null,
        data_da_ultima_visita: parsedDataUltimaVisita,
        cep: form.cep.trim() || null,
        empresa: form.empresa.trim() || null,
        pessoa: form.pessoa.trim() || null,
        contato: normalizeContato(form.contato),
        grupo: form.grupo.trim() || null,
        obs_comercial: form.obs_comercial.trim() || null,
        obs: form.obs.trim() || null,
        perfil_visita: perfilCreate.perfil || null,
        situacao: form.situacao.trim() || "Ativo",
        categoria: form.categoria.trim() || null,
        endereco: form.endereco.trim() || null,
        complemento: form.complemento.trim() || null,
        bairro: form.bairro.trim() || null,
        cidade: form.cidade.trim() || null,
        uf: form.uf.trim() || null,
      });
      setClientes((prev) => [created, ...prev]);
      if (existingMatches.length > 0) {
        setDuplicateModal({ newCliente: created, existing: existingMatches });
      }
      setForm({
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
      setCreatePlanoValores([]);
      setCodigoDuplicadoAprovado(null);
      setPerfilCreate(buildPerfilState(null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar cliente.");
    } finally {
      setCreating(false);
    }
  };

  const handleDuplicateKeepOld = async () => {
    if (!duplicateModal) return;
    setDuplicateResolving(true);
    setError(null);
    try {
      if (!duplicateModal.isTemp) {
        await deleteCliente(duplicateModal.newCliente.id);
        setClientes((prev) => prev.filter((item) => item.id !== duplicateModal.newCliente.id));
        if (selectedId === duplicateModal.newCliente.id) {
          setSelected(null);
          setSelectedId(null);
        }
      }
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
        const updated = await Promise.all(
          duplicateModal.existing.map((item) => updateCliente(item.id, updatePayload)),
        );
        await Promise.all(updated.map((item) => syncAgendaForCliente(item)));
        setClientes((prev) =>
          prev.map((item) => updated.find((entry) => entry.id === item.id) ?? item),
        );
      } else {
        const oldIds = duplicateModal.existing.map((item) => item.id);
        await Promise.all(oldIds.map((id) => deleteCliente(id)));
        setClientes((prev) => prev.filter((item) => !oldIds.includes(item.id)));
        if (selectedId && oldIds.includes(selectedId)) {
          setSelected(null);
          setSelectedId(null);
        }
        const updatedNew = await updateCliente(duplicateModal.newCliente.id, {
          complemento: duplicateComplemento.trim() || null,
        });
        await syncAgendaForCliente(updatedNew);
        setClientes((prev) =>
          prev.map((item) => (item.id === updatedNew.id ? updatedNew : item)),
        );
      }
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
        const created = await createCliente(
          buildClientePayloadFromImport({
            ...duplicateModal.payload,
            complemento: duplicateComplemento,
          }),
        );
        await syncAgendaForCliente(created);
        setClientes((prev) => [created, ...prev]);
      } else {
        const updated = await updateCliente(duplicateModal.newCliente.id, {
          complemento: duplicateComplemento.trim() || null,
        });
        await syncAgendaForCliente(updated);
        setClientes((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao manter as duas empresas.");
    } finally {
      setDuplicateResolving(false);
      setDuplicateModal(null);
    }
  };

  const handleAddressLookup = async () => {
    const road = form.endereco.trim();
    const city = form.cidade.trim();
    const state = form.uf.trim();
    if (!road || !city || !state) {
      setAddressLookupError("Informe endereco, cidade e UF.");
      return;
    }
    setAddressLookupLoading(true);
    setAddressLookupError(null);
    try {
      const mapped = await fetchNominatimByAddress(road, city, state);
      if (!mapped) {
        throw new Error("Endereco nao encontrado.");
      }
      setForm((prev) => ({
        ...prev,
        bairro: mapped.bairro ?? prev.bairro,
        cep: mapped.cep ? formatCep(mapped.cep) : prev.cep,
      }));
    } catch {
      setAddressLookupError("Endereco nao encontrado ou API indisponivel.");
    } finally {
      setAddressLookupLoading(false);
    }
  };

  const handleCodigoLookup = async () => {
    const empresaId = form.codigo.trim();
    if (!empresaId) {
      setCodigoError("Informe o codigo da empresa.");
      return;
    }
    if (findClientesByCodigo(empresaId).length > 0) {
      openCodigoDuplicadoModal({
        codigo: empresaId,
        origem: "create",
        obsAtual: form.obs,
      });
      return;
    }
    setCodigoLoading(true);
    setCodigoError(null);
    try {
      const empresaApi = await fetchEmpresaByEmpresaId(empresaId);
      if (!empresaApi) {
        throw new Error("Empresa nao encontrada na API.");
      }
      const planoValores = extractOdontoartPlanoValores(empresaApi);
      const formData = await enrichFormDataCepByAddress(
        mapEmpresaApiToClienteForm(empresaApi, empresaId),
      );
      setForm(formData);
      setCreatePlanoValores(planoValores);
      setPerfilCreate(buildPerfilState(null));
      setCepError(null);
      setAddressLookupError(null);
    } catch (err) {
      setCodigoError(err instanceof Error ? err.message : "Erro ao buscar codigo na API.");
    } finally {
      setCodigoLoading(false);
    }
  };

  const handleCnpjLookup = async () => {
    const cnpj = sanitizeCnpjDigits(form.cnpj);
    if (cnpj.length !== 14) {
      setCnpjError("Informe um CNPJ valido.");
      return;
    }

    setCnpjLoading(true);
    setCnpjError(null);
    try {
      const empresaApi = await fetchEmpresaByCnpjWs(cnpj);
      const endereco = buildEnderecoWithNumero(empresaApi.logradouro, empresaApi.numero);
      setCreatePlanoValores([]);
      setForm((prev) => ({
        ...prev,
        empresa: empresaApi.razao_social ?? prev.empresa,
        endereco: endereco || prev.endereco,
        cep: empresaApi.cep ? formatCep(empresaApi.cep) : prev.cep,
        bairro: empresaApi.bairro ?? prev.bairro,
        cidade: empresaApi.cidade ?? prev.cidade,
        uf: empresaApi.estado ?? prev.uf,
      }));
    } catch (err) {
      setCnpjError(err instanceof Error ? err.message : "Erro ao buscar CNPJ na API.");
    } finally {
      setCnpjLoading(false);
    }
  };

  const handleCepLookup = async () => {
    const digits = sanitizeCep(form.cep);
    if (digits.length !== 8) {
      setCepError("Informe um CEP valido.");
      return;
    }
    setCepLoading(true);
    setCepError(null);
    try {
      const mapped = await fetchNominatimByCep(digits);
      if (!mapped) {
        throw new Error("CEP nao encontrado.");
      }
      setForm((prev) => ({
        ...prev,
        endereco: mapped.endereco ?? prev.endereco,
        bairro: mapped.bairro ?? prev.bairro,
        cidade: mapped.cidade ?? prev.cidade,
        uf: mapped.uf ?? prev.uf,
      }));
    } catch {
      setCepError("CEP nao encontrado ou API indisponivel.");
    } finally {
      setCepLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selected || !canEdit) return;
    const codigoInformado = editForm.codigo.trim();
    if (codigoInformado) {
      const matchesByCode = findClientesByCodigo(codigoInformado, selected.id);
      if (matchesByCode.length > 0) {
        const obsInformada = editForm.obs.trim();
        const alreadyApproved =
          codigoDuplicadoAprovado?.origem === "edit" &&
          normalizeCodigoValue(codigoDuplicadoAprovado.codigo) === normalizeCodigoValue(codigoInformado) &&
          normalizeObsValue(codigoDuplicadoAprovado.obs) === normalizeObsValue(obsInformada);
        const hasConflict = hasObsConflictForCodigo(codigoInformado, obsInformada, selected.id);
        if (!alreadyApproved || !obsInformada || hasConflict) {
          openCodigoDuplicadoModal({
            codigo: codigoInformado,
            origem: "edit",
            excludeId: selected.id,
            obsAtual: obsInformada,
          });
          return;
        }
      }
    }
    if (codigoDuplicadoAprovado?.origem === "edit" && !editForm.codigo.trim()) {
      setCodigoDuplicadoAprovado(null);
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
      await syncAgendaForCliente(updated);
      await syncVisitsForCliente(updated);
      setClientes((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setSelected(updated);
      setCodigoDuplicadoAprovado(null);
      setIsEditing(false);
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
      setClientes((prev) => prev.filter((item) => item.id !== selected.id));
      setSelected(null);
      setSelectedId(null);
      setIsEditing(false);
      setDeletePasswordEdit("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir empresa.");
    } finally {
      setDeletingEdit(false);
    }
  };

  const handleCepLookupEdit = async () => {
    const digits = sanitizeCep(editForm.cep);
    if (digits.length !== 8) {
      setCepErrorEdit("Informe um CEP valido.");
      return;
    }
    setCepLoadingEdit(true);
    setCepErrorEdit(null);
    try {
      const mapped = await fetchNominatimByCep(digits);
      if (!mapped) {
        throw new Error("CEP nao encontrado.");
      }
      setEditForm((prev) => ({
        ...prev,
        endereco: mapped.endereco ?? prev.endereco,
        complemento: mapped.complemento ?? prev.complemento,
        bairro: mapped.bairro ?? prev.bairro,
        cidade: mapped.cidade ?? prev.cidade,
        uf: mapped.uf ?? prev.uf,
      }));
    } catch {
      setCepErrorEdit("CEP nao encontrado ou API indisponivel.");
    } finally {
      setCepLoadingEdit(false);
    }
  };

  const handleCnpjLookupEdit = async () => {
    const cnpj = sanitizeCnpjDigits(editForm.cnpj);
    if (cnpj.length !== 14) {
      setCnpjErrorEdit("Informe um CNPJ valido.");
      return;
    }

    setCnpjLoadingEdit(true);
    setCnpjErrorEdit(null);
    try {
      const empresaApi = await fetchEmpresaByCnpjWs(cnpj);
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
      setCnpjErrorEdit(err instanceof Error ? err.message : "Erro ao buscar CNPJ na API.");
    } finally {
      setCnpjLoadingEdit(false);
    }
  };

  const handleAddressLookupEdit = async () => {
    const road = editForm.endereco.trim();
    const city = editForm.cidade.trim();
    const state = editForm.uf.trim();
    if (!road || !city || !state) {
      setAddressLookupErrorEdit("Informe endereco, cidade e UF.");
      return;
    }
    setAddressLookupLoadingEdit(true);
    setAddressLookupErrorEdit(null);
    try {
      const mapped = await fetchNominatimByAddress(road, city, state);
      if (!mapped) {
        throw new Error("Endereco nao encontrado.");
      }
      setEditForm((prev) => ({
        ...prev,
        bairro: mapped.bairro ?? prev.bairro,
        cep: mapped.cep ? formatCep(mapped.cep) : prev.cep,
      }));
    } catch {
      setAddressLookupErrorEdit("Endereco nao encontrado ou API indisponivel.");
    } finally {
      setAddressLookupLoadingEdit(false);
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
    const existingSnapshot = clientes.length ? [...clientes] : await fetchClientes();
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

      const duplicateCandidates: DuplicateEntry[] = [];
      payloads.forEach((payload, index) => {
        const matches = existingSnapshot.filter((item) => isSameAddress(payload, item));
        if (matches.length) {
          duplicateCandidates.push({
            newCliente: {
              id: `import-${index}`,
              codigo: payload.codigo ?? null,
              cnpj: payload.cnpj ?? null,
              corte: payload.corte ?? null,
              venc: payload.venc ?? null,
              valor: payload.valor ?? null,
              data_da_ultima_visita: payload.data_da_ultima_visita ?? null,
              cep: payload.cep ?? null,
              empresa: payload.empresa ?? null,
              pessoa: payload.pessoa ?? null,
              contato: payload.contato ?? null,
              grupo: payload.grupo ?? null,
              obs_comercial: payload.obs_comercial ?? null,
              obs: payload.obs ?? null,
              nome_fantasia: null,
              complemento: payload.complemento ?? null,
              perfil_visita: payload.perfil_visita ?? null,
              situacao: "Ativo",
              categoria: payload.categoria ?? null,
              endereco: payload.endereco ?? null,
              bairro: payload.bairro ?? null,
              cidade: payload.cidade ?? null,
              uf: payload.uf ?? null,
              latitude: null,
              longitude: null,
              geocode_source: null,
              geocode_updated_at: null,
              created_at: null,
            },
            existing: matches,
            isTemp: true,
            payload,
          });
        }
      });

      const checkable = payloads.filter((item) => {
        const hasBairro = Boolean(item.bairro?.trim());
        if (hasBairro) return false;
        const cepDigits = sanitizeCep(item.cep ?? "");
        const hasCep = cepDigits.length === 8;
        const road = item.endereco?.trim() ?? "";
        const city = item.cidade?.trim() ?? "";
        const state = item.uf?.trim() ?? "";
        const canCheckAddress = Boolean(road && city && state);
        return canCheckAddress || hasCep;
      });

      setImportTotal(payloads.length);
      setImportProgress(0);
      setImportInserted(0);

      if (checkable.length > 0) {
        setImportStageLabel("Checando bairros");
        setImportMessage(`Checando bairros via API... 0/${checkable.length}`);
        let processed = 0;
        const lastRequestAt = { current: 0 };
        for (const item of checkable) {
          const cepDigits = sanitizeCep(item.cep ?? "");
          const hasCep = cepDigits.length === 8;
          const road = item.endereco?.trim() ?? "";
          const city = item.cidade?.trim() ?? "";
          const state = item.uf?.trim() ?? "";
          const canCheckAddress = Boolean(road && city && state);

          const now = Date.now();
          const wait = Math.max(0, BAIRRO_LOOKUP_DELAY_MS - (now - lastRequestAt.current));
          if (wait) {
            await delay(wait);
          }
          lastRequestAt.current = Date.now();

          try {
            if (canCheckAddress) {
              const mapped = await fetchNominatimByAddress(road, city, state);
              if (mapped?.bairro) {
                item.bairro = mapped.bairro;
              }
              if (mapped?.cep && sanitizeCep(item.cep ?? "").length !== 8) {
                item.cep = formatCep(mapped.cep);
              }
              if (!item.bairro && hasCep) {
                const mappedByCep = await fetchNominatimByCep(cepDigits);
                if (mappedByCep?.bairro) {
                  item.bairro = mappedByCep.bairro;
                }
              }
            } else if (hasCep) {
              const mapped = await fetchNominatimByCep(cepDigits);
              if (mapped?.bairro) {
                item.bairro = mapped.bairro;
              }
            }
          } catch {
            // ignore individual lookup errors, keep import running
          } finally {
            processed += 1;
            if (processed % 10 === 0 || processed === checkable.length) {
              setImportMessage(`Checando bairros via API... ${processed}/${checkable.length}`);
            }
          }
        }
      }

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
        const seen: ClienteRow[] = [...existingSnapshot];
        created.forEach((cliente) => {
          const matches = seen.filter((item) => isSameAddress(item, cliente));
          if (matches.length) {
            duplicatesFromCreated.push({ newCliente: cliente, existing: matches });
          }
          seen.push(cliente);
        });
      }

      let mergedDuplicates: DuplicateEntry[] = [];
      if (duplicateCandidates.length || duplicatesFromCreated.length) {
        const createdByKey = new Map<string, ClienteRow>();
        created.forEach((cliente) => createdByKey.set(buildImportKey(cliente), cliente));
        const resolvedCandidates = duplicateCandidates.map((entry) => {
          const key = buildImportKey(entry.newCliente);
          const createdMatch = createdByKey.get(key);
          if (!createdMatch) return entry;
          return {
            ...entry,
            newCliente: createdMatch,
            isTemp: false,
          };
        });
        const merged = new Map<string, DuplicateEntry>();
        resolvedCandidates.forEach((entry) => merged.set(buildImportKey(entry.newCliente), entry));
        duplicatesFromCreated.forEach((entry) => {
          const key = buildImportKey(entry.newCliente);
          if (!merged.has(key)) {
            merged.set(key, entry);
          }
        });
        mergedDuplicates = Array.from(merged.values());
        setDuplicateQueue((prev) => [...prev, ...mergedDuplicates]);
      }
      await loadClientes();
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
  const canSearchEndereco = Boolean(form.endereco.trim() && canEditEndereco);
  const canEditEnderecoEdit = Boolean(editForm.cidade.trim() && editForm.uf.trim());
  const canSearchEnderecoEdit = Boolean(editForm.endereco.trim() && canEditEnderecoEdit);
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
  const importElapsedSeconds = importStartedAt ? Math.max(0, (importTick - importStartedAt) / 1000) : 0;
  const importRemaining = Math.max(0, importTotal - importProgress);
  const importEstimatedSeconds = importProgress > 0 ? (importElapsedSeconds / importProgress) * importRemaining : null;

  if (!canView) {
    return (
      <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
        Este modulo e restrito a supervisao e assistencia.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-ink">Empresas</h2>
        <p className="mt-2 text-sm text-ink/60">
          Gestao de empresas cadastradas e historico de visitas.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      {canCreate && (
        <form
          onSubmit={handleCreate}
          className="grid gap-3 rounded-2xl border border-sea/20 bg-sand/30 p-4 md:grid-cols-6"
        >
          <label className="min-w-0 flex w-full flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
            Codigo
            <div className="min-w-0 flex items-end gap-1">
              <input
                value={form.codigo}
                onChange={(event) => {
                  setCodigoError(null);
                  setForm((prev) => ({ ...prev, codigo: event.target.value }));
                }}
                className="min-w-0 w-full flex-1 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
              />
              <button
                type="button"
                onClick={handleCodigoLookup}
                disabled={codigoLoading || !form.codigo.trim()}
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
                  setCnpjError(null);
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
                disabled={cnpjLoading || sanitizeCnpjDigits(form.cnpj).length !== 14}
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
                  onClick={handleAddressLookup}
                  disabled={!canSearchEndereco || addressLookupLoading}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"
                  title={addressLookupLoading ? "Buscando endereco..." : "Cadastrar via endereco"}
                  aria-label={addressLookupLoading ? "Buscando endereco..." : "Cadastrar via endereco"}
              >
                <MapPin size={15} className={addressLookupLoading ? "animate-pulse" : ""} />
              </button>
            </div>
            {addressLookupLoading && (
              <span className="text-[11px] font-normal text-ink/60">Consultando endereco...</span>
            )}
            {addressLookupError && (
              <span className="text-[11px] font-normal text-red-600">{addressLookupError}</span>
            )}
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
                disabled={cepLoading || sanitizeCep(form.cep).length !== 8}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"
                title={cepLoading ? "Buscando CEP..." : "Buscar CEP"}
                aria-label={cepLoading ? "Buscando CEP..." : "Buscar CEP"}
              >
                <Search size={15} className={cepLoading ? "animate-pulse" : ""} />
              </button>
            </div>
            {cepLoading && (
              <span className="text-[11px] text-ink/60">Consultando CEP...</span>
            )}
            {cepError && <span className="text-[11px] text-red-600">{cepError}</span>}
          </label>
          <div className="flex items-end md:col-span-2">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
            >
              <Plus size={14} />
              {creating ? "Criando" : "Adicionar cliente"}
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg text-ink">Empresas cadastradas</h3>
          <p className="text-xs text-ink/60">
            {resultCount} empresa(s){search.trim() ? ` de ${clientes.length}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <button
              type="button"
              onClick={() => {
                setImportMessage(null);
                setImportStageLabel("Aguardando arquivo");
                setImportProgress(0);
                setImportTotal(0);
                setImportInserted(0);
                setShowImportModal(true);
              }}
              className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
            >
              Importar empresa
            </button>
          )}
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
        <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
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
                    setSelected(cliente);
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
          {!isSearching && filteredClientes.length > 0 && (
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
          className={`fixed inset-0 z-50 flex ${isEditing ? "items-center justify-center p-4" : "justify-end"}`}
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
              <div className="mt-6 grid gap-3 rounded-2xl border border-sea/20 bg-sand/30 p-4 md:grid-cols-6">
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
                        onClick={handleAddressLookupEdit}
                        disabled={!canSearchEnderecoEdit || addressLookupLoadingEdit}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"
                        title={addressLookupLoadingEdit ? "Buscando bairro..." : "Buscar bairro por endereco"}
                        aria-label={addressLookupLoadingEdit ? "Buscando bairro..." : "Buscar bairro por endereco"}
                      >
                        <MapPin size={15} className={addressLookupLoadingEdit ? "animate-pulse" : ""} />
                      </button>
                    </div>
                    {addressLookupLoadingEdit && (
                      <span className="text-[11px] font-normal text-ink/60">Consultando endereco...</span>
                    )}
                    {addressLookupErrorEdit && (
                      <span className="text-[11px] font-normal text-red-600">{addressLookupErrorEdit}</span>
                    )}
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
                  <div className="flex items-end gap-1">
                    <input
                      value={editForm.bairro}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, bairro: event.target.value }))
                      }
                      className="flex-1 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    />
                    <button
                      type="button"
                      onClick={handleAddressLookupEdit}
                      disabled={!canSearchEnderecoEdit || addressLookupLoadingEdit}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"
                      title={addressLookupLoadingEdit ? "Buscando bairro..." : "Buscar bairro por endereco"}
                      aria-label={addressLookupLoadingEdit ? "Buscando bairro..." : "Buscar bairro por endereco"}
                    >
                      <MapPin size={15} className={addressLookupLoadingEdit ? "animate-pulse" : ""} />
                    </button>
                  </div>
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
                      title={cepLoadingEdit ? "Buscando CEP..." : "Buscar CEP"}
                      aria-label={cepLoadingEdit ? "Buscando CEP..." : "Buscar CEP"}
                    >
                      <Search size={15} className={cepLoadingEdit ? "animate-pulse" : ""} />
                    </button>
                  </div>
                  {cepLoadingEdit && (
                    <span className="text-[11px] text-ink/60">Consultando CEP...</span>
                  )}
                  {cepErrorEdit && <span className="text-[11px] text-red-600">{cepErrorEdit}</span>}
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
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
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

      {codigoDuplicadoModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setCodigoDuplicadoModal(null)}
          />
          <div className="relative w-full max-w-lg rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Codigo ja cadastrado</h3>
            <p className="mt-2 text-sm text-ink/70">
              Ja existe empresa cadastrada com este codigo. Informe uma obs unica para diferenciar a filial.
            </p>
            <div className="mt-4 grid gap-2 rounded-xl border border-sea/15 bg-sand/30 p-3 text-sm text-ink/80">
              <p>
                <span className="font-semibold">Codigo:</span> {codigoDuplicadoModal.codigo}
              </p>
              <p>
                <span className="font-semibold">Empresa:</span> {codigoDuplicadoModal.empresa}
              </p>
            </div>
            {codigoDuplicadoModal.existingObs.length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p className="font-semibold">Obs ja utilizadas para este codigo:</p>
                <p className="mt-1 break-words">
                  {codigoDuplicadoModal.existingObs.join(" | ")}
                </p>
              </div>
            )}
            <label className="mt-4 flex flex-col gap-1 text-xs font-semibold text-ink/70">
              Obs
              <textarea
                value={codigoDuplicadoModal.obs}
                onChange={(event) =>
                  setCodigoDuplicadoModal((prev) =>
                    prev
                      ? {
                          ...prev,
                          obs: event.target.value,
                          error: null,
                        }
                      : prev,
                  )
                }
                rows={4}
                className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
              />
            </label>
            {codigoDuplicadoModal.error && (
              <p className="mt-2 text-xs font-semibold text-red-600">{codigoDuplicadoModal.error}</p>
            )}
            <p className="mt-2 text-[11px] text-ink/60">
              Apos salvar a obs, clique em "Adicionar cliente" para concluir.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCodigoDuplicadoModal(null)}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handleSaveCodigoDuplicadoModal}
                className="rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-ink/30" />
          <div className="relative w-full max-w-lg rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
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
                {duplicateModal.existing.map((item) => (
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
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
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
