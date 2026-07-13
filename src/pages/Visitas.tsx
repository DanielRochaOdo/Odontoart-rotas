import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, endOfMonth, format, isAfter, isSameDay, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CheckCircle2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Eye,
  GripVertical,
  Lock,
  LockOpen,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import {
  DragDropContext,
  Draggable,
  Droppable,
} from "@hello-pangea/dnd";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { fetchVendedores } from "../lib/agendaApi";
import { emitProfilesUpdated, onProfilesUpdated } from "../lib/profileEvents";
import {
  extractOdontoartPlanoValores,
  fetchEmpresaByEmpresaId,
  fetchObservacaoComercialByEmpresaId,
  type OdontoartPlanoValor,
} from "../lib/odontoartEmpresaApi";
import { normalizeSearchText } from "../lib/textNormalize";
import {
  PERFIL_VISITA_PRESETS,
  extractCustomTimes,
  getSingleTimePerfilBase,
  getSingleTimePerfilValue,
  isPresetPerfilVisita,
  normalizePerfilVisita,
} from "../lib/perfilVisita";
import {
  SUPERVISOR_DESCRICAO_VISITA_OPTIONS,
  SUPERVISOR_VISIT_REASON_OPTIONS,
  VISIT_REGISTER_MODE,
  VISIT_TYPE,
  type SupervisorDescricaoVisita,
} from "../lib/supervisorVisits";

type VisitRow = {
  id: string;
  cliente_id?: string | null;
  visit_date: string;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  visit_type?: string | null;
  supervisor_reason?: string | null;
  register_mode?: string | null;
  visit_time?: string | null;
  perfil_visita: string | null;
  perfil_visita_opcoes?: string | null;
  route_id: string | null;
  completed_at: string | null;
  completed_vidas: number | null;
  no_visit_reason: string | null;
  no_visit_observation: string | null;
  instructions: string | null;
  visit_supervisors?: Array<{ supervisor_user_id: string | null }> | null;
    agenda?: {
      id: string;
      empresa: string | null;
      nome_fantasia: string | null;
      cod_1?: string | null;
      vidas_qtde?: number | null;
      corte?: number | null;
      venc?: number | null;
      valor?: number | null;
      obs_contrato_1?: string | null;
      pessoa: string | null;
      contato: string | null;
      instructions?: string | null;
      endereco: string | null;
      complemento?: string | null;
      bairro: string | null;
      cidade: string | null;
      uf: string | null;
      situacao: string | null;
      categoria?: string | null;
      regra_visita_observacao?: string | null;
      perfil_visita: string | null;
      supervisor?: string | null;
    } | null;
  cliente?: ClienteCanonicalModalRow | null;
};

type VisitRowJoin = VisitRow & {
  cliente?: VisitRow["cliente"] | VisitRow["cliente"][] | null;
};
const VISITS_FETCH_PAGE_SIZE = 1000;

const isVisitRegistered = (
  visit: Pick<VisitRow, "completed_at" | "completed_vidas" | "no_visit_reason">,
) =>
  Boolean(visit.completed_at) ||
  typeof visit.completed_vidas === "number" ||
  Boolean(visit.no_visit_reason?.trim());

type VisitSupervisorRegisterRow = {
  visit_id: string;
  quantidade_vidas: number | null;
  quantidade_funcionarios: number | null;
  descricao_visita: string | null;
  pessoa_contato_mesma: boolean | null;
  pessoa: string | null;
  contato: string | null;
};

type ClienteListRow = {
  id: string;
  codigo: string | null;
  empresa: string | null;
  nome_fantasia: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  situacao: string | null;
  categoria: string | null;
  perfil_visita: string | null;
};

type ClienteDetailsRow = ClienteListRow & {
  vidas_qtde: number | null;
  corte: number | null;
  venc: number | null;
  valor: number | null;
  data_da_ultima_visita: string | null;
  pessoa: string | null;
  contato: string | null;
  obs_comercial: string | null;
  complemento: string | null;
};

type ClienteCanonicalModalRow = ClienteDetailsRow;

type PlanoValoresModalState = {
  codigo: string;
  empresa: string | null;
  valores: OdontoartPlanoValor[];
  loading: boolean;
  error: string | null;
};

const hasPlanoValores = (planos: OdontoartPlanoValor[]) =>
  planos.some((plano) => plano.valorTitular !== null || plano.valorDependente !== null);

const buildMapAddress = (agenda?: VisitRow["agenda"] | null) => {
  if (!agenda) return null;
  const parts = [agenda.endereco, agenda.bairro, agenda.cidade, agenda.uf]
    .filter(Boolean)
    .map((value) => value?.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return `${parts.join(", ")}, Brasil`;
};

const buildMapLinks = (address: string) => {
  const encoded = encodeURIComponent(address);
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent);
  return {
    wazeApp: `waze://?q=${encoded}&navigate=yes`,
    wazeWeb: `https://waze.com/ul?q=${encoded}&navigate=yes`,
    googleApp: isIOS
      ? `comgooglemaps://?daddr=${encoded}&directionsmode=driving`
      : `google.navigation:q=${encoded}`,
    googleWeb: `https://www.google.com/maps/dir/?api=1&destination=${encoded}`,
    uberApp: `uber://?action=setPickup&dropoff[formatted_address]=${encoded}`,
    uberWeb: `https://m.uber.com/ul/?action=setPickup&dropoff[formatted_address]=${encoded}`,
    app99App: `taxis99://?client_id=MAP_123&deep_link_product_id=316`,
    app99Web: `https://m.99app.com/?destination=${encoded}`,
  };
};

type VendorOption = {
  user_id: string;
  display_name: string | null;
  role: string;
  supervisor_id?: string | null;
};

type AddAssigneeOption = {
  user_id: string;
  display_name: string | null;
  role: "VENDEDOR" | "SUPERVISOR";
};

type VendorDashboardAccessModalState = {
  vendorUserId: string;
  vendorName: string;
  releaseDate: string;
  grantAccess: boolean;
};

type AddVendorsModalState = {
  visitId: string;
  companyId: string;
  companyName: string;
  date: string;
  visitType: string | null;
  supervisorReason: string | null;
  supervisorUserIds: string[];
  allowSupervisorAssignees: boolean;
  perfilVisita: string | null;
  perfilVisitaOpcoes: string | null;
  existingAssigneeIds: string[];
  selectedAssigneeIds: string[];
};

const formatDateKey = (value: string) => {
  const directDateMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directDateMatch) return directDateMatch[1];
  return format(new Date(value), "yyyy-MM-dd");
};

const getDateKey = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const toYmd = (year: number, monthIndexZeroBased: number, day: number) => {
  const mm = String(monthIndexZeroBased + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
};

const toDateInput = (value: string | null) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const extractVisitDateKey = (value: string | null | undefined) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return toYmd(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const normalize = (value: string | null) => normalizeSearchText(value);

const CLIENTE_CANONICAL_MODAL_SELECT =
  "id, codigo, vidas_qtde, corte, venc, valor, data_da_ultima_visita, empresa, pessoa, contato, obs_comercial, nome_fantasia, complemento, perfil_visita, situacao, categoria, regra_visita_observacao, endereco, bairro, cidade, uf";
const CLIENTE_LIST_SELECT =
  "id, codigo, empresa, nome_fantasia, endereco, bairro, cidade, uf, situacao, categoria, perfil_visita";
const CLIENTE_DETAILS_SELECT = CLIENTE_CANONICAL_MODAL_SELECT;

const formatCurrency = (value?: number | null) => {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
};

const logPerfDuration = (label: string, startedAt: number) => {
  console.log(label, { durationMs: Math.round(performance.now() - startedAt) });
};

const NO_VISIT_REASONS = [
  "NAO AUTORIZADO",
  "NAO CHEGOU A TEMPO",
  "ENDERECO NAO LOCALIZADO",
  "AUSENTE NO DIA",
];
const SUPERVISOR_REASON_LABEL_BY_VALUE = new Map<string, string>(
  SUPERVISOR_VISIT_REASON_OPTIONS.map((option) => [option.value, option.label]),
);
const SHOW_VENDOR_LOCK_ICON = false;

const isSupervisorVisitType = (value: string | null | undefined) =>
  value === VISIT_TYPE.SUPERVISOR_RELACIONAMENTO;

const applyVendorVisitTypeScope = <TQuery,>(query: TQuery) =>
  (query as TQuery & { or: (filters: string) => TQuery }).or(
    `visit_type.eq.${VISIT_TYPE.VENDEDOR},visit_type.is.null`,
  );

const isMobileDevice = () => {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
};

const attemptOpenApp = (url: string, timeoutMs = 900) =>
  new Promise<boolean>((resolve) => {
    if (!url || typeof window === "undefined" || typeof document === "undefined") {
      resolve(false);
      return;
    }

    let opened = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        opened = true;
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.location.href = url;

    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      resolve(opened);
    }, timeoutMs);
  });

const openMapApp = async (address: string) => {
  const links = buildMapLinks(address);

  if (!isMobileDevice()) {
    window.open(links.googleWeb, "_blank", "noopener,noreferrer");
    return;
  }

  const attempts = [links.wazeApp, links.app99App, links.uberApp, links.googleApp];

  for (const url of attempts) {
    const opened = await attemptOpenApp(url);
    if (opened) return;
  }

  window.location.href = links.googleWeb;
};



export default function Visitas() {
  const { role, session, profile } = useAuth();
  const isVendor = role === "VENDEDOR";
  const canManage = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canManageVendorRouteAccess =
    SHOW_VENDOR_LOCK_ICON && canManage && role !== "SUPERVISOR";
  const canManageInstruction = role === "SUPERVISOR";
  const canAccess = canManage || isVendor;
  const canFilterBySupervisor = role === "ASSISTENTE" || role === "SUPERVISOR";
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorsLoaded, setVendorsLoaded] = useState(false);
  const [editState, setEditState] = useState<Record<string, { vendorId: string; date: string }>>({});
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [routeOrderEditVendor, setRouteOrderEditVendor] = useState<string | null>(null);
  const [routeOrderDraftByVendor, setRouteOrderDraftByVendor] = useState<Record<string, string[]>>({});
  const [routeOrderSavingVendor, setRouteOrderSavingVendor] = useState<string | null>(null);
  const [editingVisits, setEditingVisits] = useState<Record<string, boolean>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [hasUpdatesAvailable, setHasUpdatesAvailable] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addingVendorId, setAddingVendorId] = useState<string | null>(null);
  const [addVendorsModal, setAddVendorsModal] = useState<AddVendorsModalState | null>(null);
  const [addVendorsSaving, setAddVendorsSaving] = useState(false);
  const [addVendorsError, setAddVendorsError] = useState<string | null>(null);
  const [addVendorsQuery, setAddVendorsQuery] = useState("");
  const [maxVisibleDate, setMaxVisibleDate] = useState<string | null>(null);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);
  const [supervisores, setSupervisores] = useState<
    { id: string; user_id: string | null; display_name: string | null }[]
  >([]);
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>("all");
  const [selectedVendorId, setSelectedVendorId] = useState<string>("all");
  const [monthSummaryCounts, setMonthSummaryCounts] = useState<Map<string, number>>(new Map());
  const [dayDetailsByDate, setDayDetailsByDate] = useState<Record<string, VisitRow[]>>({});
  const [dayDetailsLoadingDateKey, setDayDetailsLoadingDateKey] = useState<string | null>(null);
  const [dayDetailsErrorByDate, setDayDetailsErrorByDate] = useState<Record<string, string | null>>({});
  const restoredViewRef = useRef(false);
  const vendorInitialViewRef = useRef(false);
  const lastDayLoadKeyRef = useRef<string | null>(null);
  const lastRouteGateKeyRef = useRef<string | null>(null);
  const clientesLiteCacheRef = useRef(new Map<string, ClienteListRow>());
  const clientesDetailsCacheRef = useRef(new Map<string, ClienteDetailsRow>());
  const pendingModalRestoreRef = useRef<{
    confirmVisitId: string | null;
    noVisit: { id: string; reason: string; observation: string } | null;
    completeVisit:
      | {
          id: string;
          visitType?: string | null;
          supervisorReason?: string | null;
          vidas: string;
          perfil: string;
          visitTime: string;
          registerLikeVendor: boolean;
          quantidadeFuncionarios: string;
          descricaoVisita: SupervisorDescricaoVisita | "";
          pessoaContatoMesma: boolean;
          pessoa: string;
          contato: string;
          customManual: boolean;
          customTime: string;
          singleTimeBase: string;
          singleTimeValue: string;
          customOptions: string[];
          customEditEnabled: boolean;
          instructions: string;
        }
      | null;
  } | null>(null);

  const selectedDateKey = useMemo(
    () => (selectedDate ? format(selectedDate, "yyyy-MM-dd") : ""),
    [selectedDate],
  );
  const currentMonthKey = useMemo(() => format(currentMonth, "yyyy-MM"), [currentMonth]);
  const dayLoadKey = useMemo(
    () =>
      [
        role,
        session?.user.id ?? "",
        profile?.display_name ?? "",
        session?.user.email ?? "",
        selectedDateKey,
        currentMonthKey,
        refreshKey,
        selectedVendorId,
        selectedSupervisorId,
      ].join("|"),
    [
      currentMonthKey,
      profile?.display_name,
      refreshKey,
      role,
      selectedDateKey,
      selectedSupervisorId,
      selectedVendorId,
      session?.user.email,
      session?.user.id,
    ],
  );
  const routeGateKey = useMemo(
    () =>
      [
        role,
        session?.user.id ?? "",
        profile?.display_name ?? "",
        session?.user.email ?? "",
        currentMonthKey,
        refreshKey,
      ].join("|"),
    [currentMonthKey, profile?.display_name, refreshKey, role, session?.user.email, session?.user.id],
  );

  const clearClientesCache = useCallback(() => {
    clientesLiteCacheRef.current.clear();
    clientesDetailsCacheRef.current.clear();
  }, []);

  const hydrateVisitsWithClientes = useCallback(async (rows: VisitRowJoin[], mode: "list" | "details") => {
    const clienteIds = Array.from(
      new Set(
        rows
          .map((item) => item.cliente_id)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const cache = mode === "details" ? clientesDetailsCacheRef.current : clientesLiteCacheRef.current;
    const select = mode === "details" ? CLIENTE_DETAILS_SELECT : CLIENTE_LIST_SELECT;
    const clientesById = new Map<string, ClienteListRow | ClienteDetailsRow>();
    for (let index = 0; index < clienteIds.length; index += 500) {
      const chunk = clienteIds.slice(index, index + 500).filter((id) => !cache.has(id));
      if (chunk.length === 0) continue;
      const { data: clientesChunk, error: clientesError } = await supabase
        .from("clientes")
        .select(select)
        .in("id", chunk);
      if (clientesError) throw new Error(clientesError.message);
      (clientesChunk ?? []).forEach((cliente) => {
        const row = cliente as unknown as ClienteListRow | ClienteDetailsRow;
        cache.set(row.id, row as ClienteListRow & ClienteDetailsRow);
        clientesById.set(row.id, row);
      });
    }

    const agendaFromCliente = (cliente: ClienteListRow | ClienteDetailsRow): NonNullable<VisitRow["agenda"]> => ({
      id: cliente.id,
      empresa: cliente.empresa,
      nome_fantasia: cliente.nome_fantasia,
      cod_1: cliente.codigo,
      corte: "corte" in cliente ? cliente.corte : null,
      venc: "venc" in cliente ? cliente.venc : null,
      valor: "valor" in cliente ? cliente.valor : null,
      obs_contrato_1: "obs_comercial" in cliente ? cliente.obs_comercial : null,
      pessoa: "pessoa" in cliente ? cliente.pessoa : null,
      contato: "contato" in cliente ? cliente.contato : null,
      instructions: null,
      endereco: cliente.endereco,
      complemento: "complemento" in cliente ? cliente.complemento : null,
      bairro: cliente.bairro,
      cidade: cliente.cidade,
      uf: cliente.uf,
      situacao: cliente.situacao,
      categoria: cliente.categoria,
      perfil_visita: cliente.perfil_visita,
      supervisor: null,
      vidas_qtde:
        "vidas_qtde" in cliente
          ? cliente.vidas_qtde
          : "quantidade_vidas" in (cliente as Record<string, unknown>)
            ? ((cliente as Record<string, unknown>).quantidade_vidas as number | null)
            : null,
    });

    return rows.map((row) => {
      const item = row as VisitRowJoin;
      const cliente = item.cliente_id ? clientesById.get(item.cliente_id) ?? cache.get(item.cliente_id) ?? null : null;
      return { ...item, agenda: cliente ? agendaFromCliente(cliente) : null, cliente };
    }) as VisitRow[];
  }, []);

  const invalidateDayDetailsCache = useCallback((dayKey?: string) => {
    if (!dayKey) {
      setDayDetailsByDate({});
      setDayDetailsErrorByDate({});
      setDayDetailsLoadingDateKey(null);
      return;
    }
    setDayDetailsByDate((prev) => {
      if (!prev[dayKey]) return prev;
      const next = { ...prev };
      delete next[dayKey];
      return next;
    });
    setDayDetailsErrorByDate((prev) => {
      if (!(dayKey in prev)) return prev;
      const next = { ...prev };
      delete next[dayKey];
      return next;
    });
    setDayDetailsLoadingDateKey((current) => (current === dayKey ? null : current));
  }, []);

  const patchVisitLocally = useCallback((visitId: string, patch: Partial<VisitRow>) => {
    setVisits((prev) => prev.map((row) => (row.id === visitId ? { ...row, ...patch } : row)));
    setDayDetailsByDate((prev) => {
      const next: Record<string, VisitRow[]> = {};
      Object.entries(prev).forEach(([key, rows]) => {
        next[key] = rows.map((row) => (row.id === visitId ? { ...row, ...patch } : row));
      });
      return next;
    });
  }, []);

  const removeVisitLocally = useCallback((visitId: string) => {
    setVisits((prev) => prev.filter((row) => row.id !== visitId));
    setDayDetailsByDate((prev) => {
      const next: Record<string, VisitRow[]> = {};
      Object.entries(prev).forEach(([key, rows]) => {
        next[key] = rows.filter((row) => row.id !== visitId);
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (restoredViewRef.current) return;
    try {
      const raw = sessionStorage.getItem("visitasViewState");
      if (!raw) {
        restoredViewRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as Partial<{
        currentMonth: string;
        selectedDate: string | null;
        expandedVendor: string | null;
        selectedSupervisorId: string;
        selectedVendorId: string;
      }>;
      if (!isVendor && parsed.currentMonth) setCurrentMonth(new Date(parsed.currentMonth));
      if (!isVendor && parsed.selectedDate) setSelectedDate(new Date(parsed.selectedDate));
      if (parsed.expandedVendor) setExpandedVendor(parsed.expandedVendor);
      if (parsed.selectedSupervisorId) setSelectedSupervisorId(parsed.selectedSupervisorId);
      if (parsed.selectedVendorId) setSelectedVendorId(parsed.selectedVendorId);
      restoredViewRef.current = true;
    } catch {
      restoredViewRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!restoredViewRef.current) return;
    if (isVendor && !vendorInitialViewRef.current) {
      const today = new Date();
      const nextMonth = startOfMonth(today);
      vendorInitialViewRef.current = true;
      setCurrentMonth(nextMonth);
      setSelectedDate(today);
      try {
        sessionStorage.setItem(
          "visitasViewState",
          JSON.stringify({
            currentMonth: nextMonth.toISOString(),
            selectedDate: today.toISOString(),
            expandedVendor,
            selectedSupervisorId,
            selectedVendorId,
          }),
        );
      } catch {
        // ignore
      }
      return;
    }
    const payload = {
      currentMonth: currentMonth.toISOString(),
      selectedDate: selectedDate ? selectedDate.toISOString() : null,
      expandedVendor,
      selectedSupervisorId,
      selectedVendorId,
    };
    try {
      sessionStorage.setItem("visitasViewState", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [currentMonth, expandedVendor, isVendor, selectedDate, selectedSupervisorId, selectedVendorId]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("visitasModalState");
      if (!raw) {
        setRestoredModalState(true);
        return;
      }
      const parsed = JSON.parse(raw) as {
        confirmVisitId?: string | null;
          noVisit?: { id: string; reason: string; observation: string } | null;
        completeVisit?: {
          id: string;
          visitType?: string | null;
          supervisorReason?: string | null;
          vidas: string;
          perfil: string;
          visitTime: string;
          registerLikeVendor: boolean;
          quantidadeFuncionarios: string;
          descricaoVisita: SupervisorDescricaoVisita | "";
          pessoaContatoMesma: boolean;
          pessoa: string;
          contato: string;
          customManual: boolean;
          customTime: string;
          singleTimeBase: string;
          singleTimeValue: string;
          customOptions: string[];
          customEditEnabled: boolean;
          instructions?: string;
        } | null;
      };
	      pendingModalRestoreRef.current = {
	        confirmVisitId: parsed.confirmVisitId ?? null,
	        noVisit: parsed.noVisit ?? null,
	        completeVisit: parsed.completeVisit
	          ? {
	              ...parsed.completeVisit,
	              visitType: parsed.completeVisit.visitType ?? VISIT_TYPE.VENDEDOR,
	              supervisorReason: parsed.completeVisit.supervisorReason ?? null,
	              visitTime: parsed.completeVisit.visitTime ?? "",
	              registerLikeVendor:
	                parsed.completeVisit.registerLikeVendor === undefined
	                  ? true
	                  : Boolean(parsed.completeVisit.registerLikeVendor),
	              quantidadeFuncionarios: parsed.completeVisit.quantidadeFuncionarios ?? "",
	              descricaoVisita: (parsed.completeVisit.descricaoVisita ?? "") as SupervisorDescricaoVisita | "",
	              pessoaContatoMesma:
	                parsed.completeVisit.pessoaContatoMesma === undefined
	                  ? true
	                  : Boolean(parsed.completeVisit.pessoaContatoMesma),
	              pessoa: parsed.completeVisit.pessoa ?? "",
	              contato: parsed.completeVisit.contato ?? "",
	              singleTimeBase: parsed.completeVisit.singleTimeBase ?? "",
	              singleTimeValue: parsed.completeVisit.singleTimeValue ?? "",
	              instructions: parsed.completeVisit.instructions ?? "",
	            }
	          : null,
	      };
    } catch {
      // ignore
    } finally {
      setRestoredModalState(true);
    }
  }, []);
  const [confirmVisit, setConfirmVisit] = useState<VisitRow | null>(null);
  const [noVisit, setNoVisit] = useState<{ id: string; reason: string; observation: string } | null>(null);
  const [restoredModalState, setRestoredModalState] = useState(false);
  const [completeVisit, setCompleteVisit] = useState<{
    id: string;
    visitType?: string | null;
    supervisorReason?: string | null;
    vidas: string;
    perfil: string;
    visitTime: string;
    registerLikeVendor: boolean;
    quantidadeFuncionarios: string;
    descricaoVisita: SupervisorDescricaoVisita | "";
    pessoaContatoMesma: boolean;
    pessoa: string;
    contato: string;
    customManual: boolean;
    customTime: string;
    singleTimeBase: string;
    singleTimeValue: string;
    customOptions: string[];
    customEditEnabled: boolean;
    instructions: string;
  } | null>(null);
  const [detailsVisit, setDetailsVisit] = useState<VisitRow | null>(null);
  const [noVisitObservationModal, setNoVisitObservationModal] = useState<{
    visitId: string;
    seller: string;
    observation: string;
  } | null>(null);
  const [detailsObsExpanded, setDetailsObsExpanded] = useState(false);
  const [detailsObsText, setDetailsObsText] = useState("");
  const [detailsInstructionDraft, setDetailsInstructionDraft] = useState("");
  const [detailsInstructionSaving, setDetailsInstructionSaving] = useState(false);
  const [detailsInstructionMessage, setDetailsInstructionMessage] = useState<string | null>(null);
  const [planoValoresModal, setPlanoValoresModal] = useState<PlanoValoresModalState | null>(null);
  const [vendorDashboardAccessModal, setVendorDashboardAccessModal] =
    useState<VendorDashboardAccessModalState | null>(null);
  const [vendorDashboardAccessSaving, setVendorDashboardAccessSaving] = useState(false);
  const [vendorDashboardAccessError, setVendorDashboardAccessError] = useState<string | null>(null);
  const [releasedVendorIdsForDate, setReleasedVendorIdsForDate] = useState<string[]>([]);
  const detailsObsRequestRef = useRef(0);
  const ignoreRealtimeRef = useRef(0);
  const isInteracting =
    Boolean(confirmVisit) ||
    Boolean(noVisit) ||
    Boolean(completeVisit) ||
    Boolean(detailsVisit) ||
    Boolean(noVisitObservationModal) ||
    Boolean(planoValoresModal) ||
    Boolean(vendorDashboardAccessModal) ||
    Boolean(addVendorsModal) ||
    Object.values(editingVisits).some(Boolean) ||
    savingId !== null ||
    removingId !== null ||
    addingVendorId !== null ||
    detailsInstructionSaving ||
    addVendorsSaving ||
    vendorDashboardAccessSaving;
  const requestRefresh = useCallback(() => {
    ignoreRealtimeRef.current += 1;
    setHasUpdatesAvailable(false);
    setRefreshKey((prev) => prev + 1);
    window.setTimeout(() => {
      ignoreRealtimeRef.current = Math.max(0, ignoreRealtimeRef.current - 1);
    }, 1200);
  }, []);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    setVendorsLoaded(false);
    const loadVendors = () => {
      fetchVendedores()
        .then((data) => {
          if (active) {
            setVendors(data as VendorOption[]);
            setVendorsLoaded(true);
          }
        })
        .catch((err) => {
          if (active) setVendorsLoaded(true);
        });
    };
    const loadSupervisores = async () => {
      const { data, error: supaError } = await supabase
        .from("profiles")
        .select("id, user_id, display_name")
        .eq("role", "SUPERVISOR")
        .order("display_name", { ascending: true });
      if (!active) return;
      if (supaError) {
        setSupervisores([]);
        return;
      }
      setSupervisores(data ?? []);
    };
    loadVendors();
    loadSupervisores();
    const unsubscribe = onProfilesUpdated(() => {
      loadVendors();
      loadSupervisores();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [canManage]);

  useEffect(() => {
    let active = true;
    const startedAt = performance.now();

    const loadMonthSummary = async () => {
      const year = currentMonth.getFullYear();
      const monthIndex = currentMonth.getMonth();
      const startDate = toYmd(year, monthIndex, 1);
      const nextMonthYear = monthIndex === 11 ? year + 1 : year;
      const nextMonthIndex = monthIndex === 11 ? 0 : monthIndex + 1;
      const monthEndExclusive = toYmd(nextMonthYear, nextMonthIndex, 1);
      const rpcAssignedToUserId =
        isVendor
          ? session?.user.id ?? null
          : canManage && selectedVendorId !== "all"
            ? selectedVendorId
            : null;
      const rpcVisitType = isVendor ? VISIT_TYPE.VENDEDOR : null;

      const { data: monthSummaryData, error: monthSummaryError } = await supabase.rpc(
        "get_visits_month_summary_v1",
        {
          p_month_start: startDate,
          p_month_end_exclusive: monthEndExclusive,
          p_assigned_to_user_id: rpcAssignedToUserId,
          p_visit_type: rpcVisitType,
          p_completed_only: null,
        },
      );

      if (!active) return;

      if (monthSummaryError) {
        setMonthSummaryCounts(new Map());
        logPerfDuration("VISITAS_MONTH_SUMMARY", startedAt);
        return;
      }

      const summaryMap = new Map<string, number>();
      (monthSummaryData ?? []).forEach((row: { visit_day?: string | null; total_visits?: number | null }) => {
        const day = String((row as { visit_day?: string | null }).visit_day ?? "");
        const total = Number((row as { total_visits?: number | null }).total_visits ?? 0);
        if (!day) return;
        summaryMap.set(day, total);
      });
      setMonthSummaryCounts(summaryMap);
      logPerfDuration("VISITAS_MONTH_SUMMARY", startedAt);
    };

    void loadMonthSummary().catch(() => {
      if (!active) return;
      setMonthSummaryCounts(new Map());
      logPerfDuration("VISITAS_MONTH_SUMMARY", startedAt);
    });

    return () => {
      active = false;
    };
  }, [canManage, currentMonth, isVendor, refreshKey, selectedVendorId, session?.user.id]);

  useEffect(() => {
    let active = true;
    const startedAt = performance.now();

    if (lastDayLoadKeyRef.current === dayLoadKey) return;
    lastDayLoadKeyRef.current = dayLoadKey;

    const load = async () => {
      if (!active) return;
      setLoading(true);
      setError(null);
      setMaxVisibleDate(null);
      setBlockMessage(null);

      const year = currentMonth.getFullYear();
      const monthIndex = currentMonth.getMonth();
      const startDate = toYmd(year, monthIndex, 1);
      const nextMonthYear = monthIndex === 11 ? year + 1 : year;
      const nextMonthIndex = monthIndex === 11 ? 0 : monthIndex + 1;
      const monthEndExclusive = toYmd(nextMonthYear, nextMonthIndex, 1);
      const assigneeClauses = [
        session?.user.id ? `assigned_to_user_id.eq.${session.user.id}` : null,
        profile?.display_name ? `assigned_to_name.eq.${profile.display_name}` : null,
        session?.user.email ? `assigned_to_name.eq.${session.user.email}` : null,
      ].filter((value): value is string => Boolean(value));
      const applyVendorVisitFilter = <TQuery,>(query: TQuery) => {
        if (assigneeClauses.length > 1) {
          return (query as TQuery & { or: (filters: string) => TQuery }).or(assigneeClauses.join(","));
        }
        if (assigneeClauses.length === 1 && assigneeClauses[0].startsWith("assigned_to_user_id.eq.")) {
          return (query as TQuery & { eq: (column: string, value: string) => TQuery }).eq(
            "assigned_to_user_id",
            assigneeClauses[0].replace("assigned_to_user_id.eq.", ""),
          );
        }
        if (assigneeClauses.length === 1 && assigneeClauses[0].startsWith("assigned_to_name.eq.")) {
          return (query as TQuery & { eq: (column: string, value: string) => TQuery }).eq(
            "assigned_to_name",
            assigneeClauses[0].replace("assigned_to_name.eq.", ""),
          );
        }
        return query;
      };

      const buildVisitsQuery = () => {
        let query = supabase
          .from("visits")
          .select(
            "id, cliente_id, visit_date, assigned_to_user_id, assigned_to_name, visit_type, supervisor_reason, register_mode, visit_time, perfil_visita, perfil_visita_opcoes, route_id, completed_at, completed_vidas, no_visit_reason, no_visit_observation, instructions, visit_supervisors(supervisor_user_id)",
          )
          .gte("visit_date", startDate)
          .lt("visit_date", monthEndExclusive)
          .order("visit_date", { ascending: true });

        if (isVendor) {
          query = applyVendorVisitTypeScope(query);
          query = applyVendorVisitFilter(query);
        }

        return query;
      };

      if (isVendor) {
        const selectedDayQueryStartedAt = performance.now();
        const selectedDayStart = selectedDate
          ? toYmd(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())
          : startDate;
        const nextDay = addDays(new Date(`${selectedDayStart}T12:00:00`), 1);
        const selectedDayEndExclusive = toYmd(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate());

        const { data: dayVisits, error: dayError } = await buildVisitsQuery()
          .gte("visit_date", selectedDayStart)
          .lt("visit_date", selectedDayEndExclusive);
        logPerfDuration("VISITAS_SELECTED_DAY_QUERY", selectedDayQueryStartedAt);

        if (!active) return;

        if (dayError) {
          setError(dayError.message);
          setVisits([]);
        } else {
          const hydrationStartedAt = performance.now();
          const normalizedDayVisits = await hydrateVisitsWithClientes((dayVisits ?? []) as VisitRowJoin[], "list");
          logPerfDuration("VISITAS_CLIENTES_HYDRATION_LITE", hydrationStartedAt);
          setVisits(normalizedDayVisits);
        }

        logPerfDuration("VISITAS_INITIAL_LOAD", startedAt);
        setLoading(false);
        return;
      }

      const data: VisitRowJoin[] = [];
      let from = 0;
      let supaError: { message: string } | null = null;
      const selectedDayQueryStartedAt = performance.now();
      while (true) {
        const { data: pageVisits, error: pageError } = await buildVisitsQuery().range(
          from,
          from + VISITS_FETCH_PAGE_SIZE - 1,
        );
        if (pageError) {
          supaError = pageError;
          break;
        }
        const page = (pageVisits ?? []) as VisitRowJoin[];
        data.push(...page);
        if (page.length < VISITS_FETCH_PAGE_SIZE) break;
        from += VISITS_FETCH_PAGE_SIZE;
      }
      logPerfDuration("VISITAS_SELECTED_DAY_QUERY", selectedDayQueryStartedAt);

      if (!active) return;

      if (supaError) {
        setError(supaError.message);
        setVisits([]);
        setMonthSummaryCounts(new Map());
      } else {
        const hydrationStartedAt = performance.now();
        const normalized = await hydrateVisitsWithClientes(data, "list");
        logPerfDuration("VISITAS_CLIENTES_HYDRATION_LITE", hydrationStartedAt);
        setVisits(normalized);
      }

      if (!active) return;
      logPerfDuration("VISITAS_INITIAL_LOAD", startedAt);
      setLoading(false);
    };

    void load().catch((err) => {
      if (!active) return;
      setError(err instanceof Error ? err.message : "Erro ao carregar visitas.");
      setVisits([]);
      setMonthSummaryCounts(new Map());
      logPerfDuration("VISITAS_INITIAL_LOAD", startedAt);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [dayLoadKey, hydrateVisitsWithClientes, isVendor]);

  useEffect(() => {
    clearClientesCache();
  }, [clearClientesCache, currentMonth, refreshKey]);

  useEffect(() => {
    if (!isVendor) {
      setMaxVisibleDate(null);
      setBlockMessage(null);
      return;
    }

    let active = true;
    if (lastRouteGateKeyRef.current === routeGateKey) return;
    lastRouteGateKeyRef.current = routeGateKey;
    const validateRouteGate = async () => {
      const startedAt = performance.now();
      try {
        const now = new Date();
        const todayKey = getDateKey(now);
        const canUnlockNextRouteByTime = now.getHours() >= 19;
        const endInclusive = format(
          addDays(new Date(`${toYmd(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)}T12:00:00`), -1),
          "yyyy-MM-dd",
        );
        const formatRouteDate = (dateKey: string) =>
          format(new Date(`${dateKey}T12:00:00`), "dd/MM/yyyy");

        const assigneeClauses = [
          session?.user.id ? `assigned_to_user_id.eq.${session.user.id}` : null,
          profile?.display_name ? `assigned_to_name.eq.${profile.display_name}` : null,
          session?.user.email ? `assigned_to_name.eq.${session.user.email}` : null,
        ].filter((value): value is string => Boolean(value));

        const applyVendorVisitFilter = <TQuery,>(query: TQuery) => {
          if (assigneeClauses.length > 1) {
            return (query as TQuery & { or: (filters: string) => TQuery }).or(assigneeClauses.join(","));
          }
          if (assigneeClauses.length === 1 && assigneeClauses[0].startsWith("assigned_to_user_id.eq.")) {
            return (query as TQuery & { eq: (column: string, value: string) => TQuery }).eq(
              "assigned_to_user_id",
              assigneeClauses[0].replace("assigned_to_user_id.eq.", ""),
            );
          }
          if (assigneeClauses.length === 1 && assigneeClauses[0].startsWith("assigned_to_name.eq.")) {
            return (query as TQuery & { eq: (column: string, value: string) => TQuery }).eq(
              "assigned_to_name",
              assigneeClauses[0].replace("assigned_to_name.eq.", ""),
            );
          }
          return query;
        };

        const { data: routeDatesData, error: routeDatesError } = await applyVendorVisitFilter(
          supabase
            .from("visits")
            .select("visit_date")
            .gte("visit_date", startOfMonth(currentMonth).toISOString().slice(0, 10))
            .not("visit_date", "is", null)
            .order("visit_date", { ascending: true }),
        );
        if (routeDatesError) throw new Error(routeDatesError.message);
        const routeDates = Array.from(
          new Set(
            (routeDatesData ?? [])
              .map((row: { visit_date?: string | null }) => row.visit_date)
              .filter((value): value is string => Boolean(value))
              .map((value) => formatDateKey(value)),
          ),
        ).sort();

        let maxDate = endInclusive;
        let blockReason: string | null = null;

        if (routeDates.length > 0) {
          const pastOrTodayDates = routeDates.filter((dateKey) => dateKey <= todayKey);
          const futureDates = routeDates.filter((dateKey) => dateKey > todayKey);

          for (const checkedRouteDate of pastOrTodayDates) {
            const [pendingCount, completedCount, aceiteCount] = await Promise.all([
              applyVendorVisitFilter(
                supabase
                  .from("visits")
                  .select("id", { count: "exact", head: true })
                  .eq("visit_date", checkedRouteDate)
                  .is("completed_at", null),
              ).then(({ count, error }) => {
                if (error) throw error;
                return count ?? 0;
              }),
              applyVendorVisitFilter(
                supabase
                  .from("visits")
                  .select("id", { count: "exact", head: true })
                  .eq("visit_date", checkedRouteDate)
                  .not("completed_at", "is", null)
                  .is("no_visit_reason", null),
              ).then(({ count, error }) => {
                if (error) throw error;
                return count ?? 0;
              }),
              session?.user.id
                ? supabase
                    .from("aceite_digital")
                    .select("id", { count: "exact", head: true })
                    .eq("vendor_user_id", session.user.id)
                    .eq("entry_date", checkedRouteDate)
                    .then(({ count, error }) => {
                      if (error) throw error;
                      return count ?? 0;
                    })
                : Promise.resolve(0),
            ]);

            if (pendingCount > 0) {
              maxDate = checkedRouteDate;
              blockReason = `Conclua todas as visitas da rota (${formatRouteDate(checkedRouteDate)}) para liberar as proximas rotas.`;
              break;
            }

            if (completedCount > 0 && aceiteCount === 0) {
              maxDate = checkedRouteDate;
              blockReason = `Registre o aceite digital da rota (${formatRouteDate(checkedRouteDate)}) para liberar as proximas rotas.`;
              break;
            }

            maxDate = checkedRouteDate;
          }

          if (!blockReason && futureDates.length > 0) {
            const nextRouteDate = futureDates[0];
            if (nextRouteDate) {
              if (!canUnlockNextRouteByTime) {
                blockReason = `A proxima rota (${formatRouteDate(nextRouteDate)}) sera liberada a partir das 19:00.`;
                maxDate = todayKey;
              } else {
                maxDate = nextRouteDate;
              }
            }
          }
        }

        if (!active) return;
        setMaxVisibleDate(maxDate);
        setBlockMessage(blockReason);
        if (isAfter(selectedDate ?? new Date(0), new Date(`${maxDate}T12:00:00`))) {
          setSelectedDate(new Date(`${maxDate}T12:00:00`));
        }
      } catch {
        if (!active) return;
        setMaxVisibleDate(startOfMonth(currentMonth).toISOString().slice(0, 10));
        setBlockMessage("Nao foi possivel validar as pendencias do vendedor. O acesso a proximas rotas foi bloqueado.");
      } finally {
        logPerfDuration("VISITAS_ROUTE_GATE", startedAt);
      }
    };

    void validateRouteGate();
    return () => {
      active = false;
    };
  }, [isVendor, routeGateKey]);

  useEffect(() => {
    const monthStart = toYmd(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const nextMonth = currentMonth.getMonth() === 11
      ? new Date(currentMonth.getFullYear() + 1, 0, 1)
      : new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    const monthEndExclusive = toYmd(nextMonth.getFullYear(), nextMonth.getMonth(), 1);
    const channel = supabase
      .channel(`visitas-month-updates-${monthStart}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "visits" },
        (payload) => {
          if (ignoreRealtimeRef.current > 0) return;
          const candidateDate =
            (payload.new as { visit_date?: string | null } | null)?.visit_date ??
            (payload.old as { visit_date?: string | null } | null)?.visit_date ??
            null;
          const key = extractVisitDateKey(candidateDate);
          if (!key) return;
          if (key < monthStart || key >= monthEndExclusive) return;
          if (isInteracting) return;
          setHasUpdatesAvailable(true);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentMonth, isInteracting]);

  const calendarCells = useMemo(() => {
    const firstDayOfMonth = startOfMonth(currentMonth);
    const lastDayOfMonth = endOfMonth(currentMonth);
    const dayCount = lastDayOfMonth.getDate();
    const leadingEmptyCells = (firstDayOfMonth.getDay() + 6) % 7;
    const cells: Array<Date | null> = [];

    for (let index = 0; index < leadingEmptyCells; index += 1) {
      cells.push(null);
    }

    for (let day = 1; day <= dayCount; day += 1) {
      cells.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day));
    }

    const trailingEmptyCells = (7 - (cells.length % 7)) % 7;
    for (let index = 0; index < trailingEmptyCells; index += 1) {
      cells.push(null);
    }

    return cells;
  }, [currentMonth]);

  const selectableVendors = useMemo(() => {
    if (!canFilterBySupervisor || selectedSupervisorId === "all") return vendors;
    const supervisor = supervisores.find(
      (item) => item.id === selectedSupervisorId || item.user_id === selectedSupervisorId,
    );
    const supervisorIds = new Set<string>();
    if (supervisor?.id) supervisorIds.add(supervisor.id);
    if (supervisor?.user_id) supervisorIds.add(supervisor.user_id);
    if (supervisorIds.size === 0) return [];
    return vendors.filter((vendor) =>
      vendor.supervisor_id ? supervisorIds.has(vendor.supervisor_id) : false,
    );
  }, [canFilterBySupervisor, selectedSupervisorId, supervisores, vendors]);

  const selectedSupervisorUserIds = useMemo(() => {
    if (!canFilterBySupervisor || selectedSupervisorId === "all") return new Set<string>();
    const supervisor = supervisores.find(
      (item) => item.id === selectedSupervisorId || item.user_id === selectedSupervisorId,
    );
    const ids = new Set<string>();
    if (selectedSupervisorId) ids.add(selectedSupervisorId);
    if (supervisor?.id) ids.add(supervisor.id);
    if (supervisor?.user_id) ids.add(supervisor.user_id);
    return ids;
  }, [canFilterBySupervisor, selectedSupervisorId, supervisores]);
  const supervisorUserIdSet = useMemo(
    () => new Set(supervisores.map((item) => item.user_id).filter((value): value is string => Boolean(value))),
    [supervisores],
  );

  const isSupervisorVisitForSelectedSupervisor = useCallback(
    (visit: VisitRow) => {
      if (!isSupervisorVisitType(visit.visit_type) || selectedSupervisorUserIds.size === 0) return false;
      if (visit.assigned_to_user_id && selectedSupervisorUserIds.has(visit.assigned_to_user_id)) return true;
      const supervisorLinks = (visit.visit_supervisors ?? [])
        .map((item) => item.supervisor_user_id)
        .filter((value): value is string => Boolean(value));
      return supervisorLinks.some((id) => selectedSupervisorUserIds.has(id));
    },
    [selectedSupervisorUserIds],
  );

  useEffect(() => {
    if (!canFilterBySupervisor) return;
    setSelectedVendorId((prev) =>
      prev !== "all" && selectableVendors.some((vendor) => vendor.user_id === prev) ? prev : "all",
    );
  }, [canFilterBySupervisor, selectableVendors]);

  const filteredVisits = useMemo(() => {
    let scopedVisits = visits;
    const debugFilter = {
      totalBefore: visits.length,
      selectedSupervisorId,
      selectedVendorId,
      vendorsLoaded,
      supervisorScopedBefore: 0,
      supervisorScopedAfter: 0,
      vendorScopedBefore: 0,
      vendorScopedAfter: 0,
    };

    if (canManage && canFilterBySupervisor && selectedSupervisorId !== "all") {
      if (!vendorsLoaded) return scopedVisits;
      debugFilter.supervisorScopedBefore = scopedVisits.length;
      const vendorIdSet = new Set(selectableVendors.map((vendor) => vendor.user_id).filter(Boolean));
      const vendorNameSet = new Set(
        selectableVendors
          .map((vendor) => vendor.display_name)
          .filter((value): value is string => Boolean(value))
          .map((value) => normalize(value)),
      );

      scopedVisits = scopedVisits.filter((visit) => {
        if (isSupervisorVisitForSelectedSupervisor(visit)) return true;
        if (visit.assigned_to_user_id && vendorIdSet.has(visit.assigned_to_user_id)) return true;
        if (visit.assigned_to_name && vendorNameSet.has(normalize(visit.assigned_to_name))) return true;
        return false;
      });
      debugFilter.supervisorScopedAfter = scopedVisits.length;
    }

    if (canManage && canFilterBySupervisor && selectedVendorId !== "all") {
      debugFilter.vendorScopedBefore = scopedVisits.length;
      const selectedVendor = vendors.find((vendor) => vendor.user_id === selectedVendorId);
      const selectedVendorName = selectedVendor?.display_name ? normalize(selectedVendor.display_name) : "";
      scopedVisits = scopedVisits.filter((visit) => {
        if (visit.assigned_to_user_id && visit.assigned_to_user_id === selectedVendorId) return true;
        if (selectedVendorName && visit.assigned_to_name) {
          return normalize(visit.assigned_to_name) === selectedVendorName;
        }
        return false;
      });
      debugFilter.vendorScopedAfter = scopedVisits.length;
    }

    if (canManage && canFilterBySupervisor) {
      void debugFilter;
    }

    return scopedVisits;
  }, [
    canManage,
    canFilterBySupervisor,
    selectedSupervisorId,
    selectedVendorId,
    selectableVendors,
    isSupervisorVisitForSelectedSupervisor,
    vendorsLoaded,
    vendors,
    visits,
  ]);

  const isSupervisorVisitForLoggedUser = useCallback(
    (visit: VisitRow) => {
      if (role !== "SUPERVISOR" || !session?.user.id || !isSupervisorVisitType(visit.visit_type)) return false;
      if (visit.assigned_to_user_id === session.user.id) return true;
      const supervisorLinks = (visit.visit_supervisors ?? [])
        .map((item) => item.supervisor_user_id)
        .filter((value): value is string => Boolean(value));
      return supervisorLinks.includes(session.user.id);
    },
    [role, session?.user.id],
  );

  const supervisorPinDates = useMemo(() => {
    const dates = new Set<string>();
    filteredVisits.forEach((visit) => {
      if (!visit.visit_date) return;
      const hasSupervisorVisitType = isSupervisorVisitType(visit.visit_type);
      const hasSupervisorLink = (visit.visit_supervisors ?? []).some((item) => Boolean(item.supervisor_user_id));
      const assignedToSupervisor = visit.assigned_to_user_id
        ? supervisorUserIdSet.has(visit.assigned_to_user_id)
        : false;
      if (!hasSupervisorVisitType && !hasSupervisorLink && !assignedToSupervisor) return;
      const key = formatDateKey(visit.visit_date);
      dates.add(key);
    });
    return dates;
  }, [filteredVisits, supervisorUserIdSet]);

  const visitsByDate = useMemo(() => {
    const map = new Map<string, VisitRow[]>();
    filteredVisits.forEach((visit) => {
      if (!visit.visit_date) return;
      const key = formatDateKey(visit.visit_date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(visit);
    });
    return map;
  }, [filteredVisits]);

  useEffect(() => {
    if (!isVendor || !maxVisibleDate || !selectedDate) return;
    const maxDate = new Date(`${maxVisibleDate}T12:00:00`);
    if (isAfter(selectedDate, maxDate)) {
      setSelectedDate(maxDate);
    }
  }, [isVendor, maxVisibleDate, selectedDate]);

  const selectedVisits = useMemo(() => {
    if (!selectedDate) return [] as VisitRow[];
    const selectedDayStart = toYmd(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
    );
    const nextDay = addDays(new Date(`${selectedDayStart}T12:00:00`), 1);
    const selectedDayEndExclusive = toYmd(
      nextDay.getFullYear(),
      nextDay.getMonth(),
      nextDay.getDate(),
    );
    const visitsForDate = filteredVisits.filter((visit) => {
      const visitKey = extractVisitDateKey(visit.visit_date);
      return visitKey >= selectedDayStart && visitKey < selectedDayEndExclusive;
    });
    const fallbackVisitsForDate = (dayDetailsByDate[selectedDayStart] ?? []).filter((visit) => {
      const visitKey = extractVisitDateKey(visit.visit_date);
      return visitKey >= selectedDayStart && visitKey < selectedDayEndExclusive;
    });
    const resolvedVisits = visitsForDate.length > 0 ? visitsForDate : fallbackVisitsForDate;
    const daySummaryTotal = monthSummaryCounts.get(selectedDayStart) ?? 0;
    const isLoadingDayDetails = dayDetailsLoadingDateKey === selectedDayStart;
    const dayDetailsError = dayDetailsErrorByDate[selectedDayStart] ?? null;
    const emptyStateReason =
      daySummaryTotal === 0
        ? "month_summary_zero"
        : isLoadingDayDetails
          ? "loading_day_details"
          : dayDetailsError
            ? "day_details_error"
            : resolvedVisits.length > 0
              ? "day_details_loaded_with_data"
              : "day_details_loaded_empty";
    return [...resolvedVisits].sort((a, b) => {
      const aSupervisor = isSupervisorVisitType(a.visit_type);
      const bSupervisor = isSupervisorVisitType(b.visit_type);
      if (aSupervisor !== bSupervisor) return aSupervisor ? -1 : 1;
      const aName = a.assigned_to_name ?? a.agenda?.empresa ?? "";
      const bName = b.assigned_to_name ?? b.agenda?.empresa ?? "";
      return aName.localeCompare(bName, "pt-BR");
    });
  }, [dayDetailsByDate, dayDetailsErrorByDate, dayDetailsLoadingDateKey, filteredVisits, monthSummaryCounts, selectedDate]);

  const selectedVisitsDayScoped = useMemo(() => {
    if (!canManage || !canFilterBySupervisor) return selectedVisits;
    let scopedVisits = selectedVisits;
    const debugDayFilter = {
      dayKey: selectedDate ? format(selectedDate, "yyyy-MM-dd") : null,
      totalBefore: selectedVisits.length,
      selectedSupervisorId,
      selectedVendorId,
      vendorsLoaded,
      supervisorScopedBefore: 0,
      supervisorScopedAfter: 0,
      vendorScopedBefore: 0,
      vendorScopedAfter: 0,
    };

    if (selectedSupervisorId !== "all") {
      if (!vendorsLoaded) return scopedVisits;
      debugDayFilter.supervisorScopedBefore = scopedVisits.length;
      const vendorIdSet = new Set(selectableVendors.map((vendor) => vendor.user_id).filter(Boolean));
      const vendorNameSet = new Set(
        selectableVendors
          .map((vendor) => vendor.display_name)
          .filter((value): value is string => Boolean(value))
          .map((value) => normalize(value)),
      );

      scopedVisits = scopedVisits.filter((visit) => {
        if (isSupervisorVisitForSelectedSupervisor(visit)) return true;
        if (visit.assigned_to_user_id && vendorIdSet.has(visit.assigned_to_user_id)) return true;
        if (visit.assigned_to_name && vendorNameSet.has(normalize(visit.assigned_to_name))) return true;
        return false;
      });
      debugDayFilter.supervisorScopedAfter = scopedVisits.length;
    }

    if (selectedVendorId !== "all") {
      debugDayFilter.vendorScopedBefore = scopedVisits.length;
      const selectedVendor = vendors.find((vendor) => vendor.user_id === selectedVendorId);
      const selectedVendorName = selectedVendor?.display_name ? normalize(selectedVendor.display_name) : "";
      scopedVisits = scopedVisits.filter((visit) => {
        if (visit.assigned_to_user_id && visit.assigned_to_user_id === selectedVendorId) return true;
        if (selectedVendorName && visit.assigned_to_name) {
          return normalize(visit.assigned_to_name) === selectedVendorName;
        }
        return false;
      });
      debugDayFilter.vendorScopedAfter = scopedVisits.length;
    }

    return scopedVisits;
  }, [
    canFilterBySupervisor,
    canManage,
    isSupervisorVisitForSelectedSupervisor,
    selectableVendors,
    selectedSupervisorId,
    selectedVendorId,
    selectedVisits,
    vendorsLoaded,
    vendors,
  ]);

  useEffect(() => {
    if (!selectedDate) return;

    const selectedDayStart = toYmd(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
    );
    const daySummaryTotal = monthSummaryCounts.get(selectedDayStart) ?? 0;
    const localDayVisits = filteredVisits.filter((visit) => extractVisitDateKey(visit.visit_date) === selectedDayStart);

    if (daySummaryTotal <= 0 || localDayVisits.length > 0 || dayDetailsByDate[selectedDayStart]) {
      return;
    }

    let active = true;
    const loadDayDetails = async () => {
      const nextDay = addDays(new Date(`${selectedDayStart}T12:00:00`), 1);
      const selectedDayEndExclusive = toYmd(
        nextDay.getFullYear(),
        nextDay.getMonth(),
        nextDay.getDate(),
      );

      setDayDetailsLoadingDateKey(selectedDayStart);
      setDayDetailsErrorByDate((prev) => ({ ...prev, [selectedDayStart]: null }));

      const startedAt = performance.now();
      let query = supabase
        .from("visits")
        .select(
          "id, cliente_id, visit_date, assigned_to_user_id, assigned_to_name, visit_type, supervisor_reason, register_mode, visit_time, perfil_visita, perfil_visita_opcoes, route_id, completed_at, completed_vidas, no_visit_reason, no_visit_observation, instructions, visit_supervisors(supervisor_user_id)",
        )
        .gte("visit_date", selectedDayStart)
        .lt("visit_date", selectedDayEndExclusive)
        .order("visit_date", { ascending: true });

      if (isVendor) {
        query = applyVendorVisitTypeScope(query);
        if (session?.user.id) {
          query = query.eq("assigned_to_user_id", session.user.id);
        }
      }

      if (canManage && selectedVendorId !== "all") {
        query = query.eq("assigned_to_user_id", selectedVendorId);
      }

      const { data, error: dayError } = await query;
      if (!active) return;


      if (dayError) {
        setDayDetailsErrorByDate((prev) => ({ ...prev, [selectedDayStart]: dayError.message }));
        setDayDetailsLoadingDateKey((current) => (current === selectedDayStart ? null : current));
        return;
      }

      const normalized = await hydrateVisitsWithClientes((data ?? []) as VisitRowJoin[], "list");
      let scopedDayDetails = normalized;
      if (canManage && canFilterBySupervisor && selectedSupervisorId !== "all") {
        if (vendorsLoaded) {
          const vendorIdSet = new Set(selectableVendors.map((vendor) => vendor.user_id).filter(Boolean));
          const vendorNameSet = new Set(
            selectableVendors
              .map((vendor) => vendor.display_name)
              .filter((value): value is string => Boolean(value))
              .map((value) => normalize(value)),
          );

          scopedDayDetails = scopedDayDetails.filter((visit) => {
            if (isSupervisorVisitForSelectedSupervisor(visit)) return true;
            if (visit.assigned_to_user_id && vendorIdSet.has(visit.assigned_to_user_id)) return true;
            if (visit.assigned_to_name && vendorNameSet.has(normalize(visit.assigned_to_name))) return true;
            return false;
          });
        }
      }
      setDayDetailsByDate((prev) => ({ ...prev, [selectedDayStart]: scopedDayDetails }));
      setDayDetailsLoadingDateKey((current) => (current === selectedDayStart ? null : current));
    };

    void loadDayDetails().catch((error) => {
      if (!active) return;
      setDayDetailsErrorByDate((prev) => ({
        ...prev,
        [selectedDayStart]: error instanceof Error ? error.message : "Erro ao carregar detalhes do dia.",
      }));
      setDayDetailsLoadingDateKey((current) => (current === selectedDayStart ? null : current));
    });

    return () => {
      active = false;
    };
  }, [
    canFilterBySupervisor,
    canManage,
    dayDetailsByDate,
    filteredVisits,
    hydrateVisitsWithClientes,
    isSupervisorVisitForSelectedSupervisor,
    isVendor,
    monthSummaryCounts,
    selectableVendors,
    selectedDate,
    selectedSupervisorId,
    selectedVendorId,
    session?.user.id,
    supervisores,
    vendorsLoaded,
  ]);

  useEffect(() => {
    if (!restoredModalState) return;
    const pending = pendingModalRestoreRef.current;
    if (!pending) return;

    if (!confirmVisit && pending.confirmVisitId) {
      const visit = visits.find((item) => item.id === pending.confirmVisitId);
      if (visit) setConfirmVisit(visit);
    }

    if (!noVisit && pending.noVisit) {
      const visitExists = visits.some((item) => item.id === pending.noVisit?.id);
      if (visitExists) {
        setNoVisit(pending.noVisit);
      }
    }

    if (!completeVisit && pending.completeVisit) {
      const visitExists = visits.some((item) => item.id === pending.completeVisit?.id);
      if (visitExists) {
        setCompleteVisit(pending.completeVisit);
      }
    }

    pendingModalRestoreRef.current = null;
  }, [completeVisit, confirmVisit, noVisit, restoredModalState, visits]);

  useEffect(() => {
    if (!restoredModalState) return;
    const payload = {
      confirmVisitId: confirmVisit?.id ?? null,
      noVisit,
      completeVisit,
    };
    try {
      sessionStorage.setItem("visitasModalState", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [completeVisit, confirmVisit, noVisit, restoredModalState]);

  const vendorById = useMemo(
    () => new Map(vendors.map((vendor) => [vendor.user_id, vendor])),
    [vendors],
  );
  const supervisorByUserId = useMemo(
    () =>
      new Map(
        supervisores
          .filter((supervisor) => Boolean(supervisor.user_id))
          .map((supervisor) => [supervisor.user_id as string, supervisor]),
      ),
    [supervisores],
  );
  const supervisorByName = useMemo(() => {
    const map = new Map<string, { id: string; user_id: string | null; display_name: string | null }>();
    supervisores.forEach((supervisor) => {
      const normalizedName = normalize(supervisor.display_name);
      if (!normalizedName || map.has(normalizedName)) return;
      map.set(normalizedName, supervisor);
    });
    return map;
  }, [supervisores]);
  const selectableSupervisores = useMemo(
    () =>
      supervisores
        .filter((supervisor): supervisor is { id: string; user_id: string; display_name: string | null } =>
          Boolean(supervisor.user_id),
        )
        .map((supervisor) => ({
          user_id: supervisor.user_id,
          display_name: supervisor.display_name ?? "Supervisor",
        })),
    [supervisores],
  );
  const supervisorRouteAssignees = useMemo<AddAssigneeOption[]>(() => {
    const byUserId = new Map<string, AddAssigneeOption>();
    vendors.forEach((vendor) => {
      if (!vendor.user_id) return;
      byUserId.set(vendor.user_id, {
        user_id: vendor.user_id,
        display_name: vendor.display_name ?? vendor.user_id,
        role: "VENDEDOR",
      });
    });
    selectableSupervisores.forEach((supervisor) => {
      if (!supervisor.user_id) return;
      if (byUserId.has(supervisor.user_id)) return;
      byUserId.set(supervisor.user_id, {
        user_id: supervisor.user_id,
        display_name: supervisor.display_name ?? supervisor.user_id,
        role: "SUPERVISOR",
      });
    });
    return Array.from(byUserId.values()).sort((a, b) =>
      (a.display_name ?? a.user_id).localeCompare(b.display_name ?? b.user_id, "pt-BR"),
    );
  }, [selectableSupervisores, vendors]);
  const supervisorRouteAssigneeById = useMemo(
    () => new Map(supervisorRouteAssignees.map((assignee) => [assignee.user_id, assignee])),
    [supervisorRouteAssignees],
  );
  const vendorByName = useMemo(() => {
    const map = new Map<string, VendorOption>();
    vendors.forEach((vendor) => {
      const normalizedName = normalize(vendor.display_name);
      if (!normalizedName || map.has(normalizedName)) return;
      map.set(normalizedName, vendor);
    });
    return map;
  }, [vendors]);
  const addVendorsList = useMemo(() => {
    const options: AddAssigneeOption[] =
      addVendorsModal?.allowSupervisorAssignees
        ? supervisorRouteAssignees
        : vendors.map((vendor) => ({
            user_id: vendor.user_id,
            display_name: vendor.display_name ?? vendor.user_id,
            role: "VENDEDOR" as const,
          }));
    if (!addVendorsQuery.trim()) return options;
    const query = normalizeSearchText(addVendorsQuery);
    return options.filter((assignee) =>
      normalizeSearchText(assignee.display_name ?? assignee.user_id).includes(query),
    );
  }, [addVendorsModal?.allowSupervisorAssignees, addVendorsQuery, supervisorRouteAssignees, vendors]);
  useEffect(() => {
    invalidateDayDetailsCache();
  }, [invalidateDayDetailsCache, selectedSupervisorId, selectedVendorId, currentMonth]);
  const groupedBySeller = useMemo(() => {
    const groups: Record<string, VisitRow[]> = {};
    selectedVisitsDayScoped.forEach((visit) => {
      const seller =
        visit.assigned_to_name ??
        (visit.assigned_to_user_id
          ? vendorById.get(visit.assigned_to_user_id)?.display_name
          : null) ??
        "Sem vendedor";
      if (!groups[seller]) groups[seller] = [];
      groups[seller].push(visit);
    });
    return Object.entries(groups)
      .map(([seller, items]) => [
        seller,
        [...items].sort((a, b) => {
          const aSupervisor = isSupervisorVisitType(a.visit_type);
          const bSupervisor = isSupervisorVisitType(b.visit_type);
          if (aSupervisor !== bSupervisor) return aSupervisor ? -1 : 1;
          const aEmpresa = a.agenda?.empresa ?? a.agenda?.nome_fantasia ?? "";
          const bEmpresa = b.agenda?.empresa ?? b.agenda?.nome_fantasia ?? "";
          return aEmpresa.localeCompare(bEmpresa, "pt-BR");
        }),
      ] as const)
      .sort((a, b) => {
        const aHasSupervisor = a[1].some((visit) => isSupervisorVisitType(visit.visit_type));
        const bHasSupervisor = b[1].some((visit) => isSupervisorVisitType(visit.visit_type));
        if (aHasSupervisor !== bHasSupervisor) return aHasSupervisor ? -1 : 1;
        return a[0].localeCompare(b[0], "pt-BR");
      });
  }, [selectedVisitsDayScoped, vendorById]);
  const releasedVendorIdSet = useMemo(
    () => new Set(releasedVendorIdsForDate),
    [releasedVendorIdsForDate],
  );

  const resolveSellerVendor = useCallback((seller: string, items: VisitRow[]) => {
    for (const item of items) {
      if (!item.assigned_to_user_id) continue;
      const matched = vendorById.get(item.assigned_to_user_id);
      if (matched) return matched;
    }
    const normalizedSeller = normalize(seller);
    if (!normalizedSeller) return null;
    return vendorByName.get(normalizedSeller) ?? null;
  }, [vendorById, vendorByName]);

  useEffect(() => {
    let active = true;

    const loadVendorRouteReleaseByDate = async () => {
      if (!canManageVendorRouteAccess || !selectedDateKey) {
        setReleasedVendorIdsForDate([]);
        return;
      }

      const vendorIds = Array.from(
        new Set(
          groupedBySeller
            .map(([seller, items]) => resolveSellerVendor(seller, items)?.user_id ?? "")
            .filter(Boolean),
        ),
      );

      if (vendorIds.length === 0) {
        setReleasedVendorIdsForDate([]);
        return;
      }

      const { data, error: releasesError } = await supabase
        .from("vendor_next_route_releases")
        .select("vendor_user_id")
        .eq("release_date", selectedDateKey)
        .in("vendor_user_id", vendorIds);

      if (!active) return;
      if (releasesError) {
        setReleasedVendorIdsForDate([]);
        return;
      }

      const next = (data ?? [])
        .map((item) => item.vendor_user_id)
        .filter((value): value is string => Boolean(value));
      setReleasedVendorIdsForDate(next);
    };

    void loadVendorRouteReleaseByDate();
    return () => {
      active = false;
    };
  }, [canManageVendorRouteAccess, groupedBySeller, resolveSellerVendor, selectedDateKey]);

  useEffect(() => {
    if (!visits.length) {
      setEditState({});
      setEditingVisits({});
      return;
    }
    setEditState((prev) => {
      const next: Record<string, { vendorId: string; date: string }> = { ...prev };
      const resolveAssigneeId = (visit: VisitRow) => {
        const normalizedName = normalize(visit.assigned_to_name);
        if (isSupervisorVisitType(visit.visit_type)) {
          if (visit.assigned_to_user_id && supervisorByUserId.has(visit.assigned_to_user_id)) {
            return visit.assigned_to_user_id;
          }
          const matchedSupervisor = normalizedName ? supervisorByName.get(normalizedName) : undefined;
          return matchedSupervisor?.user_id ?? visit.assigned_to_user_id ?? "";
        }

        if (visit.assigned_to_user_id && vendorById.has(visit.assigned_to_user_id)) {
          return visit.assigned_to_user_id;
        }
        const matchedVendor = normalizedName ? vendorByName.get(normalizedName) : undefined;
        return matchedVendor?.user_id ?? visit.assigned_to_user_id ?? "";
      };
      const validIds = new Set(visits.map((visit) => visit.id));
      Object.keys(next).forEach((id) => {
        if (!validIds.has(id)) {
          delete next[id];
        }
      });
      visits.forEach((visit) => {
        const resolvedAssigneeId = resolveAssigneeId(visit);
        if (!next[visit.id]) {
          next[visit.id] = {
            vendorId: resolvedAssigneeId,
            date: toDateInput(visit.visit_date),
          };
        } else {
          if (!next[visit.id].date) {
            next[visit.id].date = toDateInput(visit.visit_date);
          }
          if (!next[visit.id].vendorId) {
            if (resolvedAssigneeId) {
              next[visit.id].vendorId = resolvedAssigneeId;
            }
          }
        }
      });
      return next;
    });
    setEditingVisits((prev) => {
      const next: Record<string, boolean> = { ...prev };
      const validIds = new Set(visits.map((visit) => visit.id));
      Object.keys(next).forEach((id) => {
        if (!validIds.has(id)) delete next[id];
      });
      return next;
    });
  }, [supervisorByName, supervisorByUserId, vendorById, vendorByName, visits]);

  const ensureRoute = async (vendorId: string, vendorName: string, dateValue: string) => {
    const { data: existing, error } = await supabase
      .from("routes")
      .select("id")
      .eq("assigned_to_user_id", vendorId)
      .eq("date", dateValue)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (existing?.id) {
      return existing.id as string;
    }

    const displayDate = format(new Date(`${dateValue}T12:00:00`), "dd/MM/yyyy");
    const { data: created, error: createError } = await supabase
      .from("routes")
      .insert({
        name: `Visitas ${displayDate} - ${vendorName || "Responsavel"}`,
        date: dateValue,
        assigned_to_user_id: vendorId,
        created_by: session?.user.id ?? null,
      })
      .select("id")
      .single();

    if (createError || !created) {
      throw new Error(createError?.message ?? "Erro ao criar rota.");
    }

    return created.id as string;
  };

  const getNextStopOrder = async (routeId: string) => {
    const { count, error } = await supabase
      .from("route_stops")
      .select("id", { count: "exact", head: true })
      .eq("route_id", routeId);

    if (error) {
      throw new Error(error.message);
    }

    return (count ?? 0) + 1;
  };

  const ensureRouteStop = async (routeId: string, empresaId: string) => {
    const { data: existing, error } = await supabase
      .from("route_stops")
      .select("id")
      .eq("route_id", routeId)
      .eq("cliente_id", empresaId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (existing?.id) return;

    const stopOrder = await getNextStopOrder(routeId);
    const { error: insertError } = await supabase.from("route_stops").insert({
      route_id: routeId,
      cliente_id: empresaId,
      stop_order: stopOrder,
    });
    if (insertError) throw new Error(insertError.message);
  };

  const getVendorRouteOrder = (seller: string, items: VisitRow[]) => {
    const savedOrder = routeOrderDraftByVendor[seller];
    const itemIds = items.map((item) => item.id);
    if (!savedOrder || savedOrder.length === 0) return itemIds;
    const savedSet = new Set(savedOrder);
    const next = [...savedOrder.filter((id) => itemIds.includes(id)), ...itemIds.filter((id) => !savedSet.has(id))];
    return next;
  };

  const reorderList = (list: string[], startIndex: number, endIndex: number) => {
    const result = [...list];
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return result;
  };

  const startVendorRouteOrderEdit = (seller: string, items: VisitRow[]) => {
    setExpandedVendor(seller);
    setRouteOrderEditVendor(seller);
    setRouteOrderDraftByVendor((prev) => ({
      ...prev,
      [seller]: getVendorRouteOrder(seller, items),
    }));
  };

  const saveVendorRouteOrder = async (seller: string, orderedItems: VisitRow[]) => {
    if (orderedItems.length === 0) return;

    setRouteOrderSavingVendor(seller);
    try {
      const routeGroups = new Map<string, VisitRow[]>();
      orderedItems.forEach((item) => {
        if (!item.route_id) return;
        if (!routeGroups.has(item.route_id)) routeGroups.set(item.route_id, []);
        routeGroups.get(item.route_id)!.push(item);
      });

      for (const [routeId, routeItems] of routeGroups.entries()) {
        const updates = routeItems
          .filter((item) => Boolean(item.cliente_id))
          .map((item, index) =>
            supabase
              .from("route_stops")
              .update({ stop_order: index + 1 })
              .eq("route_id", routeId)
              .eq("cliente_id", item.cliente_id as string),
          );
        for (const update of updates) {
          const { error } = await update;
          if (error) throw new Error(error.message);
        }
      }

      setRouteOrderEditVendor(null);
      setRouteOrderDraftByVendor((prev) => ({
        ...prev,
        [seller]: orderedItems.map((item) => item.id),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar ordenacao.");
    } finally {
      setRouteOrderSavingVendor(null);
    }
  };

  const handleSaveVisit = async (visitId: string, visitInput?: VisitRow) => {
    const visit = visitInput ?? visits.find((item) => item.id === visitId);
    if (!visit) {
      setError("Visita nao encontrada para edicao.");
      return;
    }
    const state = editState[visitId] ?? {
      vendorId: visit.assigned_to_user_id ?? "",
      date: toDateInput(visit.visit_date),
    };
    const previousDateKey = toDateInput(visit.visit_date);
    if (!state.date) {
      setError("Selecione a data da visita.");
      return;
    }
    const isSupervisorVisit = isSupervisorVisitType(visit.visit_type);
    if (!state.vendorId) {
      setError(isSupervisorVisit ? "Selecione o responsavel." : "Selecione o vendedor.");
      return;
    }
    const companyId = visit.cliente_id ?? null;
    if (!companyId) {
      setError("Empresa da visita nao encontrada.");
      return;
    }
    if (visit.completed_at) {
      setError("Visita registrada. Edicao bloqueada.");
      return;
    }

    const assigneeOption = isSupervisorVisit
      ? supervisorRouteAssigneeById.get(state.vendorId)
      : vendorById.get(state.vendorId);
    const assigneeName =
      assigneeOption?.display_name ??
      assigneeOption?.user_id ??
      visit.assigned_to_name ??
      (isSupervisorVisit ? "Sem responsavel" : "Sem vendedor");
    const supervisorUserIdsToLink = isSupervisorVisit
      ? Array.from(
          new Set(
            [
              ...(visit.assigned_to_user_id && supervisorByUserId.has(visit.assigned_to_user_id)
                ? [visit.assigned_to_user_id]
                : []),
              ...(supervisorByUserId.has(state.vendorId) ? [state.vendorId] : []),
              ...(visit.visit_supervisors ?? [])
                .map((item) => item.supervisor_user_id)
                .filter((value): value is string => Boolean(value)),
            ].filter(Boolean),
          ),
        )
      : [];
    const syncSupervisorLinks = async (targetVisitId: string) => {
      if (!isSupervisorVisit || supervisorUserIdsToLink.length === 0) return;
      const linkRows = supervisorUserIdsToLink.map((supervisorUserId) => ({
        visit_id: targetVisitId,
        supervisor_user_id: supervisorUserId,
        created_by: session?.user.id ?? null,
      }));
      const { error: linkError } = await supabase.from("visit_supervisors").upsert(linkRows, {
        onConflict: "visit_id,supervisor_user_id",
        ignoreDuplicates: true,
      });
      if (linkError) throw new Error(linkError.message);
    };

    setSavingId(visitId);
    setError(null);
    try {
      const routeId = await ensureRoute(state.vendorId, assigneeName, state.date);
      const { data: targetVisit, error: targetVisitError } = await supabase
        .from("visits")
        .select("id, route_id, assigned_to_name")
        .eq("cliente_id", companyId)
        .eq("assigned_to_user_id", state.vendorId)
        .eq("visit_date", state.date)
        .neq("id", visitId)
        .maybeSingle();
      if (targetVisitError) throw new Error(targetVisitError.message);

      if (targetVisit?.id) {
        if (targetVisit.route_id !== routeId || normalize(targetVisit.assigned_to_name) !== normalize(assigneeName)) {
          const { error: updateTargetError } = await supabase
            .from("visits")
            .update({
              assigned_to_name: assigneeName,
              route_id: routeId,
            })
            .eq("id", targetVisit.id);
          if (updateTargetError) throw new Error(updateTargetError.message);
        }

        if (visit.route_id && visit.route_id !== routeId) {
          const { error: deleteStopError } = await supabase
            .from("route_stops")
            .delete()
            .eq("route_id", visit.route_id)
            .eq("cliente_id", companyId);
          if (deleteStopError) throw new Error(deleteStopError.message);
        }

        await ensureRouteStop(routeId, companyId);
        await syncSupervisorLinks(targetVisit.id);

        const { error: deleteError } = await supabase.from("visits").delete().eq("id", visitId);
        if (deleteError) throw new Error(deleteError.message);

        patchVisitLocally(targetVisit.id, {
          assigned_to_user_id: state.vendorId,
          assigned_to_name: assigneeName,
          visit_date: state.date,
          route_id: routeId,
        });
        removeVisitLocally(visitId);
        setEditingVisits((prev) => ({ ...prev, [visitId]: false }));
        invalidateDayDetailsCache(previousDateKey);
        invalidateDayDetailsCache(state.date);
        requestRefresh();
        return;
      }

      if (visit.route_id && visit.route_id !== routeId) {
        const { error: deleteStopError } = await supabase
          .from("route_stops")
          .delete()
          .eq("route_id", visit.route_id)
          .eq("cliente_id", companyId);
        if (deleteStopError) throw new Error(deleteStopError.message);
      }

      await ensureRouteStop(routeId, companyId);

      const { error: updateError } = await supabase
        .from("visits")
        .update({
          assigned_to_user_id: state.vendorId,
          assigned_to_name: assigneeName,
          visit_date: state.date,
          route_id: routeId,
        })
        .eq("id", visitId);

      if (updateError) throw new Error(updateError.message);
      await syncSupervisorLinks(visitId);

      patchVisitLocally(visitId, {
        assigned_to_user_id: state.vendorId,
        assigned_to_name: assigneeName,
        visit_date: state.date,
        route_id: routeId,
      });
      setEditingVisits((prev) => ({ ...prev, [visitId]: false }));
      invalidateDayDetailsCache(previousDateKey);
      invalidateDayDetailsCache(state.date);
      requestRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar visita.");
    } finally {
      setSavingId(null);
    }
  };

  const handleAddVendorToVisit = async (visitId: string, visitInput?: VisitRow) => {
    const visit = visitInput ?? visits.find((item) => item.id === visitId);
    if (!visit) {
      setError("Visita nao encontrada para adicionar responsavel.");
      return;
    }
    const state = editState[visitId] ?? {
      vendorId: visit.assigned_to_user_id ?? "",
      date: toDateInput(visit.visit_date),
    };
    if (!state.date) {
      setError("Selecione a data da visita.");
      return;
    }
    const isSupervisorVisit = isSupervisorVisitType(visit.visit_type);
    const companyId = visit.cliente_id ?? null;
    if (!companyId) {
      setError("Empresa da visita nao encontrada.");
      return;
    }
    if (visit.completed_at) {
      setError("Visita registrada. Edicao bloqueada.");
      return;
    }

    setAddingVendorId(visitId);
    setAddVendorsError(null);
    setAddVendorsQuery("");
    setError(null);
    try {
      const { data: existingVisits, error: existingVisitsError } = await supabase
        .from("visits")
        .select("assigned_to_user_id, assigned_to_name")
        .eq("cliente_id", companyId)
        .eq("visit_date", state.date);
      if (existingVisitsError) throw new Error(existingVisitsError.message);

      const addAssigneeOptions: AddAssigneeOption[] = isSupervisorVisit
        ? supervisorRouteAssignees
        : vendors.map((vendor) => ({
            user_id: vendor.user_id,
            display_name: vendor.display_name ?? vendor.user_id,
            role: "VENDEDOR" as const,
          }));
      const addAssigneeByName = new Map<string, AddAssigneeOption>();
      addAssigneeOptions.forEach((option) => {
        const normalizedName = normalize(option.display_name);
        if (!normalizedName || addAssigneeByName.has(normalizedName)) return;
        addAssigneeByName.set(normalizedName, option);
      });

      const existingAssigneeIdsSet = new Set<string>();
      const existingAssigneeNamesSet = new Set<string>();
      (existingVisits ?? []).forEach((row) => {
        if (row.assigned_to_user_id) existingAssigneeIdsSet.add(row.assigned_to_user_id);
        if (row.assigned_to_name) existingAssigneeNamesSet.add(normalize(row.assigned_to_name));
      });
      existingAssigneeNamesSet.forEach((normalizedName) => {
        const matched = addAssigneeByName.get(normalizedName);
        if (matched?.user_id) {
          existingAssigneeIdsSet.add(matched.user_id);
        }
      });

      const preferredVendorId = state.vendorId;
      const initialSelection =
        preferredVendorId && !existingAssigneeIdsSet.has(preferredVendorId)
          ? [preferredVendorId]
          : [];
      const supervisorUserIdsSet = new Set<string>(
        (visit.visit_supervisors ?? [])
          .map((item) => item.supervisor_user_id)
          .filter((value): value is string => Boolean(value)),
      );
      if (visit.assigned_to_user_id && supervisorByUserId.has(visit.assigned_to_user_id)) {
        supervisorUserIdsSet.add(visit.assigned_to_user_id);
      }
      if (role === "SUPERVISOR" && session?.user.id) {
        supervisorUserIdsSet.add(session.user.id);
      }

      setAddVendorsModal({
        visitId,
        companyId,
        companyName: visit.agenda?.empresa ?? visit.agenda?.nome_fantasia ?? "Sem nome",
        date: state.date,
        visitType: visit.visit_type ?? VISIT_TYPE.VENDEDOR,
        supervisorReason: visit.supervisor_reason ?? null,
        supervisorUserIds: Array.from(supervisorUserIdsSet),
        allowSupervisorAssignees: isSupervisorVisit,
        perfilVisita: visit.perfil_visita ?? null,
        perfilVisitaOpcoes: visit.perfil_visita_opcoes ?? null,
        existingAssigneeIds: Array.from(existingAssigneeIdsSet),
        selectedAssigneeIds: initialSelection,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar responsaveis para adicionar.");
    } finally {
      setAddingVendorId(null);
    }
  };

  const toggleVendorInAddModal = (vendorId: string) => {
    if (!addVendorsModal) return;
    if (addVendorsModal.existingAssigneeIds.includes(vendorId)) return;
    setAddVendorsModal((prev) => {
      if (!prev) return prev;
      const selectedSet = new Set(prev.selectedAssigneeIds);
      if (selectedSet.has(vendorId)) {
        selectedSet.delete(vendorId);
      } else {
        selectedSet.add(vendorId);
      }
      return {
        ...prev,
        selectedAssigneeIds: Array.from(selectedSet),
      };
    });
  };

  const handleSaveAddVendors = async () => {
    if (!addVendorsModal) return;
    const selectedVendorIds = Array.from(new Set(addVendorsModal.selectedAssigneeIds));
    if (selectedVendorIds.length === 0) {
      setAddVendorsError(
        addVendorsModal.allowSupervisorAssignees
          ? "Selecione pelo menos um responsavel."
          : "Selecione pelo menos um vendedor.",
      );
      return;
    }

    setAddVendorsSaving(true);
    setAddVendorsError(null);
    setError(null);
    try {
      let createdCount = 0;
      const knownExisting = new Set(addVendorsModal.existingAssigneeIds);
      const isSupervisorRouteVisit = isSupervisorVisitType(addVendorsModal.visitType);

      for (const vendorId of selectedVendorIds) {
        if (knownExisting.has(vendorId)) continue;
        const assignee = isSupervisorRouteVisit
          ? supervisorRouteAssigneeById.get(vendorId)
          : vendorById.get(vendorId);
        if (!assignee) continue;
        const vendorName =
          assignee.display_name ?? assignee.user_id ?? (isSupervisorRouteVisit ? "Sem responsavel" : "Sem vendedor");

        const { data: existingVisit, error: existingVisitError } = await supabase
          .from("visits")
          .select("id")
          .eq("cliente_id", addVendorsModal.companyId)
          .eq("assigned_to_user_id", vendorId)
          .eq("visit_date", addVendorsModal.date)
          .maybeSingle();
        if (existingVisitError) throw new Error(existingVisitError.message);
        if (existingVisit?.id) {
          knownExisting.add(vendorId);
          continue;
        }

        const routeId = await ensureRoute(vendorId, vendorName, addVendorsModal.date);
        const insertPayload: Record<string, unknown> = {
          cliente_id: addVendorsModal.companyId,
          assigned_to_user_id: vendorId,
          assigned_to_name: vendorName,
          visit_date: addVendorsModal.date,
          perfil_visita: addVendorsModal.perfilVisita,
          perfil_visita_opcoes: addVendorsModal.perfilVisitaOpcoes,
          instructions: null,
          route_id: routeId,
          created_by: session?.user.id ?? null,
        };
        if (isSupervisorRouteVisit) {
          insertPayload.visit_type = VISIT_TYPE.SUPERVISOR_RELACIONAMENTO;
          insertPayload.supervisor_reason = addVendorsModal.supervisorReason;
        }
        const { data: insertedVisit, error: insertError } = await supabase
          .from("visits")
          .insert(insertPayload)
          .select("id")
          .single();
        if (insertError) throw new Error(insertError.message);

        if (isSupervisorRouteVisit && insertedVisit?.id) {
          const supervisorIdsForLink = new Set(addVendorsModal.supervisorUserIds);
          if (supervisorByUserId.has(vendorId)) {
            supervisorIdsForLink.add(vendorId);
          }
          if (role === "SUPERVISOR" && session?.user.id) {
            supervisorIdsForLink.add(session.user.id);
          }
          if (supervisorIdsForLink.size > 0) {
            const linkRows = Array.from(supervisorIdsForLink).map((supervisorUserId) => ({
              visit_id: insertedVisit.id as string,
              supervisor_user_id: supervisorUserId,
              created_by: session?.user.id ?? null,
            }));
            const { error: linksError } = await supabase.from("visit_supervisors").upsert(linkRows, {
              onConflict: "visit_id,supervisor_user_id",
              ignoreDuplicates: true,
            });
            if (linksError) throw new Error(linksError.message);
          }
        }

        await ensureRouteStop(routeId, addVendorsModal.companyId);
        knownExisting.add(vendorId);
        createdCount += 1;
      }

      if (createdCount === 0) {
        setAddVendorsError(
          addVendorsModal.allowSupervisorAssignees
            ? "Todos os responsaveis selecionados ja estao vinculados para esta data."
            : "Todos os vendedores selecionados ja estao vinculados para esta data.",
        );
        setAddVendorsModal((prev) =>
          prev ? { ...prev, existingAssigneeIds: Array.from(knownExisting) } : prev,
        );
        return;
      }

      setAddVendorsModal(null);
      setAddVendorsQuery("");
      invalidateDayDetailsCache(addVendorsModal.date);
      requestRefresh();
    } catch (err) {
      setAddVendorsError(err instanceof Error ? err.message : "Erro ao adicionar responsaveis.");
    } finally {
      setAddVendorsSaving(false);
    }
  };

  const handleRemoveVisit = async (visitId: string, visitInput?: VisitRow) => {
    const confirmRemove = window.confirm("Remover esta visita e voltar para a agenda?");
    if (!confirmRemove) return;
    setRemovingId(visitId);
    setError(null);
    try {
      let visit = visitInput ?? visits.find((item) => item.id === visitId);
      if (!visit) {
        const { data: fetchedVisit, error: fetchedVisitError } = await supabase
          .from("visits")
          .select("id, cliente_id, route_id")
          .eq("id", visitId)
          .maybeSingle();
        if (fetchedVisitError) throw new Error(fetchedVisitError.message);
        if (!fetchedVisit) {
          setError("Visita nao encontrada.");
          setRemovingId(null);
          return;
        }
        visit = {
          id: fetchedVisit.id,
          cliente_id: fetchedVisit.cliente_id ?? null,
          route_id: fetchedVisit.route_id ?? null,
          visit_date: "",
          assigned_to_user_id: null,
          assigned_to_name: null,
          perfil_visita: null,
          completed_at: null,
          completed_vidas: null,
          no_visit_reason: null,
          no_visit_observation: null,
          instructions: null,
          agenda: null,
          cliente: null,
        };
      }

      const resolvedVisit = visit;

      if (resolvedVisit.route_id && resolvedVisit.cliente_id) {
        const { error: deleteStopError } = await supabase
          .from("route_stops")
          .delete()
          .eq("route_id", resolvedVisit.route_id)
          .eq("cliente_id", resolvedVisit.cliente_id);
        if (deleteStopError) throw new Error(deleteStopError.message);
      }

      const { error: deleteError } = await supabase.from("visits").delete().eq("id", visitId);
      if (deleteError) throw new Error(deleteError.message);

      if (resolvedVisit.cliente_id) {
        const { count, error: countError } = await supabase
          .from("visits")
          .select("id", { count: "exact", head: true })
          .eq("cliente_id", resolvedVisit.cliente_id);

        if (countError) throw new Error(countError.message);

        if ((count ?? 0) === 0) {
          const { error: updateError } = await supabase
            .from("clientes")
            .update({ visit_generated_at: null })
            .eq("id", resolvedVisit.cliente_id);
          if (updateError) throw new Error(updateError.message);
        }
      }

      removeVisitLocally(visitId);
      invalidateDayDetailsCache(toDateInput(resolvedVisit.visit_date));
      requestRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover visita.");
    } finally {
      setRemovingId(null);
    }
  };

  const fetchSupervisorRegister = async (visitId: string) => {
    const { data, error } = await supabase
      .from("visit_supervisor_register")
      .select(
        "visit_id, quantidade_vidas, quantidade_funcionarios, descricao_visita, pessoa_contato_mesma, pessoa, contato",
      )
      .eq("visit_id", visitId)
      .maybeSingle<VisitSupervisorRegisterRow>();
    if (error) throw new Error(error.message);
    return data ?? null;
  };

  const openCompleteModal = async (item: VisitRow) => {
    const agendaPerfil = item.agenda?.perfil_visita ?? "";
    const visitPerfil = item.perfil_visita ?? "";
    const visitOptionsRaw = item.perfil_visita_opcoes ?? "";
    const agendaOptions = extractCustomTimes(agendaPerfil);
    const visitOptions = extractCustomTimes(visitOptionsRaw || visitPerfil);
    const customOptions =
      agendaOptions.length >= visitOptions.length ? agendaOptions : visitOptions;
    const rawPerfil = visitOptionsRaw || visitPerfil || agendaPerfil;
    const singleTimeBase = getSingleTimePerfilBase(rawPerfil);
    const singleTimeValue = getSingleTimePerfilValue(rawPerfil);
    const normalized = normalizePerfilVisita(rawPerfil);
    const isPreset = normalized !== "" && isPresetPerfilVisita(normalized);
    const hasCustomOptions = customOptions.length > 0 && !isPreset && !singleTimeBase;
    const selectedPerfil = hasCustomOptions
      ? customOptions.find((option) => option === visitPerfil) ?? customOptions[0]
      : singleTimeBase && singleTimeValue
        ? `${singleTimeBase} ${singleTimeValue}`
        : normalized;
    const fallbackVisitTime = item.visit_time ?? singleTimeValue ?? "";
    const isSupervisorVisit = item.visit_type === VISIT_TYPE.SUPERVISOR_RELACIONAMENTO;
    const isOwnSupervisorVisit = isSupervisorVisitForLoggedUser(item);
    const baseState = {
      id: item.id,
      visitType: item.visit_type ?? VISIT_TYPE.VENDEDOR,
      supervisorReason: item.supervisor_reason ?? null,
      vidas: item.completed_vidas?.toString() ?? "",
      perfil: selectedPerfil,
      visitTime: fallbackVisitTime,
      registerLikeVendor: isOwnSupervisorVisit
        ? false
        : item.register_mode !== VISIT_REGISTER_MODE.SUPERVISOR_DIFERENCIADO,
      quantidadeFuncionarios: "",
      descricaoVisita: "",
      pessoaContatoMesma: true,
      pessoa: item.agenda?.pessoa ?? "",
      contato: item.agenda?.contato ?? "",
      customManual: false,
      customTime: hasCustomOptions ? selectedPerfil : "",
      singleTimeBase: singleTimeBase ?? "",
      singleTimeValue,
      customOptions: hasCustomOptions ? customOptions : [],
      customEditEnabled: false,
      instructions: item.instructions ?? "",
    } as const;

    setCompleteVisit(baseState);

    if (!isSupervisorVisit) return;

    try {
      const register = await fetchSupervisorRegister(item.id);
      if (!register) return;
      setCompleteVisit((prev) => {
        if (!prev || prev.id !== item.id) return prev;
        return {
          ...prev,
          vidas:
            register.quantidade_vidas !== null && register.quantidade_vidas !== undefined
              ? String(register.quantidade_vidas)
              : prev.vidas,
          registerLikeVendor: false,
          quantidadeFuncionarios:
            register.quantidade_funcionarios !== null && register.quantidade_funcionarios !== undefined
              ? String(register.quantidade_funcionarios)
              : "",
          descricaoVisita: (register.descricao_visita ?? "") as SupervisorDescricaoVisita | "",
          pessoaContatoMesma: register.pessoa_contato_mesma ?? true,
          pessoa: register.pessoa ?? prev.pessoa,
          contato: register.contato ?? prev.contato,
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar registro de supervisor.");
    }
  };

  const handleStartRegister = (item: VisitRow) => {
    if (item.completed_at && !item.no_visit_reason) {
      void openCompleteModal(item);
      return;
    }
    setConfirmVisit(item);
  };

  const fetchObsComercialFromClientes = async (visit?: VisitRow | null) => {
    const agenda = visit?.agenda;
    if (!agenda) return null;
    const joinUniqueObs = (rows: Array<{ obs_comercial?: string | null }> | null | undefined) => {
      if (!rows || rows.length === 0) return null;
      const unique = Array.from(
        new Set(
          rows
            .map((row) => (row.obs_comercial ?? "").trim())
            .filter(Boolean),
        ),
      );
      return unique.length > 0 ? unique.join(" | ") : null;
    };

    if (visit?.cliente?.obs_comercial?.trim()) {
      return visit.cliente.obs_comercial.trim();
    }

    const clienteId = visit?.cliente?.id ?? visit?.cliente_id ?? null;
    if (clienteId) {
      const { data, error } = await supabase
        .from("clientes")
        .select("obs_comercial")
        .eq("id", clienteId)
        .limit(1);
      if (!error && data && data.length > 0) {
        return (data[0] as { obs_comercial?: string | null }).obs_comercial ?? null;
      }
    }

    const codigo = agenda.cod_1?.trim();
    if (codigo) {
      const { data, error } = await supabase
        .from("clientes")
        .select("obs_comercial")
        .eq("codigo", codigo);
      if (!error) {
        const merged = joinUniqueObs(data as Array<{ obs_comercial?: string | null }>);
        if (merged) return merged;
      }

      try {
        const fromEndpoint = await fetchObservacaoComercialByEmpresaId(codigo);
        if (fromEndpoint?.trim()) return fromEndpoint.trim();
      } catch (error) {
      }
    }

    const empresa = agenda.empresa?.trim();
    const nomeFantasia = agenda.nome_fantasia?.trim();
    if (empresa && nomeFantasia) {
      const { data, error } = await supabase
        .from("clientes")
        .select("obs_comercial")
        .eq("empresa", empresa)
        .eq("nome_fantasia", nomeFantasia);
      if (!error) {
        const merged = joinUniqueObs(data as Array<{ obs_comercial?: string | null }>);
        if (merged) return merged;
      }
    }
    if (empresa) {
      const { data, error } = await supabase
        .from("clientes")
        .select("obs_comercial")
        .eq("empresa", empresa);
      if (!error) {
        const merged = joinUniqueObs(data as Array<{ obs_comercial?: string | null }>);
        if (merged) return merged;
      }
    }
    if (nomeFantasia) {
      const { data, error } = await supabase
        .from("clientes")
        .select("obs_comercial")
        .eq("nome_fantasia", nomeFantasia);
      if (!error) {
        const merged = joinUniqueObs(data as Array<{ obs_comercial?: string | null }>);
        if (merged) return merged;
      }
    }

    return null;
  };

  const fetchAgendaCanonicalFromClientes = async (visit?: VisitRow | null) => {
    const agenda = visit?.agenda;
    if (!agenda) return null;

    const mapCanonicalToAgenda = (row: ClienteCanonicalModalRow): NonNullable<VisitRow["agenda"]> => ({
      ...agenda,
      cod_1: row.codigo,
      corte: row.corte,
      venc: row.venc,
      valor: row.valor,
      empresa: row.empresa,
      pessoa: row.pessoa,
      contato: row.contato,
      obs_contrato_1: row.obs_comercial,
      nome_fantasia: row.nome_fantasia,
      complemento: row.complemento,
      perfil_visita: row.perfil_visita,
      situacao: row.situacao,
      endereco: row.endereco,
      bairro: row.bairro,
      cidade: row.cidade,
      uf: row.uf,
    });

    if (visit?.cliente) {
      return mapCanonicalToAgenda(visit.cliente);
    }

    const fetchCanonicalRows = async (
      queryPromise: PromiseLike<{
        data: ClienteCanonicalModalRow[] | null;
        error: { message: string } | null;
      }>,
    ) => {
      const { data, error } = await queryPromise;
      if (error) {
        return [] as ClienteCanonicalModalRow[];
      }
      return (data ?? []) as ClienteCanonicalModalRow[];
    };

    const clienteId = visit?.cliente_id ?? null;
    if (clienteId) {
      const rows = await fetchCanonicalRows(
        supabase.from("clientes").select(CLIENTE_CANONICAL_MODAL_SELECT).eq("id", clienteId).limit(1),
      );
      if (rows.length > 0) {
        return mapCanonicalToAgenda(rows[0]);
      }
    }

    const codigo = agenda.cod_1?.trim() ?? "";
    const codigoCandidates = Array.from(
      new Set(
        [
          codigo,
          codigo.replace(/^0+/, ""),
          (() => {
            const numeric = Number(codigo);
            return Number.isFinite(numeric) ? String(numeric) : "";
          })(),
        ].filter(Boolean),
      ),
    );

    const candidateById = new Map<string, ClienteCanonicalModalRow>();
    const ingestCandidates = (rows: ClienteCanonicalModalRow[]) => {
      rows.forEach((row) => {
        if (!row?.id) return;
        candidateById.set(row.id, row);
      });
    };

    if (codigoCandidates.length > 0) {
      const rows = await fetchCanonicalRows(
        supabase.from("clientes").select(CLIENTE_CANONICAL_MODAL_SELECT).in("codigo", codigoCandidates).limit(100),
      );
      ingestCandidates(rows);
    }

    const empresa = agenda.empresa?.trim() ?? "";
    const nomeFantasia = agenda.nome_fantasia?.trim() ?? "";

    if (empresa && nomeFantasia) {
      const rows = await fetchCanonicalRows(
        supabase
          .from("clientes")
          .select(CLIENTE_CANONICAL_MODAL_SELECT)
          .eq("empresa", empresa)
          .eq("nome_fantasia", nomeFantasia)
          .limit(100),
      );
      ingestCandidates(rows);
    }

    if (empresa) {
      const rows = await fetchCanonicalRows(
        supabase.from("clientes").select(CLIENTE_CANONICAL_MODAL_SELECT).eq("empresa", empresa).limit(100),
      );
      ingestCandidates(rows);
    }

    if (nomeFantasia) {
      const rows = await fetchCanonicalRows(
        supabase.from("clientes").select(CLIENTE_CANONICAL_MODAL_SELECT).eq("nome_fantasia", nomeFantasia).limit(100),
      );
      ingestCandidates(rows);
    }

    const candidates = Array.from(candidateById.values());
    if (candidates.length === 0) return null;

    const normalizedAgendaCodigoSet = new Set(codigoCandidates.map((value) => normalize(value)).filter(Boolean));
    const normalizedAgendaEmpresa = normalize(agenda.empresa);
    const normalizedAgendaFantasia = normalize(agenda.nome_fantasia);
    const normalizedAgendaEndereco = normalize(agenda.endereco);
    const normalizedAgendaComplemento = normalize(agenda.complemento ?? null);
    const normalizedAgendaBairro = normalize(agenda.bairro);
    const normalizedAgendaCidade = normalize(agenda.cidade);
    const normalizedAgendaUf = normalize(agenda.uf);

    const scoreCandidate = (candidate: ClienteCanonicalModalRow) => {
      let score = 0;

      const normalizedCodigo = normalize(candidate.codigo);
      const normalizedEmpresa = normalize(candidate.empresa);
      const normalizedFantasia = normalize(candidate.nome_fantasia);
      const normalizedEndereco = normalize(candidate.endereco);
      const normalizedComplemento = normalize(candidate.complemento);
      const normalizedBairro = normalize(candidate.bairro);
      const normalizedCidade = normalize(candidate.cidade);
      const normalizedUf = normalize(candidate.uf);

      if (normalizedCodigo && normalizedAgendaCodigoSet.has(normalizedCodigo)) {
        score += 500;
      }
      if (normalizedAgendaEmpresa && normalizedEmpresa && normalizedAgendaEmpresa === normalizedEmpresa) {
        score += 120;
      }
      if (normalizedAgendaFantasia && normalizedFantasia && normalizedAgendaFantasia === normalizedFantasia) {
        score += 80;
      }
      if (normalizedAgendaEndereco && normalizedEndereco && normalizedAgendaEndereco === normalizedEndereco) {
        score += 60;
      }
      if (
        normalizedAgendaComplemento &&
        normalizedComplemento &&
        normalizedAgendaComplemento === normalizedComplemento
      ) {
        score += 20;
      }
      if (normalizedAgendaBairro && normalizedBairro && normalizedAgendaBairro === normalizedBairro) {
        score += 25;
      }
      if (normalizedAgendaCidade && normalizedCidade && normalizedAgendaCidade === normalizedCidade) {
        score += 25;
      }
      if (normalizedAgendaUf && normalizedUf && normalizedAgendaUf === normalizedUf) {
        score += 10;
      }

      // Prefer candidates with more canonical data filled.
      if (candidate.corte !== null) score += 3;
      if (candidate.venc !== null) score += 3;
      if (candidate.valor !== null) score += 3;
      if (candidate.endereco) score += 1;
      if (candidate.bairro) score += 1;
      if (candidate.cidade) score += 1;
      if (candidate.uf) score += 1;

      return score;
    };

    const best = candidates.reduce<ClienteCanonicalModalRow | null>((currentBest, candidate) => {
      if (!currentBest) return candidate;
      const bestScore = scoreCandidate(currentBest);
      const nextScore = scoreCandidate(candidate);
      if (nextScore > bestScore) return candidate;
      return currentBest;
    }, null);

    return best ? mapCanonicalToAgenda(best) : null;
  };

  const openDetailsModal = (item: VisitRow) => {
    setDetailsObsExpanded(false);
    setDetailsVisit(item);
    setDetailsInstructionDraft("");
    setDetailsInstructionMessage(null);
    const fallbackObs = item.agenda?.obs_contrato_1?.trim() ?? "";
    setDetailsObsText(fallbackObs);
    const requestId = detailsObsRequestRef.current + 1;
    detailsObsRequestRef.current = requestId;
    fetchObsComercialFromClientes(item)
      .then((obsComercial) => {
        if (detailsObsRequestRef.current !== requestId) return;
        setDetailsObsText((obsComercial ?? fallbackObs ?? "").trim());
      })
      .catch((err) => {
      });

    void (async () => {
      try {
        const { data, error } = await supabase
          .from("visits")
          .select("id, instructions")
          .eq("id", item.id)
          .maybeSingle<{ id: string; instructions: string | null }>();

        if (detailsObsRequestRef.current !== requestId) return;
        if (error) {
          setDetailsInstructionDraft(item.instructions ?? "");
          return;
        }
        const nextInstructions = data?.instructions ?? item.instructions ?? "";
        setDetailsInstructionDraft(nextInstructions);
        setDetailsVisit((prev) =>
          prev && prev.id === item.id
            ? {
                ...prev,
                instructions: data?.instructions ?? prev.instructions,
              }
            : prev,
        );
      } catch (err) {
        if (detailsObsRequestRef.current !== requestId) return;
        setDetailsInstructionDraft(item.instructions ?? "");
      }
    })();

    if (item.cliente_id) {
      const hydrationStartedAt = performance.now();
      hydrateVisitsWithClientes([item], "details")
        .then((hydratedVisits) => {
          if (detailsObsRequestRef.current !== requestId) return;
          const hydratedVisit = hydratedVisits[0];
          if (!hydratedVisit) return;

          setVisits((prev) =>
            prev.map((visit) =>
              visit.id === item.id
                ? {
                    ...visit,
                    agenda: hydratedVisit.agenda ?? visit.agenda,
                    cliente: hydratedVisit.cliente ?? visit.cliente,
                  }
                : visit,
            ),
          );

          setDetailsVisit((prev) =>
            prev && prev.id === item.id
              ? {
                  ...prev,
                  agenda: hydratedVisit.agenda ?? prev.agenda,
                  cliente: hydratedVisit.cliente ?? prev.cliente,
                }
              : prev,
          );
        })
        .catch(() => {})
        .finally(() => {
          logPerfDuration("VISITAS_CLIENTES_HYDRATION_FULL", hydrationStartedAt);
        });
    }
  };

  const closeDetailsModal = () => {
    detailsObsRequestRef.current += 1;
    setDetailsVisit(null);
    setNoVisitObservationModal(null);
    setDetailsObsExpanded(false);
    setDetailsObsText("");
    setDetailsInstructionDraft("");
    setDetailsInstructionSaving(false);
    setDetailsInstructionMessage(null);
    setPlanoValoresModal(null);
  };

  const openNoVisitObservationModal = (item: VisitRow, seller: string) => {
    const observation = item.no_visit_observation?.trim() ?? "";
    if (!observation) return;
    setNoVisitObservationModal({
      visitId: item.id,
      seller,
      observation,
    });
  };

  const openPlanoValoresModal = async (codigoRaw: string | null | undefined, empresa: string | null) => {
    const codigo = (codigoRaw ?? "").trim();
    setPlanoValoresModal({
      codigo,
      empresa,
      valores: [],
      loading: true,
      error: null,
    });

    if (!codigo) {
      setPlanoValoresModal({
        codigo,
        empresa,
        valores: [],
        loading: false,
        error: "Codigo da empresa nao informado.",
      });
      return;
    }

    try {
      const empresaApi = await fetchEmpresaByEmpresaId(codigo);
      if (!empresaApi) {
        setPlanoValoresModal({
          codigo,
          empresa,
          valores: [],
          loading: false,
          error: "Empresa nao encontrada na API.",
        });
        return;
      }

      const valores = extractOdontoartPlanoValores(empresaApi);
      setPlanoValoresModal({
        codigo,
        empresa,
        valores,
        loading: false,
        error: null,
      });
    } catch (err) {
      setPlanoValoresModal({
        codigo,
        empresa,
        valores: [],
        loading: false,
        error: err instanceof Error ? err.message : "Erro ao carregar valores de plano.",
      });
    }
  };

  useEffect(() => {
    if (!detailsVisit) return;
    const latestVisit = visits.find((visit) => visit.id === detailsVisit.id);
    if (!latestVisit) return;
    setDetailsVisit((prev) => {
      if (!prev || prev.id !== latestVisit.id) return prev;
      if (prev === latestVisit) return prev;
      return latestVisit;
    });
  }, [detailsVisit, visits]);

  useEffect(() => {
    if (!detailsVisit) {
      setDetailsInstructionDraft("");
      return;
    }
    setDetailsInstructionDraft(detailsVisit.instructions ?? "");
    setDetailsInstructionMessage(null);
  }, [detailsVisit?.id]);

  const handleSaveDetailsInstruction = async () => {
    if (!detailsVisit || !canManageInstruction) return;

    const nextInstructions = detailsInstructionDraft.trim() || null;
    const visitId = detailsVisit.id;
    const clienteId = detailsVisit.cliente_id ?? null;

    setDetailsInstructionSaving(true);
    setDetailsInstructionMessage(null);
    try {
      let updateQuery = supabase
        .from("visits")
        .update({ instructions: nextInstructions })
        .eq("id", visitId);
      if (clienteId) {
        updateQuery = updateQuery.eq("cliente_id", clienteId);
      }
      const { data: updatedVisit, error: visitsError } = await updateQuery
        .select("id, instructions")
        .single<{ id: string; instructions: string | null }>();
      if (visitsError) throw new Error(visitsError.message);

      const savedInstructions = updatedVisit?.instructions ?? nextInstructions;

      setVisits((prev) =>
        prev.map((item) =>
          item.id === visitId
            ? {
                ...item,
                instructions: savedInstructions,
              }
            : item,
        ),
      );
      setDetailsVisit((prev) =>
        prev && prev.id === visitId
          ? {
              ...prev,
              instructions: savedInstructions,
            }
          : prev,
      );
      setCompleteVisit((prev) =>
        prev && prev.id === visitId ? { ...prev, instructions: savedInstructions ?? "" } : prev,
      );
      setDetailsInstructionMessage("Instrucoes salvas.");
    } catch (err) {
      setDetailsInstructionMessage(err instanceof Error ? err.message : "Erro ao salvar instrucoes.");
    } finally {
      setDetailsInstructionSaving(false);
    }
  };

  const handleConfirmNoVisit = async () => {
    if (!noVisit) return;
    if (!noVisit.reason) {
      setError("Selecione o motivo.");
      return;
    }
    setSavingId(noVisit.id);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from("visits")
        .update({
          completed_at: new Date().toISOString(),
          no_visit_reason: noVisit.reason,
          no_visit_observation: noVisit.observation.trim() || null,
        })
        .eq("id", noVisit.id);

      if (updateError) throw new Error(updateError.message);

      setNoVisit(null);
      requestRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registrar visita.");
    } finally {
      setSavingId(null);
    }
  };

  const handleConfirmVisit = async () => {
    if (!completeVisit) return;
    const isSupervisorVisit = isSupervisorVisitType(completeVisit.visitType);
    const isDifferentiatedSupervisor = isSupervisorVisit && !completeVisit.registerLikeVendor;

    const parseIntegerValue = (
      raw: string,
      options: { required: boolean; fieldLabel: string },
    ): { value: number | null; error: string | null } => {
      const trimmed = raw.trim();
      if (!trimmed) {
        if (!options.required) return { value: null, error: null };
        return { value: null, error: `Informe ${options.fieldLabel}.` };
      }
      if (!/^\d+$/.test(trimmed)) {
        return { value: null, error: `${options.fieldLabel} deve conter apenas numeros.` };
      }
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { value: null, error: `${options.fieldLabel} deve ser um numero inteiro valido.` };
      }
      return { value: parsed, error: null };
    };

    const vidasParsed = parseIntegerValue(completeVisit.vidas, {
      required: !isDifferentiatedSupervisor,
      fieldLabel: "a quantidade de vidas",
    });
    if (vidasParsed.error) {
      setError(vidasParsed.error);
      return;
    }
    const vidas = vidasParsed.value;

    if (!completeVisit.perfil) {
      setError("Selecione o perfil da visita.");
      return;
    }

    const visitTimeValue = completeVisit.visitTime.trim();
    if (isDifferentiatedSupervisor && !visitTimeValue) {
      setError("Informe o horario da visita.");
      return;
    }

    let quantidadeFuncionarios: number | null = null;
    if (isDifferentiatedSupervisor) {
      const parsedFuncionarios = parseIntegerValue(completeVisit.quantidadeFuncionarios, {
        required: true,
        fieldLabel: "a quantidade de funcionarios",
      });
      if (parsedFuncionarios.error) {
        setError(parsedFuncionarios.error);
        return;
      }
      quantidadeFuncionarios = parsedFuncionarios.value;
    }

    if (
      isDifferentiatedSupervisor &&
      quantidadeFuncionarios !== null &&
      vidas !== null &&
      quantidadeFuncionarios < vidas
    ) {
      setError("Quantidade de funcionarios deve ser maior ou igual a quantidade de vidas.");
      return;
    }

    const descricaoVisita = completeVisit.descricaoVisita;
    if (isDifferentiatedSupervisor && !descricaoVisita) {
      setError("Selecione a descricao da visita.");
      return;
    }
    if (
      descricaoVisita &&
      !SUPERVISOR_DESCRICAO_VISITA_OPTIONS.some((option) => option.value === descricaoVisita)
    ) {
      setError("Descricao da visita invalida.");
      return;
    }

    const pessoa = completeVisit.pessoa.trim();
    const contato = completeVisit.contato.trim();
    if (isDifferentiatedSupervisor && !completeVisit.pessoaContatoMesma && (!pessoa || !contato)) {
      setError("Preencha os campos Pessoa e Contato para atualizar os dados da empresa.");
      return;
    }

    setSavingId(completeVisit.id);
    setError(null);
    try {
      const visit = visits.find((item) => item.id === completeVisit.id);
      if (!visit) {
        throw new Error("Visita nao encontrada.");
      }

      const cleanedOptions = completeVisit.customOptions
        .map((option) => option.trim())
        .filter(Boolean);
      const customTime = completeVisit.customManual ? completeVisit.customTime.trim() : "";
      const normalizedOptions = [...cleanedOptions];
      if (customTime && !normalizedOptions.includes(customTime)) {
        normalizedOptions.push(customTime);
      }
      const perfilOpcoesString = normalizedOptions.length > 0 ? normalizedOptions.join(" | ") : null;
      const completedAt = new Date().toISOString();
      const registerMode = isDifferentiatedSupervisor
        ? VISIT_REGISTER_MODE.SUPERVISOR_DIFERENCIADO
        : VISIT_REGISTER_MODE.PADRAO;

      const { error: updateError } = await supabase
        .from("visits")
        .update({
          completed_at: completedAt,
          completed_vidas: vidas,
          perfil_visita: completeVisit.perfil,
          perfil_visita_opcoes: perfilOpcoesString,
          visit_time: visitTimeValue || null,
          register_mode: registerMode,
          registered_by_user_id: session?.user.id ?? null,
          no_visit_reason: null,
        })
        .eq("id", completeVisit.id);

      if (updateError) throw new Error(updateError.message);

      if (isSupervisorVisit) {
        if (isDifferentiatedSupervisor) {
          const { error: registerError } = await supabase
            .from("visit_supervisor_register")
            .upsert(
              {
                visit_id: completeVisit.id,
                quantidade_vidas: vidas,
                quantidade_funcionarios: quantidadeFuncionarios ?? 0,
                descricao_visita: descricaoVisita,
                pessoa_contato_mesma: completeVisit.pessoaContatoMesma,
                pessoa: completeVisit.pessoaContatoMesma ? null : pessoa,
                contato: completeVisit.pessoaContatoMesma ? null : contato,
                updated_by_user_id: session?.user.id ?? null,
                updated_at: completedAt,
              },
              { onConflict: "visit_id" },
            );
          if (registerError) throw new Error(registerError.message);
        } else {
          const { error: deleteRegisterError } = await supabase
            .from("visit_supervisor_register")
            .delete()
            .eq("visit_id", completeVisit.id);
          if (deleteRegisterError) throw new Error(deleteRegisterError.message);
        }
      }

      if (visit.cliente_id) {
        if (isDifferentiatedSupervisor && !completeVisit.pessoaContatoMesma) {
          const { error: contactUpdateError } = await supabase
            .from("clientes")
            .update({
              pessoa,
              contato,
            })
            .eq("id", visit.cliente_id);
          if (contactUpdateError) throw new Error(contactUpdateError.message);
        }

        const visitDateKey = visit.visit_date ? formatDateKey(visit.visit_date) : formatDateKey(completedAt);
        const visitDateIso = visit.visit_date
          ? new Date(`${visitDateKey}T12:00:00`).toISOString()
          : completedAt;

        const { data: clienteSnapshot, error: clienteSnapshotError } = await supabase
          .from("clientes")
          .select("data_da_ultima_visita")
          .eq("id", visit.cliente_id)
          .maybeSingle<{ data_da_ultima_visita: string | null }>();

        if (clienteSnapshotError) throw new Error(clienteSnapshotError.message);

        const currentLastVisitKey = clienteSnapshot?.data_da_ultima_visita
          ? formatDateKey(clienteSnapshot.data_da_ultima_visita)
          : "";

        if (!currentLastVisitKey || currentLastVisitKey <= visitDateKey) {
          const { error: clienteUpdateError } = await supabase
            .from("clientes")
            .update({
              data_da_ultima_visita: visitDateIso,
              visit_completed_vidas: vidas,
            })
            .eq("id", visit.cliente_id);

          if (clienteUpdateError) throw new Error(clienteUpdateError.message);
        }
      }

      setCompleteVisit(null);
      requestRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registrar visita.");
    } finally {
      setSavingId(null);
    }
  };

  const handleConfirmVendorDashboardAccess = async () => {
    if (!vendorDashboardAccessModal) return;
    setVendorDashboardAccessSaving(true);
    setVendorDashboardAccessError(null);
    try {
      if (vendorDashboardAccessModal.grantAccess) {
        const { error: upsertError } = await supabase
          .from("vendor_next_route_releases")
          .upsert(
            {
              vendor_user_id: vendorDashboardAccessModal.vendorUserId,
              release_date: vendorDashboardAccessModal.releaseDate,
              released_by_user_id: session?.user.id ?? null,
            },
            { onConflict: "vendor_user_id,release_date" },
          );
        if (upsertError) throw new Error(upsertError.message);
      } else {
        const { error: deleteError } = await supabase
          .from("vendor_next_route_releases")
          .delete()
          .eq("vendor_user_id", vendorDashboardAccessModal.vendorUserId)
          .eq("release_date", vendorDashboardAccessModal.releaseDate);
        if (deleteError) throw new Error(deleteError.message);
      }

      setReleasedVendorIdsForDate((prev) => {
        const next = new Set(prev);
        if (vendorDashboardAccessModal.grantAccess) {
          next.add(vendorDashboardAccessModal.vendorUserId);
        } else {
          next.delete(vendorDashboardAccessModal.vendorUserId);
        }
        return Array.from(next);
      });
      emitProfilesUpdated();
      setVendorDashboardAccessModal(null);
    } catch (err) {
      setVendorDashboardAccessError(
        err instanceof Error ? err.message : "Erro ao atualizar permissao do vendedor.",
      );
    } finally {
      setVendorDashboardAccessSaving(false);
    }
  };

  const updateCustomOptions = (options: string[]) => {
    setCompleteVisit((prev) => {
      if (!prev) return prev;
      const cleaned = options.map((item) => item.trim());
      const available = cleaned.filter(Boolean);
      const shouldUpdatePerfil =
        !prev.customManual && (prev.perfil === "" || !available.includes(prev.perfil));
      return {
        ...prev,
        customOptions: cleaned,
        perfil: shouldUpdatePerfil ? (available[0] ?? "") : prev.perfil,
        customTime: prev.customManual ? prev.customTime : prev.customTime,
      };
    });
  };

  const shouldLockSupervisorRegisterMode = useMemo(() => {
    if (!completeVisit || !isSupervisorVisitType(completeVisit.visitType)) return false;
    const currentVisit = visits.find((item) => item.id === completeVisit.id);
    if (!currentVisit) return false;
    return isSupervisorVisitForLoggedUser(currentVisit);
  }, [completeVisit, isSupervisorVisitForLoggedUser, visits]);

  useEffect(() => {
    if (!shouldLockSupervisorRegisterMode) return;
    setCompleteVisit((prev) => {
      if (!prev || prev.registerLikeVendor === false) return prev;
      return { ...prev, registerLikeVendor: false };
    });
  }, [shouldLockSupervisorRegisterMode]);

  return (
    <div className="overflow-x-hidden space-y-4 md:space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-ink">Agenda</h2>
            <p className="mt-2 text-sm text-ink/60">
              Calendario de visitas de vendedores e supervisores. Clique em um dia para ver os detalhes.
            </p>
          </div>
          {canFilterBySupervisor && (
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              {hasUpdatesAvailable && (
                <button
                  type="button"
                  onClick={requestRefresh}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:border-amber-400"
                >
                  Ha novas rotas disponiveis. Atualizar agenda
                </button>
              )}
              <label className="flex w-full min-w-0 flex-col gap-1 text-xs font-semibold text-ink/70 sm:min-w-[220px]">
                Supervisor
                <select
                  id="visitas-supervisor-select"
                  name="visitasSupervisorSelect"
                  value={selectedSupervisorId}
                  onChange={(event) => setSelectedSupervisorId(event.target.value || "all")}
                  className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink outline-none focus:border-sea"
                >
                  <option value="all">Todos</option>
                  {supervisores.length === 0 ? (
                    <option value="all">Nenhum supervisor</option>
                  ) : (
                    supervisores.map((supervisor) => (
                      <option key={supervisor.id} value={supervisor.id}>
                        {supervisor.display_name ?? "Supervisor"}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="flex w-full min-w-0 flex-col gap-1 text-xs font-semibold text-ink/70 sm:min-w-[220px]">
                Vendedor
                <select
                  id="visitas-vendor-select"
                  name="visitasVendorSelect"
                  value={selectedVendorId}
                  onChange={(event) => setSelectedVendorId(event.target.value || "all")}
                  className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink outline-none focus:border-sea"
                >
                  <option value="all">Todos</option>
                  {selectableVendors.length === 0 ? (
                    <option value="all">Nenhum vendedor</option>
                  ) : (
                    selectableVendors.map((vendor) => (
                      <option key={vendor.user_id} value={vendor.user_id}>
                        {vendor.display_name ?? "Vendedor"}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>
          )}
        </div>
        {hasUpdatesAvailable && !canFilterBySupervisor && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Ha novas rotas disponiveis.
            <button
              type="button"
              onClick={requestRefresh}
              className="ml-2 font-semibold underline"
            >
              Atualizar agenda
            </button>
          </div>
        )}
      </header>

      {!canAccess ? (
        <div className="glass-pane rounded-2xl p-4 text-sm text-ink/70 md:p-6">
          Este modulo e restrito a usuarios autorizados.
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[1.1fr_1fr] lg:gap-6">
          <section className="min-w-0 rounded-2xl border border-sea/15 bg-white/95 p-3 shadow-card md:p-4">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="rounded-full border border-sea/20 bg-white/80 p-2 text-sea hover:border-sea"
                onClick={() => setCurrentMonth(addDays(currentMonth, -30))}
              >
                <ChevronLeft size={18} />
              </button>
              <div className="text-sm font-semibold text-ink">
                {format(currentMonth, "MMMM 'de' yyyy", { locale: ptBR })}
              </div>
              <button
                type="button"
                className="rounded-full border border-sea/20 bg-white/80 p-2 text-sea hover:border-sea"
                onClick={() => setCurrentMonth(addDays(currentMonth, 30))}
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[10px] text-ink/60 sm:gap-2 sm:text-xs">
              {["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"].map((day) => (
                <span key={day} className="font-semibold">
                  {day}
                </span>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-7 gap-1 sm:gap-2">
              {calendarCells.map((day, index) => {
                if (!day) {
                  return <div key={`calendar-empty-${index}`} aria-hidden="true" className="h-16 rounded-xl" />;
                }

                const key = format(day, "yyyy-MM-dd");
                const count = visitsByDate.get(key)?.length ?? monthSummaryCounts.get(key) ?? 0;
                const hasVisits = count > 0;
                const hasSupervisorVisitForLoggedUser = supervisorPinDates.has(key);
                const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                const maxDate = isVendor && maxVisibleDate ? new Date(`${maxVisibleDate}T12:00:00`) : null;
                const isDisabled = maxDate ? isAfter(day, maxDate) : false;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => (isDisabled ? null : setSelectedDate(day))}
                    disabled={isDisabled}
                    title={
                      hasVisits
                        ? `${count} visita(s) em ${format(day, "dd/MM/yyyy")}${hasSupervisorVisitForLoggedUser ? " • inclui visita de supervisor" : ""}`
                        : undefined
                    }
                    className={[
                      "relative flex h-14 flex-col items-center justify-center rounded-xl border px-1 text-center text-[10px] transition sm:h-16 sm:text-xs",
                      isSelected ? "border-orange-300" : "border-sea/20 bg-white",
                      isSelected
                        ? "bg-orange-200 shadow-lg shadow-orange-200/70 ring-2 ring-orange-200"
                        : "hover:border-sea hover:bg-sand/40",
                      hasVisits && !isSelected ? "ring-1 ring-sea/35 shadow-sm" : "",
                      isDisabled ? "cursor-not-allowed opacity-40 hover:border-sea/20 hover:bg-white/50" : "",
                    ].join(" ")}
                  >
                    {hasVisits ? (
                      <span
                        className={[
                          "absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border",
                          hasSupervisorVisitForLoggedUser
                            ? "border-violet-400 bg-violet-100 text-violet-700"
                            : "border-orange-300 bg-orange-100 text-orange-600",
                        ].join(" ")}
                      >
                        <MapPin size={11} strokeWidth={2.5} />
                        <span className="sr-only">
                          {count} visita(s) no dia
                          {hasSupervisorVisitForLoggedUser ? ", inclui supervisor" : ""}
                        </span>
                      </span>
                    ) : null}
                    <span className={["text-[11px] font-semibold sm:text-sm", isSelected ? "text-green-700" : "text-ink"].join(" ")}>
                      {format(day, "d")}
                    </span>
                    <span className={["text-[9px] sm:text-[10px]", isSelected ? "text-green-700/80" : "text-ink/60"].join(" ")}>
                      {count} visitas
                    </span>
                  </button>
                );
              })}
            </div>

            {loading && (
              <p className="mt-4 text-sm text-ink/60">Carregando visitas...</p>
            )}
            {error && (
              <p className="mt-4 text-sm text-red-500">{error}</p>
            )}
          </section>

          <section className="min-w-0 rounded-2xl border border-sea/15 bg-white/95 p-3 shadow-card md:p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="min-w-0 font-display text-lg text-ink">Visitas do dia</h3>
              <span className="shrink-0 text-xs text-ink/60">
                {selectedDate ? format(selectedDate, "dd/MM/yyyy") : "Selecione uma data"}
              </span>
            </div>

            {groupedBySeller.length === 0 ? (
              dayDetailsLoadingDateKey === selectedDateKey && (monthSummaryCounts.get(selectedDateKey) ?? 0) > 0 ? (
                <p className="mt-4 text-sm text-ink/60">Carregando visitas do dia...</p>
              ) : (dayDetailsErrorByDate[selectedDateKey] && (monthSummaryCounts.get(selectedDateKey) ?? 0) > 0) ? (
                <p className="mt-4 text-sm text-red-500">Erro ao carregar visitas do dia.</p>
              ) : (
                <p className="mt-4 text-sm text-ink/60">Nenhuma visita para esta data.</p>
              )
            ) : (
              <div className="mt-4 space-y-4 overflow-x-hidden">
                {groupedBySeller.map(([seller, items]) => {
                  const isExpanded = expandedVendor === seller;
                  const hasSupervisorGroup = items.some((item) => isSupervisorVisitType(item.visit_type));
                  const completedCompanies = items.filter((item) => isVisitRegistered(item)).length;
                  const totalCompanies = items.length;
                  const allCompleted = totalCompanies > 0 && completedCompanies === totalCompanies;
                  const sellerVendor = resolveSellerVendor(seller, items);
                  const canAccessNextRouteDashboard = Boolean(
                    sellerVendor && releasedVendorIdSet.has(sellerVendor.user_id),
                  );
                  const lockTooltip = canAccessNextRouteDashboard
                    ? `Acesso liberado para ${selectedDate ? format(selectedDate, "dd/MM/yyyy") : "a data selecionada"}`
                    : `Acesso bloqueado para ${selectedDate ? format(selectedDate, "dd/MM/yyyy") : "a data selecionada"}`;
                  return (
                    <div
                      key={seller}
                      className={[
                        "min-w-0 overflow-hidden rounded-2xl border p-3",
                        hasSupervisorGroup
                          ? "border-violet-300 bg-violet-50/50 dark:border-violet-500/45 dark:bg-violet-950/35"
                          : "border-sea/20 bg-sand/20",
                      ].join(" ")}
                    >
                      <div className="flex w-full items-start justify-between gap-2 text-left">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedVendor(isExpanded ? null : seller)}
                            className="min-w-0 break-words text-left text-sm font-semibold text-ink"
                          >
                            {seller}
                          </button>
                          {canManage ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (routeOrderEditVendor === seller) {
                                  const orderedItems = getVendorRouteOrder(seller, items)
                                    .map((id) => items.find((item) => item.id === id))
                                    .filter((value): value is VisitRow => Boolean(value));
                                  void saveVendorRouteOrder(seller, orderedItems);
                                  return;
                                }
                                startVendorRouteOrderEdit(seller, items);
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-sea/30 bg-sea/10 text-sea hover:border-sea hover:bg-sea/20"
                              title={routeOrderEditVendor === seller ? "Salvar ordenacao" : "Reordenar rotas"}
                              aria-label={routeOrderEditVendor === seller ? "Salvar ordenacao" : "Reordenar rotas"}
                              disabled={routeOrderSavingVendor === seller}
                            >
                              {routeOrderSavingVendor === seller ? (
                                <LoaderCircle size={12} className="animate-spin" />
                              ) : routeOrderEditVendor === seller ? (
                                <CheckCircle2 size={12} />
                              ) : (
                                <Pencil size={12} />
                              )}
                            </button>
                          ) : null}
                          {hasSupervisorGroup ? (
                            <span className="inline-flex rounded-full border border-violet-300 bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:border-violet-400/60 dark:bg-violet-500/20 dark:text-violet-200">
                              Supervisor
                            </span>
                          ) : null}
                          {canManageVendorRouteAccess && sellerVendor ? (
                            <button
                              type="button"
                              onClick={() => {
                                setVendorDashboardAccessError(null);
                                setVendorDashboardAccessModal({
                                  vendorUserId: sellerVendor.user_id,
                                  vendorName: sellerVendor.display_name ?? seller,
                                  releaseDate: selectedDateKey,
                                  grantAccess: !canAccessNextRouteDashboard,
                                });
                              }}
                              className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${
                                canAccessNextRouteDashboard
                                  ? "border-emerald-400 bg-emerald-50 text-emerald-600 hover:border-emerald-500"
                                  : "border-red-300 bg-red-50 text-red-600 hover:border-red-400"
                              }`}
                              title={lockTooltip}
                              aria-label={lockTooltip}
                            >
                              {canAccessNextRouteDashboard ? <LockOpen size={11} /> : <Lock size={11} />}
                            </button>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedVendor(isExpanded ? null : seller)}
                          className={[
                            "shrink-0 text-xs font-semibold",
                            allCompleted ? "text-emerald-600" : "text-red-600",
                          ].join(" ")}
                        >
                          {completedCompanies}/{totalCompanies} empresa(s)
                        </button>
                      </div>

                      {isExpanded && (
                        <DragDropContext
                          onDragEnd={(result) => {
                            const { destination, source } = result;
                            if (!destination) return;
                            if (destination.droppableId !== source.droppableId) return;
                            if (destination.index === source.index) return;
                            if (destination.droppableId !== `seller-${seller}`) return;
                            const order = getVendorRouteOrder(seller, items);
                            const nextOrder = reorderList(order, source.index, destination.index);
                            setRouteOrderDraftByVendor((prev) => ({ ...prev, [seller]: nextOrder }));
                          }}
                        >
                          <Droppable
                            droppableId={`seller-${seller}`}
                            renderClone={(cloneProvided, _cloneSnapshot, rubric) => {
                              const cloneItemId = (routeOrderEditVendor === seller
                                ? getVendorRouteOrder(seller, items)
                                : items.map((item) => item.id))[rubric.source.index];
                              const cloneItem = items.find((item) => item.id === cloneItemId);
                              if (!cloneItem) return null;
                              return (
                                <div
                                  ref={cloneProvided.innerRef}
                                  {...cloneProvided.draggableProps}
                                  {...cloneProvided.dragHandleProps}
                                  style={{
                                    ...cloneProvided.draggableProps.style,
                                    zIndex: 9999,
                                  }}
                                  className={[
                                    "rounded-xl border p-3 shadow-2xl",
                                    isSupervisorVisitType(cloneItem.visit_type)
                                      ? "border-violet-300 bg-violet-50/90 dark:border-violet-500/45 dark:bg-violet-950/75"
                                      : "border-sea/20 bg-white",
                                  ].join(" ")}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-sea/30 bg-sea/15 text-[10px] font-semibold text-sea">
                                          {rubric.source.index + 1}
                                        </span>
                                        <p className="text-sm font-semibold text-ink">
                                          {cloneItem.agenda?.empresa ?? "Sem nome"}
                                        </p>
                                        <span className="rounded-full bg-sea/10 px-2 py-0.5 text-[10px] font-semibold text-sea">
                                          COD {cloneItem.agenda?.cod_1 ?? "-"}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-ink/70">
                                        Pessoa: {cloneItem.agenda?.pessoa ?? "-"}
                                      </p>
                                      <p className="text-[11px] text-ink/70">
                                        Contato: {cloneItem.agenda?.contato ?? "-"}
                                      </p>
                                    </div>
                                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sea/30 bg-sea/10 text-sea">
                                      <GripVertical size={13} />
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                          >
                            {(dropProvided) => (
                              <div
                                ref={dropProvided.innerRef}
                                {...dropProvided.droppableProps}
                                className="mt-3 space-y-3 text-xs text-ink/70"
                              >
                                {(routeOrderEditVendor === seller ? getVendorRouteOrder(seller, items) : items.map((item) => item.id))
                                  .map((itemId) => items.find((item) => item.id === itemId))
                                  .filter((value): value is VisitRow => Boolean(value))
                                  .map((item, index) => {
                                    const state = editState[item.id] ?? {
                                      vendorId: "",
                                      date: toDateInput(item.visit_date),
                                    };
                                    const isSupervisorVisit = isSupervisorVisitType(item.visit_type);
                                    const isEditing = editingVisits[item.id] ?? false;
                                    const isCompleted = isVisitRegistered(item);
                                    const canLoggedSupervisorRegister =
                                      role === "SUPERVISOR" &&
                                      isSupervisorVisit &&
                                      isSupervisorVisitForLoggedUser(item);
                                    const mapAddress = buildMapAddress(item.agenda);
                                    const instructionText = item.instructions?.trim() || "";
                                    const isEditRegisteredAction = isCompleted && !item.no_visit_reason;
                                    const registerVisitButtonClass = [
                                      "rounded-lg px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60",
                                      isEditRegisteredAction ? "bg-orange-500 hover:bg-orange-400" : "bg-sea hover:bg-seaLight",
                                    ].join(" ");
                                    const supervisorReasonLabel = item.supervisor_reason
                                      ? SUPERVISOR_REASON_LABEL_BY_VALUE.get(item.supervisor_reason) ?? item.supervisor_reason
                                      : null;
                                    const isEditingOrder = routeOrderEditVendor === seller;
                                    const itemOrderLabel = `${index + 1}`;
                                  return (
                                      <Draggable key={item.id} draggableId={item.id} index={index} isDragDisabled={!isEditingOrder}>
                                        {(dragProvided, dragSnapshot) => (
                                          <div
                                            ref={dragProvided.innerRef}
                                            {...dragProvided.draggableProps}
                                            style={{
                                              ...dragProvided.draggableProps.style,
                                              zIndex: dragSnapshot.isDragging ? 9999 : undefined,
                                              opacity: 1,
                                            }}
                                            className={[
                                              "min-w-0 overflow-hidden rounded-xl border p-3 transition-transform",
                                              isSupervisorVisit
                                                ? "border-violet-300 bg-violet-50/70 dark:border-violet-500/45 dark:bg-violet-950/45"
                                                : "border-sea/10 bg-white/90",
                                              isEditingOrder ? "ring-2 ring-sea/25" : "",
                                              dragSnapshot.isDragging ? "scale-[1.03] shadow-2xl" : "",
                                            ].join(" ")}
                                          >
                                            <div className="space-y-3 md:hidden">
                                              <div className="flex items-start justify-between gap-3">
                                                <div className="flex min-w-0 items-center gap-3">
                                                  <span
                                                    className={[
                                                      "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                                                      isEditingOrder
                                                        ? "border-sea/30 bg-sea/10 text-ink dark:text-white"
                                                        : "border-sea/20 bg-white text-ink dark:border-white/10 dark:bg-white/5 dark:text-white",
                                                    ].join(" ")}
                                                  >
                                                    {itemOrderLabel}
                                                  </span>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-2">
                                                  {isEditingOrder ? (
                                                    <div
                                                      {...dragProvided.dragHandleProps}
                                                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-sea/30 bg-sea/10 text-sea cursor-grab active:cursor-grabbing"
                                                      aria-label="Arrastar rota"
                                                      title="Arrastar rota"
                                                    >
                                                      <GripVertical size={13} />
                                                    </div>
                                                  ) : null}
                                                  <button
                                                    type="button"
                                                    onClick={(event) => {
                                                      event.stopPropagation();
                                                      openDetailsModal(item);
                                                    }}
                                                    className="rounded-full border border-sea/20 bg-white px-1.5 py-1 text-[10px] text-sea hover:border-sea"
                                                    aria-label="Visualizar detalhes da empresa"
                                                    title="Visualizar detalhes da empresa"
                                                  >
                                                    <Eye size={12} />
                                                  </button>
                                                  {mapAddress ? (
                                                    <button
                                                      type="button"
                                                      onClick={(event) => {
                                                        event.stopPropagation();
                                                        openMapApp(mapAddress);
                                                      }}
                                                      className="rounded-full border border-sea/20 bg-white px-1.5 py-1 text-[10px] text-sea hover:border-sea"
                                                      aria-label="Abrir mapa"
                                                      title="Abrir mapa"
                                                    >
                                                      <MapPin size={12} />
                                                    </button>
                                                  ) : null}
                                                  {canManage && (
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        if (isCompleted) return;
                                                        setEditState((prev) => ({
                                                          ...prev,
                                                          [item.id]:
                                                            prev[item.id] ?? {
                                                              vendorId: item.assigned_to_user_id ?? "",
                                                              date: toDateInput(item.visit_date),
                                                            },
                                                        }));
                                                        setEditingVisits((prev) => ({
                                                          ...prev,
                                                          [item.id]: !isEditing,
                                                        }));
                                                      }}
                                                      disabled={isCompleted}
                                                      className="rounded-full border border-sea/20 bg-white px-1.5 py-1 text-[10px] text-sea hover:border-sea"
                                                      aria-label="Editar visita"
                                                      title="Editar visita"
                                                    >
                                                      <Pencil size={12} />
                                                    </button>
                                                  )}
                                                </div>
                                              </div>

                                              <div className="min-w-0">
                                                <p className="break-words text-sm font-bold leading-tight text-ink dark:text-white">
                                                  {item.agenda?.empresa ?? "Sem nome"}
                                                </p>
                                              </div>

                                              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
                                                <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-sea/20 bg-sea/15 px-2.5 py-1.5 text-[10px] font-semibold leading-none text-sea dark:border-sea/30 dark:bg-sea/20 dark:text-emerald-300">
                                                  <span className="truncate">COD {item.agenda?.cod_1 ?? "-"}</span>
                                                </span>
                                                {item.agenda?.situacao ? (
                                                  <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-1.5 text-[10px] font-semibold leading-none text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300">
                                                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                                                    <span className="truncate">{item.agenda.situacao}</span>
                                                  </span>
                                                ) : null}
                                                {canManage && item.agenda?.categoria ? (
                                                  <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1.5 text-[10px] font-semibold leading-none text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
                                                    <TriangleAlert size={12} />
                                                    <span className="truncate">{item.agenda.categoria}</span>
                                                  </span>
                                                ) : null}
                                                {isSupervisorVisit ? (
                                                  <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-violet-300 bg-violet-100 px-2.5 py-1.5 text-[10px] font-semibold leading-none text-violet-700 dark:border-violet-400/60 dark:bg-violet-500/20 dark:text-violet-200">
                                                    Visita supervisor
                                                  </span>
                                                ) : null}
                                                {isSupervisorVisit && supervisorReasonLabel ? (
                                                  <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[10px] font-semibold leading-none text-violet-700 dark:border-violet-400/55 dark:bg-violet-500/15 dark:text-violet-200">
                                                    <span className="truncate">{supervisorReasonLabel}</span>
                                                  </span>
                                                ) : null}
                                              </div>

                                              <div className="grid gap-3 border-t border-white/10 pt-3 dark:border-white/10 md:grid-cols-2">
                                                <div className="space-y-2">
                                                  <div className="flex items-center gap-2 text-xs font-semibold text-ink/75 dark:text-white/75">
                                                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-sea/20 bg-white text-sea dark:border-white/10 dark:bg-white/5">
                                                      <Eye size={12} />
                                                    </span>
                                                    <span>Contato</span>
                                                  </div>
                                                  <div className="space-y-1 text-xs text-ink dark:text-white">
                                                    <p>
                                                      <span className="font-semibold text-ink/55 dark:text-white/55">Pessoa:</span>{" "}
                                                      {item.agenda?.pessoa ?? "-"}
                                                    </p>
                                                    <p>
                                                      <span className="font-semibold text-ink/55 dark:text-white/55">Contato:</span>{" "}
                                                      {item.agenda?.contato ?? "-"}
                                                    </p>
                                                  </div>
                                                </div>
                                                <div className="space-y-2">
                                                  <div className="flex items-center gap-2 text-xs font-semibold text-ink/75 dark:text-white/75">
                                                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-sea/20 bg-white text-sea dark:border-white/10 dark:bg-white/5">
                                                      <Calendar size={12} />
                                                    </span>
                                                    <span>Visita</span>
                                                  </div>
                                                  <div className="space-y-1 text-xs text-ink dark:text-white">
                                                    <p>
                                                      <span className="font-semibold text-ink/55 dark:text-white/55">
                                                        Perfil visita:
                                                      </span>{" "}
                                                      {item.perfil_visita ?? item.perfil_visita_opcoes ?? item.agenda?.perfil_visita ?? "-"}
                                                    </p>
                                                    {item.visit_time ? (
                                                      <p>
                                                        <span className="font-semibold text-ink/55 dark:text-white/55">
                                                          Horario visita:
                                                        </span>{" "}
                                                        {item.visit_time.slice(0, 5)}
                                                      </p>
                                                    ) : null}
                                                    {instructionText ? (
                                                      <p>
                                                        <span className="font-semibold text-ink/55 dark:text-white/55">
                                                          Instrucoes:
                                                        </span>{" "}
                                                        {instructionText}
                                                      </p>
                                                    ) : null}
                                                    {item.no_visit_reason ? (
                                                      <p>
                                                        <span className="font-semibold text-ink/55 dark:text-white/55">Motivo:</span>{" "}
                                                        {item.no_visit_reason}
                                                      </p>
                                                    ) : null}
                                                    <div className="flex items-center gap-2">
                                                      <p>
                                                        <span className="font-semibold text-ink/55 dark:text-white/55">Vidas:</span>{" "}
                                                        {item.completed_vidas ?? "-"}
                                                      </p>
                                                      {item.no_visit_observation?.trim() ? (
                                                        <button
                                                          type="button"
                                                          onClick={() => openNoVisitObservationModal(item, seller)}
                                                          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-300 bg-amber-100 text-amber-700 hover:border-amber-400 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-300"
                                                          title="Ver observacao"
                                                          aria-label="Ver observacao"
                                                        >
                                                          <TriangleAlert size={12} />
                                                        </button>
                                                      ) : null}
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>

                                              {isCompleted ? (
                                                <div className="rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-[11px] font-semibold text-red-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-red-300">
                                                  <div className="flex items-center gap-2">
                                                    <TriangleAlert size={14} />
                                                    <span>Visita registrada. Edicao bloqueada.</span>
                                                  </div>
                                                </div>
                                              ) : null}

                                              {canManage ? (
                                                canLoggedSupervisorRegister ? (
                                                  <div className="pt-1">
                                                    <button
                                                      type="button"
                                                      onClick={() => handleStartRegister(item)}
                                                      disabled={Boolean(item.no_visit_reason)}
                                                      className={registerVisitButtonClass}
                                                    >
                                                      {isCompleted
                                                        ? item.no_visit_reason
                                                          ? "Visita nao realizada"
                                                          : "Editar registro"
                                                        : "Registrar visita"}
                                                    </button>
                                                  </div>
                                                ) : null
                                              ) : (
                                                <div className="pt-1">
                                                  <button
                                                    type="button"
                                                    onClick={() => handleStartRegister(item)}
                                                    disabled={Boolean(item.no_visit_reason)}
                                                    className={registerVisitButtonClass}
                                                  >
                                                    {isCompleted
                                                      ? item.no_visit_reason
                                                        ? "Visita nao realizada"
                                                        : "Editar registro"
                                                      : "Registrar visita"}
                                                  </button>
                                                </div>
                                              )}
                                            </div>

                                            <div className="hidden space-y-3 md:block">
                                              <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div>
                                                  <div className="flex items-center gap-2">
                                                    <span
                                                      className={[
                                                        "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold",
                                                        isEditingOrder
                                                          ? "border-sea/30 bg-sea/15 text-sea"
                                                          : "border-sea/15 bg-white text-ink/60",
                                                      ].join(" ")}
                                                    >
                                                      {itemOrderLabel}
                                                    </span>
                                                    <p className="text-sm font-semibold text-ink">
                                                      {item.agenda?.empresa ?? "Sem nome"}
                                                    </p>
                                                    <span className="rounded-full bg-sea/10 px-2 py-0.5 text-[10px] font-semibold text-sea">
                                                      COD {item.agenda?.cod_1 ?? "-"}
                                                    </span>
                                                    {item.agenda?.situacao ? (
                                                      <span className="inline-flex rounded-full bg-sea/10 px-2 py-0.5 text-[10px] font-semibold text-sea">
                                                        {item.agenda.situacao}
                                                      </span>
                                                    ) : null}
                                                    {canManage && item.agenda?.categoria ? (
                                                      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                                        {item.agenda.categoria}
                                                      </span>
                                                    ) : null}
                                                    {isSupervisorVisit ? (
                                                      <span className="inline-flex rounded-full border border-violet-300 bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:border-violet-400/60 dark:bg-violet-500/20 dark:text-violet-200">
                                                        Visita supervisor
                                                      </span>
                                                    ) : null}
                                                    {isSupervisorVisit && supervisorReasonLabel ? (
                                                      <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:border-violet-400/55 dark:bg-violet-500/15 dark:text-violet-200">
                                                        {supervisorReasonLabel}
                                                      </span>
                                                    ) : null}
                                                  </div>
                                                  <p className="text-[11px] text-ink/70">
                                                    Pessoa: {item.agenda?.pessoa ?? "-"}
                                                  </p>
                                                  <p className="text-[11px] text-ink/70">
                                                    Contato: {item.agenda?.contato ?? "-"}
                                                  </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  {isEditingOrder ? (
                                                    <div
                                                      {...dragProvided.dragHandleProps}
                                                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sea/30 bg-sea/10 text-sea cursor-grab active:cursor-grabbing"
                                                      aria-label="Arrastar rota"
                                                      title="Arrastar rota"
                                                    >
                                                      <GripVertical size={13} />
                                                    </div>
                                                  ) : null}
                                                  <button
                                                    type="button"
                                                    onClick={(event) => {
                                                      event.stopPropagation();
                                                      openDetailsModal(item);
                                                    }}
                                                    className="rounded-full border border-sea/20 bg-white px-2 py-1 text-[11px] text-sea hover:border-sea"
                                                    aria-label="Visualizar detalhes da empresa"
                                                    title="Visualizar detalhes da empresa"
                                                  >
                                                    <Eye size={12} />
                                                  </button>
                                                  {mapAddress ? (
                                                    <button
                                                      type="button"
                                                      onClick={(event) => {
                                                        event.stopPropagation();
                                                        openMapApp(mapAddress);
                                                      }}
                                                      className="rounded-full border border-sea/20 bg-white px-2 py-1 text-[11px] text-sea hover:border-sea"
                                                      aria-label="Abrir mapa"
                                                      title="Abrir mapa"
                                                    >
                                                      <MapPin size={12} />
                                                    </button>
                                                  ) : null}
                                                  {canManage && (
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        if (isCompleted) return;
                                                        setEditState((prev) => ({
                                                          ...prev,
                                                          [item.id]:
                                                            prev[item.id] ?? {
                                                              vendorId: item.assigned_to_user_id ?? "",
                                                              date: toDateInput(item.visit_date),
                                                            },
                                                        }));
                                                        setEditingVisits((prev) => ({
                                                          ...prev,
                                                          [item.id]: !isEditing,
                                                        }));
                                                      }}
                                                      disabled={isCompleted}
                                                      className="rounded-full border border-sea/20 bg-white px-2 py-1 text-[11px] text-sea hover:border-sea"
                                                      aria-label="Editar visita"
                                                      title="Editar visita"
                                                    >
                                                      <Pencil size={12} />
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                            {canManage && isEditing && !isCompleted ? (
                                              <div className="mt-3 grid gap-2 md:grid-cols-3">
                                    <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                                      {isSupervisorVisit ? "Responsavel" : "Vendedor"}
                                      <select
                                        value={state.vendorId}
                                        onChange={(event) =>
                                          setEditState((prev) => ({
                                            ...prev,
                                            [item.id]: { ...state, vendorId: event.target.value },
                                          }))
                                        }
                                        className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                                      >
                                        <option value="">Selecione</option>
                                        {isSupervisorVisit
                                          ? supervisorRouteAssignees.map((assignee) => (
                                              <option key={assignee.user_id} value={assignee.user_id}>
                                                {(assignee.display_name ?? assignee.user_id) +
                                                  (assignee.role === "SUPERVISOR" ? " (Supervisor)" : " (Vendedor)")}
                                              </option>
                                            ))
                                          : vendors.map((vendor) => (
                                              <option key={vendor.user_id} value={vendor.user_id}>
                                                {vendor.display_name ?? vendor.user_id}
                                              </option>
                                            ))}
                                      </select>
                                    </label>
                                    <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                                      Data
                                      <input
                                        type="date"
                                        value={state.date}
                                        onChange={(event) =>
                                          setEditState((prev) => ({
                                            ...prev,
                                            [item.id]: { ...state, date: event.target.value },
                                          }))
                                        }
                                        className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                                      />
                                    </label>
                                    <div className="flex flex-wrap items-end gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleSaveVisit(item.id, item)}
                                        disabled={savingId === item.id || addingVendorId === item.id}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sea text-white hover:bg-seaLight disabled:opacity-60"
                                        aria-label="Salvar visita"
                                        title="Salvar visita"
                                      >
                                        {savingId === item.id ? (
                                          <LoaderCircle size={14} className="animate-spin" />
                                        ) : (
                                          <CheckCircle2 size={14} />
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleAddVendorToVisit(item.id, item)}
                                        disabled={addingVendorId === item.id || savingId === item.id}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sea/30 bg-white text-sea hover:border-sea hover:bg-sea/5 disabled:opacity-60"
                                        aria-label={isSupervisorVisit ? "Adicionar responsavel" : "Adicionar vendedor"}
                                        title={isSupervisorVisit ? "Adicionar responsavel" : "Adicionar vendedor"}
                                      >
                                        {addingVendorId === item.id ? (
                                          <LoaderCircle size={14} className="animate-spin" />
                                        ) : (
                                          <Plus size={14} />
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveVisit(item.id, item)}
                                        disabled={removingId === item.id || addingVendorId === item.id}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600 hover:border-red-300 disabled:opacity-60"
                                        aria-label="Remover visita"
                                        title="Remover visita"
                                      >
                                        {removingId === item.id ? (
                                          <LoaderCircle size={14} className="animate-spin" />
                                        ) : (
                                          <Trash2 size={14} />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                ) : canManage ? (
                                  <div className="hidden mt-3 flex-wrap items-center justify-between gap-2 md:flex">
                                    <div className="grid gap-1 text-[11px] text-ink/60">
                                      {item.visit_time ? <span>Horario visita: {item.visit_time.slice(0, 5)}</span> : null}
                                      {instructionText ? (
                                        <span>Instrucoes: {instructionText}</span>
                                      ) : null}
                                      {item.no_visit_reason ? (
                                        <span>Motivo: {item.no_visit_reason}</span>
                                      ) : null}
                                    </div>
                                    {canLoggedSupervisorRegister ? (
                                      <button
                                        type="button"
                                        onClick={() => handleStartRegister(item)}
                                        disabled={Boolean(item.no_visit_reason)}
                                        className={registerVisitButtonClass}
                                      >
                                        {isCompleted
                                          ? item.no_visit_reason
                                            ? "Visita nao realizada"
                                            : "Editar registro"
                                          : "Registrar visita"}
                                      </button>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div className="hidden mt-3 flex-wrap items-center justify-between gap-2 md:flex">
                                    <div className="grid gap-1 text-[11px] text-ink/60">
                                      <span>
                                        Perfil visita: {item.perfil_visita ?? item.perfil_visita_opcoes ?? item.agenda?.perfil_visita ?? "-"}
                                      </span>
                                      {item.visit_time ? <span>Horario visita: {item.visit_time.slice(0, 5)}</span> : null}
                                      {instructionText ? (
                                        <span>Instrucoes: {instructionText}</span>
                                      ) : null}
                                      {item.no_visit_reason ? (
                                        <span>Motivo: {item.no_visit_reason}</span>
                                      ) : null}
                                      {isCompleted ? (
                                        <div className="flex items-center gap-2">
                                          <span>Vidas: {item.completed_vidas ?? "-"}</span>
                                          {item.no_visit_observation?.trim() ? (
                                            <button
                                              type="button"
                                              onClick={() => openNoVisitObservationModal(item, seller)}
                                            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-300 bg-amber-100 text-amber-700 hover:border-amber-400 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-300"
                                              title="Ver observacao"
                                              aria-label="Ver observacao"
                                            >
                                              <TriangleAlert size={12} />
                                            </button>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleStartRegister(item)}
                                      disabled={Boolean(item.no_visit_reason)}
                                      className={registerVisitButtonClass}
                                    >
                                      {isCompleted
                                        ? item.no_visit_reason
                                          ? "Visita nao realizada"
                                          : "Editar registro"
                                        : "Registrar visita"}
                                    </button>
                                  </div>
                                )}
                              </div>
                                )}
                              </Draggable>
                            );
                          })}
                                {dropProvided.placeholder}
                              </div>
                            )}
                          </Droppable>
                        </DragDropContext>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {isVendor && blockMessage && (
              <p className="mt-4 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-bold text-red-600">
                {blockMessage}
              </p>
            )}
          </section>
        </div>
      )}

      {addVendorsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => {
              if (addVendorsSaving) return;
              setAddVendorsModal(null);
              setAddVendorsError(null);
              setAddVendorsQuery("");
            }}
            aria-label="Fechar modal de adicionar vendedores"
          />
          <div className="relative w-full max-w-2xl rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg text-ink">
                  {addVendorsModal.allowSupervisorAssignees ? "Adicionar responsaveis" : "Adicionar vendedores"}
                </h3>
                <p className="mt-1 text-xs text-ink/60">
                  Empresa: {addVendorsModal.companyName} | Data:{" "}
                  {format(new Date(`${addVendorsModal.date}T12:00:00`), "dd/MM/yyyy")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (addVendorsSaving) return;
                  setAddVendorsModal(null);
                  setAddVendorsError(null);
                  setAddVendorsQuery("");
                }}
                className="rounded-full border border-sea/30 bg-white px-3 py-1 text-xs text-ink/70 hover:border-sea disabled:opacity-60"
                disabled={addVendorsSaving}
              >
                Fechar
              </button>
            </div>

            <div className="mt-4">
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                {addVendorsModal.allowSupervisorAssignees ? "Buscar responsavel" : "Buscar vendedor"}
                <input
                  type="text"
                  value={addVendorsQuery}
                  onChange={(event) => setAddVendorsQuery(event.target.value)}
                  placeholder={
                    addVendorsModal.allowSupervisorAssignees
                      ? "Digite o nome do responsavel"
                      : "Digite o nome do vendedor"
                  }
                  className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
            </div>

            <div className="mt-4 max-h-[48vh] overflow-y-auto rounded-2xl border border-sea/15 bg-sand/20 p-3">
              {addVendorsList.length === 0 ? (
                <p className="text-sm text-ink/60">
                  {addVendorsModal.allowSupervisorAssignees
                    ? "Nenhum responsavel encontrado."
                    : "Nenhum vendedor encontrado."}
                </p>
              ) : (
                <div className="space-y-2">
                  {addVendorsList.map((vendor) => {
                    const isAlreadyLinked = addVendorsModal.existingAssigneeIds.includes(vendor.user_id);
                    const isSelected =
                      isAlreadyLinked || addVendorsModal.selectedAssigneeIds.includes(vendor.user_id);
                    return (
                      <label
                        key={vendor.user_id}
                        className={[
                          "flex items-center justify-between rounded-xl border px-3 py-2",
                          isAlreadyLinked
                            ? "border-amber-300 bg-amber-100/90"
                            : "border-sea/20 bg-white",
                        ].join(" ")}
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isAlreadyLinked || addVendorsSaving}
                            onChange={() => toggleVendorInAddModal(vendor.user_id)}
                            className="h-4 w-4 accent-sea"
                          />
                          <span
                            className={[
                              "text-sm",
                              isAlreadyLinked ? "font-semibold text-amber-900" : "text-ink",
                            ].join(" ")}
                          >
                            {vendor.display_name ?? vendor.user_id}
                            {addVendorsModal.allowSupervisorAssignees
                              ? ` ${vendor.role === "SUPERVISOR" ? "(Supervisor)" : "(Vendedor)"}`
                              : ""}
                          </span>
                        </span>
                        {isAlreadyLinked ? (
                          <span className="rounded-full border border-amber-500 bg-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                            Ja vinculado
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {addVendorsError ? (
              <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {addVendorsError}
              </p>
            ) : null}

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs text-ink/60">
                Selecionados: {addVendorsModal.selectedAssigneeIds.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (addVendorsSaving) return;
                    setAddVendorsModal(null);
                    setAddVendorsError(null);
                    setAddVendorsQuery("");
                  }}
                  className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea disabled:opacity-60"
                  disabled={addVendorsSaving}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveAddVendors}
                  className="rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                  disabled={addVendorsSaving}
                >
                  {addVendorsSaving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailsVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-6">
          <button type="button" className="absolute inset-0 bg-ink/30" onClick={closeDetailsModal} />
          <div className="relative w-full max-w-lg rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-lg text-ink">Detalhes da empresa</h3>
              <button
                type="button"
                onClick={closeDetailsModal}
                className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Fechar
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-ink/80">
              <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                <p className="text-[11px] font-semibold text-ink/60">Nome da empresa</p>
                <p className="mt-1 font-semibold text-ink">
                  {detailsVisit.agenda?.empresa ?? "-"}{" "}
                  <span className="text-sea/80">{"{"}COD {detailsVisit.agenda?.cod_1 ?? "-"}{"}"}</span>
                </p>
              </div>
              <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                <p className="text-[11px] font-semibold text-ink/60">Endereco e numero</p>
                <p className="mt-1">
                  {[detailsVisit.agenda?.endereco, detailsVisit.agenda?.complemento].filter(Boolean).join(", ") || "-"}
                </p>
              </div>
              <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                <p className="text-[11px] font-semibold text-ink/60">Regra visita</p>
                <p className="mt-1">{detailsVisit.agenda?.regra_visita_observacao ?? "-"}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                  <p className="text-[11px] font-semibold text-ink/60">Quantidade de vidas</p>
                  <p className="mt-1">{detailsVisit.agenda?.vidas_qtde ?? "-"}</p>
                </div>
                <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                  <p className="text-[11px] font-semibold text-ink/60">Corte</p>
                  <p className="mt-1">{detailsVisit.agenda?.corte ?? "-"}</p>
                </div>
                <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                  <p className="text-[11px] font-semibold text-ink/60">Vencimento</p>
                  <p className="mt-1">{detailsVisit.agenda?.venc ?? "-"}</p>
                </div>
                <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold text-ink/60">Valores dos planos</p>
                    <button
                      type="button"
                      onClick={() =>
                        void openPlanoValoresModal(detailsVisit.agenda?.cod_1, detailsVisit.agenda?.empresa ?? null)
                      }
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight"
                      title="Ver valores Titular/Dependente"
                      aria-label="Ver valores Titular e Dependente"
                    >
                      {planoValoresModal?.loading ? (
                        <LoaderCircle size={12} className="animate-spin" />
                      ) : (
                        <DollarSign size={12} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                <p className="text-[11px] font-semibold text-ink/60">Instrucoes</p>
                {canManageInstruction ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={detailsInstructionDraft}
                      onChange={(event) => setDetailsInstructionDraft(event.target.value)}
                      rows={3}
                      placeholder="Digite a instrucao desta empresa"
                      disabled={detailsInstructionSaving}
                      className="w-full rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea disabled:opacity-70"
                    />
                    <button
                      type="button"
                      onClick={handleSaveDetailsInstruction}
                      disabled={detailsInstructionSaving}
                      className="rounded-lg bg-sea px-3 py-1.5 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                    >
                      {detailsInstructionSaving ? "Salvando..." : "Salvar instrucao"}
                    </button>
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap">
                    {detailsVisit.instructions?.trim() || "-"}
                  </p>
                )}
                {detailsInstructionMessage ? (
                  <p className="mt-2 text-xs text-ink/70">{detailsInstructionMessage}</p>
                ) : null}
              </div>
              <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold text-ink/60">Obs</p>
                  {detailsObsText.trim() ? (
                    <button
                      type="button"
                      onClick={() => setDetailsObsExpanded((prev) => !prev)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300 bg-emerald-100 text-emerald-700"
                      title={detailsObsExpanded ? "Ocultar observacao" : "Ver observacao"}
                      aria-label={detailsObsExpanded ? "Ocultar observacao" : "Ver observacao"}
                    >
                      <CheckCircle2 size={14} />
                    </button>
                  ) : null}
                </div>
                {detailsObsText.trim() ? (
                  detailsObsExpanded ? (
                    <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-all text-sm">
                      {detailsObsText}
                    </p>
                  ) : null
                ) : (
                  <p className="mt-1">-</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {noVisitObservationModal && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center overflow-y-auto px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setNoVisitObservationModal(null)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-sea/20 bg-white p-6 text-ink shadow-card dark:border-sea/30 dark:bg-white/95 dark:text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg text-ink dark:text-white">Observacao da rota</h3>
                <p className="mt-1 text-xs text-ink/60 dark:text-white/65">{noVisitObservationModal.seller}</p>
              </div>
              <button
                type="button"
                onClick={() => setNoVisitObservationModal(null)}
                className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea dark:border-sea/30 dark:bg-white/80 dark:text-white/80 dark:hover:text-white"
              >
                Fechar
              </button>
            </div>
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-ink/80 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-white/90">
              <p className="whitespace-pre-wrap break-words">{noVisitObservationModal.observation}</p>
            </div>
          </div>
        </div>
      )}

      {planoValoresModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setPlanoValoresModal(null)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-lg text-ink">Valores por plano</h3>
              <button
                type="button"
                onClick={() => setPlanoValoresModal(null)}
                className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Fechar
              </button>
            </div>
            <p className="mt-2 text-xs text-ink/60">
              Empresa: {planoValoresModal.empresa ?? "-"} | COD {planoValoresModal.codigo || "-"}
            </p>
            <p className="mt-1 text-xs text-ink/60">
              Planos consultados: 2 (ODONTOART PJ INDIVIDUAL), 18 (Multiprev), 19 (Multiplus), 20 (Multimaster).
            </p>

            {planoValoresModal.loading ? (
              <div className="mt-4 inline-flex items-center gap-2 text-sm text-ink/70">
                <LoaderCircle size={14} className="animate-spin" />
                Carregando valores...
              </div>
            ) : planoValoresModal.error ? (
              <p className="mt-4 text-xs text-red-600">{planoValoresModal.error}</p>
            ) : (
              <div className="mt-4 space-y-2">
                {planoValoresModal.valores.map((plano) => (
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
                {!hasPlanoValores(planoValoresModal.valores) ? (
                  <p className="text-xs text-ink/60">Nenhum valor de plano retornado para esta empresa.</p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

      {canManageVendorRouteAccess && vendorDashboardAccessModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => (vendorDashboardAccessSaving ? null : setVendorDashboardAccessModal(null))}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Liberar proxima rota</h3>
            <p className="mt-2 text-sm text-ink/80">
              O vendedor{" "}
              <span className="font-semibold text-ink">{vendorDashboardAccessModal.vendorName}</span>{" "}
              {vendorDashboardAccessModal.grantAccess ? "tera" : "nao tera"} acesso ao bloco
              Proxima rota no dashboard em{" "}
              <span className="font-semibold text-ink">
                {format(new Date(`${vendorDashboardAccessModal.releaseDate}T12:00:00`), "dd/MM/yyyy")}
              </span>.
            </p>
            <p className="mt-2 text-xs text-amber-700">
              Aviso: essa liberacao vale apenas para esta data. Para outras datas, libere manualmente.
            </p>
            {vendorDashboardAccessError ? (
              <p className="mt-3 text-xs text-red-500">{vendorDashboardAccessError}</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVendorDashboardAccessModal(null)}
                disabled={vendorDashboardAccessSaving}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
              >
                Nao
              </button>
              <button
                type="button"
                onClick={handleConfirmVendorDashboardAccess}
                disabled={vendorDashboardAccessSaving}
                className="rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {vendorDashboardAccessSaving ? "Salvando..." : "Sim"}
              </button>
            </div>
          </div>
        </div>
      )}

      {completeVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setCompleteVisit(null)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Registrar visita</h3>
            <p className="mt-1 text-xs text-ink/60">
              {isSupervisorVisitType(completeVisit.visitType) && !completeVisit.registerLikeVendor
                ? "Preencha os dados do registro diferenciado do supervisor."
                : "Informe a quantidade de vidas, perfil e horario da visita."}
            </p>
            {isSupervisorVisitType(completeVisit.visitType) ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="inline-flex rounded-full border border-violet-300 bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                  Visita supervisor
                </span>
                {completeVisit.supervisorReason ? (
                  <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                    {SUPERVISOR_REASON_LABEL_BY_VALUE.get(completeVisit.supervisorReason) ??
                      completeVisit.supervisorReason}
                  </span>
                ) : null}
              </div>
            ) : null}
            {completeVisit.instructions ? (
              <p className="mt-2 rounded-lg border border-sea/20 bg-sand/40 px-3 py-2 text-[11px] text-ink/70">
                Instrucoes: {completeVisit.instructions}
              </p>
            ) : null}

            {isSupervisorVisitType(completeVisit.visitType) && !shouldLockSupervisorRegisterMode ? (
              <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                <p className="text-[11px] font-semibold text-violet-800">Tratar igual vendedor?</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setCompleteVisit((prev) =>
                        prev
                          ? {
                              ...prev,
                              registerLikeVendor: true,
                              quantidadeFuncionarios: "",
                              descricaoVisita: "",
                              pessoaContatoMesma: true,
                            }
                          : prev,
                      )
                    }
                    className={[
                      "rounded-lg border px-3 py-1 text-[11px] font-semibold",
                      completeVisit.registerLikeVendor
                        ? "border-sea bg-sea/20 text-sea"
                        : "border-sea/20 bg-white text-ink/70",
                    ].join(" ")}
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCompleteVisit((prev) =>
                        prev ? { ...prev, registerLikeVendor: false } : prev,
                      )
                    }
                    className={[
                      "rounded-lg border px-3 py-1 text-[11px] font-semibold",
                      !completeVisit.registerLikeVendor
                        ? "border-violet-400 bg-violet-100 text-violet-700"
                        : "border-sea/20 bg-white text-ink/70",
                    ].join(" ")}
                  >
                    Nao
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                Quantidade de vidas
                {isSupervisorVisitType(completeVisit.visitType) && !completeVisit.registerLikeVendor ? " (opcional)" : ""}
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={0}
                  step={1}
                  value={completeVisit.vidas}
                  onChange={(event) =>
                    setCompleteVisit((prev) =>
                      prev ? { ...prev, vidas: event.target.value } : prev,
                    )
                  }
                  className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
              {isSupervisorVisitType(completeVisit.visitType) && !completeVisit.registerLikeVendor ? (
                <>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    Quantidade de funcionarios
                    <input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      step={1}
                      value={completeVisit.quantidadeFuncionarios}
                      onChange={(event) =>
                        setCompleteVisit((prev) =>
                          prev ? { ...prev, quantidadeFuncionarios: event.target.value } : prev,
                        )
                      }
                      className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    Descricao da visita
                    <select
                      value={completeVisit.descricaoVisita}
                      onChange={(event) =>
                        setCompleteVisit((prev) =>
                          prev
                            ? {
                                ...prev,
                                descricaoVisita: event.target.value as SupervisorDescricaoVisita | "",
                              }
                            : prev,
                        )
                      }
                      className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    >
                      <option value="">Selecione</option>
                      {SUPERVISOR_DESCRICAO_VISITA_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    Pessoa de contato e a mesma?
                    <select
                      value={completeVisit.pessoaContatoMesma ? "SIM" : "NAO"}
                      onChange={(event) =>
                        setCompleteVisit((prev) =>
                          prev
                            ? {
                                ...prev,
                                pessoaContatoMesma: event.target.value === "SIM",
                              }
                            : prev,
                        )
                      }
                      className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    >
                      <option value="SIM">Sim</option>
                      <option value="NAO">Nao</option>
                    </select>
                  </label>
                  {!completeVisit.pessoaContatoMesma ? (
                    <>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                        Pessoa
                        <input
                          type="text"
                          value={completeVisit.pessoa}
                          onChange={(event) =>
                            setCompleteVisit((prev) =>
                              prev ? { ...prev, pessoa: event.target.value } : prev,
                            )
                          }
                          className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                        Contato
                        <input
                          type="text"
                          value={completeVisit.contato}
                          onChange={(event) =>
                            setCompleteVisit((prev) =>
                              prev ? { ...prev, contato: event.target.value } : prev,
                            )
                          }
                          className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                        />
                      </label>
                    </>
                  ) : null}
                </>
              ) : null}
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                Horario da visita
                <input
                  type="time"
                  value={completeVisit.visitTime}
                  onChange={(event) =>
                    setCompleteVisit((prev) =>
                      prev ? { ...prev, visitTime: event.target.value } : prev,
                    )
                  }
                  className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                Perfil da visita
                {completeVisit.customOptions.filter((option) => option.trim()).length > 0 ? (
                  <div className="rounded-lg border border-sea/20 bg-sand/40 px-3 py-2 text-[11px] text-ink/70">
                    Perfil visita: Horario customizado
                    <div className="mt-1 flex flex-wrap gap-1">
                      {completeVisit.customOptions
                        .filter((option) => option.trim())
                        .map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() =>
                              setCompleteVisit((prev) =>
                                prev ? { ...prev, perfil: option, customManual: false } : prev,
                              )
                            }
                            className={[
                              "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                              completeVisit.perfil === option
                                ? "border-sea bg-sea/20 text-sea"
                                : "border-sea/20 bg-white/80 text-ink/70",
                            ].join(" ")}
                          >
                            {option}
                          </button>
                        ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setCompleteVisit((prev) =>
                            prev ? { ...prev, customEditEnabled: !prev.customEditEnabled } : prev,
                          )
                        }
                        className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1 text-[10px] font-semibold text-ink/70"
                      >
                        {completeVisit.customEditEnabled ? "Fechar edicao" : "Editar horarios"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCompleteVisit((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  customManual: true,
                                  customTime: prev.customTime || "",
                                }
                              : prev,
                          )
                        }
                        className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1 text-[10px] font-semibold text-ink/70"
                      >
                        Outro horario
                      </button>
                    </div>
                    {completeVisit.customEditEnabled && (
                      <div className="mt-2 space-y-2">
                        {completeVisit.customOptions.map((time, index) => (
                          <div key={`${time}-${index}`} className="flex items-center gap-2">
                            <input
                              type="time"
                              value={time}
                              onChange={(event) => {
                                const next = [...completeVisit.customOptions];
                                next[index] = event.target.value;
                                updateCustomOptions(next);
                              }}
                              className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                            />
                            {completeVisit.customOptions.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const next = completeVisit.customOptions.filter((_, idx) => idx !== index);
                                  updateCustomOptions(next.length ? next : [""]);
                                }}
                                className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-[10px] text-ink/70"
                              >
                                Remover
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => updateCustomOptions([...completeVisit.customOptions, ""])}
                          className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-[10px] text-ink/70"
                        >
                          Adicionar horario
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <select
                    value={
                      completeVisit.customManual
                        ? "__custom__"
                        : completeVisit.singleTimeBase || getSingleTimePerfilBase(completeVisit.perfil) || completeVisit.perfil
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "__custom__") {
                        setCompleteVisit((prev) =>
                          prev
                            ? {
                                ...prev,
                                customManual: true,
                                singleTimeBase: "",
                                singleTimeValue: "",
                                customTime: prev.customManual ? prev.customTime : "",
                                perfil: prev.customManual ? prev.customTime : "",
                              }
                            : prev,
                        );
                      } else if (value === "ALMOCO" || value === "JANTAR") {
                        setCompleteVisit((prev) =>
                          prev
                            ? {
                                ...prev,
                                customManual: false,
                                singleTimeBase: value,
                                singleTimeValue: "",
                                perfil: value,
                              }
                            : prev,
                        );
                      } else {
                        setCompleteVisit((prev) =>
                          prev
                            ? {
                                ...prev,
                                customManual: false,
                                singleTimeBase: "",
                                singleTimeValue: "",
                                perfil: value,
                              }
                            : prev,
                        );
                      }
                    }}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  >
                    <option value="">Selecione</option>
                    {PERFIL_VISITA_PRESETS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                    <option value="__custom__">Outro horario</option>
                  </select>
                )}
              </label>
              {((completeVisit.singleTimeBase || getSingleTimePerfilBase(completeVisit.perfil)) === "ALMOCO" ||
                (completeVisit.singleTimeBase || getSingleTimePerfilBase(completeVisit.perfil)) === "JANTAR") && (
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  HH:MM
                  <input
                    type="time"
                    value={completeVisit.singleTimeValue || getSingleTimePerfilValue(completeVisit.perfil)}
                    onChange={(event) =>
                      setCompleteVisit((prev) =>
                        prev
                          ? {
                              ...prev,
                              singleTimeValue: event.target.value,
                              perfil: event.target.value
                                ? `${prev.singleTimeBase || getSingleTimePerfilBase(prev.perfil)} ${event.target.value}`
                                : prev.singleTimeBase || getSingleTimePerfilBase(prev.perfil) || "",
                            }
                          : prev,
                      )
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
              )}
              {completeVisit.customManual && (
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Horario customizado
                  <input
                    type="time"
                    value={completeVisit.customTime}
                    onChange={(event) =>
                      setCompleteVisit((prev) =>
                        prev
                          ? {
                              ...prev,
                              customTime: event.target.value,
                              perfil: event.target.value,
                            }
                          : prev,
                      )
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
              )}
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setCompleteVisit(null)}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmVisit}
                disabled={savingId === completeVisit.id}
                className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {savingId === completeVisit.id ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setConfirmVisit(null)}
          />
          <div className="relative w-full max-w-sm rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Visita feita?</h3>
            <p className="mt-1 text-xs text-ink/60">
              Confirme se a visita foi realizada.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmVisit(null);
                setNoVisit({ id: confirmVisit.id, reason: "", observation: "" });
              }}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Nao
              </button>
              <button
                type="button"
                onClick={() => {
                  const visit = confirmVisit;
                  setConfirmVisit(null);
                  if (visit) {
                    void openCompleteModal(visit);
                  }
                }}
                className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight"
              >
                Sim
              </button>
            </div>
          </div>
        </div>
      )}

      {noVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setNoVisit(null)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Motivo da visita nao realizada</h3>
            <p className="mt-1 text-xs text-ink/60">
              Selecione o motivo.
            </p>
            <div className="mt-4">
              <select
                value={noVisit.reason}
                onChange={(event) =>
                  setNoVisit((prev) => (prev ? { ...prev, reason: event.target.value } : prev))
                }
                className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
              >
                <option value="">Selecione</option>
                {NO_VISIT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                </option>
              ))}
              </select>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-ink/70">
                Observacao (opcional)
                <textarea
                  value={noVisit.observation}
                  onChange={(event) =>
                    setNoVisit((prev) => (prev ? { ...prev, observation: event.target.value } : prev))
                  }
                  rows={4}
                  placeholder="Descreva a observacao desta rota"
                  className="mt-2 w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setNoVisit(null)}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmNoVisit}
                disabled={savingId === noVisit.id}
                className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {savingId === noVisit.id ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




