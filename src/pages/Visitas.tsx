import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, endOfMonth, format, isAfter, isSameDay, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Eye,
  Lock,
  LockOpen,
  LoaderCircle,
  MapPin,
  Pencil,
} from "lucide-react";
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

type VisitRow = {
  id: string;
  cliente_id?: string | null;
  visit_date: string;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  perfil_visita: string | null;
  perfil_visita_opcoes?: string | null;
  route_id: string | null;
  completed_at: string | null;
  completed_vidas: number | null;
  no_visit_reason: string | null;
  instructions: string | null;
  agenda?: {
    id: string;
    empresa: string | null;
    nome_fantasia: string | null;
    cod_1?: string | null;
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
    perfil_visita: string | null;
    supervisor?: string | null;
  } | null;
  cliente?: ClienteCanonicalModalRow | null;
};

type ClienteCanonicalModalRow = {
  id: string;
  codigo: string | null;
  corte: number | null;
  venc: number | null;
  valor: number | null;
  data_da_ultima_visita: string | null;
  empresa: string | null;
  pessoa: string | null;
  contato: string | null;
  obs_comercial: string | null;
  nome_fantasia: string | null;
  complemento: string | null;
  perfil_visita: string | null;
  situacao: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
};

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

type VendorDashboardAccessModalState = {
  vendorUserId: string;
  vendorName: string;
  releaseDate: string;
  grantAccess: boolean;
};

const formatDateKey = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return format(new Date(value), "yyyy-MM-dd");
};

const getDateKey = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const toDateInput = (value: string | null) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const normalize = (value: string | null) => normalizeSearchText(value);

const CLIENTE_CANONICAL_MODAL_SELECT =
  "id, codigo, corte, venc, valor, data_da_ultima_visita, empresa, pessoa, contato, obs_comercial, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf";

const formatCurrency = (value?: number | null) => {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
};

const NO_VISIT_REASONS = [
  "NAO AUTORIZADO",
  "NAO CHEGOU A TEMPO",
  "ENDERECO NAO LOCALIZADO",
  "AUSENTE NO DIA",
];
const SHOW_VENDOR_LOCK_ICON = false;

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
  const canManageInstruction = role === "SUPERVISOR";
  const canAccess = canManage || isVendor;
  const canFilterBySupervisor = role === "ASSISTENTE" || role === "SUPERVISOR";
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [editState, setEditState] = useState<Record<string, { vendorId: string; date: string }>>({});
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [editingVisits, setEditingVisits] = useState<Record<string, boolean>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addingVendorId, setAddingVendorId] = useState<string | null>(null);
  const [maxVisibleDate, setMaxVisibleDate] = useState<string | null>(null);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);
  const [supervisores, setSupervisores] = useState<
    { id: string; user_id: string | null; display_name: string | null }[]
  >([]);
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>("all");
  const restoredViewRef = useRef(false);
  const pendingModalRestoreRef = useRef<{
    confirmVisitId: string | null;
    noVisit: { id: string; reason: string } | null;
    completeVisit:
      | {
          id: string;
          vidas: string;
          perfil: string;
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
      }>;
      if (parsed.currentMonth) setCurrentMonth(new Date(parsed.currentMonth));
      if (parsed.selectedDate) setSelectedDate(new Date(parsed.selectedDate));
      if (parsed.expandedVendor) setExpandedVendor(parsed.expandedVendor);
      if (parsed.selectedSupervisorId) setSelectedSupervisorId(parsed.selectedSupervisorId);
      restoredViewRef.current = true;
    } catch {
      restoredViewRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!restoredViewRef.current) return;
    const payload = {
      currentMonth: currentMonth.toISOString(),
      selectedDate: selectedDate ? selectedDate.toISOString() : null,
      expandedVendor,
      selectedSupervisorId,
    };
    try {
      sessionStorage.setItem("visitasViewState", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [currentMonth, expandedVendor, selectedDate, selectedSupervisorId]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("visitasModalState");
      if (!raw) {
        setRestoredModalState(true);
        return;
      }
      const parsed = JSON.parse(raw) as {
        confirmVisitId?: string | null;
        noVisit?: { id: string; reason: string } | null;
        completeVisit?: {
          id: string;
          vidas: string;
          perfil: string;
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
  const [noVisit, setNoVisit] = useState<{ id: string; reason: string } | null>(null);
  const [restoredModalState, setRestoredModalState] = useState(false);
  const [completeVisit, setCompleteVisit] = useState<{
    id: string;
    vidas: string;
    perfil: string;
    customManual: boolean;
    customTime: string;
    singleTimeBase: string;
    singleTimeValue: string;
    customOptions: string[];
    customEditEnabled: boolean;
    instructions: string;
  } | null>(null);
  const [detailsVisit, setDetailsVisit] = useState<VisitRow | null>(null);
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

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    const loadVendors = () => {
      fetchVendedores()
        .then((data) => {
          if (active) setVendors(data as VendorOption[]);
        })
        .catch((err) => {
          console.error(err);
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
        console.error(supaError);
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

    const load = async () => {
      if (!active) return;
      setLoading(true);
      setError(null);

      const start = startOfMonth(currentMonth);
      const end = endOfMonth(currentMonth);
      const startDate = format(start, "yyyy-MM-dd");
      const endDate = format(end, "yyyy-MM-dd");
      const baseDate = new Date();
      const todayKey = getDateKey(baseDate);
      const yesterdayKey = getDateKey(addDays(baseDate, -1));
      const tomorrowKey = getDateKey(addDays(baseDate, 1));
      const canUnlockTomorrowByTime = baseDate.getHours() >= 19;
      let effectiveEnd = endDate;
      let maxDate = endDate;

      if (isVendor) {
        let blockReason: string | null = null;
        const applyVendorVisitFilter = <TQuery,>(query: TQuery) => {
          if (session?.user.id && profile?.display_name) {
            return (query as TQuery & { or: (filters: string) => TQuery }).or(
              `assigned_to_user_id.eq.${session.user.id},assigned_to_name.eq.${profile.display_name}`,
            );
          }
          if (session?.user.id) {
            return (query as TQuery & { eq: (column: string, value: string) => TQuery }).eq(
              "assigned_to_user_id",
              session.user.id,
            );
          }
          if (profile?.display_name) {
            return (query as TQuery & { eq: (column: string, value: string) => TQuery }).eq(
              "assigned_to_name",
              profile.display_name,
            );
          }
          return query;
        };

        const fetchPendingVisitCount = async (dateKey: string) => {
          let query = supabase
            .from("visits")
            .select("id", { count: "exact", head: true })
            .eq("visit_date", dateKey)
            .is("completed_at", null);
          query = applyVendorVisitFilter(query);
          const { count, error: countError } = await query;
          if (countError) throw new Error(countError.message);
          return count ?? 0;
        };

        const fetchCompletedVisitCount = async (dateKey: string) => {
          let query = supabase
            .from("visits")
            .select("id", { count: "exact", head: true })
            .eq("visit_date", dateKey)
            .not("completed_at", "is", null)
            .is("no_visit_reason", null);
          query = applyVendorVisitFilter(query);
          const { count, error: countError } = await query;
          if (countError) throw new Error(countError.message);
          return count ?? 0;
        };

        const hasAceiteDigital = async (dateKey: string) => {
          if (!session?.user.id) return false;
          const { count, error: aceiteError } = await supabase
            .from("aceite_digital")
            .select("id", { count: "exact", head: true })
            .eq("vendor_user_id", session.user.id)
            .eq("entry_date", dateKey);
          if (aceiteError) throw new Error(aceiteError.message);
          return (count ?? 0) > 0;
        };

        const resolveDayGate = async (
          dateKey: string,
          pendingReason: string,
          acceptanceReason: string,
        ) => {
          const [pendingCount, completedCount] = await Promise.all([
            fetchPendingVisitCount(dateKey),
            fetchCompletedVisitCount(dateKey),
          ]);

          if (pendingCount > 0) {
            return { blocked: true, reason: pendingReason };
          }

          if (completedCount > 0) {
            const accepted = await hasAceiteDigital(dateKey);
            if (!accepted) {
              return { blocked: true, reason: acceptanceReason };
            }
          }

          return { blocked: false, reason: null };
        };

        try {
          const yesterdayGate = await resolveDayGate(
            yesterdayKey,
            "Conclua todas as visitas de ontem para ver as visitas de hoje.",
            "Registre o aceite digital de ontem para ver as visitas de hoje.",
          );

          if (yesterdayGate.blocked) {
            maxDate = yesterdayKey;
            blockReason = yesterdayGate.reason;
          } else {
            const todayGate = await resolveDayGate(
              todayKey,
              "Conclua todas as visitas de hoje para ver as visitas de amanha.",
              "Registre o aceite digital de hoje para ver as visitas de amanha.",
            );

            if (todayGate.blocked) {
              maxDate = todayKey;
              blockReason = todayGate.reason;
            } else if (!canUnlockTomorrowByTime) {
              maxDate = todayKey;
              blockReason = "A agenda de amanha sera liberada a partir das 19:00.";
            } else {
              maxDate = tomorrowKey;
            }
          }
        } catch (gateError) {
          console.error(gateError);
          maxDate = todayKey;
          blockReason = "Nao foi possivel validar as pendencias do vendedor.";
        }

        if (blockReason) {
          if (!active) return;
          setBlockMessage(blockReason);
        } else {
          if (!active) return;
          setBlockMessage(null);
        }

        if (!active) return;
        setMaxVisibleDate(maxDate);
        effectiveEnd = maxDate < endDate ? maxDate : endDate;
        if (effectiveEnd < startDate) {
          if (!active) return;
          setVisits([]);
          setLoading(false);
          return;
        }
      } else {
        if (!active) return;
        setMaxVisibleDate(null);
        setBlockMessage(null);
      }

      let visitsQuery = supabase
        .from("visits")
        .select(
          "id, cliente_id, visit_date, assigned_to_user_id, assigned_to_name, perfil_visita, perfil_visita_opcoes, route_id, completed_at, completed_vidas, no_visit_reason, instructions, cliente:cliente_id (id, codigo, corte, venc, valor, data_da_ultima_visita, empresa, pessoa, contato, obs_comercial, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf)",
        )
        .gte("visit_date", startDate)
        .lte("visit_date", effectiveEnd)
        .order("visit_date", { ascending: true });

      if (isVendor) {
        if (session?.user.id && profile?.display_name) {
          visitsQuery = visitsQuery.or(
            `assigned_to_user_id.eq.${session.user.id},assigned_to_name.eq.${profile.display_name}`,
          );
        } else if (session?.user.id) {
          visitsQuery = visitsQuery.eq("assigned_to_user_id", session.user.id);
        } else if (profile?.display_name) {
          visitsQuery = visitsQuery.eq("assigned_to_name", profile.display_name);
        }
      }

      const { data, error: supaError } = await visitsQuery;
      if (!active) return;

      if (supaError) {
        setError(supaError.message);
        setVisits([]);
      } else {
        type VisitRowJoin = VisitRow & {
          cliente?: VisitRow["cliente"] | VisitRow["cliente"][] | null;
        };
        const agendaFromCliente = (cliente: ClienteCanonicalModalRow): NonNullable<VisitRow["agenda"]> => ({
          id: cliente.id,
          empresa: cliente.empresa,
          nome_fantasia: cliente.nome_fantasia,
          cod_1: cliente.codigo,
          corte: cliente.corte,
          venc: cliente.venc,
          valor: cliente.valor,
          obs_contrato_1: cliente.obs_comercial,
          pessoa: cliente.pessoa,
          contato: cliente.contato,
          instructions: null,
          endereco: cliente.endereco,
          complemento: cliente.complemento,
          bairro: cliente.bairro,
          cidade: cliente.cidade,
          uf: cliente.uf,
          situacao: cliente.situacao,
          perfil_visita: cliente.perfil_visita,
          supervisor: null,
        });
        const normalized = (data ?? []).map((row) => {
          const item = row as VisitRowJoin;
          const cliente = Array.isArray(item.cliente) ? item.cliente[0] ?? null : item.cliente ?? null;
          return { ...item, agenda: cliente ? agendaFromCliente(cliente) : null, cliente };
        }) as VisitRow[];
        setVisits(normalized);
      }

      if (!active) return;
      setLoading(false);
    };

    void load().catch((err) => {
      if (!active) return;
      setError(err instanceof Error ? err.message : "Erro ao carregar visitas.");
      setVisits([]);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [currentMonth, refreshKey, isVendor, profile?.display_name, session?.user.id]);

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

  const filteredVisits = useMemo(() => {
    if (!canManage || !canFilterBySupervisor || selectedSupervisorId === "all") return visits;
    const supervisor = supervisores.find(
      (item) => item.id === selectedSupervisorId || item.user_id === selectedSupervisorId,
    );
    const supervisorName = supervisor?.display_name ? normalize(supervisor.display_name) : "";
    const supervisorIds = new Set<string>();
    if (supervisor?.id) supervisorIds.add(supervisor.id);
    if (supervisor?.user_id) supervisorIds.add(supervisor.user_id);
    const vendorIds = vendors
      .filter((vendor) => (vendor.supervisor_id ? supervisorIds.has(vendor.supervisor_id) : false))
      .map((vendor) => vendor.user_id)
      .filter(Boolean);
    const vendorNames = vendors
      .filter((vendor) => (vendor.supervisor_id ? supervisorIds.has(vendor.supervisor_id) : false))
      .map((vendor) => vendor.display_name)
      .filter((value): value is string => Boolean(value))
      .map((value) => normalize(value));
    const vendorIdSet = new Set(vendorIds);
    const vendorNameSet = new Set(vendorNames);
    if (vendorIdSet.size === 0 && vendorNameSet.size === 0) return [];
    return visits.filter((visit) => {
      if (visit.assigned_to_user_id && vendorIdSet.has(visit.assigned_to_user_id)) return true;
      if (visit.assigned_to_name && vendorNameSet.has(normalize(visit.assigned_to_name))) return true;
      if (supervisorName && visit.agenda?.supervisor) {
        return normalize(visit.agenda.supervisor) === supervisorName;
      }
      return false;
    });
  }, [canManage, canFilterBySupervisor, selectedSupervisorId, supervisores, vendors, visits]);

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
    const key = format(selectedDate, "yyyy-MM-dd");
    return visitsByDate.get(key) ?? [];
  }, [selectedDate, visitsByDate]);

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
  const vendorByName = useMemo(() => {
    const map = new Map<string, VendorOption>();
    vendors.forEach((vendor) => {
      const normalizedName = normalize(vendor.display_name);
      if (!normalizedName || map.has(normalizedName)) return;
      map.set(normalizedName, vendor);
    });
    return map;
  }, [vendors]);
  const selectedDateKey = useMemo(
    () => (selectedDate ? format(selectedDate, "yyyy-MM-dd") : ""),
    [selectedDate],
  );
  const groupedBySeller = useMemo(() => {
    const groups: Record<string, VisitRow[]> = {};
    selectedVisits.forEach((visit) => {
      const seller =
        visit.assigned_to_name ??
        (visit.assigned_to_user_id
          ? vendorById.get(visit.assigned_to_user_id)?.display_name
          : null) ??
        "Sem vendedor";
      if (!groups[seller]) groups[seller] = [];
      groups[seller].push(visit);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [selectedVisits, vendorById]);
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
      if (!canManage || !selectedDateKey) {
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
        console.error(releasesError);
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
  }, [canManage, groupedBySeller, resolveSellerVendor, selectedDateKey]);

  useEffect(() => {
    if (!visits.length) {
      setEditState({});
      setEditingVisits({});
      return;
    }
    setEditState((prev) => {
      const next: Record<string, { vendorId: string; date: string }> = { ...prev };
      const validIds = new Set(visits.map((visit) => visit.id));
      Object.keys(next).forEach((id) => {
        if (!validIds.has(id)) {
          delete next[id];
        }
      });
      visits.forEach((visit) => {
        if (!next[visit.id]) {
          const vendorName = visit.assigned_to_name ?? "";
          const matchedVendor =
            visit.assigned_to_user_id
              ? vendors.find((vendor) => vendor.user_id === visit.assigned_to_user_id)
              : vendors.find((vendor) => normalize(vendor.display_name) === normalize(vendorName));
          next[visit.id] = {
            vendorId: matchedVendor?.user_id ?? "",
            date: toDateInput(visit.visit_date),
          };
        } else {
          if (!next[visit.id].date) {
            next[visit.id].date = toDateInput(visit.visit_date);
          }
          if (!next[visit.id].vendorId) {
            const vendorName = visit.assigned_to_name ?? "";
            const matchedVendor =
              visit.assigned_to_user_id
                ? vendors.find((vendor) => vendor.user_id === visit.assigned_to_user_id)
                : vendors.find((vendor) => normalize(vendor.display_name) === normalize(vendorName));
            if (matchedVendor) {
              next[visit.id].vendorId = matchedVendor.user_id;
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
  }, [visits, vendors]);

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
        name: `Visitas ${displayDate} - ${vendorName || "Vendedor"}`,
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

  const isSameVisitVendor = (visit: VisitRow, vendorId: string, vendorName: string) =>
    (visit.assigned_to_user_id && visit.assigned_to_user_id === vendorId) ||
    (!visit.assigned_to_user_id && normalize(visit.assigned_to_name) === normalize(vendorName));

  const handleSaveVisit = async (visitId: string) => {
    const state = editState[visitId];
    if (!state) return;
    if (!state.date) {
      setError("Selecione a data da visita.");
      return;
    }
    if (!state.vendorId) {
      setError("Selecione o vendedor.");
      return;
    }

    const visit = visits.find((item) => item.id === visitId);
    if (!visit) return;
    const companyId = visit.cliente_id ?? null;
    if (!companyId) {
      setError("Empresa da visita nao encontrada.");
      return;
    }
    if (visit.completed_at) {
      setError("Visita registrada. Edicao bloqueada.");
      return;
    }

    const vendor = vendorById.get(state.vendorId);
    const vendorName = vendor?.display_name ?? vendor?.user_id ?? visit.assigned_to_name ?? "Sem vendedor";

    setSavingId(visitId);
    setError(null);
    try {
      const routeId = await ensureRoute(state.vendorId, vendorName, state.date);
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
        if (targetVisit.route_id !== routeId || normalize(targetVisit.assigned_to_name) !== normalize(vendorName)) {
          const { error: updateTargetError } = await supabase
            .from("visits")
            .update({
              assigned_to_name: vendorName,
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

        const { error: deleteError } = await supabase.from("visits").delete().eq("id", visitId);
        if (deleteError) throw new Error(deleteError.message);

        setRefreshKey((prev) => prev + 1);
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
          assigned_to_name: vendorName,
          visit_date: state.date,
          route_id: routeId,
        })
        .eq("id", visitId);

      if (updateError) throw new Error(updateError.message);

      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar visita.");
    } finally {
      setSavingId(null);
    }
  };

  const handleAddVendorToVisit = async (visitId: string) => {
    const state = editState[visitId];
    if (!state) return;
    if (!state.date) {
      setError("Selecione a data da visita.");
      return;
    }
    if (!state.vendorId) {
      setError("Selecione o vendedor.");
      return;
    }

    const visit = visits.find((item) => item.id === visitId);
    if (!visit) return;
    const companyId = visit.cliente_id ?? null;
    if (!companyId) {
      setError("Empresa da visita nao encontrada.");
      return;
    }
    if (visit.completed_at) {
      setError("Visita registrada. Edicao bloqueada.");
      return;
    }

    const vendor = vendorById.get(state.vendorId);
    const vendorName = vendor?.display_name ?? vendor?.user_id ?? "Sem vendedor";
    if (isSameVisitVendor(visit, state.vendorId, vendorName)) {
      setError("Selecione um vendedor diferente para adicionar.");
      return;
    }

    setAddingVendorId(visitId);
    setError(null);
    try {
      const { data: existingVisit, error: existingVisitError } = await supabase
        .from("visits")
        .select("id")
        .eq("cliente_id", companyId)
        .eq("assigned_to_user_id", state.vendorId)
        .eq("visit_date", state.date)
        .maybeSingle();
      if (existingVisitError) throw new Error(existingVisitError.message);
      if (existingVisit?.id) {
        setError("Este vendedor ja esta vinculado a empresa nessa data.");
        return;
      }

      const routeId = await ensureRoute(state.vendorId, vendorName, state.date);
      const { error: insertError } = await supabase.from("visits").insert({
        cliente_id: companyId,
        assigned_to_user_id: state.vendorId,
        assigned_to_name: vendorName,
        visit_date: state.date,
        perfil_visita: visit.perfil_visita ?? null,
        perfil_visita_opcoes: visit.perfil_visita_opcoes ?? null,
        instructions: visit.instructions ?? null,
        route_id: routeId,
        created_by: session?.user.id ?? null,
      });
      if (insertError) throw new Error(insertError.message);

      await ensureRouteStop(routeId, companyId);
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao adicionar vendedor na visita.");
    } finally {
      setAddingVendorId(null);
    }
  };

  const handleRemoveVisit = async (visitId: string) => {
    const confirmRemove = window.confirm("Remover esta visita e voltar para a agenda?");
    if (!confirmRemove) return;
    setRemovingId(visitId);
    setError(null);
    try {
      const visit = visits.find((item) => item.id === visitId);
      if (!visit) {
        setRemovingId(null);
        return;
      }

      if (visit.route_id && visit.cliente_id) {
        const { error: deleteStopError } = await supabase
          .from("route_stops")
          .delete()
          .eq("route_id", visit.route_id)
          .eq("cliente_id", visit.cliente_id);
        if (deleteStopError) throw new Error(deleteStopError.message);
      }

      const { error: deleteError } = await supabase.from("visits").delete().eq("id", visitId);
      if (deleteError) throw new Error(deleteError.message);

      if (visit.cliente_id) {
        const { count, error: countError } = await supabase
          .from("visits")
          .select("id", { count: "exact", head: true })
          .eq("cliente_id", visit.cliente_id);

        if (countError) throw new Error(countError.message);

        if ((count ?? 0) === 0) {
          const { error: updateError } = await supabase
            .from("clientes")
            .update({ visit_generated_at: null })
            .eq("id", visit.cliente_id);
          if (updateError) throw new Error(updateError.message);
        }
      }

      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover visita.");
    } finally {
      setRemovingId(null);
    }
  };

  const openCompleteModal = (item: VisitRow) => {
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
    setCompleteVisit({
      id: item.id,
      vidas: item.completed_vidas?.toString() ?? "",
      perfil: selectedPerfil,
      customManual: false,
      customTime: hasCustomOptions ? selectedPerfil : "",
      singleTimeBase: singleTimeBase ?? "",
      singleTimeValue,
      customOptions: hasCustomOptions ? customOptions : [],
      customEditEnabled: false,
      instructions: item.instructions ?? "",
    });
  };

  const handleStartRegister = (item: VisitRow) => {
    setConfirmVisit(item);
  };

  const fetchObsComercialFromClientes = async (visit?: VisitRow | null) => {
    const agenda = visit?.agenda;
    if (!agenda) return null;

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
      try {
        const fromEndpoint = await fetchObservacaoComercialByEmpresaId(codigo);
        if (fromEndpoint?.trim()) return fromEndpoint.trim();
      } catch (error) {
        console.error(error);
      }

      const { data, error } = await supabase
        .from("clientes")
        .select("obs_comercial")
        .eq("codigo", codigo)
        .limit(1);
      if (!error && data && data.length > 0) {
        return (data[0] as { obs_comercial?: string | null }).obs_comercial ?? null;
      }
    }

    const empresa = agenda.empresa?.trim();
    const nomeFantasia = agenda.nome_fantasia?.trim();
    if (empresa && nomeFantasia) {
      const { data, error } = await supabase
        .from("clientes")
        .select("obs_comercial")
        .eq("empresa", empresa)
        .eq("nome_fantasia", nomeFantasia)
        .limit(1);
      if (!error && data && data.length > 0) {
        return (data[0] as { obs_comercial?: string | null }).obs_comercial ?? null;
      }
    }
    if (empresa) {
      const { data, error } = await supabase
        .from("clientes")
        .select("obs_comercial")
        .eq("empresa", empresa)
        .limit(1);
      if (!error && data && data.length > 0) {
        return (data[0] as { obs_comercial?: string | null }).obs_comercial ?? null;
      }
    }
    if (nomeFantasia) {
      const { data, error } = await supabase
        .from("clientes")
        .select("obs_comercial")
        .eq("nome_fantasia", nomeFantasia)
        .limit(1);
      if (!error && data && data.length > 0) {
        return (data[0] as { obs_comercial?: string | null }).obs_comercial ?? null;
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
        console.error(error);
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
    setDetailsInstructionDraft(item.instructions ?? "");
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
        console.error(err);
      });

    if (item.agenda) {
      fetchAgendaCanonicalFromClientes(item)
        .then((hydratedAgenda) => {
          if (detailsObsRequestRef.current !== requestId) return;
          if (!hydratedAgenda) return;

          setVisits((prev) =>
            prev.map((visit) =>
              visit.id === item.id
                ? {
                    ...visit,
                    agenda: hydratedAgenda,
                  }
                : visit,
            ),
          );

          setDetailsVisit((prev) =>
            prev && prev.id === item.id
              ? {
                  ...prev,
                  agenda: hydratedAgenda,
                }
              : prev,
          );
        })
        .catch((err) => {
          console.error(err);
        });
    }
  };

  const closeDetailsModal = () => {
    detailsObsRequestRef.current += 1;
    setDetailsVisit(null);
    setDetailsObsExpanded(false);
    setDetailsObsText("");
    setDetailsInstructionDraft("");
    setDetailsInstructionSaving(false);
    setDetailsInstructionMessage(null);
    setPlanoValoresModal(null);
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

  const handleSaveDetailsInstruction = async () => {
    if (!detailsVisit || !canManageInstruction) return;

    const nextInstructions = detailsInstructionDraft.trim() || null;
    const visitId = detailsVisit.id;

    setDetailsInstructionSaving(true);
    setDetailsInstructionMessage(null);
    try {
      const { error: visitsError } = await supabase
        .from("visits")
        .update({ instructions: nextInstructions })
        .eq("id", visitId);
      if (visitsError) throw new Error(visitsError.message);

      setVisits((prev) =>
        prev.map((item) =>
          item.id === visitId
            ? {
                ...item,
                instructions: nextInstructions,
              }
            : item,
        ),
      );
      setDetailsVisit((prev) =>
        prev && prev.id === visitId
          ? {
              ...prev,
              instructions: nextInstructions,
            }
          : prev,
      );
      setCompleteVisit((prev) =>
        prev && prev.id === visitId ? { ...prev, instructions: nextInstructions ?? "" } : prev,
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
        })
        .eq("id", noVisit.id);

      if (updateError) throw new Error(updateError.message);

      setNoVisit(null);
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registrar visita.");
    } finally {
      setSavingId(null);
    }
  };

  const handleConfirmVisit = async () => {
    if (!completeVisit) return;
    const vidasValue = completeVisit.vidas.trim();
    if (!vidasValue) {
      setError("Informe a quantidade de vidas.");
      return;
    }
    if (!/^\d+$/.test(vidasValue)) {
      setError("Quantidade de vidas deve conter apenas numeros.");
      return;
    }
    const vidas = Number(vidasValue);
    if (!Number.isInteger(vidas) || vidas < 0) {
      setError("Quantidade de vidas deve ser um numero inteiro valido.");
      return;
    }
    if (!completeVisit.perfil) {
      setError("Selecione o horario da visita.");
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
      const perfilOpcoesString = normalizedOptions.length > 0 ? normalizedOptions.join(" • ") : null;

      const completedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("visits")
        .update({
          completed_at: completedAt,
          completed_vidas: vidas,
          perfil_visita: completeVisit.perfil,
          perfil_visita_opcoes: perfilOpcoesString,
          no_visit_reason: null,
        })
        .eq("id", completeVisit.id);

      if (updateError) throw new Error(updateError.message);

      if (visit.cliente_id) {
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
      setRefreshKey((prev) => prev + 1);
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

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-ink">Agenda</h2>
            <p className="mt-2 text-sm text-ink/60">
              Calendario de visitas por vendedor. Clique em um dia para ver as visitas detalhadas.
            </p>
          </div>
          {canFilterBySupervisor && (
            <label className="flex min-w-[220px] flex-col gap-1 text-xs font-semibold text-ink/70">
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
          )}
        </div>
      </header>

      {!canAccess ? (
        <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
          Este modulo e restrito a usuarios autorizados.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <section className="rounded-2xl border border-sea/15 bg-white/95 p-4 shadow-card">
            <div className="flex items-center justify-between">
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

            <div className="mt-4 grid grid-cols-7 gap-2 text-center text-xs text-ink/60">
              {["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"].map((day) => (
                <span key={day} className="font-semibold">
                  {day}
                </span>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-7 gap-2">
              {calendarCells.map((day, index) => {
                if (!day) {
                  return <div key={`calendar-empty-${index}`} aria-hidden="true" className="h-16 rounded-xl" />;
                }

                const key = format(day, "yyyy-MM-dd");
                const count = visitsByDate.get(key)?.length ?? 0;
                const hasVisits = count > 0;
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
                        ? `${count} visita(s) em ${format(day, "dd/MM/yyyy")}`
                        : undefined
                    }
                    className={[
                      "relative flex h-16 flex-col items-center justify-center rounded-xl border px-1 text-xs transition",
                      isSelected ? "border-orange-300" : "border-sea/20 bg-white",
                      isSelected
                        ? "bg-orange-200 shadow-lg shadow-orange-200/70 ring-2 ring-orange-200"
                        : "hover:border-sea hover:bg-sand/40",
                      hasVisits && !isSelected ? "ring-1 ring-sea/35 shadow-sm" : "",
                      isDisabled ? "cursor-not-allowed opacity-40 hover:border-sea/20 hover:bg-white/50" : "",
                    ].join(" ")}
                  >
                    {hasVisits ? (
                      <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-orange-300 bg-orange-100 text-orange-600">
                        <MapPin size={11} strokeWidth={2.5} />
                        <span className="sr-only">{count} visita(s) no dia</span>
                      </span>
                    ) : null}
                    <span className={["text-sm font-semibold", isSelected ? "text-green-700" : "text-ink"].join(" ")}>
                      {format(day, "d")}
                    </span>
                    <span className={["text-[10px]", isSelected ? "text-green-700/80" : "text-ink/60"].join(" ")}>
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

          <section className="rounded-2xl border border-sea/15 bg-white/95 p-4 shadow-card">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-ink">Visitas do dia</h3>
              <span className="text-xs text-ink/60">
                {selectedDate ? format(selectedDate, "dd/MM/yyyy") : "Selecione uma data"}
              </span>
            </div>

            {selectedVisits.length === 0 ? (
              <p className="mt-4 text-sm text-ink/60">Nenhuma visita para esta data.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {groupedBySeller.map(([seller, items]) => {
                  const isExpanded = expandedVendor === seller;
                  const sellerVendor = resolveSellerVendor(seller, items);
                  const canAccessNextRouteDashboard = Boolean(
                    sellerVendor && releasedVendorIdSet.has(sellerVendor.user_id),
                  );
                  const lockTooltip = canAccessNextRouteDashboard
                    ? `Acesso liberado para ${selectedDate ? format(selectedDate, "dd/MM/yyyy") : "a data selecionada"}`
                    : `Acesso bloqueado para ${selectedDate ? format(selectedDate, "dd/MM/yyyy") : "a data selecionada"}`;
                  return (
                    <div key={seller} className="rounded-2xl border border-sea/20 bg-sand/20 p-3">
                      <div className="flex w-full items-center justify-between text-left">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedVendor(isExpanded ? null : seller)}
                            className="text-sm font-semibold text-ink"
                          >
                            {seller}
                          </button>
                          {SHOW_VENDOR_LOCK_ICON && canManage && sellerVendor ? (
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
                          className="text-xs text-ink/60"
                        >
                          {items.length} empresa(s)
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="mt-3 space-y-3 text-xs text-ink/70">
                          {items.map((item) => {
                            const state = editState[item.id] ?? {
                              vendorId: "",
                              date: toDateInput(item.visit_date),
                            };
                            const isEditing = editingVisits[item.id] ?? false;
                            const isCompleted = Boolean(item.completed_at);
                            const mapAddress = buildMapAddress(item.agenda);
                            const instructionText = item.instructions?.trim() || "";
                            return (
                              <div key={item.id} className="rounded-xl border border-sea/10 bg-white/90 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-semibold text-ink">
                                        {item.agenda?.empresa ?? "Sem nome"}
                                      </p>
                                      <span className="rounded-full bg-sea/10 px-2 py-0.5 text-[10px] font-semibold text-sea">
                                        COD {item.agenda?.cod_1 ?? "-"}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-ink/50">
                                      Pessoa: {item.agenda?.pessoa ?? "-"}
                                    </p>
                                    <p className="text-[11px] text-ink/50">
                                      Contato: {item.agenda?.contato ?? "-"}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
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
                                    {item.agenda?.situacao ? (
                                      <span className="inline-flex rounded-full bg-sea/10 px-2 py-0.5 text-[10px] font-semibold text-sea">
                                        {item.agenda.situacao}
                                      </span>
                                    ) : null}
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

                                {canManage && isEditing && !isCompleted ? (
                                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                                    <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                                      Vendedor
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
                                        {vendors.map((vendor) => (
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
                                        onClick={() => handleSaveVisit(item.id)}
                                        disabled={savingId === item.id || addingVendorId === item.id}
                                        className="rounded-lg bg-sea px-3 py-2 text-[11px] font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                                      >
                                        {savingId === item.id ? "Salvando..." : "Salvar"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleAddVendorToVisit(item.id)}
                                        disabled={addingVendorId === item.id || savingId === item.id}
                                        className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-[11px] font-semibold text-sea hover:border-sea hover:bg-sea/5 disabled:opacity-60"
                                      >
                                        {addingVendorId === item.id ? "Adicionando..." : "Adicionar vendedor"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveVisit(item.id)}
                                        disabled={removingId === item.id || addingVendorId === item.id}
                                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600 hover:border-red-300 disabled:opacity-60"
                                      >
                                        {removingId === item.id ? "Removendo..." : "Remover"}
                                      </button>
                                    </div>
                                  </div>
                                ) : canManage ? (
                                  <div className="mt-3 grid gap-1 text-[11px] text-ink/60">
                                    <span>
                                      Perfil visita: {item.perfil_visita ?? item.perfil_visita_opcoes ?? item.agenda?.perfil_visita ?? "-"}
                                    </span>
                                    {instructionText ? (
                                      <span>Instrucoes: {instructionText}</span>
                                    ) : null}
                                    {isCompleted ? (
                                      <span className="rounded-lg border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] font-semibold text-red-600">
                                        Visita registrada. Edicao bloqueada.
                                      </span>
                                    ) : null}
                                    {item.no_visit_reason ? (
                                      <span>Motivo: {item.no_visit_reason}</span>
                                    ) : null}
                                    {isCompleted ? (
                                      <span>Vidas: {item.completed_vidas ?? "-"}</span>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                    <div className="grid gap-1 text-[11px] text-ink/60">
                                      <span>
                                        Perfil visita: {item.perfil_visita ?? item.perfil_visita_opcoes ?? item.agenda?.perfil_visita ?? "-"}
                                      </span>
                                      {instructionText ? (
                                        <span>Instrucoes: {instructionText}</span>
                                      ) : null}
                                      {item.no_visit_reason ? (
                                        <span>Motivo: {item.no_visit_reason}</span>
                                      ) : null}
                                      {isCompleted ? (
                                        <span>Vidas: {item.completed_vidas ?? "-"}</span>
                                      ) : null}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleStartRegister(item)}
                                      disabled={isCompleted}
                                      className="rounded-lg bg-sea px-3 py-2 text-[11px] font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                                    >
                                      {isCompleted
                                        ? item.no_visit_reason
                                          ? "Visita nao realizada"
                                          : "Visita registrada"
                                        : "Registrar visita"}
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
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

      {detailsVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
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
              <div className="grid gap-2 sm:grid-cols-3">
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

      {planoValoresModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
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

      {vendorDashboardAccessModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setCompleteVisit(null)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Registrar visita</h3>
            <p className="mt-1 text-xs text-ink/60">
              Informe a quantidade de vidas e o horario da visita.
            </p>
            {completeVisit.instructions ? (
              <p className="mt-2 rounded-lg border border-sea/20 bg-sand/40 px-3 py-2 text-[11px] text-ink/70">
                Instrucoes: {completeVisit.instructions}
              </p>
            ) : null}

            <div className="mt-4 grid gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                Quantidade de vidas
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
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                Horario da visita
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
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
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
                  setNoVisit({ id: confirmVisit.id, reason: "" });
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
                  if (visit) openCompleteModal(visit);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
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



