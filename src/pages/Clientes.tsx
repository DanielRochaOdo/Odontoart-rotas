import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { MapPin, Plus, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "../context/AuthContext";
import {
  createCliente,
  deleteCliente,
  fetchClienteHistory,
  fetchClientes,
  updateCliente,
  syncAgendaForCliente,
  syncVisitsForCliente,
  upsertClientes,
} from "../lib/clientesApi";
import { fetchSupervisores } from "../lib/agendaApi";
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
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const isSameAddress = (
  a: Pick<ClienteRow, "endereco" | "cidade" | "uf">,
  b: Pick<ClienteRow, "endereco" | "cidade" | "uf">,
) => {
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
  return true;
};

type DuplicateEntry = {
  newCliente: ClienteRow;
  existing: ClienteRow[];
  isTemp?: boolean;
  payload?: ImportPayload;
};

type ImportPayload = {
  codigo?: string | null;
  valor?: number | null;
  cep?: string | null;
  empresa?: string | null;
  pessoa?: string | null;
  contato?: string | null;
  situacao?: string | null;
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
}) =>
  [
    normalizeAddressValue(payload.codigo ?? ""),
    normalizeAddressValue(payload.empresa ?? ""),
    normalizeAddressValue(payload.endereco ?? ""),
    normalizeAddressValue(payload.cidade ?? ""),
    normalizeAddressValue(payload.uf ?? ""),
  ].join("|");

const buildClientePayloadFromImport = (payload: ImportPayload) => ({
  codigo: payload.codigo ?? null,
  corte: payload.corte ?? null,
  venc: payload.venc ?? null,
  valor: payload.valor ?? null,
  data_da_ultima_visita: payload.data_da_ultima_visita ?? null,
  cep: payload.cep ?? null,
  empresa: payload.empresa ?? null,
  pessoa: payload.pessoa ?? null,
  contato: normalizeContato(payload.contato ?? ""),
  complemento: payload.complemento ?? null,
  perfil_visita: payload.perfil_visita ?? null,
  situacao: payload.situacao ?? "Ativo",
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

const SITUACAO_OPTIONS = ["Ativo", "Inativo"] as const;

const normalizeHeader = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const IMPORT_NUMERIC_FIELDS = new Set(["corte", "venc"]);
const sanitizeDigits = (value: string) => value.replace(/\D/g, "");

const formatContato = (value: string) => {
  const digits = sanitizeDigits(value).slice(0, 11);
  if (!digits) return "";
  const area = digits.slice(0, 2);
  const first = digits.slice(2, 3);
  const middle = digits.slice(3, 7);
  const last = digits.slice(7, 11);
  if (digits.length <= 2) return `(${area}`;
  let formatted = `(${area})`;
  if (first) formatted += ` ${first}`;
  if (middle) formatted += ` ${middle}`;
  if (last) formatted += ` ${last}`;
  return formatted;
};

const normalizeContato = (value: string) => {
  const digits = sanitizeDigits(value);
  return digits ? formatContato(digits) : null;
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

const formatCurrencyInput = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const amount = Number(digits) / 100;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
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
  situacao: "situacao",
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
  const cleaned = value.trim().toLowerCase();
  if (cleaned === "ativo") return "Ativo";
  if (cleaned === "inativo") return "Inativo";
  return null;
};

const normalizeName = (value: string | null) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

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
  const { role } = useAuth();
  const canView = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canCreate = canView;
  const canEdit = role === "SUPERVISOR";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [search, setSearch] = useState("");
  const [situacaoFilter, setSituacaoFilter] = useState<"" | "Ativo" | "Inativo">("");

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    codigo: "",
    corte: "",
    venc: "",
    valor: "",
    data_da_ultima_visita: "",
    cep: "",
    empresa: "",
    pessoa: "",
    contato: "",
    situacao: "Ativo",
    endereco: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
  });
  const [perfilCreate, setPerfilCreate] = useState(() => buildPerfilState(null));

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
    corte: "",
    venc: "",
    valor: "",
    data_da_ultima_visita: "",
    cep: "",
    empresa: "",
    pessoa: "",
    contato: "",
    situacao: "",
    endereco: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
  });
  const [perfilEdit, setPerfilEdit] = useState(() => buildPerfilState(null));

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
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const [cepLoadingEdit, setCepLoadingEdit] = useState(false);
  const [cepErrorEdit, setCepErrorEdit] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importStartedAt, setImportStartedAt] = useState<number | null>(null);
  const [importTick, setImportTick] = useState(0);
  const [bairroLoading, setBairroLoading] = useState(false);
  const [bairroLoadingEdit, setBairroLoadingEdit] = useState(false);
  const [addressLookupLoading, setAddressLookupLoading] = useState(false);
  const [addressLookupError, setAddressLookupError] = useState<string | null>(null);
  const [addressLookupLoadingEdit, setAddressLookupLoadingEdit] = useState(false);
  const [addressLookupErrorEdit, setAddressLookupErrorEdit] = useState<string | null>(null);
  const [duplicateModal, setDuplicateModal] = useState<DuplicateEntry | null>(null);
  const [duplicateQueue, setDuplicateQueue] = useState<DuplicateEntry[]>([]);
  const [duplicateResolving, setDuplicateResolving] = useState(false);
  const [duplicateComplemento, setDuplicateComplemento] = useState("");
  const skipCepLookupRef = useRef(false);
  const skipCepLookupEditRef = useRef(false);

  const loadClientes = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchClientes();
      setClientes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar empresas.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canView) return;
    loadClientes();
  }, [canView]);

  useEffect(() => {
    if (restoredViewRef.current) return;
    try {
      const raw = sessionStorage.getItem("clientesViewState");
      if (!raw) {
        restoredViewRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as Partial<{
        search: string;
        situacaoFilter: "" | "Ativo" | "Inativo";
        selectedId: string | null;
        isEditing: boolean;
        historySupervisorId: string;
        historyDateFrom: string;
        historyDateTo: string;
      }>;
      if (typeof parsed.search === "string") setSearch(parsed.search);
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
      situacaoFilter,
      selectedId,
      isEditing,
      historySupervisorId,
      historyDateFrom,
      historyDateTo,
    };
    try {
      sessionStorage.setItem("clientesViewState", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [historyDateFrom, historyDateTo, historySupervisorId, isEditing, search, selectedId, situacaoFilter]);

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
    setHistorySupervisorId("all");
    setHistoryDateFrom("");
    setHistoryDateTo("");
    setEditForm({
      codigo: selected.codigo ?? "",
      corte: selected.corte !== null && selected.corte !== undefined ? String(selected.corte) : "",
      venc: selected.venc !== null && selected.venc !== undefined ? String(selected.venc) : "",
      valor: selected.valor !== null && selected.valor !== undefined ? formatCurrency(selected.valor) : "",
      data_da_ultima_visita: toDateInput(selected.data_da_ultima_visita),
      cep: selected.cep ?? "",
      empresa: selected.empresa ?? "",
      pessoa: selected.pessoa ?? "",
      contato: selected.contato ?? "",
      situacao: selected.situacao ?? "Ativo",
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

  useEffect(() => {
    if (skipCepLookupRef.current) {
      skipCepLookupRef.current = false;
      return;
    }
    const digits = sanitizeCep(form.cep);
    if (digits.length !== 8) {
      setCepError(null);
      return;
    }
    const controller = new AbortController();
    const handler = window.setTimeout(async () => {
      setCepLoading(true);
      setCepError(null);
      try {
        const mapped = await fetchNominatimByCep(digits, controller.signal);
        if (!mapped) {
          throw new Error("CEP nao encontrado.");
        }
        setForm((prev) => ({
          ...prev,
          endereco: mapped.endereco ?? prev.endereco,
          complemento: mapped.complemento ?? prev.complemento,
          bairro: mapped.bairro ?? prev.bairro,
          cidade: mapped.cidade ?? prev.cidade,
          uf: mapped.uf ?? prev.uf,
        }));
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setCepError("CEP nao encontrado ou API indisponivel.");
        }
      } finally {
        setCepLoading(false);
      }
    }, 400);
    return () => {
      window.clearTimeout(handler);
      controller.abort();
    };
  }, [form.cep]);

  useEffect(() => {
    if (skipCepLookupEditRef.current) {
      skipCepLookupEditRef.current = false;
      return;
    }
    const digits = sanitizeCep(editForm.cep);
    if (digits.length !== 8) {
      setCepErrorEdit(null);
      return;
    }
    const controller = new AbortController();
    const handler = window.setTimeout(async () => {
      setCepLoadingEdit(true);
      setCepErrorEdit(null);
      try {
        const mapped = await fetchNominatimByCep(digits, controller.signal);
        if (!mapped) {
          throw new Error("CEP nao encontrado.");
        }
        setEditForm((prev) => ({
          ...prev,
          endereco: mapped.endereco ?? prev.endereco,
          bairro: mapped.bairro ?? prev.bairro,
          cidade: mapped.cidade ?? prev.cidade,
          uf: mapped.uf ?? prev.uf,
        }));
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setCepErrorEdit("CEP nao encontrado ou API indisponivel.");
        }
      } finally {
        setCepLoadingEdit(false);
      }
    }, 400);
    return () => {
      window.clearTimeout(handler);
      controller.abort();
    };
  }, [editForm.cep]);

  useEffect(() => {
    const road = form.endereco.trim();
    const city = form.cidade.trim();
    const state = form.uf.trim();
    const cepDigits = sanitizeCep(form.cep);
    if (!road || !city || !state || cepDigits.length === 8) {
      setBairroLoading(false);
      return;
    }
    const controller = new AbortController();
    const handler = window.setTimeout(async () => {
      setBairroLoading(true);
      try {
        const mapped = await fetchNominatimByAddress(road, city, state, controller.signal);
        if (mapped?.bairro) {
          setForm((prev) => ({
            ...prev,
            bairro: mapped.bairro ?? prev.bairro,
          }));
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error(err);
        }
      } finally {
        setBairroLoading(false);
      }
    }, 600);
    return () => {
      window.clearTimeout(handler);
      controller.abort();
      setBairroLoading(false);
    };
  }, [form.endereco, form.cidade, form.uf, form.cep]);

  useEffect(() => {
    const road = editForm.endereco.trim();
    const city = editForm.cidade.trim();
    const state = editForm.uf.trim();
    const cepDigits = sanitizeCep(editForm.cep);
    if (!road || !city || !state || cepDigits.length === 8) {
      setBairroLoadingEdit(false);
      return;
    }
    const controller = new AbortController();
    const handler = window.setTimeout(async () => {
      setBairroLoadingEdit(true);
      try {
        const mapped = await fetchNominatimByAddress(road, city, state, controller.signal);
        if (mapped?.bairro) {
          setEditForm((prev) => ({
            ...prev,
            bairro: mapped.bairro ?? prev.bairro,
          }));
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error(err);
        }
      } finally {
        setBairroLoadingEdit(false);
      }
    }, 600);
    return () => {
      window.clearTimeout(handler);
      controller.abort();
      setBairroLoadingEdit(false);
    };
  }, [editForm.endereco, editForm.cidade, editForm.uf, editForm.cep]);

  const filteredClientes = useMemo(() => {
    const base = search.trim()
      ? clientes.filter((cliente) => {
          const term = search.trim().toLowerCase();
          const fields = [
            cliente.codigo,
            cliente.cep,
            cliente.empresa,
            cliente.pessoa,
            cliente.contato,
            cliente.situacao,
            cliente.cidade,
            cliente.uf,
            cliente.bairro,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return fields.includes(term);
        })
      : clientes;

    const filteredByStatus = situacaoFilter
      ? base.filter((cliente) => {
          const normalized = normalizeStatus(cliente.situacao ?? "Ativo") ?? "Ativo";
          return normalized === situacaoFilter;
        })
      : base;

    return [...filteredByStatus].sort((a, b) => {
      const nameA = (a.empresa ?? "").toLocaleLowerCase("pt-BR");
      const nameB = (b.empresa ?? "").toLocaleLowerCase("pt-BR");
      return nameA.localeCompare(nameB, "pt-BR");
    });
  }, [clientes, search, situacaoFilter]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) return;
    if (!form.empresa.trim()) {
      setError("Informe o nome da empresa.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const existingMatches = clientes.filter((cliente) =>
        isSameAddress(
          { endereco: form.endereco, cidade: form.cidade, uf: form.uf },
          { endereco: cliente.endereco, cidade: cliente.cidade, uf: cliente.uf },
        ),
      );
      const corteValue = form.corte ? Number(form.corte) : null;
      const vencValue = form.venc ? Number(form.venc) : null;
      const parsedCorte = Number.isFinite(corteValue ?? NaN) ? corteValue : null;
      const parsedVenc = Number.isFinite(vencValue ?? NaN) ? vencValue : null;
      const parsedDataUltimaVisita = toIsoDateInput(form.data_da_ultima_visita);
      const created = await createCliente({
        codigo: form.codigo.trim() || null,
        corte: parsedCorte,
        venc: parsedVenc,
        valor: form.valor ? parseImportCurrency(form.valor) : null,
        data_da_ultima_visita: parsedDataUltimaVisita,
        cep: form.cep.trim() || null,
        empresa: form.empresa.trim() || null,
        pessoa: form.pessoa.trim() || null,
        contato: normalizeContato(form.contato),
        perfil_visita: perfilCreate.perfil || null,
        situacao: form.situacao.trim() || "Ativo",
        endereco: form.endereco.trim() || null,
        complemento: form.complemento.trim() || null,
        bairro: form.bairro.trim() || null,
        cidade: form.cidade.trim() || null,
        uf: form.uf.trim() || null,
      });
      setClientes((prev) => [created, ...prev]);
      if (existingMatches.length > 0) {
        setDuplicateModal({ newCliente: created, existing: existingMatches });
      } else {
        await syncAgendaForCliente(created);
      }
      setForm({
        codigo: "",
        corte: "",
        venc: "",
        valor: "",
        data_da_ultima_visita: "",
        cep: "",
        empresa: "",
        pessoa: "",
        contato: "",
        situacao: "Ativo",
        endereco: "",
        complemento: "",
        bairro: "",
        cidade: "",
        uf: "",
      });
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
      if (mapped.cep) {
        skipCepLookupRef.current = true;
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
        corte: parsedCorte,
        venc: parsedVenc,
        valor: editForm.valor ? parseImportCurrency(editForm.valor) : null,
        data_da_ultima_visita: parsedDataUltimaVisita,
        cep: editForm.cep.trim() || null,
        empresa: editForm.empresa.trim() || null,
        pessoa: editForm.pessoa.trim() || null,
        contato: normalizeContato(editForm.contato),
        perfil_visita: perfilEdit.perfil || null,
        situacao: editForm.situacao.trim() || "Ativo",
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
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar cliente.");
    } finally {
      setSavingEdit(false);
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
      if (mapped.cep) {
        skipCepLookupEditRef.current = true;
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
      "empresa",
      "pessoa",
      "contato",
      "corte",
      "vencimento",
      "valor",
      "data_ultima_visita",
      "perfil_visita",
      "situacao",
      "cidade",
      "uf",
      "endereco",
      "complemento",
      "bairro",
      "cep",
    ];
    const sheet = XLSX.utils.aoa_to_sheet([headers]);
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

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const existingSnapshot = clientes.length ? [...clientes] : await fetchClientes();
    setImporting(true);
    setImportMessage(null);
    setImportProgress(0);
    setImportTotal(0);
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

          const situacaoValue = record.situacao ? normalizeStatus(record.situacao) : null;
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
            corte: parsedCorte,
            venc: parsedVenc,
            valor: parsedValor,
            data_da_ultima_visita: parsedDataUltimaVisita,
            cep: record.cep ?? null,
            empresa: record.empresa ?? null,
            pessoa: record.pessoa ?? null,
            contato: normalizeContato(record.contato ?? ""),
            situacao: situacaoValue ?? record.situacao ?? "Ativo",
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
              corte: payload.corte ?? null,
              venc: payload.venc ?? null,
              valor: payload.valor ?? null,
              data_da_ultima_visita: payload.data_da_ultima_visita ?? null,
              cep: payload.cep ?? null,
              empresa: payload.empresa ?? null,
              pessoa: payload.pessoa ?? null,
              contato: payload.contato ?? null,
              nome_fantasia: null,
              complemento: payload.complemento ?? null,
              perfil_visita: payload.perfil_visita ?? null,
              situacao: payload.situacao ?? "Ativo",
              endereco: payload.endereco ?? null,
              bairro: payload.bairro ?? null,
              cidade: payload.cidade ?? null,
              uf: payload.uf ?? null,
              created_at: null,
            },
            existing: matches,
            isTemp: true,
            payload,
          });
        }
      });

      const checkable = payloads.filter((item) => {
        const cepDigits = sanitizeCep(item.cep ?? "");
        if (cepDigits.length === 8) return true;
        const road = item.endereco?.trim() ?? "";
        const city = item.cidade?.trim() ?? "";
        const state = item.uf?.trim() ?? "";
        return Boolean(road && city && state);
      });

      setImportTotal(checkable.length);

      if (checkable.length > 0) {
        setImportMessage("Checando bairros via API...");
        let processed = 0;
        const lastRequestAt = { current: 0 };
        for (const item of checkable) {
          const cepDigits = sanitizeCep(item.cep ?? "");
          const hasCep = cepDigits.length === 8;
          const road = item.endereco?.trim() ?? "";
          const city = item.cidade?.trim() ?? "";
          const state = item.uf?.trim() ?? "";
          const canCheckAddress = Boolean(road && city && state);
          const hasRequest = hasCep || canCheckAddress;

          if (!hasRequest) {
            processed += 1;
            setImportProgress(processed);
            continue;
          }

          const now = Date.now();
          const wait = Math.max(0, 1000 - (now - lastRequestAt.current));
          if (wait) {
            await delay(wait);
          }
          lastRequestAt.current = Date.now();

          try {
            if (hasCep) {
              const mapped = await fetchNominatimByCep(cepDigits);
              if (mapped?.bairro) {
                item.bairro = mapped.bairro;
              }
            } else if (canCheckAddress) {
              const mapped = await fetchNominatimByAddress(road, city, state);
              if (mapped?.bairro) {
                item.bairro = mapped.bairro;
              }
            }
          } catch {
            // ignore individual lookup errors, keep import running
          } finally {
            processed += 1;
            setImportProgress(processed);
          }
        }
      }

      const created = await upsertClientes(payloads);
      for (const cliente of created) {
        await syncAgendaForCliente(cliente);
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
  const hasPendingDuplicates = Boolean(duplicateModal || duplicateQueue.length > 0);

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
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
            Codigo
            <input
              value={form.codigo}
              onChange={(event) => setForm((prev) => ({ ...prev, codigo: event.target.value }))}
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Empresa
            <input
              value={form.empresa}
              onChange={(event) => setForm((prev) => ({ ...prev, empresa: event.target.value }))}
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Pessoa
            <input
              value={form.pessoa}
              onChange={(event) => setForm((prev) => ({ ...prev, pessoa: event.target.value }))}
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
            Contato
            <input
              value={form.contato}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, contato: formatContato(event.target.value) }))
              }
              inputMode="numeric"
              placeholder="(00) 0 0000 0000"
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
            <label className="w-36 flex flex-col gap-1 text-xs font-semibold text-ink/70">
              Valor
              <input
                value={form.valor}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, valor: formatCurrencyInput(event.target.value) }))
                }
                inputMode="decimal"
                className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
              />
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
                {SITUACAO_OPTIONS.map((option) => (
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
                Endereco
                {!canEditEndereco && (
                  <span className="font-normal text-ink/50"> (Informe cidade e UF para editar o endereco.)</span>
                )}
              </span>
              <div className="flex items-end gap-2">
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
            {bairroLoading && (
              <span className="text-[10px] font-normal text-ink/50 animate-pulse">
                Buscando bairro...
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            CEP
            <div className="flex items-end gap-2">
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
          <p className="text-xs text-ink/60">{clientes.length} empresa(s).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <button
              type="button"
              onClick={() => {
                setImportMessage(null);
                setShowImportModal(true);
              }}
              className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
            >
              Importar empresa
            </button>
          )}
          <select
            value={situacaoFilter}
            onChange={(event) => setSituacaoFilter(event.target.value as "" | "Ativo" | "Inativo")}
            className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
          >
            <option value="">Todas situacoes</option>
            {SITUACAO_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar empresa, cidade, bairro..."
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
            {filteredClientes.length === 0 ? (
              <div className="px-4 py-6 text-sm text-ink/60">Nenhum cliente encontrado.</div>
            ) : (
              filteredClientes.map((cliente) => (
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
              <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-12">
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                  Codigo
                  <input
                    value={editForm.codigo}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, codigo: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-4">
                  Empresa
                  <input
                    value={editForm.empresa}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, empresa: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-3">
                  Pessoa
                  <input
                    value={editForm.pessoa}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, pessoa: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-3">
                  Contato
                  <input
                    value={editForm.contato}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, contato: formatContato(event.target.value) }))
                    }
                    inputMode="numeric"
                    placeholder="(00) 0 0000 0000"
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                    Corte
                    <input
                      value={editForm.corte}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, corte: sanitizeDigits(event.target.value).slice(0, 2) }))
                      }
                      inputMode="numeric"
                      maxLength={2}
                      className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-sm text-ink outline-none focus:border-sea"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                    Venc
                    <input
                      value={editForm.venc}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, venc: sanitizeDigits(event.target.value).slice(0, 2) }))
                      }
                      inputMode="numeric"
                      maxLength={2}
                      className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-sm text-ink outline-none focus:border-sea"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-3">
                    Valor
                    <input
                      value={editForm.valor}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, valor: formatCurrencyInput(event.target.value) }))
                      }
                      inputMode="decimal"
                      className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-5">
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
                      className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-3">
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
                <div className="min-w-0 md:col-span-6">
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
                    <div className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-ink/70">
                      <span>Horarios customizados</span>
                      <div className="flex min-w-0 items-end gap-2 overflow-x-auto pb-1 pr-1">
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
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-3">
                    Situacao
                    <select
                      value={editForm.situacao}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, situacao: event.target.value }))
                      }
                      className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    >
                      <option value="">Selecione</option>
                      {SITUACAO_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-3">
                  Cidade
                  <input
                    value={editForm.cidade}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, cidade: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
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
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-7">
                  <span>
                    Endereco
                    {!canEditEnderecoEdit && (
                      <span className="font-normal text-ink/50"> (Informe cidade e UF para editar o endereco.)</span>
                    )}
                  </span>
                  <div className="flex items-end gap-2">
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
                      title={addressLookupLoadingEdit ? "Buscando endereco..." : "Cadastrar via endereco"}
                      aria-label={addressLookupLoadingEdit ? "Buscando endereco..." : "Cadastrar via endereco"}
                    >
                      <MapPin size={15} className={addressLookupLoadingEdit ? "animate-pulse" : ""} />
                    </button>
                  </div>
                  {addressLookupErrorEdit && (
                    <span className="text-[11px] font-normal text-red-600">{addressLookupErrorEdit}</span>
                  )}
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-4">
                  Complemento
                  <input
                    value={editForm.complemento}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, complemento: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-4">
                  Bairro
                  <input
                    value={editForm.bairro}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, bairro: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                  {bairroLoadingEdit && (
                    <span className="text-[10px] font-normal text-ink/50 animate-pulse">
                      Buscando bairro...
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-4">
                  CEP
                  <div className="flex items-end gap-2">
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
                  ["Valor", selected.valor !== null && selected.valor !== undefined ? formatCurrency(selected.valor) : null],
                  ["Data da ultima visita", formatDate(selected.data_da_ultima_visita)],
                  ["CEP", selected.cep],
                  ["Empresa", selected.empresa],
                  ["Pessoa", selected.pessoa],
                  ["Contato", selected.contato],
                  ["Situacao", selected.situacao ?? "Ativo"],
                  ["Perfil visita", formatPerfilDisplay(selected.perfil_visita)],
                  ["Endereco", selected.endereco],
                  ["Complemento", selected.complemento],
                  ["Bairro", selected.bairro],
                  ["Cidade", selected.cidade],
                  ["UF", selected.uf],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between border-b border-mist/50 pb-2">
                    <span className="text-xs font-semibold text-muted">{label}</span>
                    <span className="text-sm text-ink">{value ?? "-"}</span>
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
                    Checagem de bairros: {importProgress}/{importTotal}
                  </span>
                  <span>
                    Tempo corrido: {formatDuration(importStartedAt ? (importTick - importStartedAt) / 1000 : 0)}
                  </span>
                  <span>
                    Tempo estimado: {formatDuration(Math.max(0, importTotal - importProgress))}
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





