import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { supabaseDash } from "../lib/supabaseDashboard";
import { useAuth } from "../context/AuthContext";
import { formatDateBr } from "../lib/dateFormat";
import { normalizeText } from "../lib/textNormalize";
import { SUPERVISOR_VISIT_REASON_OPTIONS, VISIT_TYPE } from "../lib/supervisorVisits";
import DashboardModal from "../components/DashboardModal";

const formatNumber = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
const startOfWeek = (date: Date) => {
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const result = new Date(date);
  result.setDate(date.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
};

const startOfMonth = (date: Date) => {
  const result = new Date(date.getFullYear(), date.getMonth(), 1);
  result.setHours(0, 0, 0, 0);
  return result;
};

const toLocalDateInput = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const parseVisitDate = (row: { data_da_ultima_visita: string | null }) => {
  if (row.data_da_ultima_visita) return new Date(row.data_da_ultima_visita);
  return null;
};

const formatOrValues = (values: string[]) =>
  values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",");

const normalizeKey = (value: string) =>
  normalizeText(value, { letterCase: "upper" });

const applyVendorVisitTypeScope = <TQuery,>(query: TQuery) =>
  (query as TQuery & { or: (filters: string) => TQuery }).or(
    `visit_type.eq.${VISIT_TYPE.VENDEDOR},visit_type.is.null`,
  );

const SHOW_NEXT_ROUTE_BLOCK = false;
const SESSION_EXPIRED_FRIENDLY_MESSAGE = "Sua sessao foi encerrada. Faca login novamente.";
const DASHBOARD_STATUS_COLORS = {
  success: "#1f7a5a",
  warning: "#f59e0b",
  neutral: "#94a3b8",
  info: "#0f766e",
  accent: "#38bdf8",
};

const isSessionExpiredError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("invalid refresh token") ||
    normalized.includes("refresh token not found") ||
    normalized.includes("jwt") ||
    normalized.includes("unauthorized") ||
    normalized.includes("status 401") ||
    normalized.includes("session not found") ||
    normalized.includes("sessao invalida") ||
    normalized.includes("sessao expirada")
  );
};

type VisitStats = {
  totalVidas: number;
  empresasVisitadas: number;
  visitasRealizadas: number;
  visitasNaoRealizadas: number;
  visitasPendentes: number;
};

type DonutSeries = { label: string; value: number; color: string };
type VendorVidasSeries = { label: string; visitas: number; aceite: number; total: number };
type VendorVidasSummary = {
  total: number;
  totalVisitas: number;
  totalAceite: number;
  totalVendors: number;
  hiddenCount: number;
};
type DigitalSummary = {
  allTimeTotalVidas: number;
  monthTotalVidas: number;
  periodTotalVidas: number;
  periodRegistered: number;
  todayTotalVidas: number;
  todayRegistered: number;
  weekTotalVidas: number;
  weekRegistered: number;
  pendingToday: string[];
  pendingWeek: string[];
  pendingByVendor: Array<{
    name: string;
    pendingToday: boolean;
    pendingWeek: boolean;
  }>;
  hasAnyEntries: boolean;
};

type VendorNextRoutePreview = {
  date: string;
  routes: Array<{
    client: string;
    perfil: string;
  }>;
};

type NeighborhoodVidasRow = {
  bairro: string;
  vidas: number;
};
type ScheduledProgress = {
  scheduled: number;
  completed: number;
};

type SupervisorVisitDashboardRow = {
  id: string;
  cliente_id?: string | null;
  visit_date: string | null;
  completed_at: string | null;
  completed_vidas: number | null;
  supervisor_reason: string | null;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  register_mode: string | null;
  cliente?:
    | { empresa: string | null; nome_fantasia: string | null }
    | Array<{ empresa: string | null; nome_fantasia: string | null }>
    | null;
};

type SupervisorVisitDashboardSummary = {
  realizadas: number;
  pendentes: number;
  vidas: number;
  motivos: Array<{ key: string; label: string; count: number }>;
};

type DashboardPendingVisitRow = {
  id: string;
  cliente_id: string | null;
  visit_date: string | null;
  assigned_to_name: string | null;
  assigned_to_user_id: string | null;
  cliente: { empresa: string | null; nome_fantasia: string | null } | null;
};

const computeVisitStats = (
  data: Array<{
    cliente_id: string | null;
    completed_at: string | null;
    completed_vidas: number | null;
    no_visit_reason: string | null;
  }>,
): VisitStats => {
  const totalVidas = (data ?? []).reduce((sum, item) => {
    const value = Number(item.completed_vidas ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  const empresasSet = new Set<string>();
  let visitasRealizadas = 0;
  let visitasNaoRealizadas = 0;
  let visitasPendentes = 0;

  (data ?? []).forEach((item) => {
    if (item.completed_at) {
      if (item.no_visit_reason) {
        visitasNaoRealizadas += 1;
      } else {
        visitasRealizadas += 1;
        const empresaId = item.cliente_id ?? null;
        if (empresaId) empresasSet.add(empresaId);
      }
    } else {
      visitasPendentes += 1;
    }
  });

  return {
    totalVidas,
    empresasVisitadas: empresasSet.size,
    visitasRealizadas,
    visitasNaoRealizadas,
    visitasPendentes,
  };
};

const buildDailyVidasSeries = (
  data: Array<{
    visit_date: string | null;
    completed_at: string | null;
    completed_vidas: number | null;
    no_visit_reason: string | null;
  }>,
  days = 7,
): DonutSeries[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const labels: { key: string; label: string }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
    labels.push({ key, label });
  }

  const totals = new Map<string, number>();
  labels.forEach(({ key }) => totals.set(key, 0));

  (data ?? []).forEach((item) => {
    if (!item.completed_at || item.no_visit_reason) return;
    const key = item.visit_date ?? item.completed_at?.slice(0, 10);
    if (!key || !totals.has(key)) return;
    const value = Number(item.completed_vidas ?? 0);
    if (!Number.isFinite(value)) return;
    totals.set(key, (totals.get(key) ?? 0) + value);
  });

  const palette = [
    DASHBOARD_STATUS_COLORS.info,
    DASHBOARD_STATUS_COLORS.success,
    "#22c55e",
    DASHBOARD_STATUS_COLORS.accent,
    "#7dd3fc",
    DASHBOARD_STATUS_COLORS.neutral,
    "#e2e8f0",
  ];

  return labels.map(({ key, label }, index) => ({
    label,
    value: totals.get(key) ?? 0,
    color: palette[index % palette.length],
  }));
};

const buildDailyDualVidasSeries = (
  visits: Array<{
    visit_date: string | null;
    completed_at: string | null;
    completed_vidas: number | null;
    no_visit_reason: string | null;
  }>,
  aceites: Array<{
    entry_date: string | null;
    vidas: number | null;
  }>,
  from: string,
  to: string,
) => {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const labels: { key: string; label: string }[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const date = new Date(cursor);
    const key = date.toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
    labels.push({ key, label });
    cursor.setDate(cursor.getDate() + 1);
  }

  const visitsTotals = new Map<string, number>();
  const aceiteTotals = new Map<string, number>();
  labels.forEach(({ key }) => {
    visitsTotals.set(key, 0);
    aceiteTotals.set(key, 0);
  });

  visits.forEach((item) => {
    if (!item.completed_at || item.no_visit_reason) return;
    const key = item.visit_date ?? item.completed_at?.slice(0, 10);
    if (!key || !visitsTotals.has(key)) return;
    const value = Number(item.completed_vidas ?? 0);
    if (!Number.isFinite(value)) return;
    visitsTotals.set(key, (visitsTotals.get(key) ?? 0) + value);
  });

  aceites.forEach((item) => {
    const key = (item.entry_date ?? "").slice(0, 10);
    if (!key || !aceiteTotals.has(key)) return;
    const value = Number(item.vidas ?? 0);
    if (!Number.isFinite(value)) return;
    aceiteTotals.set(key, (aceiteTotals.get(key) ?? 0) + value);
  });

  return labels.map(({ key, label }) => ({
    label,
    visitas: visitsTotals.get(key) ?? 0,
    aceite: aceiteTotals.get(key) ?? 0,
  }));
};

export default function Dashboard() {
  const { role, profile, session, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<
    {
      data_da_ultima_visita: string | null;
      situacao: string | null;
      bairro: string | null;
      cidade: string | null;
      uf: string | null;
      vendedor: string | null;
    }[]
  >([]);
  const [visitStats, setVisitStats] = useState<VisitStats | null>(null);
  const [visitStatsError, setVisitStatsError] = useState<string | null>(null);
  const [vendorVisitsRaw, setVendorVisitsRaw] = useState<Array<{
    visit_date: string | null;
    completed_at: string | null;
    completed_vidas: number | null;
    no_visit_reason: string | null;
  }>>([]);
  const [visitDailyVidas, setVisitDailyVidas] = useState<DonutSeries[]>([]);
  const [vendorAceites, setVendorAceites] = useState<Array<{ entry_date: string | null; vidas: number | null }>>([]);
  const [vendorAceitePeriodVidas, setVendorAceitePeriodVidas] = useState(0);
  const [teamStats, setTeamStats] = useState<VisitStats | null>(null);
  const [teamStatsError, setTeamStatsError] = useState<string | null>(null);
  const [teamDailyVidas, setTeamDailyVidas] = useState<DonutSeries[]>([]);
  const [teamVendorsCount, setTeamVendorsCount] = useState(0);
  const [supervisores, setSupervisores] = useState<
    { id: string; user_id: string | null; display_name: string | null }[]
  >([]);
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>("all");
  const [supervisorVisitFilterUserId, setSupervisorVisitFilterUserId] = useState<string>("all");
  const [vendedores, setVendedores] = useState<
    { user_id: string | null; display_name: string | null }[]
  >([]);
  const [selectedVendorId, setSelectedVendorId] = useState<string>("all");
  const [teamVendorNames, setTeamVendorNames] = useState<string[]>([]);
  const [vendorVidasSeries, setVendorVidasSeries] = useState<VendorVidasSeries[]>([]);
  const [vendorVidasLoading, setVendorVidasLoading] = useState(false);
  const [vendorVidasError, setVendorVidasError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [vendorVidasSummary, setVendorVidasSummary] = useState<VendorVidasSummary>({
    total: 0,
    totalVisitas: 0,
    totalAceite: 0,
    totalVendors: 0,
    hiddenCount: 0,
  });
  const [vendorVidasFrom, setVendorVidasFrom] = useState(() => toLocalDateInput(startOfMonth(new Date())));
  const [vendorVidasTo, setVendorVidasTo] = useState(() => toLocalDateInput(new Date()));
  const [digitalSummary, setDigitalSummary] = useState<DigitalSummary | null>(null);
  const [digitalLoading, setDigitalLoading] = useState(false);
  const [digitalError, setDigitalError] = useState<string | null>(null);
  const [showVendorVisitsModal, setShowVendorVisitsModal] = useState(false);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [pendingVisitsModal, setPendingVisitsModal] = useState<{
    title: string;
    subtitle?: string;
    rows: DashboardPendingVisitRow[];
  } | null>(null);
  const [scheduledCounts, setScheduledCounts] = useState<{
    today: ScheduledProgress;
    week: ScheduledProgress;
    month: ScheduledProgress;
  }>({
    today: { scheduled: 0, completed: 0 },
    week: { scheduled: 0, completed: 0 },
    month: { scheduled: 0, completed: 0 },
  });
  const [scheduledCountsError, setScheduledCountsError] = useState<string | null>(null);
  const [vendorNextRouteAccessAllowed, setVendorNextRouteAccessAllowed] = useState(false);
  const [nextRoutePreview, setNextRoutePreview] = useState<VendorNextRoutePreview | null>(null);
  const [nextRoutePreviewLoading, setNextRoutePreviewLoading] = useState(false);
  const [nextRoutePreviewError, setNextRoutePreviewError] = useState<string | null>(null);
  const [showNextRouteModal, setShowNextRouteModal] = useState(false);
  const [topNeighborhoodsByVidas, setTopNeighborhoodsByVidas] = useState<NeighborhoodVidasRow[]>([]);
  const [supervisorVisitSummary, setSupervisorVisitSummary] = useState<SupervisorVisitDashboardSummary>({
    realizadas: 0,
    pendentes: 0,
    vidas: 0,
    motivos: [],
  });
  const [supervisorVisitRows, setSupervisorVisitRows] = useState<SupervisorVisitDashboardRow[]>([]);
  const [supervisorVisitLoading, setSupervisorVisitLoading] = useState(false);
  const [supervisorVisitError, setSupervisorVisitError] = useState<string | null>(null);

  const isVendor = role === "VENDEDOR";
  const canSelectSupervisor = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canViewTeamStats = role === "SUPERVISOR" || role === "ASSISTENTE";
  const activeSupervisorId = selectedSupervisorId === "all" ? null : selectedSupervisorId;
  const activeVendorId = selectedVendorId === "all" ? null : selectedVendorId;
  const activeVendorName = useMemo(() => {
    if (!activeVendorId) return null;
    return vendedores.find((vendor) => vendor.user_id === activeVendorId)?.display_name ?? null;
  }, [activeVendorId, vendedores]);
  const todayKey = useMemo(() => toLocalDateInput(new Date()), []);
  const monthStartKey = useMemo(() => toLocalDateInput(startOfMonth(new Date())), []);
  const monthEndKey = useMemo(() => toLocalDateInput(new Date()), []);
  const weekStartKey = useMemo(() => toLocalDateInput(startOfWeek(new Date())), []);
  const globalFrom = vendorVidasFrom;
  const globalTo = vendorVidasTo;
  const globalPeriodLabel = `${formatDateBr(globalFrom)} a ${formatDateBr(globalTo)}`;
  const supervisorReasonLabelByValue = useMemo(
    () => new Map<string, string>(SUPERVISOR_VISIT_REASON_OPTIONS.map((option) => [option.value, option.label])),
    [],
  );

  useEffect(() => {
    if (!canSelectSupervisor) return;
    let active = true;
    const loadSupervisores = async () => {
      const { data, error: supaError } = await supabaseDash
        .from("v_dash_profiles_active")
        .select("id, user_id, display_name")
        .eq("role", "SUPERVISOR")
        .order("display_name", { ascending: true });

      if (!active) return;

      if (supaError) {
        setSupervisores([]);
        return;
      }

      const list = data ?? [];
      setSupervisores(list);
      setSelectedSupervisorId((prev) => {
        if (prev && prev !== "") return prev;
        if (role === "SUPERVISOR" && profile?.id) return profile.id;
        return "all";
      });
      setSupervisorVisitFilterUserId((prev) => {
        if (prev && prev !== "all" && list.some((item) => item.user_id === prev)) return prev;
        if (role === "SUPERVISOR" && session?.user.id) return session.user.id;
        return "all";
      });
    };

    loadSupervisores();
    return () => {
      active = false;
    };
  }, [canSelectSupervisor, profile?.id, role, session?.user.id]);

  useEffect(() => {
    if (!canSelectSupervisor) return;
    let active = true;

    const loadVendedores = async () => {
      let query = supabaseDash
        .from("v_dash_profiles_active")
        .select("user_id, display_name")
        .eq("role", "VENDEDOR")
        .order("display_name", { ascending: true });

      if (activeSupervisorId) {
        query = query.eq("supervisor_id", activeSupervisorId);
      }

      const { data, error: vendorsError } = await query;
      if (!active) return;

      if (vendorsError) {
        setVendedores([]);
        setSelectedVendorId("all");
        return;
      }

      const list = data ?? [];
      setVendedores(list);
      setSelectedVendorId((prev) =>
        prev !== "all" && list.some((item) => item.user_id === prev) ? prev : "all",
      );
    };

    loadVendedores();
    return () => {
      active = false;
    };
  }, [activeSupervisorId, canSelectSupervisor]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      let query = supabaseDash
        .from("v_dash_clientes_active")
        .select("data_da_ultima_visita, situacao, bairro, cidade, uf, vendedor")
        .limit(5000);

      if (isVendor) {
        const vendorDisplayName = profile?.display_name ? normalizeKey(profile.display_name) : null;
        if (!vendorDisplayName) {
          setRows([]);
          setError("Perfil de vendedor sem nome de exibicao. Faca login novamente.");
          setLoading(false);
          return;
        }
        query = query.eq("vendedor", vendorDisplayName);
      }

      const { data, error: supabaseError } = await query;

      if (supabaseError) {
        const errorMessage = supabaseError.message ?? "";
        if (isSessionExpiredError(errorMessage)) {
          await signOut();
          setError(SESSION_EXPIRED_FRIENDLY_MESSAGE);
          setRows([]);
          setLoading(false);
          return;
        }
        setError(errorMessage);
        setRows([]);
      } else {
        setRows(data ?? []);
      }
      setLoading(false);
    };

    void load();
  }, [isVendor, profile?.display_name, signOut]);

  useEffect(() => {
    let active = true;

    const loadScheduledCounts = async () => {
      setScheduledCountsError(null);
      try {
        if (!globalFrom || !globalTo) {
          setScheduledCounts({
            today: { scheduled: 0, completed: 0 },
            week: { scheduled: 0, completed: 0 },
            month: { scheduled: 0, completed: 0 },
          });
          return;
        }
        if (globalFrom > globalTo) {
          throw new Error("Periodo invalido.");
        }

        const now = new Date();
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        const weekStart = startOfWeek(now);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(0, 0, 0, 0);
        const monthStart = startOfMonth(now);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        monthEnd.setHours(0, 0, 0, 0);

        const startKey = globalFrom;
        const endKey = globalTo;
        const todayKey = toLocalDateInput(today);
        const weekStartKeyLocal = toLocalDateInput(weekStart);
        const weekEndKeyLocal = toLocalDateInput(weekEnd);
        const monthStartKeyLocal = toLocalDateInput(monthStart);
        const monthEndKeyLocal = toLocalDateInput(monthEnd);

        let baseQuery = supabaseDash
          .from("v_dash_visits_active")
          .select("visit_date, assigned_to_user_id, assigned_to_name, completed_at, no_visit_reason")
          .gte("visit_date", startKey)
          .lte("visit_date", endKey);
        baseQuery = applyVendorVisitTypeScope(baseQuery);

        if (isVendor) {
          if (session?.user.id && profile?.display_name) {
            baseQuery = baseQuery.or(
              `assigned_to_user_id.eq.${session.user.id},assigned_to_name.eq.${profile.display_name}`,
            );
          } else if (session?.user.id) {
            baseQuery = baseQuery.eq("assigned_to_user_id", session.user.id);
          } else if (profile?.display_name) {
            baseQuery = baseQuery.eq("assigned_to_name", profile.display_name);
          }
        } else if (activeVendorId || activeVendorName) {
          if (activeVendorId && activeVendorName) {
            baseQuery = baseQuery.or(
              `assigned_to_user_id.eq.${activeVendorId},assigned_to_name.eq.${activeVendorName}`,
            );
          } else if (activeVendorId) {
            baseQuery = baseQuery.eq("assigned_to_user_id", activeVendorId);
          } else if (activeVendorName) {
            baseQuery = baseQuery.eq("assigned_to_name", activeVendorName);
          }
        } else if (activeSupervisorId) {
          const vendorsQuery = supabaseDash
            .from("v_dash_profiles_active")
            .select("user_id, display_name")
            .eq("role", "VENDEDOR")
            .eq("supervisor_id", activeSupervisorId);
          const { data: vendors, error: vendorsError } = await vendorsQuery;
          if (vendorsError) throw new Error(vendorsError.message);

          const vendorIds = (vendors ?? [])
            .map((vendor) => vendor.user_id)
            .filter((value): value is string => Boolean(value));
          const vendorNames = (vendors ?? [])
            .map((vendor) => vendor.display_name)
            .filter((value): value is string => Boolean(value));

          if (vendorIds.length === 0 && vendorNames.length === 0) {
            if (active) {
              setScheduledCounts({
                today: { scheduled: 0, completed: 0 },
                week: { scheduled: 0, completed: 0 },
                month: { scheduled: 0, completed: 0 },
              });
            }
            return;
          }

          if (vendorIds.length && vendorNames.length) {
            baseQuery = baseQuery.or(
              `assigned_to_user_id.in.(${formatOrValues(vendorIds)}),assigned_to_name.in.(${formatOrValues(vendorNames)})`,
            );
          } else if (vendorIds.length) {
            baseQuery = baseQuery.in("assigned_to_user_id", vendorIds);
          } else {
            baseQuery = baseQuery.in("assigned_to_name", vendorNames);
          }
        }

        const { data: visitsData, error: visitsError } = await baseQuery;
        if (!active) return;
        if (visitsError) throw new Error(visitsError.message);

        let todayCount = 0;
        let weekCount = 0;
        let monthCount = 0;
        let todayCompleted = 0;
        let weekCompleted = 0;
        let monthCompleted = 0;

        (visitsData ?? []).forEach((visit) => {
          const key = (visit.visit_date ?? "").slice(0, 10);
          if (!key) return;
          const isCompleted = Boolean(visit.completed_at) && !visit.no_visit_reason;
          if (key === todayKey) {
            todayCount += 1;
            if (isCompleted) todayCompleted += 1;
          }
          if (key >= weekStartKeyLocal && key <= weekEndKeyLocal) {
            weekCount += 1;
            if (isCompleted) weekCompleted += 1;
          }
          if (key >= monthStartKeyLocal && key <= monthEndKeyLocal) {
            monthCount += 1;
            if (isCompleted) monthCompleted += 1;
          }
        });

        if (!active) return;
        setScheduledCounts({
          today: { scheduled: todayCount, completed: todayCompleted },
          week: { scheduled: weekCount, completed: weekCompleted },
          month: { scheduled: monthCount, completed: monthCompleted },
        });
      } catch (err) {
        if (!active) return;
        setScheduledCountsError(err instanceof Error ? err.message : "Erro ao carregar visitas marcadas.");
        setScheduledCounts({
          today: { scheduled: 0, completed: 0 },
          week: { scheduled: 0, completed: 0 },
          month: { scheduled: 0, completed: 0 },
        });
      }
    };

    loadScheduledCounts();
    return () => {
      active = false;
    };
  }, [activeSupervisorId, activeVendorId, activeVendorName, globalFrom, globalTo, isVendor, profile?.display_name, session?.user.id]);

  useEffect(() => {
    let active = true;

    const loadNeighborhoodLives = async () => {
      if (!globalFrom || !globalTo || globalFrom > globalTo) {
        setTopNeighborhoodsByVidas([]);
        return;
      }

      try {
        let visitsQuery = supabaseDash
          .from("v_dash_visits_active")
          .select(
            "assigned_to_user_id, assigned_to_name, completed_vidas, completed_at, no_visit_reason, visit_date, cliente_id",
          )
          .gte("visit_date", globalFrom)
          .lte("visit_date", globalTo)
          .not("completed_at", "is", null)
          .is("no_visit_reason", null);
        visitsQuery = applyVendorVisitTypeScope(visitsQuery);

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
        } else if (activeVendorId || activeVendorName) {
          if (activeVendorId && activeVendorName) {
            visitsQuery = visitsQuery.or(
              `assigned_to_user_id.eq.${activeVendorId},assigned_to_name.eq.${activeVendorName}`,
            );
          } else if (activeVendorId) {
            visitsQuery = visitsQuery.eq("assigned_to_user_id", activeVendorId);
          } else if (activeVendorName) {
            visitsQuery = visitsQuery.eq("assigned_to_name", activeVendorName);
          }
        } else if (activeSupervisorId) {
          const vendorsQuery = supabaseDash
            .from("v_dash_profiles_active")
            .select("user_id, display_name")
            .eq("role", "VENDEDOR")
            .eq("supervisor_id", activeSupervisorId);
          const { data: vendors, error: vendorsError } = await vendorsQuery;
          if (vendorsError) throw new Error(vendorsError.message);

          const vendorIds = (vendors ?? [])
            .map((vendor) => vendor.user_id)
            .filter((value): value is string => Boolean(value));
          const vendorNames = (vendors ?? [])
            .map((vendor) => vendor.display_name)
            .filter((value): value is string => Boolean(value));

          if (vendorIds.length === 0 && vendorNames.length === 0) {
            if (active) setTopNeighborhoodsByVidas([]);
            return;
          }

          if (vendorIds.length && vendorNames.length) {
            visitsQuery = visitsQuery.or(
              `assigned_to_user_id.in.(${formatOrValues(vendorIds)}),assigned_to_name.in.(${formatOrValues(vendorNames)})`,
            );
          } else if (vendorIds.length) {
            visitsQuery = visitsQuery.in("assigned_to_user_id", vendorIds);
          } else {
            visitsQuery = visitsQuery.in("assigned_to_name", vendorNames);
          }
        }

        const { data: visitsData, error: visitsError } = await visitsQuery;
        if (visitsError) throw new Error(visitsError.message);
        if (!active) return;

        const clienteIds = Array.from(
          new Set(
            ((visitsData ?? []) as Array<{ cliente_id: string | null }>)
              .map((item) => item.cliente_id)
              .filter((value): value is string => Boolean(value)),
          ),
        );
        const clientesById = new Map<string, { bairro: string | null }>();
        for (let index = 0; index < clienteIds.length; index += 500) {
          const chunk = clienteIds.slice(index, index + 500);
          if (chunk.length === 0) continue;
          const { data: clientesData, error: clientesError } = await supabaseDash
            .from("v_dash_clientes_active")
            .select("id, bairro")
            .in("id", chunk);
          if (clientesError) throw new Error(clientesError.message);
          (clientesData ?? []).forEach((row) => {
            const item = row as { id: string; bairro: string | null };
            clientesById.set(item.id, { bairro: item.bairro });
          });
        }

        type NeighborhoodVisitRow = {
          completed_vidas: number | null;
          cliente_id: string | null;
        };

        const byNeighborhood = new Map<string, number>();
        ((visitsData ?? []) as NeighborhoodVisitRow[]).forEach((item) => {
          const neighborhood = clientesById.get(item.cliente_id ?? "")?.bairro?.trim() ?? "";
          if (!neighborhood) return;
          const vidas = Number(item.completed_vidas ?? 0);
          if (!Number.isFinite(vidas)) return;
          byNeighborhood.set(neighborhood, (byNeighborhood.get(neighborhood) ?? 0) + vidas);
        });

        const topRows = Array.from(byNeighborhood.entries())
          .map(([bairro, vidas]) => ({ bairro, vidas }))
          .sort((a, b) => b.vidas - a.vidas)
          .slice(0, 6);
        setTopNeighborhoodsByVidas(topRows);
      } catch (err) {
        if (active) setTopNeighborhoodsByVidas([]);
      }
    };

    void loadNeighborhoodLives();
    return () => {
      active = false;
    };
  }, [
    activeSupervisorId,
    activeVendorId,
    activeVendorName,
    globalFrom,
    globalTo,
    isVendor,
    profile?.display_name,
    session?.user.id,
  ]);

  useEffect(() => {
    let active = true;

    const loadVendorNextRoute = async () => {
      if (!isVendor) {
        setVendorNextRouteAccessAllowed(false);
        setNextRoutePreview(null);
        setNextRoutePreviewError(null);
        setShowNextRouteModal(false);
        return;
      }

      setNextRoutePreviewLoading(true);
      setNextRoutePreviewError(null);
      try {
        if (!session?.user.id) {
          setVendorNextRouteAccessAllowed(false);
          setNextRoutePreview(null);
          setShowNextRouteModal(false);
          return;
        }

        const todayRouteKey = toLocalDateInput(new Date());
        let nextRouteQuery = supabaseDash
          .from("v_dash_visits_active")
          .select(
            "visit_date, perfil_visita, completed_at, assigned_to_user_id, assigned_to_name, cliente_id",
          )
          .gt("visit_date", todayRouteKey)
          .is("completed_at", null)
          .order("visit_date", { ascending: true })
          .limit(120);
        nextRouteQuery = applyVendorVisitTypeScope(nextRouteQuery);

        if (session.user.id && profile?.display_name) {
          nextRouteQuery = nextRouteQuery.or(
            `assigned_to_user_id.eq.${session.user.id},assigned_to_name.eq.${profile.display_name}`,
          );
        } else if (session.user.id) {
          nextRouteQuery = nextRouteQuery.eq("assigned_to_user_id", session.user.id);
        } else if (profile?.display_name) {
          nextRouteQuery = nextRouteQuery.eq("assigned_to_name", profile.display_name);
        }

        const { data: nextRoutesData, error: nextRoutesError } = await nextRouteQuery;
        if (nextRoutesError) throw new Error(nextRoutesError.message);
        if (!active) return;

        type NextRouteRow = {
          visit_date: string | null;
          perfil_visita: string | null;
          cliente_id: string | null;
        };
        const futureRoutes = ((nextRoutesData ?? []) as NextRouteRow[]).filter(
          (row): row is NextRouteRow & { visit_date: string } => Boolean(row.visit_date),
        );

        if (futureRoutes.length === 0) {
          setVendorNextRouteAccessAllowed(true);
          setNextRoutePreview(null);
          setShowNextRouteModal(false);
          return;
        }

        const candidateDates = Array.from(
          new Set(
            futureRoutes
              .map((row) => row.visit_date)
              .filter((value): value is string => Boolean(value)),
          ),
        );
        if (candidateDates.length === 0) {
          setVendorNextRouteAccessAllowed(false);
          setNextRoutePreview(null);
          setShowNextRouteModal(false);
          return;
        }

        const { data: releasedDatesData, error: releasedDatesError } = await supabase
          .from("vendor_next_route_releases")
          .select("release_date")
          .eq("vendor_user_id", session.user.id)
          .in("release_date", candidateDates);
        if (releasedDatesError) throw new Error(releasedDatesError.message);
        if (!active) return;

        const releasedDateSet = new Set(
          ((releasedDatesData ?? []) as Array<{ release_date: string | null }>)
            .map((item) => item.release_date)
            .filter((value): value is string => Boolean(value)),
        );

        const releasedRoute = futureRoutes.find((route) => releasedDateSet.has(route.visit_date));
        if (!releasedRoute) {
          setVendorNextRouteAccessAllowed(false);
          setNextRoutePreview(null);
          setShowNextRouteModal(false);
          return;
        }

        const releasedDateRoutes = futureRoutes.filter(
          (route) => route.visit_date === releasedRoute.visit_date,
        );
        const routeClienteIds = Array.from(
          new Set(
            releasedDateRoutes
              .map((route) => route.cliente_id)
              .filter((value): value is string => Boolean(value)),
          ),
        );
        const clientesById = new Map<string, { empresa: string | null; nome_fantasia: string | null }>();
        for (let index = 0; index < routeClienteIds.length; index += 500) {
          const chunk = routeClienteIds.slice(index, index + 500);
          if (chunk.length === 0) continue;
          const { data: clientesData, error: clientesError } = await supabaseDash
            .from("v_dash_clientes_active")
            .select("id, empresa, nome_fantasia")
            .in("id", chunk);
          if (clientesError) throw new Error(clientesError.message);
          (clientesData ?? []).forEach((row) => {
            const item = row as { id: string; empresa: string | null; nome_fantasia: string | null };
            clientesById.set(item.id, { empresa: item.empresa, nome_fantasia: item.nome_fantasia });
          });
        }
        const routeItems = releasedDateRoutes.map((route) => {
          const cliente = route.cliente_id ? clientesById.get(route.cliente_id) ?? null : null;
          return {
            client: cliente?.empresa ?? cliente?.nome_fantasia ?? "Sem empresa",
            perfil: route.perfil_visita?.trim() || "-",
          };
        });
        setVendorNextRouteAccessAllowed(true);
        setNextRoutePreview({
          date: formatDateBr(releasedRoute.visit_date, "-"),
          routes: routeItems,
        });
      } catch (err) {
        if (!active) return;
        setVendorNextRouteAccessAllowed(false);
        setNextRoutePreview(null);
        setShowNextRouteModal(false);
        setNextRoutePreviewError(
          err instanceof Error ? err.message : "Erro ao carregar a proxima rota.",
        );
      } finally {
        if (active) setNextRoutePreviewLoading(false);
      }
    };

    void loadVendorNextRoute();
    return () => {
      active = false;
    };
  }, [isVendor, profile?.display_name, session?.user.id]);

  useEffect(() => {
    if (!isVendor) return;

    const loadVendorStats = async () => {
      setVisitStatsError(null);
      if (!globalFrom || !globalTo) {
        setVisitStats(null);
        setVendorVisitsRaw([]);
        setVisitDailyVidas([]);
        setVendorAceites([]);
        setVendorAceitePeriodVidas(0);
        return;
      }
      if (globalFrom > globalTo) {
        setVisitStatsError("Periodo invalido.");
        setVisitStats(null);
        setVendorVisitsRaw([]);
        setVisitDailyVidas([]);
        setVendorAceites([]);
        setVendorAceitePeriodVidas(0);
        return;
      }

      let visitsQuery = supabaseDash
        .from("v_dash_visits_active")
        .select("id, cliente_id, assigned_to_user_id, assigned_to_name, completed_at, completed_vidas, no_visit_reason, visit_date")
        .gte("visit_date", globalFrom)
        .lte("visit_date", globalTo);
      visitsQuery = applyVendorVisitTypeScope(visitsQuery);
      let aceiteQuery = supabaseDash
        .from("v_dash_aceite_digital_active")
        .select("entry_date, vidas")
        .gte("entry_date", globalFrom)
        .lte("entry_date", globalTo);

      if (session?.user.id && profile?.display_name) {
        visitsQuery = visitsQuery.or(
          `assigned_to_user_id.eq.${session.user.id},assigned_to_name.eq.${profile.display_name}`,
        );
        aceiteQuery = aceiteQuery.or(
          `vendor_user_id.eq.${session.user.id},vendor_name.eq.${profile.display_name}`,
        );
      } else if (session?.user.id) {
        visitsQuery = visitsQuery.eq("assigned_to_user_id", session.user.id);
        aceiteQuery = aceiteQuery.eq("vendor_user_id", session.user.id);
      } else if (profile?.display_name) {
        visitsQuery = visitsQuery.eq("assigned_to_name", profile.display_name);
        aceiteQuery = aceiteQuery.eq("vendor_name", profile.display_name);
      }

      const [
        { data: visitsData, error: visitsError },
        { data: aceiteData, error: aceiteError },
      ] = await Promise.all([visitsQuery, aceiteQuery]);

      if (visitsError) {
        setVisitStatsError(visitsError.message);
        setVisitStats(null);
        setVendorVisitsRaw([]);
        setVisitDailyVidas([]);
        setVendorAceites([]);
        setVendorAceitePeriodVidas(0);
        return;
      }
      if (aceiteError) {
        setVisitStatsError(aceiteError.message);
        setVisitStats(null);
        setVendorVisitsRaw([]);
        setVisitDailyVidas([]);
        setVendorAceites([]);
        setVendorAceitePeriodVidas(0);
        return;
      }

      const totalAceite = (aceiteData ?? []).reduce((sum, item) => {
        const value = Number(item.vidas ?? 0);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
      setVendorAceitePeriodVidas(totalAceite);
      setVendorVisitsRaw(
        (visitsData ?? []) as Array<{
          visit_date: string | null;
          completed_at: string | null;
          completed_vidas: number | null;
          no_visit_reason: string | null;
        }>,
      );
      setVendorAceites((aceiteData ?? []) as Array<{ entry_date: string | null; vidas: number | null }>);
      setVisitDailyVidas(buildDailyVidasSeries(visitsData ?? []));
      const visits = (visitsData ?? []) as Array<{
        id: string;
        cliente_id: string | null;
        assigned_to_user_id: string | null;
        assigned_to_name: string | null;
        completed_at: string | null;
        completed_vidas: number | null;
        no_visit_reason: string | null;
        visit_date: string | null;
      }>;
      const pendingVisits = visits.filter((item) => !item.completed_at && !item.no_visit_reason);
      const pendingClienteIds = Array.from(
        new Set(pendingVisits.map((item) => item.cliente_id).filter((value): value is string => Boolean(value))),
      );
      const pendingClientesById = new Map<string, { empresa: string | null; nome_fantasia: string | null }>();
      if (pendingClienteIds.length > 0) {
        const { data: clientesData } = await supabaseDash
          .from("v_dash_clientes_active")
          .select("id, empresa, nome_fantasia")
          .in("id", pendingClienteIds);
        (clientesData ?? []).forEach((row) => {
          const item = row as { id: string; empresa: string | null; nome_fantasia: string | null };
          pendingClientesById.set(item.id, { empresa: item.empresa, nome_fantasia: item.nome_fantasia });
        });
      }
      setVisitStats(
        computeVisitStats(
          visits.map((item) => ({
            cliente_id: item.cliente_id ?? null,
            completed_at: item.completed_at ?? null,
            completed_vidas: item.completed_vidas ?? null,
            no_visit_reason: item.no_visit_reason ?? null,
          })),
        ),
      );
      setPendingVisitsModal((prev) =>
        prev?.title === "Visitas pendentes"
          ? {
              ...prev,
              rows: pendingVisits.map((item) => ({
                id: item.id,
                cliente_id: item.cliente_id,
                visit_date: item.visit_date,
                assigned_to_name: item.assigned_to_name,
                assigned_to_user_id: item.assigned_to_user_id,
                cliente: item.cliente_id ? pendingClientesById.get(item.cliente_id) ?? null : null,
              })),
            }
          : prev,
      );
    };

    loadVendorStats();
  }, [globalFrom, globalTo, isVendor, profile?.display_name, session?.user.id]);

  useEffect(() => {
    if (!canViewTeamStats) return;

    const loadTeamStats = async () => {
      setTeamStatsError(null);
      if (!globalFrom || !globalTo) {
        setTeamStats(computeVisitStats([]));
        setTeamDailyVidas([]);
        return;
      }
      if (globalFrom > globalTo) {
        setTeamStatsError("Periodo invalido.");
        setTeamStats(computeVisitStats([]));
        setTeamDailyVidas([]);
        return;
      }

      const vendorsQuery = supabaseDash
        .from("v_dash_profiles_active")
        .select("user_id, display_name")
        .eq("role", "VENDEDOR");

      const { data: vendors, error: vendorsError } = activeSupervisorId
        ? await vendorsQuery.eq("supervisor_id", activeSupervisorId)
        : await vendorsQuery;

      if (vendorsError) {
        setTeamStatsError(vendorsError.message);
        setTeamStats(null);
        return;
      }

      const scopedVendors = (vendors ?? []).filter((vendor) => {
        if (!activeVendorId && !activeVendorName) return true;
        const byId = activeVendorId ? vendor.user_id === activeVendorId : false;
        const byName =
          activeVendorName && vendor.display_name
            ? normalizeKey(vendor.display_name) === normalizeKey(activeVendorName)
            : false;
        return byId || byName;
      });

      const vendorIds = scopedVendors
        .map((vendor) => vendor.user_id)
        .filter((value): value is string => Boolean(value));
      const vendorNames = scopedVendors
        .map((vendor) => vendor.display_name)
        .filter((value): value is string => Boolean(value));

      setTeamVendorsCount(vendorIds.length);
      setTeamVendorNames(vendorNames);

      let visitsQuery = supabaseDash
        .from("v_dash_visits_active")
        .select("id, cliente_id, assigned_to_user_id, assigned_to_name, completed_at, completed_vidas, no_visit_reason, visit_date")
        .gte("visit_date", globalFrom)
        .lte("visit_date", globalTo);
      visitsQuery = applyVendorVisitTypeScope(visitsQuery);

      if (activeSupervisorId || activeVendorId || activeVendorName) {
        if (vendorIds.length === 0 && vendorNames.length === 0) {
          setTeamStats(computeVisitStats([]));
          setTeamDailyVidas([]);
          return;
        }

        if (vendorIds.length && vendorNames.length) {
          visitsQuery = visitsQuery.or(
            `assigned_to_user_id.in.(${formatOrValues(vendorIds)}),assigned_to_name.in.(${formatOrValues(vendorNames)})`,
          );
        } else if (vendorIds.length) {
          visitsQuery = visitsQuery.in("assigned_to_user_id", vendorIds);
        } else {
          visitsQuery = visitsQuery.in("assigned_to_name", vendorNames);
        }
      }

      const { data: visitsData, error: visitsError } = await visitsQuery;
      if (visitsError) {
        setTeamStatsError(visitsError.message);
        setTeamStats(null);
        setTeamDailyVidas([]);
        return;
      }

      const visits = (visitsData ?? []) as Array<{
        id: string;
        cliente_id: string | null;
        assigned_to_user_id: string | null;
        assigned_to_name: string | null;
        completed_at: string | null;
        completed_vidas: number | null;
        no_visit_reason: string | null;
        visit_date: string | null;
      }>;
      const pendingVisits = visits.filter((item) => !item.completed_at && !item.no_visit_reason);
      const pendingClienteIds = Array.from(
        new Set(pendingVisits.map((item) => item.cliente_id).filter((value): value is string => Boolean(value))),
      );
      const pendingClientesById = new Map<string, { empresa: string | null; nome_fantasia: string | null }>();
      for (let index = 0; index < pendingClienteIds.length; index += 500) {
        const chunk = pendingClienteIds.slice(index, index + 500);
        if (chunk.length === 0) continue;
        const { data: clientesData, error: clientesError } = await supabaseDash
          .from("v_dash_clientes_active")
          .select("id, empresa, nome_fantasia")
          .in("id", chunk);
        if (clientesError) throw new Error(clientesError.message);
        (clientesData ?? []).forEach((row) => {
          const item = row as { id: string; empresa: string | null; nome_fantasia: string | null };
          pendingClientesById.set(item.id, { empresa: item.empresa, nome_fantasia: item.nome_fantasia });
        });
      }

      setTeamDailyVidas(buildDailyVidasSeries(visits));
      setTeamStats(
        computeVisitStats(
          visits.map((item) => ({
            cliente_id: item.cliente_id ?? null,
            completed_at: item.completed_at ?? null,
            completed_vidas: item.completed_vidas ?? null,
            no_visit_reason: item.no_visit_reason ?? null,
          })),
        ),
      );
      setPendingVisitsModal({
        title: "Visitas pendentes",
        subtitle: `Registros sem conclusao no periodo ${globalPeriodLabel}.`,
        rows: pendingVisits.map((item) => ({
          id: item.id,
          cliente_id: item.cliente_id,
          visit_date: item.visit_date,
          assigned_to_name: item.assigned_to_name,
          assigned_to_user_id: item.assigned_to_user_id,
          cliente: item.cliente_id ? pendingClientesById.get(item.cliente_id) ?? null : null,
        })),
      });
    };

    loadTeamStats();
  }, [activeSupervisorId, activeVendorId, activeVendorName, canViewTeamStats, globalFrom, globalTo]);

  useEffect(() => {
    if (!canViewTeamStats) return;
    if (!vendorVidasFrom || !vendorVidasTo) {
      setVendorVidasSeries([]);
      setVendorVidasSummary({ total: 0, totalVisitas: 0, totalAceite: 0, totalVendors: 0, hiddenCount: 0 });
      return;
    }
    if (vendorVidasFrom > vendorVidasTo) {
      setVendorVidasError("Periodo invalido.");
      setVendorVidasSeries([]);
      setVendorVidasSummary({ total: 0, totalVisitas: 0, totalAceite: 0, totalVendors: 0, hiddenCount: 0 });
      return;
    }

    const loadVendorVidas = async () => {
      setVendorVidasLoading(true);
      setVendorVidasError(null);
      try {
        const vendorsQuery = supabaseDash
          .from("v_dash_profiles_active")
          .select("user_id, display_name")
          .eq("role", "VENDEDOR");

        const { data: vendors, error: vendorsError } = activeSupervisorId
          ? await vendorsQuery.eq("supervisor_id", activeSupervisorId)
          : await vendorsQuery;

        if (vendorsError) {
          throw new Error(vendorsError.message);
        }

        const scopedVendors = (vendors ?? []).filter((vendor) => {
          if (!activeVendorId && !activeVendorName) return true;
          const byId = activeVendorId ? vendor.user_id === activeVendorId : false;
          const byName =
            activeVendorName && vendor.display_name
              ? normalizeKey(vendor.display_name) === normalizeKey(activeVendorName)
              : false;
          return byId || byName;
        });

        const vendorIds = scopedVendors
          .map((vendor) => vendor.user_id)
          .filter((value): value is string => Boolean(value));
        const vendorNames = scopedVendors
          .map((vendor) => vendor.display_name)
          .filter((value): value is string => Boolean(value));

        const vendorNameById = new Map(
          scopedVendors
            .filter((vendor) => vendor.user_id)
            .map((vendor) => [vendor.user_id as string, vendor.display_name ?? vendor.user_id]),
        );

        let visitsQuery = supabaseDash
          .from("v_dash_visits_active")
          .select("assigned_to_user_id, assigned_to_name, completed_vidas, completed_at, no_visit_reason, visit_date")
          .gte("visit_date", vendorVidasFrom)
          .lte("visit_date", vendorVidasTo)
          .not("completed_at", "is", null)
          .is("no_visit_reason", null);
        visitsQuery = applyVendorVisitTypeScope(visitsQuery);

        if (activeSupervisorId || activeVendorId || activeVendorName) {
          if (vendorIds.length === 0 && vendorNames.length === 0) {
            setVendorVidasSeries([]);
            setVendorVidasSummary({ total: 0, totalVisitas: 0, totalAceite: 0, totalVendors: 0, hiddenCount: 0 });
            setVendorVidasLoading(false);
            return;
          }

          if (vendorIds.length && vendorNames.length) {
            visitsQuery = visitsQuery.or(
              `assigned_to_user_id.in.(${formatOrValues(vendorIds)}),assigned_to_name.in.(${formatOrValues(vendorNames)})`,
            );
          } else if (vendorIds.length) {
            visitsQuery = visitsQuery.in("assigned_to_user_id", vendorIds);
          } else {
            visitsQuery = visitsQuery.in("assigned_to_name", vendorNames);
          }
        }

        const { data: visitsData, error: visitsError } = await visitsQuery;
        if (visitsError) throw new Error(visitsError.message);

        const visitasTotals = new Map<string, number>();
        const aceiteTotals = new Map<string, number>();
        (visitsData ?? []).forEach((item) => {
          const value = Number(item.completed_vidas ?? 0);
          if (!Number.isFinite(value) || value <= 0) return;
          const label =
            item.assigned_to_name ??
            (item.assigned_to_user_id ? vendorNameById.get(item.assigned_to_user_id) : null) ??
            "Sem vendedor";
          visitasTotals.set(label, (visitasTotals.get(label) ?? 0) + value);
        });

        let aceiteQuery = supabaseDash
          .from("v_dash_aceite_digital_active")
          .select("vendor_user_id, vendor_name, vidas, entry_date")
          .gte("entry_date", vendorVidasFrom)
          .lte("entry_date", vendorVidasTo);

        if (activeSupervisorId || activeVendorId || activeVendorName) {
          if (vendorIds.length === 0 && vendorNames.length === 0) {
            setVendorVidasSeries([]);
            setVendorVidasSummary({ total: 0, totalVisitas: 0, totalAceite: 0, totalVendors: 0, hiddenCount: 0 });
            setVendorVidasLoading(false);
            return;
          }

          if (vendorIds.length && vendorNames.length) {
            aceiteQuery = aceiteQuery.or(
              `vendor_user_id.in.(${formatOrValues(vendorIds)}),vendor_name.in.(${formatOrValues(vendorNames)})`,
            );
          } else if (vendorIds.length) {
            aceiteQuery = aceiteQuery.in("vendor_user_id", vendorIds);
          } else {
            aceiteQuery = aceiteQuery.in("vendor_name", vendorNames);
          }
        }

        const { data: aceiteData, error: aceiteError } = await aceiteQuery;
        if (aceiteError) throw new Error(aceiteError.message);

        (aceiteData ?? []).forEach((item) => {
          const value = Number(item.vidas ?? 0);
          if (!Number.isFinite(value) || value < 0) return;
          const label =
            item.vendor_name ??
            (item.vendor_user_id ? vendorNameById.get(item.vendor_user_id) : null) ??
            "Sem vendedor";
          aceiteTotals.set(label, (aceiteTotals.get(label) ?? 0) + value);
        });

        const allLabels = new Set<string>([
          ...Array.from(visitasTotals.keys()),
          ...Array.from(aceiteTotals.keys()),
        ]);
        const series = Array.from(allLabels)
          .map((label) => {
            const visitas = visitasTotals.get(label) ?? 0;
            const aceite = aceiteTotals.get(label) ?? 0;
            const total = visitas + aceite;
            return { label, visitas, aceite, total };
          })
          .sort((a, b) => b.total - a.total);
        const topSeries = series.slice(0, 10);
        const totalVisitas = series.reduce((acc, item) => acc + item.visitas, 0);
        const totalAceite = series.reduce((acc, item) => acc + item.aceite, 0);
        const total = totalVisitas + totalAceite;
        setVendorVidasSeries(topSeries);
        setVendorVidasSummary({
          total,
          totalVisitas,
          totalAceite,
          totalVendors: series.length,
          hiddenCount: Math.max(0, series.length - topSeries.length),
        });
      } catch (err) {
        setVendorVidasError(err instanceof Error ? err.message : "Erro ao carregar grafico.");
        setVendorVidasSeries([]);
        setVendorVidasSummary({ total: 0, totalVisitas: 0, totalAceite: 0, totalVendors: 0, hiddenCount: 0 });
      } finally {
        setVendorVidasLoading(false);
      }
    };

    loadVendorVidas();
  }, [activeSupervisorId, activeVendorId, activeVendorName, canViewTeamStats, vendorVidasFrom, vendorVidasTo]);

  useEffect(() => {
    if (!canViewTeamStats) return;
    let active = true;

    const loadDigitalSummary = async () => {
      setDigitalLoading(true);
      setDigitalError(null);
      try {
        const vendorsQuery = supabaseDash
          .from("v_dash_profiles_active")
          .select("user_id, display_name")
          .eq("role", "VENDEDOR");

        const { data: vendors, error: vendorsError } = activeSupervisorId
          ? await vendorsQuery.eq("supervisor_id", activeSupervisorId)
          : await vendorsQuery;

        if (!active) return;
        if (vendorsError) throw new Error(vendorsError.message);

        const scopedVendors = (vendors ?? []).filter((vendor) => {
          if (!activeVendorId && !activeVendorName) return true;
          const byId = activeVendorId ? vendor.user_id === activeVendorId : false;
          const byName =
            activeVendorName && vendor.display_name
              ? normalizeKey(vendor.display_name) === normalizeKey(activeVendorName)
              : false;
          return byId || byName;
        });

        const vendorIds = scopedVendors
          .map((vendor) => vendor.user_id)
          .filter((value): value is string => Boolean(value));
        const vendorNames = scopedVendors
          .map((vendor) => vendor.display_name)
          .filter((value): value is string => Boolean(value));
        if (!globalFrom || !globalTo) {
          throw new Error("Informe o periodo do aceite digital.");
        }
        if (globalFrom > globalTo) {
          throw new Error("Periodo invalido.");
        }

        if (scopedVendors.length === 0) {
          setDigitalSummary({
            allTimeTotalVidas: 0,
            monthTotalVidas: 0,
            periodTotalVidas: 0,
            periodRegistered: 0,
            todayTotalVidas: 0,
            todayRegistered: 0,
            weekTotalVidas: 0,
            weekRegistered: 0,
            pendingToday: [],
            pendingWeek: [],
            pendingByVendor: [],
            hasAnyEntries: false,
          });
          setDigitalLoading(false);
          return;
        }

        const buildScheduledVisitsQuery = () =>
          applyVendorVisitTypeScope(
            supabaseDash
              .from("v_dash_visits_active")
              .select("assigned_to_user_id, assigned_to_name")
              .gte("visit_date", globalFrom)
              .lte("visit_date", globalTo),
          );

        const applyScheduledVendorFilter = (query: ReturnType<typeof buildScheduledVisitsQuery>) => {
          if (vendorIds.length && vendorNames.length) {
            return query.or(
              `assigned_to_user_id.in.(${formatOrValues(vendorIds)}),assigned_to_name.in.(${formatOrValues(vendorNames)})`,
            );
          }
          if (vendorIds.length) return query.in("assigned_to_user_id", vendorIds);
          if (vendorNames.length) return query.in("assigned_to_name", vendorNames);
          return query;
        };

        const { data: scheduledRows, error: scheduledError } = await applyScheduledVendorFilter(
          buildScheduledVisitsQuery(),
        );
        if (!active) return;
        if (scheduledError) throw new Error(scheduledError.message);

        const scheduledVendorIds = new Set(
          (scheduledRows ?? [])
            .map((row) => row.assigned_to_user_id)
            .filter((value): value is string => Boolean(value)),
        );
        const scheduledVendorNames = new Set(
          (scheduledRows ?? [])
            .map((row) => row.assigned_to_name)
            .filter((value): value is string => Boolean(value))
            .map((name) => normalizeKey(name)),
        );
        const pendingScopeVendors = scopedVendors.filter((vendor) => {
          const byId = Boolean(vendor.user_id && scheduledVendorIds.has(vendor.user_id));
          const byName = Boolean(vendor.display_name && scheduledVendorNames.has(normalizeKey(vendor.display_name)));
          return byId || byName;
        });

        const buildAceiteQuery = () =>
          supabaseDash
            .from("v_dash_aceite_digital_active")
            .select("vendor_user_id, vendor_name, vidas, entry_date");

        const applyVendorFilter = (query: ReturnType<typeof buildAceiteQuery>) => {
          if (vendorIds.length && vendorNames.length) {
            return query.or(
              `vendor_user_id.in.(${formatOrValues(vendorIds)}),vendor_name.in.(${formatOrValues(vendorNames)})`,
            );
          }
          if (vendorIds.length) return query.in("vendor_user_id", vendorIds);
          if (vendorNames.length) return query.in("vendor_name", vendorNames);
          return query;
        };
        const applyGlobalRange = (query: ReturnType<typeof buildAceiteQuery>) =>
          query.gte("entry_date", globalFrom).lte("entry_date", globalTo);

        const todayQuery = applyVendorFilter(
          applyGlobalRange(buildAceiteQuery().eq("entry_date", todayKey)),
        );
        const weekQuery = applyVendorFilter(
          applyGlobalRange(buildAceiteQuery().gte("entry_date", weekStartKey).lte("entry_date", todayKey)),
        );
        const monthQuery = applyVendorFilter(
          applyGlobalRange(buildAceiteQuery().gte("entry_date", monthStartKey).lte("entry_date", monthEndKey)),
        );
        const periodQuery = applyVendorFilter(
          applyGlobalRange(buildAceiteQuery()),
        );
        const allTimeQuery = applyVendorFilter(applyGlobalRange(buildAceiteQuery()));

        const [
          { data: todayRows, error: todayError },
          { data: weekRows, error: weekError },
          { data: monthRows, error: monthError },
          { data: periodRows, error: periodError },
          { data: allRows, error: allError },
        ] = await Promise.all([todayQuery, weekQuery, monthQuery, periodQuery, allTimeQuery]);

        if (!active) return;
        if (todayError) throw new Error(todayError.message);
        if (weekError) throw new Error(weekError.message);
        if (monthError) throw new Error(monthError.message);
        if (periodError) throw new Error(periodError.message);
        if (allError) throw new Error(allError.message);

        const sumRows = (rows: typeof todayRows) =>
          (rows ?? []).reduce((acc, row) => {
            const value = Number(row.vidas ?? 0);
            return acc + (Number.isFinite(value) ? value : 0);
          }, 0);

        const acceptedTodayIds = new Set(
          (todayRows ?? []).map((row) => row.vendor_user_id).filter((value): value is string => Boolean(value)),
        );
        const acceptedTodayNames = new Set(
          (todayRows ?? [])
            .map((row) => row.vendor_name)
            .filter((value): value is string => Boolean(value))
            .map((name) => normalizeKey(name)),
        );
        const acceptedWeekIds = new Set(
          (weekRows ?? []).map((row) => row.vendor_user_id).filter((value): value is string => Boolean(value)),
        );
        const acceptedWeekNames = new Set(
          (weekRows ?? [])
            .map((row) => row.vendor_name)
            .filter((value): value is string => Boolean(value))
            .map((name) => normalizeKey(name)),
        );
        const acceptedPeriodIds = new Set(
          (periodRows ?? []).map((row) => row.vendor_user_id).filter((value): value is string => Boolean(value)),
        );
        const acceptedPeriodNames = new Set(
          (periodRows ?? [])
            .map((row) => row.vendor_name)
            .filter((value): value is string => Boolean(value))
            .map((name) => normalizeKey(name)),
        );

        const pendingToday: string[] = [];
        const pendingWeek: string[] = [];
        const pendingByVendorMap = new Map<
          string,
          { name: string; pendingToday: boolean; pendingWeek: boolean }
        >();
        let todayRegistered = 0;
        let weekRegistered = 0;
        let periodRegistered = 0;
        const hasAnyEntries = pendingScopeVendors.length > 0;

        pendingScopeVendors.forEach((vendor) => {
          const name = vendor.display_name ?? vendor.user_id ?? "Vendedor";
          const nameKey = vendor.display_name ? normalizeKey(vendor.display_name) : "";
          const isToday =
            (vendor.user_id && acceptedTodayIds.has(vendor.user_id)) ||
            (nameKey && acceptedTodayNames.has(nameKey));
          const isWeek =
            (vendor.user_id && acceptedWeekIds.has(vendor.user_id)) ||
            (nameKey && acceptedWeekNames.has(nameKey));
          const isPeriod =
            (vendor.user_id && acceptedPeriodIds.has(vendor.user_id)) ||
            (nameKey && acceptedPeriodNames.has(nameKey));

          if (isToday) todayRegistered += 1;
          if (isWeek) weekRegistered += 1;
          if (isPeriod) periodRegistered += 1;
          if (!isToday) pendingToday.push(name);
          if (!isWeek) pendingWeek.push(name);
          if (!isToday || !isWeek) {
            const normalizedName = normalizeKey(name);
            const existing = pendingByVendorMap.get(normalizedName);
            if (existing) {
              existing.pendingToday = existing.pendingToday || !isToday;
              existing.pendingWeek = existing.pendingWeek || !isWeek;
            } else {
              pendingByVendorMap.set(normalizedName, {
                name,
                pendingToday: !isToday,
                pendingWeek: !isWeek,
              });
            }
          }
        });

        const normalizePendingList = (list: string[]) =>
          Array.from(new Set(list.map((name) => name.trim()).filter(Boolean)));
        const pendingTodayList = normalizePendingList(pendingToday);
        const pendingWeekList = normalizePendingList(pendingWeek);
        const pendingByVendorList = Array.from(pendingByVendorMap.values()).sort((a, b) =>
          a.name.localeCompare(b.name, "pt-BR"),
        );

        if (!active) return;
        setDigitalSummary({
          allTimeTotalVidas: sumRows(allRows),
          monthTotalVidas: sumRows(monthRows),
          periodTotalVidas: sumRows(periodRows),
          periodRegistered,
          todayTotalVidas: sumRows(todayRows),
          todayRegistered,
          weekTotalVidas: sumRows(weekRows),
          weekRegistered,
          pendingToday: pendingTodayList,
          pendingWeek: pendingWeekList,
          pendingByVendor: pendingByVendorList,
          hasAnyEntries,
        });
      } catch (err) {
        if (!active) return;
        setDigitalError(err instanceof Error ? err.message : "Erro ao carregar aceite digital.");
        setDigitalSummary(null);
      } finally {
        if (active) setDigitalLoading(false);
      }
    };

    loadDigitalSummary();
    return () => {
      active = false;
    };
  }, [
    activeSupervisorId,
    activeVendorId,
    activeVendorName,
    canViewTeamStats,
    globalFrom,
    globalTo,
    monthEndKey,
    monthStartKey,
    todayKey,
    weekStartKey,
  ]);

  useEffect(() => {
    if (!canViewTeamStats) return;
    let active = true;

    const loadSupervisorVisits = async () => {
      setSupervisorVisitLoading(true);
      setSupervisorVisitError(null);
      try {
        const { data, error: visitsError } = await supabaseDash
          .from("v_dash_visits_active")
          .select(
            "id, cliente_id, visit_date, completed_at, completed_vidas, supervisor_reason, assigned_to_user_id, assigned_to_name, register_mode",
          )
          .eq("visit_type", VISIT_TYPE.SUPERVISOR_RELACIONAMENTO)
          .gte("visit_date", globalFrom)
          .lte("visit_date", globalTo)
          .order("visit_date", { ascending: false });

        if (visitsError) throw new Error(visitsError.message);
        if (!active) return;

        const rows = (data ?? []) as unknown as SupervisorVisitDashboardRow[];
        const clienteIds = Array.from(
          new Set(
            rows
              .map((row) => row.cliente_id)
              .filter((value): value is string => Boolean(value)),
          ),
        );

        const clientesById = new Map<string, { empresa: string | null; nome_fantasia: string | null }>();
        for (let index = 0; index < clienteIds.length; index += 500) {
          const chunk = clienteIds.slice(index, index + 500);
          if (chunk.length === 0) continue;
          const { data: clientesData, error: clientesError } = await supabaseDash
            .from("v_dash_clientes_active")
            .select("id, empresa, nome_fantasia")
            .in("id", chunk);
          if (clientesError) throw new Error(clientesError.message);
          (clientesData ?? []).forEach((row) => {
            const item = row as { id: string; empresa: string | null; nome_fantasia: string | null };
            clientesById.set(item.id, { empresa: item.empresa, nome_fantasia: item.nome_fantasia });
          });
        }

        const rowsWithCliente = rows.map((row) => ({
          ...row,
          cliente: row.cliente_id ? clientesById.get(row.cliente_id) ?? null : null,
        }));
        const filtered = rowsWithCliente.filter((row) => {
          if (supervisorVisitFilterUserId === "all") return true;
          return row.assigned_to_user_id === supervisorVisitFilterUserId;
        });

        const motivosCount = new Map<string, number>();
        let realizadas = 0;
        let pendentes = 0;
        let vidas = 0;

        filtered.forEach((item) => {
          if (item.completed_at) {
            realizadas += 1;
          } else {
            pendentes += 1;
          }
          const vidasValue = Number(item.completed_vidas ?? 0);
          if (Number.isFinite(vidasValue)) vidas += vidasValue;
          const motivoKey = item.supervisor_reason ?? "SEM_MOTIVO";
          motivosCount.set(motivoKey, (motivosCount.get(motivoKey) ?? 0) + 1);
        });

        const motivos = Array.from(motivosCount.entries())
          .map(([key, count]) => ({
            key,
            label:
              key === "SEM_MOTIVO"
                ? "Sem motivo"
                : supervisorReasonLabelByValue.get(key) ?? key,
            count,
          }))
          .sort((a, b) => b.count - a.count);

        setSupervisorVisitRows(filtered);
        setSupervisorVisitSummary({
          realizadas,
          pendentes,
          vidas,
          motivos,
        });
      } catch (err) {
        if (!active) return;
        setSupervisorVisitRows([]);
        setSupervisorVisitSummary({
          realizadas: 0,
          pendentes: 0,
          vidas: 0,
          motivos: [],
        });
        setSupervisorVisitError(
          err instanceof Error ? err.message : "Erro ao carregar visitas de supervisor.",
        );
      } finally {
        if (active) setSupervisorVisitLoading(false);
      }
    };

    void loadSupervisorVisits();
    return () => {
      active = false;
    };
  }, [
    canViewTeamStats,
    globalFrom,
    globalTo,
    supervisorReasonLabelByValue,
    supervisorVisitFilterUserId,
  ]);

  const normalizedVendorNames = useMemo(() => {
    if (!teamVendorNames.length) return new Set<string>();
    return new Set(teamVendorNames.map((name) => normalizeKey(name)));
  }, [teamVendorNames]);

  const summaryRows = useMemo(() => {
    if (!globalFrom || !globalTo || globalFrom > globalTo) return [];
    return rows.filter((row) => {
      const dateKey = (row.data_da_ultima_visita ?? "").slice(0, 10);
      if (!dateKey || dateKey < globalFrom || dateKey > globalTo) return false;

      if (!canViewTeamStats || (!activeSupervisorId && !activeVendorId)) return true;
      if (normalizedVendorNames.size === 0 || !row.vendedor) return false;
      return normalizedVendorNames.has(normalizeKey(row.vendedor));
    });
  }, [activeSupervisorId, activeVendorId, canViewTeamStats, globalFrom, globalTo, normalizedVendorNames, rows]);

  const summary = useMemo(() => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);

    const totals = { today: 0, week: 0, month: 0 };
    const byStatus: Record<string, number> = {};
    const byVendor: Record<string, number> = {};

    summaryRows.forEach((row) => {
      const visitDate = parseVisitDate(row);
      if (visitDate) {
        const visitDay = new Date(visitDate);
        visitDay.setHours(0, 0, 0, 0);
        if (visitDay.getTime() === today.getTime()) totals.today += 1;
        if (visitDay >= weekStart) totals.week += 1;
        if (visitDay >= monthStart) totals.month += 1;
      }

      if (row.situacao) {
        byStatus[row.situacao] = (byStatus[row.situacao] ?? 0) + 1;
      }

      if (row.vendedor) {
        byVendor[row.vendedor] = (byVendor[row.vendedor] ?? 0) + 1;
      }
    });

    const topStatus = Object.entries(byStatus).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const ranking = Object.entries(byVendor).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return { totals, topStatus, ranking, byVendor };
  }, [summaryRows]);

  const vendorVisitsList = useMemo(
    () =>
      Object.entries(summary.byVendor)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value),
    [summary.byVendor],
  );
  const supervisorVisitRowsPreview = useMemo(
    () => supervisorVisitRows.slice(0, 12),
    [supervisorVisitRows],
  );

  const donutLabel = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
  const dailyVidasTotal = useMemo(
    () => visitDailyVidas.reduce((sum, item) => sum + item.value, 0),
    [visitDailyVidas],
  );
  const teamDailyVidasTotal = useMemo(
    () => teamDailyVidas.reduce((sum, item) => sum + item.value, 0),
    [teamDailyVidas],
  );
  const vendorImpactVidas = useMemo(
    () => (visitStats?.totalVidas ?? 0) + vendorAceitePeriodVidas,
    [vendorAceitePeriodVidas, visitStats],
  );
  const teamImpactVidas = useMemo(
    () => (teamStats?.totalVidas ?? 0) + (digitalSummary?.periodTotalVidas ?? 0),
    [digitalSummary, teamStats],
  );
  const resolvedDailyRange = useMemo(() => {
    const today = toLocalDateInput(new Date());
    const monthStart = toLocalDateInput(startOfMonth(new Date()));
    const from = globalFrom || monthStart;
    const to = globalTo || today;
    return { from, to };
  }, [globalFrom, globalTo]);
  const dailyDualVidas = useMemo(
    () => buildDailyDualVidasSeries(vendorVisitsRaw, vendorAceites, resolvedDailyRange.from, resolvedDailyRange.to),
    [resolvedDailyRange.from, resolvedDailyRange.to, vendorAceites, vendorVisitsRaw],
  );
  const canViewDailyVendorStats = canViewTeamStats && selectedVendorId !== "all";

  const renderDonut = (
    title: string,
    total: number,
    data: Array<{ label: string; value: number; color: string }>,
    subtitle?: string,
    onSegmentClick?: (label: string) => void,
  ) => {
    const sum = data.reduce((acc, item) => acc + item.value, 0);
    let current = 0;
    const segments = data
      .map((item) => {
        const percent = sum ? (item.value / sum) * 100 : 0;
        const start = current;
        current += percent;
        return `${item.color} ${start}% ${current}%`;
      })
      .join(", ");
    const background = sum ? `conic-gradient(${segments})` : "conic-gradient(#e2e8f0 0% 100%)";

    return (
      <div className="rounded-2xl border border-sea/15 bg-white/95 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">{title}</h3>
          {subtitle ? <span className="text-xs text-ink/60">{subtitle}</span> : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="relative h-36 w-36">
            <div className="absolute inset-0 rounded-full" style={{ background }} />
            <div className="absolute inset-4 rounded-full bg-white" />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xs text-ink/60">Total</span>
              <span className="text-xl font-semibold text-ink">{donutLabel(total)}</span>
            </div>
          </div>
          <div className="space-y-2 text-xs text-ink/70">
            {data.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onSegmentClick?.(item.label)}
                disabled={!onSegmentClick}
                className="flex w-full items-center gap-2 text-left disabled:cursor-default"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="min-w-[110px]">{item.label}</span>
                <span className="font-semibold text-ink">{donutLabel(item.value)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const exportDashboardPdf = async () => {
    setVendorVidasError(null);
    setExportingPdf(true);
    const root = document.getElementById("dashboard-export-root");
    if (!root) {
      setVendorVidasError("Nao foi possivel preparar o PDF do dashboard.");
      setExportingPdf(false);
      return;
    }

    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      try {
        const fontsReady = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
        if (fontsReady) await fontsReady;
      } catch {
        // ignore font readiness issues and continue
      }

      const images = Array.from(root.querySelectorAll("img"));
      if (images.length > 0) {
        await Promise.all(
          images.map(
            (image) =>
              new Promise<void>((resolve) => {
                if (image.complete) {
                  resolve();
                  return;
                }
                image.onload = () => resolve();
                image.onerror = () => resolve();
              }),
          ),
        );
      }

      const waitFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await waitFrame();

      const bounds = root.getBoundingClientRect();
      const exportWidthPx = Math.max(Math.ceil(bounds.width), 794);
      const deviceScale = Math.min(window.devicePixelRatio || 1.5, 2);
      const safeScale = Math.max(0.7, deviceScale);
      const htmlElement = document.documentElement;
      const hadDarkClass = htmlElement.classList.contains("dark");

      const hasVisiblePixels = (canvas: HTMLCanvasElement) => {
        const probeCanvas = document.createElement("canvas");
        probeCanvas.width = 56;
        probeCanvas.height = 56;
        const probeCtx = probeCanvas.getContext("2d", { willReadFrequently: true });
        if (!probeCtx) return true;

        probeCtx.fillStyle = "#ffffff";
        probeCtx.fillRect(0, 0, probeCanvas.width, probeCanvas.height);
        probeCtx.drawImage(canvas, 0, 0, probeCanvas.width, probeCanvas.height);
        const imageData = probeCtx.getImageData(0, 0, probeCanvas.width, probeCanvas.height).data;
        let nonWhite = 0;
        for (let index = 0; index < imageData.length; index += 4) {
          const r = imageData[index];
          const g = imageData[index + 1];
          const b = imageData[index + 2];
          const a = imageData[index + 3];
          if (a > 0 && (r < 245 || g < 245 || b < 245)) {
            nonWhite += 1;
            if (nonWhite >= 8) return true;
          }
        }
        return false;
      };

      const captureAttempts = [
        { scale: safeScale, foreignObjectRendering: false },
        { scale: 1, foreignObjectRendering: false },
        { scale: 1, foreignObjectRendering: true },
      ].filter(
        (attempt, index, list) =>
          list.findIndex(
            (item) =>
              Math.abs(item.scale - attempt.scale) < 0.01 &&
              item.foreignObjectRendering === attempt.foreignObjectRendering,
          ) === index,
      );

      const captureElement = async (element: HTMLElement) => {
        let captureError: unknown = null;
        for (const attempt of captureAttempts) {
          try {
            const candidate = await html2canvas(element, {
              scale: attempt.scale,
              useCORS: true,
              allowTaint: false,
              backgroundColor: "#ffffff",
              logging: false,
              foreignObjectRendering: attempt.foreignObjectRendering,
              scrollX: 0,
              scrollY: 0,
              windowWidth: exportWidthPx,
              windowHeight: Math.max(element.scrollHeight, element.clientHeight, document.documentElement.clientHeight, 1),
              ignoreElements: (node) => node instanceof HTMLElement && node.dataset.pdfExclude === "true",
            });

            if (candidate.width <= 0 || candidate.height <= 0) {
              throw new Error("Renderizacao do PDF retornou canvas vazio.");
            }
            if (!hasVisiblePixels(candidate)) {
              throw new Error("Renderizacao do PDF retornou conteudo em branco.");
            }
            return candidate;
          } catch (error) {
            captureError = error;
          }
        }
        if (captureError instanceof Error) throw captureError;
        throw new Error("Falha ao renderizar bloco do dashboard.");
      };

      const getPdfFileName = () => {
        const now = new Date();
        const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
          now.getDate(),
        ).padStart(2, "0")}`;
        return `dashboard-${dateKey}.pdf`;
      };

      const saveSingleCanvasPdf = (canvas: HTMLCanvasElement) => {
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        const pageWidthMm = 210;
        const pageHeightMm = 297;
        const marginMm = 8;
        const contentWidthMm = pageWidthMm - marginMm * 2;
        const contentHeightMm = pageHeightMm - marginMm * 2;
        const renderXmm = (pageWidthMm - contentWidthMm) / 2;
        const pageHeightPx = Math.max(1, Math.floor((contentHeightMm * canvas.width) / contentWidthMm));
        let renderedPx = 0;
        let pageIndex = 0;

        while (renderedPx < canvas.height) {
          const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);
          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = canvas.width;
          pageCanvas.height = sliceHeightPx;
          const pageCtx = pageCanvas.getContext("2d");
          if (!pageCtx) throw new Error("Falha ao preparar paginas do PDF.");
          pageCtx.fillStyle = "#ffffff";
          pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
          pageCtx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);

          if (pageIndex > 0) {
            pdf.addPage();
          }

          const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
          const sliceHeightMm = (sliceHeightPx * contentWidthMm) / canvas.width;
          pdf.addImage(imgData, "JPEG", renderXmm, marginMm, contentWidthMm, sliceHeightMm, undefined, "FAST");

          renderedPx += sliceHeightPx;
          pageIndex += 1;
        }

        pdf.save(getPdfFileName());
      };

      const exportHost = document.createElement("div");
      exportHost.style.position = "fixed";
      exportHost.style.left = "0";
      exportHost.style.top = "0";
      exportHost.style.width = `${exportWidthPx}px`;
      exportHost.style.maxWidth = `${exportWidthPx}px`;
      exportHost.style.background = "#ffffff";
      exportHost.style.pointerEvents = "none";
      exportHost.style.opacity = "1";
      exportHost.style.zIndex = "-1";

      const clonedRoot = root.cloneNode(true) as HTMLElement;
      clonedRoot.style.width = `${exportWidthPx}px`;
      clonedRoot.style.maxWidth = "none";
      clonedRoot.style.minWidth = `${exportWidthPx}px`;
      clonedRoot.style.display = "block";

      exportHost.appendChild(clonedRoot);
      document.body.appendChild(exportHost);

      let blockExportError: unknown = null;
      try {
        if (hadDarkClass) {
          htmlElement.classList.remove("dark");
        }

        clonedRoot.querySelectorAll<HTMLElement>("[data-pdf-exclude='true']").forEach((node) => node.remove());
        clonedRoot.style.boxSizing = "border-box";
        clonedRoot.style.padding = "18px 18px 22px";
        clonedRoot.style.background = "#ffffff";
        clonedRoot.style.color = "#111827";

        clonedRoot.querySelectorAll<HTMLElement>("section, .dashboard-card, .dashboard-card-soft").forEach((node) => {
          node.style.boxSizing = "border-box";
          node.style.maxWidth = "none";
          node.style.width = "100%";
        });

        clonedRoot.querySelectorAll<HTMLElement>("section.grid, div.grid").forEach((node) => {
          const className = node.className ?? "";
          if (typeof className === "string" && /grid-cols-\d|grid-cols-\[/.test(className)) {
            node.style.display = "grid";
            node.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
            node.style.width = "100%";
            node.style.alignItems = "stretch";
          }
        });

        clonedRoot.querySelectorAll<HTMLElement>(".overflow-x-auto").forEach((node) => {
          node.style.overflowX = "visible";
        });

        clonedRoot.querySelectorAll<HTMLLabelElement>("label").forEach((label) => {
          const text = (label.textContent ?? "").trim().toLowerCase();
          if (text === "supervisor" || text === "vendedor") {
            label.style.display = "none";
          }
        });

        clonedRoot.querySelectorAll<HTMLElement>("select, input[type='date'], button").forEach((element) => {
          const label = element.closest("label");
          if (label) return;
          const parentText = (element.parentElement?.textContent ?? "").toLowerCase();
          if (parentText.includes("de") || parentText.includes("ate") || parentText.includes("período")) return;
        });

        const headerControls = Array.from(clonedRoot.querySelectorAll("header label, header select, header input")).filter(
          (node): node is HTMLElement => node instanceof HTMLElement,
        );
        headerControls.forEach((node) => {
          const text = (node.textContent ?? "").trim().toLowerCase();
          if (text === "de" || text === "ate" || text === "supervisor" || text === "vendedor") {
            return;
          }
          if (node.tagName === "SELECT" || node.tagName === "INPUT") {
            node.style.display = "none";
          }
        });

        clonedRoot.querySelectorAll<HTMLElement>("header").forEach((header) => {
          const rangeText = `${globalFrom && globalTo ? `${globalFrom} a ${globalTo}` : `${resolvedDailyRange.from} a ${resolvedDailyRange.to}`}`;
          const rangeBadge = document.createElement("span");
          rangeBadge.textContent = rangeText;
          rangeBadge.style.display = "inline-flex";
          rangeBadge.style.alignItems = "center";
          rangeBadge.style.padding = "4px 8px";
          rangeBadge.style.border = "1px solid #d1d5db";
          rangeBadge.style.borderRadius = "9999px";
          rangeBadge.style.fontSize = "11px";
          rangeBadge.style.fontWeight = "600";
          rangeBadge.style.color = "#111827";
          rangeBadge.style.background = "#f9fafb";
          header.appendChild(rangeBadge);
        });

        clonedRoot.querySelectorAll<HTMLElement>(".text-muted, .text-ink\\/60, .text-ink\\/50, .text-ink\\/70").forEach((node) => {
          node.style.color = "#6b7280";
        });

        const cloneImages = Array.from(clonedRoot.querySelectorAll("img"));
        if (cloneImages.length > 0) {
          await Promise.all(
            cloneImages.map(
              (image) =>
                new Promise<void>((resolve) => {
                  if (image.complete) {
                    resolve();
                    return;
                  }
                  image.onload = () => resolve();
                  image.onerror = () => resolve();
                }),
            ),
          );
        }

        await waitFrame();
        await waitFrame();

        const blocks: HTMLElement[] = [];
        Array.from(clonedRoot.children).forEach((child) => {
          if (!(child instanceof HTMLElement)) return;
          if (
            child.tagName === "DIV" &&
            (child.classList.contains("space-y-6") || child.classList.contains("space-y-4")) &&
            child.children.length > 0
          ) {
            const nested = Array.from(child.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
            if (nested.length > 0) {
              blocks.push(...nested);
              return;
            }
          }
          blocks.push(child);
        });
        if (blocks.length === 0) {
          blocks.push(clonedRoot);
        }

        const fullCanvas = await captureElement(clonedRoot);
        saveSingleCanvasPdf(fullCanvas);
      } catch (error) {
        setVendorVidasError(error instanceof Error ? error.message : "Falha ao gerar o PDF.");
      } finally {
        if (hadDarkClass) {
          htmlElement.classList.add("dark");
        }
        exportHost.remove();
      }
    } catch (error) {
      setVendorVidasError(error instanceof Error ? error.message : "Falha ao gerar o PDF.");
    } finally {
      setExportingPdf(false);
    }
  };

  const formatPendingList = (names: string[], limit = 6) => {
    if (names.length === 0) return "Nenhuma pendencia.";
    const slice = names.slice(0, limit);
    const extra = names.length - slice.length;
    return `${slice.join(", ")}${extra > 0 ? ` e mais ${extra}` : ""}`;
  };
  const formatVendorPending = (item: { pendingToday: boolean; pendingWeek: boolean }) => {
    if (item.pendingToday && item.pendingWeek) return "Hoje e Semana";
    if (item.pendingToday) return "Hoje";
    if (item.pendingWeek) return "Semana";
    return "-";
  };

  return (
    <div id="dashboard-export-root" className="space-y-4 md:space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-ink">Dashboard</h2>
            <p className="mt-2 text-sm text-muted">
              Indicadores gerais da agenda e visitas comerciais.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {canSelectSupervisor && (
              <>
                <label className="flex min-w-[220px] flex-col gap-1 text-xs font-semibold text-ink/70">
                  Supervisor
                  <select
                    id="dashboard-supervisor-select"
                    name="dashboardSupervisorSelect"
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
                <label className="flex min-w-[220px] flex-col gap-1 text-xs font-semibold text-ink/70">
                  Vendedor
                  <select
                    id="dashboard-vendor-select"
                    name="dashboardVendorSelect"
                    value={selectedVendorId}
                    onChange={(event) => setSelectedVendorId(event.target.value || "all")}
                    className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink outline-none focus:border-sea"
                  >
                    <option value="all">Todos</option>
                    {vendedores.length === 0 ? (
                      <option value="all">Nenhum vendedor</option>
                    ) : (
                      vendedores.map((vendor) => (
                        <option key={vendor.user_id ?? vendor.display_name ?? "vendor"} value={vendor.user_id ?? "all"}>
                          {vendor.display_name ?? "Vendedor"}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </>
            )}
            <label className="flex min-w-[150px] flex-col gap-1 text-xs font-semibold text-ink/70">
              De
              <input
                type="date"
                value={globalFrom}
                onChange={(event) => setVendorVidasFrom(event.target.value)}
                className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink outline-none focus:border-sea"
              />
            </label>
            <label className="flex min-w-[150px] flex-col gap-1 text-xs font-semibold text-ink/70">
              Ate
              <input
                type="date"
                value={globalTo}
                onChange={(event) => setVendorVidasTo(event.target.value)}
                className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink outline-none focus:border-sea"
              />
            </label>
            <button
              type="button"
              onClick={exportDashboardPdf}
              disabled={exportingPdf}
              data-pdf-exclude="true"
              className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea print:hidden"
            >
              {exportingPdf ? "Gerando PDF..." : "Exportar PDF"}
            </button>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="glass-pane rounded-2xl p-4 text-sm text-ink/70 md:p-6">
          Carregando indicadores...
        </div>
      ) : error ? (
        <div className="dashboard-status-danger rounded-2xl border p-6 text-sm">
          {error}
        </div>
      ) : (
        <div className="space-y-4 md:space-y-6">
          {scheduledCountsError && (
            <div className="dashboard-status-warning rounded-2xl border px-4 py-3 text-xs">
              {scheduledCountsError}
            </div>
          )}
          <section className={`grid gap-4 ${isVendor ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
            <div className="rounded-2xl border border-sea/20 bg-sand/40 p-4 md:p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Hoje</p>
              <p className="mt-2 font-display text-3xl text-ink">
                {formatNumber(scheduledCounts.today.scheduled)}
              </p>
              <p className="text-xs text-ink/60">Visitas marcadas para hoje</p>
              <p className="mt-1 text-[11px] font-semibold text-ink/70">
                Efetuadas: {formatNumber(scheduledCounts.today.completed)}/
                {formatNumber(scheduledCounts.today.scheduled)}
              </p>
            </div>
            <div className="rounded-2xl border border-sea/20 bg-sand/40 p-4 md:p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Semana</p>
              <p className="mt-2 font-display text-3xl text-ink">
                {formatNumber(scheduledCounts.week.scheduled)}
              </p>
              <p className="text-xs text-ink/60">Visitas marcadas para a semana</p>
              <p className="mt-1 text-[11px] font-semibold text-ink/70">
                Efetuadas: {formatNumber(scheduledCounts.week.completed)}/
                {formatNumber(scheduledCounts.week.scheduled)}
              </p>
            </div>
            <div className="rounded-2xl border border-sea/20 bg-sand/40 p-4 md:p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Mes</p>
              <p className="mt-2 font-display text-3xl text-ink">
                {formatNumber(scheduledCounts.month.scheduled)}
              </p>
              <p className="text-xs text-ink/60">Visitas marcadas para o mes</p>
              <p className="mt-1 text-[11px] font-semibold text-ink/70">
                Efetuadas: {formatNumber(scheduledCounts.month.completed)}/
                {formatNumber(scheduledCounts.month.scheduled)}
              </p>
            </div>
            {SHOW_NEXT_ROUTE_BLOCK && isVendor && (
              <button
                type="button"
                onClick={() => {
                  if (vendorNextRouteAccessAllowed && nextRoutePreview) {
                    setShowNextRouteModal(true);
                  }
                }}
                disabled={!vendorNextRouteAccessAllowed || !nextRoutePreview}
                className={`rounded-2xl border border-sea/20 bg-sand/40 p-4 text-left md:p-5 ${
                  !vendorNextRouteAccessAllowed || !nextRoutePreview
                    ? "cursor-not-allowed opacity-80"
                    : "transition hover:border-sea hover:bg-sand/55"
                }`}
              >
                <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Proxima rota</p>
                {nextRoutePreviewLoading ? (
                  <p className="mt-2 text-sm text-ink/70">Carregando...</p>
                ) : !vendorNextRouteAccessAllowed ? (
                  <p className="mt-2 text-sm text-ink/70">visualização não disponivel</p>
                ) : nextRoutePreview ? (
                  <p className="mt-2 font-display text-3xl text-ink">{nextRoutePreview.date}</p>
                ) : (
                  <p className="mt-2 text-sm text-ink/70">Nenhuma rota agendada.</p>
                )}
                <p className="text-xs text-ink/60">
                  {vendorNextRouteAccessAllowed && nextRoutePreview ? "Clique para ver detalhes" : ""}
                </p>
              </button>
            )}
          </section>
          {isVendor && nextRoutePreviewError ? (
            <p className="text-xs text-red-500">{nextRoutePreviewError}</p>
          ) : null}

          {canViewTeamStats && (
            <section className="rounded-2xl border border-sea/15 bg-white/90 p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg text-ink">Aceite digital</h3>
                  <p className="mt-1 text-xs text-ink/60">
                    Resumo de registros de vidas e pendencias do time.
                  </p>
                </div>
                <span className="text-[11px] font-semibold text-ink/60">
                  Periodo global: {globalPeriodLabel}
                </span>
              </div>

              {digitalLoading ? (
                <p className="mt-3 text-xs text-ink/60">Carregando aceite digital...</p>
              ) : digitalError ? (
                <p className="mt-3 text-xs text-red-500">{digitalError}</p>
              ) : digitalSummary ? (
                <div className="mt-4 grid gap-3 md:grid-cols-5">
                  <div className="rounded-xl border border-sea/15 bg-sand/30 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Total</p>
                    <p className="mt-2 text-2xl font-semibold text-ink">
                      {formatNumber(digitalSummary.allTimeTotalVidas)}
                    </p>
                    <p className="text-[11px] text-ink/60">Periodo global</p>
                  </div>
                  <div className="rounded-xl border border-sea/15 bg-sand/30 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Periodo</p>
                    <p className="mt-2 text-2xl font-semibold text-ink">
                      {formatNumber(digitalSummary.periodTotalVidas)}
                    </p>
                    <p className="text-[11px] text-ink/60">
                      {digitalSummary.periodRegistered} vendedor(es) registraram
                    </p>
                  </div>
                  <div className="rounded-xl border border-sea/15 bg-sand/30 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Mes</p>
                    <p className="mt-2 text-2xl font-semibold text-ink">
                      {formatNumber(digitalSummary.monthTotalVidas)}
                    </p>
                    <p className="text-[11px] text-ink/60">Mes atual</p>
                  </div>
                  <div className="rounded-xl border border-sea/15 bg-sand/30 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Hoje</p>
                    <p className="mt-2 text-2xl font-semibold text-ink">
                      {formatNumber(digitalSummary.todayTotalVidas)}
                    </p>
                    <p className="text-[11px] text-ink/60">
                      {digitalSummary.todayRegistered} vendedor(es) registraram
                    </p>
                  </div>
                  <div className="rounded-xl border border-sea/15 bg-sand/30 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Semana</p>
                    <p className="mt-2 text-2xl font-semibold text-ink">
                      {formatNumber(digitalSummary.weekTotalVidas)}
                    </p>
                    <p className="text-[11px] text-ink/60">
                      {digitalSummary.weekRegistered} vendedor(es) registraram
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPendingModal(true)}
                    className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-left transition hover:border-amber-300 md:col-span-5"
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-amber-700">Pendencias</p>
                    {!digitalSummary.hasAnyEntries ||
                      (digitalSummary.pendingWeek.length === 0 &&
                        digitalSummary.pendingToday.length === 0) ? (
                      <p className="mt-2 text-sm text-amber-700">
                        Nao ha pendencias ate o momento.
                      </p>
                    ) : (
                      <>
                        <p className="mt-2 text-sm text-amber-700">
                          Semana: {digitalSummary.pendingWeek.length} vendedor(es)
                        </p>
                        <p className="text-[11px] text-amber-700">
                          {formatPendingList(digitalSummary.pendingWeek)}
                        </p>
                        <p className="mt-2 text-sm text-amber-700">
                          Hoje: {digitalSummary.pendingToday.length} vendedor(es)
                        </p>
                        <p className="text-[11px] text-amber-700">
                          {formatPendingList(digitalSummary.pendingToday)}
                        </p>
                        <p className="mt-2 text-[11px] text-amber-700">Clique para ver por vendedor.</p>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-xs text-ink/60">Sem dados de aceite digital.</p>
              )}
            </section>
          )}

          {canViewTeamStats && (
            <section className="dashboard-card rounded-2xl p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg text-ink">Visitas de supervisor</h3>
                  <p className="mt-1 text-xs text-ink/60">
                    Bloco dedicado a realizadas, pendentes, vidas e motivo das visitas de supervisor.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex min-w-[220px] flex-col gap-1 text-xs font-semibold text-ink/70">
                    Supervisor
                    <select
                      value={supervisorVisitFilterUserId}
                      onChange={(event) => setSupervisorVisitFilterUserId(event.target.value || "all")}
                      className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink outline-none focus:border-sea"
                    >
                      <option value="all">Todos</option>
                      {supervisores
                        .filter((supervisor) => Boolean(supervisor.user_id))
                        .map((supervisor) => (
                          <option key={supervisor.id} value={supervisor.user_id ?? "all"}>
                            {supervisor.display_name ?? "Supervisor"}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              </div>

              {supervisorVisitLoading ? (
                <p className="mt-4 text-xs text-ink/60">Carregando visitas de supervisor...</p>
              ) : supervisorVisitError ? (
                <p className="mt-4 text-xs text-red-500">{supervisorVisitError}</p>
              ) : (
                <>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="dashboard-card-soft rounded-xl px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Realizadas</p>
                      <p className="mt-2 text-2xl font-semibold text-ink">
                        {formatNumber(supervisorVisitSummary.realizadas)}
                      </p>
                    </div>
                    <div className="dashboard-card-soft rounded-xl px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Pendentes</p>
                      <p className="mt-2 text-2xl font-semibold text-ink">
                        {formatNumber(supervisorVisitSummary.pendentes)}
                      </p>
                    </div>
                    <div className="dashboard-card-soft rounded-xl px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Vidas</p>
                      <p className="mt-2 text-2xl font-semibold text-ink">
                        {formatNumber(supervisorVisitSummary.vidas)}
                      </p>
                      <p className="text-[11px] text-ink/60">Soma de valores preenchidos (null = 0)</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.5fr]">
                    <div className="dashboard-card-soft rounded-xl p-4">
                      <p className="text-xs font-semibold text-ink/70">Motivos das visitas</p>
                      <div className="mt-3 space-y-2">
                        {supervisorVisitSummary.motivos.length === 0 ? (
                          <p className="text-xs text-ink/60">Sem motivos no periodo.</p>
                        ) : (
                          supervisorVisitSummary.motivos.map((item) => (
                            <div key={item.key} className="flex items-center justify-between text-xs">
                              <span className="text-ink/80">{item.label}</span>
                              <span className="font-semibold text-sea">{formatNumber(item.count)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="dashboard-card-soft rounded-xl p-4">
                      <p className="text-xs font-semibold text-ink/70">Detalhamento das visitas</p>
                      <div className="mt-3 max-h-[300px] overflow-y-auto rounded-lg border border-sea/10">
                        {supervisorVisitRowsPreview.length === 0 ? (
                          <p className="px-3 py-3 text-xs text-ink/60">Sem visitas no periodo selecionado.</p>
                        ) : (
                          <div className="divide-y divide-sea/10">
                            {supervisorVisitRowsPreview.map((item) => {
                              const cliente = Array.isArray(item.cliente)
                                ? item.cliente[0] ?? null
                                : item.cliente;
                              const empresa = cliente?.empresa ?? cliente?.nome_fantasia ?? "-";
                              const statusLabel = item.completed_at ? "Realizada" : "Pendente";
                              const motivoLabel = item.supervisor_reason
                                ? supervisorReasonLabelByValue.get(item.supervisor_reason) ?? item.supervisor_reason
                                : "Sem motivo";
                              return (
                                <div key={item.id} className="px-3 py-2 text-xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-semibold text-ink">{empresa}</span>
                                    <span
                                      className={[
                                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                        item.completed_at
                                          ? "bg-emerald-100 text-emerald-700"
                                          : "bg-amber-100 text-amber-700",
                                      ].join(" ")}
                                    >
                                      {statusLabel}
                                    </span>
                                  </div>
                                  <div className="mt-1 grid gap-1 text-[11px] text-ink/65">
                                    <span>Data: {item.visit_date ? formatDateBr(item.visit_date) : "-"}</span>
                                    <span>Motivo: {motivoLabel}</span>
                                    <span>Vidas: {formatNumber(Number(item.completed_vidas ?? 0))}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {supervisorVisitRows.length > supervisorVisitRowsPreview.length ? (
                        <p className="mt-2 text-[11px] text-ink/60">
                          Mostrando {supervisorVisitRowsPreview.length} de {supervisorVisitRows.length} visitas.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          <section className="grid gap-4 lg:grid-cols-2">
            {canViewDailyVendorStats && (
              <div className="rounded-2xl border border-sea/15 bg-white/90 p-4 md:p-5 lg:col-span-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-lg text-ink">Vidas por dia</h3>
                    <p className="mt-1 text-xs text-ink/60">
                      Vidas vindas de visitas e aceite digital no periodo selecionado.
                    </p>
                  </div>
                  <span className="text-xs text-ink/60">
                    {globalFrom && globalTo ? `${globalFrom} a ${globalTo}` : `${resolvedDailyRange.from} a ${resolvedDailyRange.to}`}
                  </span>
                </div>
                {dailyDualVidas.length === 0 ? (
                  <p className="mt-4 text-sm text-ink/60">Sem dados.</p>
                ) : (
                  <div className="mt-5">
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink/60">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm bg-sea" />
                        Visitas
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />
                        Aceite digital
                      </span>
                    </div>
                    <div className="mt-4 flex items-end gap-4 overflow-x-auto pb-2">
                      {(() => {
                        const maxValue = dailyDualVidas.reduce((max, item) => Math.max(max, item.visitas, item.aceite), 1);
                        return dailyDualVidas.map((item) => {
                          const visitasHeight = Math.max(8, Math.round((item.visitas / maxValue) * 160));
                          const aceiteHeight = Math.max(8, Math.round((item.aceite / maxValue) * 160));
                          const total = item.visitas + item.aceite;
                          return (
                            <div key={item.label} className="flex min-w-[72px] flex-col items-center gap-2">
                              <span className="text-[11px] font-semibold text-ink">{formatNumber(total)}</span>
                              <div className="flex items-end gap-1">
                                <div className="w-4 rounded-t-lg bg-sea" style={{ height: visitasHeight }} />
                                <div className="w-4 rounded-t-lg bg-amber-400" style={{ height: aceiteHeight }} />
                              </div>
                              <span className="w-20 truncate text-center text-[11px] text-ink/70">{item.label}</span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                    <div className="mt-5 overflow-x-auto rounded-xl border border-sea/10">
                      <table className="min-w-[560px] w-full text-left text-xs">
                        <thead className="bg-sand/30 text-ink/60">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Dia</th>
                            <th className="px-3 py-2 font-semibold text-right">Visitas</th>
                            <th className="px-3 py-2 font-semibold text-right">Aceite digital</th>
                            <th className="px-3 py-2 font-semibold text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-sea/10">
                          {dailyDualVidas.map((item) => {
                            const total = item.visitas + item.aceite;
                            return (
                              <tr key={item.label}>
                                <td className="px-3 py-2 text-ink">{item.label}</td>
                                <td className="px-3 py-2 text-right text-ink/70">{formatNumber(item.visitas)}</td>
                                <td className="px-3 py-2 text-right text-ink/70">{formatNumber(item.aceite)}</td>
                                <td className="px-3 py-2 text-right font-semibold text-sea">{formatNumber(total)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

          </section>

          {canViewTeamStats && (
            <section className="rounded-2xl border border-sea/15 bg-white/90 p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg text-ink">Vidas por vendedor</h3>
                  <p className="mt-1 text-xs text-ink/60">
                    Soma de vidas registradas por vendedor (visitas + aceite digital) no periodo selecionado.
                  </p>
                </div>
                <span className="text-[11px] font-semibold text-ink/60">
                  Periodo global: {globalPeriodLabel}
                </span>
              </div>

              {vendorVidasError && (
                <p className="mt-3 text-xs text-red-500">{vendorVidasError}</p>
              )}
              {vendorVidasLoading ? (
                <p className="mt-3 text-xs text-ink/60">Carregando grafico...</p>
              ) : vendorVidasSeries.length === 0 ? (
                <p className="mt-3 text-xs text-ink/60">Sem dados para o periodo.</p>
              ) : (
                <div className="mt-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink/60">
                    <span>Total de vidas: {formatNumber(vendorVidasSummary.total)}</span>
                    <span>
                      Mostrando top 10{vendorVidasSummary.hiddenCount > 0 ? ` (+${vendorVidasSummary.hiddenCount} outros)` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink/60">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm bg-sea" />
                      Visitas
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />
                      Aceite digital
                    </span>
                  </div>
                  <div className="flex items-end gap-4 overflow-x-auto pb-2">
                    {(() => {
                      const maxValue = vendorVidasSeries[0]?.total ?? 1;
                      const safeMax = Math.max(1, maxValue);
                      const total =
                        vendorVidasSummary.total ||
                        vendorVidasSeries.reduce((acc, item) => acc + item.total, 0);
                      return vendorVidasSeries.map((item) => {
                        const visitasHeight = Math.max(6, Math.round((item.visitas / safeMax) * 160));
                        const aceiteHeight = Math.max(6, Math.round((item.aceite / safeMax) * 160));
                        const percent = total ? ((item.total / total) * 100).toFixed(1) : "0.0";
                        return (
                          <div
                            key={item.label}
                            className="flex min-w-[72px] flex-col items-center gap-2"
                            title={`${item.label} • Total ${formatNumber(item.total)} (Visitas ${formatNumber(item.visitas)} + Aceite ${formatNumber(item.aceite)}) • ${percent}% • ${formatDateBr(vendorVidasFrom)} a ${formatDateBr(vendorVidasTo)}`}
                          >
                            <span className="text-[11px] font-semibold text-ink">
                              {formatNumber(item.total)}
                            </span>
                            <div className="flex items-end gap-1">
                              <div
                                className="w-4 rounded-t-lg bg-sea"
                                style={{ height: visitasHeight }}
                              />
                              <div
                                className="w-4 rounded-t-lg bg-amber-400"
                                style={{ height: aceiteHeight }}
                              />
                            </div>
                            <span className="w-20 truncate text-center text-[11px] text-ink/70">
                              {item.label}
                            </span>
                            <span className="text-[10px] text-ink/50">{percent}%</span>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-[520px] w-full text-left text-xs text-ink/70">
                      <thead>
                        <tr className="border-b border-sea/20">
                          <th className="py-2 pr-2">#</th>
                          <th className="py-2 pr-2">Vendedor</th>
                          <th className="py-2 pr-2 text-right">Visitas</th>
                          <th className="py-2 pr-2 text-right">Aceite</th>
                          <th className="py-2 pr-2 text-right">Total</th>
                          <th className="py-2 pr-2 text-right">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendorVidasSeries.map((item, index) => {
                          const total =
                            vendorVidasSummary.total ||
                            vendorVidasSeries.reduce((acc, row) => acc + row.total, 0);
                          const percent = total ? ((item.total / total) * 100).toFixed(1) : "0.0";
                          return (
                            <tr key={item.label} className="border-b border-sea/10">
                              <td className="py-2 pr-2">{index + 1}</td>
                              <td className="py-2 pr-2">{item.label}</td>
                              <td className="py-2 pr-2 text-right">{formatNumber(item.visitas)}</td>
                              <td className="py-2 pr-2 text-right">{formatNumber(item.aceite)}</td>
                              <td className="py-2 pr-2 text-right">{formatNumber(item.total)}</td>
                              <td className="py-2 pr-2 text-right">{percent}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {isVendor && (
            <section className="overflow-x-auto">
              <div className="grid min-w-[960px] gap-4 lg:grid-cols-3">
                {visitStatsError ? (
                  <div className="dashboard-status-danger rounded-2xl border p-4 text-sm md:p-5">
                    {visitStatsError}
                  </div>
                ) : visitStats ? (
                  <>
                    {renderDonut(
                      "Visitas no periodo",
                      visitStats.visitasRealizadas + visitStats.visitasNaoRealizadas + visitStats.visitasPendentes,
                      [
                        { label: "Realizadas", value: visitStats.visitasRealizadas, color: DASHBOARD_STATUS_COLORS.success },
                        { label: "Nao realizadas", value: visitStats.visitasNaoRealizadas, color: DASHBOARD_STATUS_COLORS.warning },
                        { label: "Pendentes", value: visitStats.visitasPendentes, color: DASHBOARD_STATUS_COLORS.neutral },
                      ],
                      globalPeriodLabel,
                      (label) => {
                        if (label === "Pendentes") {
                          setPendingVisitsModal({
                            title: "Visitas pendentes",
                            subtitle: `Registros sem conclusao no periodo ${globalPeriodLabel}.`,
                            rows: pendingVisitsModal?.rows ?? [],
                          });
                        }
                      },
                    )}
                    {renderDonut(
                      "Impacto no periodo",
                      vendorImpactVidas,
                      [
                        {
                          label: "Vidas em visitas",
                          value: visitStats.totalVidas,
                          color: DASHBOARD_STATUS_COLORS.info,
                        },
                        {
                          label: "Vidas em aceite digital",
                          value: vendorAceitePeriodVidas,
                          color: DASHBOARD_STATUS_COLORS.accent,
                        },
                      ],
                      `${globalPeriodLabel} • Empresas visitadas: ${formatNumber(visitStats.empresasVisitadas)}`,
                    )}
                    {renderDonut(
                      "Vidas por dia",
                      dailyVidasTotal,
                      visitDailyVidas,
                      globalPeriodLabel,
                    )}
                  </>
                ) : (
                  <div className="glass-pane rounded-2xl p-4 text-sm text-ink/70 md:p-5">
                    Carregando dados do vendedor...
                  </div>
                )}
              </div>
            </section>
          )}

          {canViewTeamStats && (
            <section className="overflow-x-auto">
              <div className="grid min-w-[960px] gap-4 lg:grid-cols-3">
                {teamStatsError ? (
                  <div className="dashboard-status-danger rounded-2xl border p-4 text-sm md:p-5">
                    {teamStatsError}
                  </div>
                ) : teamStats ? (
                  <>
                    {renderDonut(
                      "Visitas no periodo (equipe)",
                      teamStats.visitasRealizadas + teamStats.visitasNaoRealizadas + teamStats.visitasPendentes,
                      [
                        { label: "Realizadas", value: teamStats.visitasRealizadas, color: DASHBOARD_STATUS_COLORS.success },
                        { label: "Nao realizadas", value: teamStats.visitasNaoRealizadas, color: DASHBOARD_STATUS_COLORS.warning },
                        { label: "Pendentes", value: teamStats.visitasPendentes, color: DASHBOARD_STATUS_COLORS.neutral },
                      ],
                      `${globalPeriodLabel} • ${teamVendorsCount} vendedor(es)`,
                      (label) => {
                        if (label === "Pendentes") {
                          setPendingVisitsModal({
                            title: "Visitas pendentes",
                            subtitle: `Registros sem conclusao no periodo ${globalPeriodLabel}.`,
                            rows: pendingVisitsModal?.rows ?? [],
                          });
                        }
                      },
                    )}
                    {renderDonut(
                      "Impacto no periodo (equipe)",
                      teamImpactVidas,
                      [
                        {
                          label: "Vidas em visitas",
                          value: teamStats.totalVidas,
                          color: DASHBOARD_STATUS_COLORS.info,
                        },
                        {
                          label: "Vidas em aceite digital",
                          value: digitalSummary?.periodTotalVidas ?? 0,
                          color: DASHBOARD_STATUS_COLORS.accent,
                        },
                      ],
                      `${globalPeriodLabel} • Empresas visitadas: ${formatNumber(teamStats.empresasVisitadas)}`,
                    )}
                    {renderDonut(
                      "Vidas por dia (equipe)",
                      teamDailyVidasTotal,
                      teamDailyVidas,
                      globalPeriodLabel,
                    )}
                  </>
                ) : (
                  <div className="glass-pane rounded-2xl p-4 text-sm text-ink/70 md:p-5">
                    Carregando dados da equipe...
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      <DashboardModal
        open={showVendorVisitsModal}
        title="Visitas por vendedor"
        subtitle="Lista completa de vendedores e quantidade de visitas."
        onClose={() => setShowVendorVisitsModal(false)}
        maxWidthClassName="max-w-2xl"
      >
        <div className="rounded-2xl border border-sea/15 bg-sand/20">
          {vendorVisitsList.length === 0 ? (
            <div className="px-4 py-6 text-sm text-ink/60">Sem dados.</div>
          ) : (
            <div className="divide-y divide-sea/10">
              {vendorVisitsList.map((item, index) => (
                <div key={item.label} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-ink">
                    {index + 1}. {item.label}
                  </span>
                  <span className="font-semibold text-sea">{formatNumber(item.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </DashboardModal>

      <DashboardModal
        open={showPendingModal}
        title="Pendencias por vendedor"
        subtitle="Resumo rapido do que falta registrar."
        onClose={() => setShowPendingModal(false)}
        maxWidthClassName="max-w-2xl"
      >
        <div className="rounded-2xl border border-sea/15 bg-sand/20">
          {!digitalSummary || digitalSummary.pendingByVendor.length === 0 ? (
            <div className="px-4 py-6 text-sm text-ink/60">Sem pendencias.</div>
          ) : (
            <div className="divide-y divide-sea/10">
              {digitalSummary.pendingByVendor.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-ink">
                    {index + 1}. {item.name}
                  </span>
                  <span className="font-semibold text-amber-700">{formatVendorPending(item)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </DashboardModal>

      <DashboardModal
        open={Boolean(pendingVisitsModal)}
        title={pendingVisitsModal?.title ?? "Visitas pendentes"}
        subtitle={pendingVisitsModal?.subtitle}
        onClose={() => setPendingVisitsModal(null)}
        maxWidthClassName="max-w-3xl"
      >
        <div className="rounded-2xl border border-sea/15 bg-sand/20">
          {!pendingVisitsModal || pendingVisitsModal.rows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-ink/60">Sem visitas pendentes.</div>
          ) : (
            <div className="divide-y divide-sea/10">
              {pendingVisitsModal.rows.map((item, index) => {
                const empresa = item.cliente?.empresa ?? item.cliente?.nome_fantasia ?? "Sem empresa";
                return (
                  <div key={item.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-ink">
                        {index + 1}. {empresa}
                      </span>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        Pendente
                      </span>
                    </div>
                    <div className="mt-1 grid gap-1 text-xs text-ink/60">
                      <span>Data: {item.visit_date ? formatDateBr(item.visit_date) : "-"}</span>
                      <span>Vendedor: {item.assigned_to_name ?? item.assigned_to_user_id ?? "-"}</span>
                      <span>Cliente: {item.cliente_id ?? "-"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DashboardModal>

      {SHOW_NEXT_ROUTE_BLOCK && isVendor && nextRoutePreview && vendorNextRouteAccessAllowed && (
        <DashboardModal
          open={showNextRouteModal}
          title="Proxima rota"
          subtitle="Visualizacao somente leitura."
          onClose={() => setShowNextRouteModal(false)}
          maxWidthClassName="max-w-md"
        >
          <div className="space-y-2 rounded-2xl border border-sea/15 bg-sand/25 p-4 text-sm text-ink/80">
            <p>
              <span className="font-semibold text-ink">Data:</span> {nextRoutePreview.date}
            </p>
            <p>
              <span className="font-semibold text-ink">Empresas:</span>{" "}
              {nextRoutePreview.routes.length}
            </p>
            <div className="space-y-2">
              {nextRoutePreview.routes.map((route, index) => (
                <div
                  key={`${route.client}-${route.perfil}-${index}`}
                  className="rounded-xl border border-sea/15 bg-white/80 p-3"
                >
                  <p>
                    <span className="font-semibold text-ink">Cliente:</span> {route.client}
                  </p>
                  <p>
                    <span className="font-semibold text-ink">Perfil:</span> {route.perfil}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </DashboardModal>
      )}
    </div>
  );
}
