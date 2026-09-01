import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Building2, CalendarDays, Check, CheckCircle2, Filter, MapPinned, TrendingUp, Users } from "lucide-react";
import { supabaseDash } from "../lib/supabaseDashboard";
import { useAuth } from "../context/AuthContext";
import { formatDateBr } from "../lib/dateFormat";
import DashboardLegacy from "./Dashboard";
import DashboardModal from "../components/DashboardModal";
import { useLocalStorageState } from "../hooks/useLocalStorageState";

type TabKey = "visao" | "performance" | "comercial" | "cobertura" | "qualidade";
type LineMetric = "visitas" | "concluidas" | "vidas";

type VisitLite = {
  id: string;
  cliente_id: string | null;
  visit_date: string | null;
  completed_at: string | null;
  no_visit_reason: string | null;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  completed_vidas: number | null;
};

type AceiteLite = {
  entry_date: string | null;
  vendor_user_id: string | null;
  vidas: number | null;
};

type ClienteLite = {
  id: string;
  codigo?: string | null;
  empresa?: string | null;
  cidade: string | null;
  bairro: string | null;
  situacao: string | null;
  vendedor: string | null;
  categoria: string | null;
  grupo: string | null;
};

type ProfileLite = {
  id?: string | null;
  user_id: string | null;
  display_name: string | null;
  role?: string | null;
  supervisor_id?: string | null;
};

type TrendSummary = {
  currentTotal: number;
  previousTotal: number;
  variationPct: number | null;
  dailyAverage: number;
  previousDailyAverage: number;
  alertLevel: "ok" | "warning" | "critical";
  alertMessage: string;
};

type DashboardEstrategicoUiState = {
  tab: TabKey;
  metric: LineMetric;
  from: string;
  to: string;
  selectedSupervisor: string;
  selectedSeller: string;
  draftFrom: string;
  draftTo: string;
  draftSelectedSupervisor: string;
  draftSelectedSeller: string;
};

type DashboardKpiDetailMode = "visitas" | "concluidas" | "pendentes" | "empresas" | "cobertura" | "vidas" | "taxa";

type DashboardEstrategicoDataCache = {
  visits: VisitLite[];
  historicalVisits: VisitLite[];
  previousVisits: VisitLite[];
  previousMonthVisits: VisitLite[];
  aceites: AceiteLite[];
  previousAceites: AceiteLite[];
  clientesMapEntries: Array<[string, ClienteLite]>;
  allClientes: ClienteLite[];
  profilesMapEntries: Array<[string, string]>;
  vendorSupervisorEntries: Array<[string, string]>;
  supervisorNameEntries: Array<[string, string]>;
  totalClientes: number;
  cachedAt: number;
};

const VISITS_PAGE_SIZE = 1000;
const CLIENTES_UNIVERSE_PAGE_SIZE = 300;
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "visao", label: "Geral" },
  { key: "performance", label: "Performance" },
  { key: "comercial", label: "Comercial" },
  { key: "cobertura", label: "Cobertura" },
  { key: "qualidade", label: "Qualidade" },
];

const formatNumber = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
const formatPercent = (value: number) => `${value.toFixed(1)}%`;
const normalizeFilterValue = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
const startOfMonth = (value: Date) => new Date(value.getFullYear(), value.getMonth(), 1);
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const toYmd = (date: Date) => {
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const isValidYmd = (value: string | null | undefined) => {
  if (!value || !YMD_RE.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime());
};

const normalizeYmd = (value: string | null | undefined, fallback: string) =>
  isValidYmd(value) ? String(value) : fallback;

const formatTimelineTick = (value: string | undefined) => {
  if (!value) return "-";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(parsed);
};

type CommercialHighlight = { type: "seller"; value: string } | { type: "team"; value: string } | null;

const formatMonthTick = (value: string | undefined) => {
  if (!value) return "-";
  const parsed = new Date(`${value}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(parsed);
};

const getMonthKey = (value: string | null | undefined) => {
  const raw = String(value ?? "").slice(0, 10);
  return YMD_RE.test(raw) ? raw.slice(0, 7) : null;
};

const COMMERCIAL_COLORS = [
  "#3b82f6",
  "#fb923c",
  "#a78bfa",
  "#a3c957",
  "#22b8c7",
  "#facc15",
  "#db64a4",
  "#6366f1",
  "#e9bf78",
  "#7dd3fc",
  "#0f766e",
  "#d8a7e8",
  "#c86b45",
  "#2563eb",
];

const endExclusive = (value: string) => {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  d.setDate(d.getDate() + 1);
  return toYmd(d) || value;
};

const getPreviousRange = (from: string, to: string) => {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  const dayDiff = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - dayDiff);
  return { prevFrom: toYmd(prevStart), prevTo: toYmd(prevEnd) };
};

const getPreviousMonthSameRange = (from: string, to: string) => {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { prevMonthFrom: from, prevMonthTo: to };
  }
  start.setMonth(start.getMonth() - 1);
  end.setMonth(end.getMonth() - 1);
  return { prevMonthFrom: toYmd(start), prevMonthTo: toYmd(end) };
};

const getSellerLabelFromVisit = (visit: VisitLite, profilesMap: Map<string, string>) =>
  visit.assigned_to_name ??
  (visit.assigned_to_user_id ? profilesMap.get(visit.assigned_to_user_id) ?? visit.assigned_to_user_id : "Sem nome");

const buildDashboardDataCacheKey = (userId: string | null | undefined, from: string, to: string) =>
  `dashboardEstrategicoDataCacheV1:${userId ?? "anon"}:${from}:${to}`;

function DailyBarChart({
  title,
  labels,
  values,
  color,
  metricLabel,
  averageValue,
}: {
  title: string;
  labels: string[];
  values: number[];
  color: string;
  metricLabel: string;
  averageValue: number;
}) {
  const safeValues = values.map((value) => (Number.isFinite(value) ? value : 0));
  const safeAverageValue = Number.isFinite(averageValue) ? averageValue : 0;
  const resolvedColor =
    color?.trim().length > 0
      ? color
      : "rgb(16 185 129)";
  const rawMax = Math.max(1, ...safeValues);
  const yStep = Math.max(1, Math.ceil(rawMax / 6));
  const max = yStep * 6;
  const yTicks = Array.from({ length: 7 }).map((_, index) => index * yStep).reverse();
  const barHeightPct = (value: number) => Math.max(8, (Math.max(0, value) / max) * 100);
  const averagePct = Math.max(0, Math.min(100, (Math.max(0, safeAverageValue) / max) * 100));
  const chartTopSpacePct = 12;
  const chartPlotHeightPct = 100 - chartTopSpacePct;
  return (
    <article className="dashboard-card rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg text-ink">{title}</h3>
        <span className="text-xs font-semibold text-ink/65">Metrica: {metricLabel}</span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[48px_1fr] gap-2">
            <div className="relative h-72">
              {yTicks.map((tick, index) => (
                <span
                  key={`yt-${tick}`}
                  className="absolute right-0 -translate-y-1/2 text-[10px] text-ink/55"
                  style={{ top: `${(index / (yTicks.length - 1)) * 100}%` }}
                >
                  {tick}
                </span>
              ))}
            </div>
            <div className="relative h-72 border-b border-sea/20">
              {yTicks.map((_, index) => (
                <div
                  key={`gl-${index}`}
                  className="absolute left-0 right-0 border-t border-sea/10"
                  style={{ top: `${(index / (yTicks.length - 1)) * 100}%` }}
                />
              ))}
              <div
                className="absolute left-0 right-0 border-t border-dashed border-amber-400"
                style={{ top: `${100 - averagePct}%` }}
              />
              <div className="absolute inset-0 flex items-end gap-1 px-1">
                {safeValues.map((value, index) => {
                  const height = barHeightPct(value);
                  const barHeight = (height / 100) * chartPlotHeightPct;
                  const labelBottom = Math.min(96, barHeight + 1.5);
                  return (
                    <div
                      key={`${labels[index]}-${index}`}
                      className="relative h-full min-w-[18px] flex-1"
                      title={`${formatTimelineTick(labels[index])}: ${formatNumber(value)}`}
                    >
                      <span
                        className="absolute left-0 right-0 z-20 text-center text-[10px] font-semibold text-ink/70"
                        style={{ bottom: `${labelBottom}%` }}
                      >
                        {formatNumber(value)}
                      </span>
                      <div
                        className="absolute bottom-0 left-0 right-0 z-10 rounded-t-sm transition-all duration-300"
                        style={{
                          height: `${barHeight}%`,
                          minHeight: value > 0 ? 2 : 1,
                          backgroundColor:
                            value <= 0
                              ? "rgb(148 163 184)"
                              : resolvedColor,
                          opacity: value <= 0 ? 0.45 : 1,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-[48px_1fr] gap-2">
            <span className="text-[10px] font-semibold text-ink/70">Datas</span>
            <div className="flex gap-1 px-1">
              {labels.map((label, index) => (
                <span key={`${label}-x-${index}`} className="min-w-[18px] flex-1 text-center text-[9px] text-ink/60">
                  {formatTimelineTick(label)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function CommercialDonutChart({
  items,
  highlight,
  onSelectSeller,
}: {
  items: Array<{ seller: string; total: number; color: string; supervisorId: string | null }>;
  highlight: CommercialHighlight;
  onSelectSeller: (seller: string | null) => void;
}) {
  const total = items.reduce((acc, item) => acc + item.total, 0);
  const radius = 86;
  const center = 120;
  const innerRadius = 50;
  type DonutSegment = {
    seller: string;
    total: number;
    color: string;
    supervisorId: string | null;
    angle: number;
    path: string;
    labelX: number;
    labelY: number;
  };

  const polarPoint = (angle: number, distance: number) => {
    const radians = (angle * Math.PI) / 180;
    return {
      x: center + distance * Math.cos(radians),
      y: center + distance * Math.sin(radians),
    };
  };

  const segments = useMemo<DonutSegment[]>(() => {
    let startAngle = -90;
    return items.map((item) => {
      const angle = total > 0 ? (item.total / total) * 360 : 0;
      const endAngle = startAngle + angle;
      const largeArc = angle > 180 ? 1 : 0;
      const outerStart = polarPoint(startAngle, radius);
      const outerEnd = polarPoint(endAngle, radius);
      const innerEnd = polarPoint(endAngle, innerRadius);
      const innerStart = polarPoint(startAngle, innerRadius);
      const labelPoint = polarPoint(startAngle + angle / 2, 66);
      const path = [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${radius} ${radius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerEnd.x} ${innerEnd.y}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
        "Z",
      ].join(" ");
      startAngle = endAngle;
      return {
        ...item,
        angle,
        path,
        labelX: labelPoint.x,
        labelY: labelPoint.y,
      };
    });
  }, [items, total]);
  const previousSegmentsRef = useRef<DonutSegment[]>([]);
  const [exitingSegments, setExitingSegments] = useState<DonutSegment[]>([]);
  const previousSegmentsBySeller = useMemo(
    () => new Map(previousSegmentsRef.current.map((segment) => [segment.seller, segment])),
    [segments],
  );

  useEffect(() => {
    const currentSellers = new Set(segments.map((segment) => segment.seller));
    const removedSegments = previousSegmentsRef.current.filter((segment) => !currentSellers.has(segment.seller));
    if (removedSegments.length > 0) {
      setExitingSegments(removedSegments);
      const timeoutId = window.setTimeout(() => setExitingSegments([]), 960);
      previousSegmentsRef.current = segments;
      return () => window.clearTimeout(timeoutId);
    }
    setExitingSegments([]);
    previousSegmentsRef.current = segments;
    return undefined;
  }, [segments]);

  if (items.length === 0 || total <= 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-xl border border-sea/15 bg-white/60 text-sm text-ink/60">
        Sem vidas registradas no recorte.
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(380px,560px)_minmax(220px,0.8fr)]">
      <svg viewBox="0 0 240 240" className="mx-auto h-[420px] w-full max-w-[560px]">
        {exitingSegments.map((segment) => (
          <g key={`leaving-${segment.seller}`} className="origin-center">
            <path d={segment.path} fill={segment.color} className="pointer-events-none">
              <animate attributeName="opacity" from="1" to="0" dur="900ms" calcMode="spline" keySplines="0.4 0 0.2 1" fill="freeze" />
              <animateTransform
                attributeName="transform"
                type="scale"
                from="1"
                to="0.92"
                dur="900ms"
                calcMode="spline"
                keySplines="0.4 0 0.2 1"
                fill="freeze"
                additive="sum"
              />
            </path>
            {segment.angle >= 8 ? (
              <text
                x={segment.labelX}
                y={segment.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                className="pointer-events-none fill-ink text-[10px] font-semibold"
              >
                {formatNumber(segment.total)}
                <animate attributeName="opacity" from="1" to="0" dur="620ms" calcMode="spline" keySplines="0.4 0 0.2 1" fill="freeze" />
              </text>
            ) : null}
          </g>
        ))}
        {segments.map((item) => {
          const sellerActive = highlight?.type === "seller" && highlight.value === item.seller;
          const previousSegment = previousSegmentsBySeller.get(item.seller);
          const isNewSegment = !previousSegment;
          return (
            <g key={item.seller}>
              <path
                d={item.path}
                fill={item.color}
                opacity={1}
                className="cursor-pointer transition-opacity duration-700 ease-out"
                onClick={() => onSelectSeller(sellerActive ? null : item.seller)}
              >
                {previousSegment && previousSegment.path !== item.path ? (
                  <animate attributeName="d" from={previousSegment.path} to={item.path} dur="900ms" calcMode="spline" keySplines="0.4 0 0.2 1" fill="freeze" />
                ) : null}
                {isNewSegment ? (
                  <animate attributeName="opacity" from="0" to="1" begin="140ms" dur="620ms" calcMode="spline" keySplines="0.4 0 0.2 1" fill="freeze" />
                ) : null}
              </path>
              {item.angle >= 8 ? (
                <text
                  x={item.labelX}
                  y={item.labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="pointer-events-none fill-ink text-[10px] font-semibold transition-opacity duration-700"
                >
                  {formatNumber(item.total)}
                  {isNewSegment ? (
                    <animate attributeName="opacity" from="0" to="1" begin="240ms" dur="620ms" calcMode="spline" keySplines="0.4 0 0.2 1" fill="freeze" />
                  ) : null}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="grid content-center gap-1.5">
        {items.map((item) => {
          const active = highlight?.type === "seller" && highlight.value === item.seller;
          return (
            <button
              key={item.seller}
              type="button"
              onClick={() => onSelectSeller(active ? null : item.seller)}
              className={[
                "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition",
                "duration-700 ease-out animate-in fade-in slide-in-from-right-2",
                active
                  ? "border-sea bg-sea/10 text-sea"
                  : "border-transparent text-ink/80 hover:border-sea/20 hover:bg-white/70",
              ].join(" ")}
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="truncate font-semibold">{item.seller}</span>
              </span>
              <span className="font-semibold">{formatNumber(item.total)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthlyCommercialBarChart({
  rows,
  color,
}: {
  rows: Array<{ month: string; total: number }>;
  color: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return (
    <div className="mt-5 overflow-x-auto pb-2">
      <div className="flex min-h-[260px] min-w-[720px] items-end gap-4 border-b border-sea/20 px-2 pt-8">
        {rows.map((row) => {
          const height = Math.max(8, (row.total / max) * 190);
          return (
            <div key={row.month} className="flex min-w-[64px] flex-1 flex-col items-center gap-2">
              <span className="text-xs font-semibold text-ink">{formatNumber(row.total)}</span>
              <div
                className="w-full max-w-[44px] rounded-t-lg transition-all"
                style={{ height, backgroundColor: row.total > 0 ? color : "rgb(148 163 184)", opacity: row.total > 0 ? 1 : 0.45 }}
                title={`${formatMonthTick(row.month)}: ${formatNumber(row.total)}`}
              />
              <span className="text-center text-[10px] font-semibold text-ink/60">{formatMonthTick(row.month)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardEstrategico() {
  const { role, session } = useAuth();
  const isVendor = role === "VENDEDOR";
  const canViewTeam = role === "SUPERVISOR" || role === "ASSISTENTE";
  const visibleTabs = isVendor ? TABS.filter((item) => item.key === "visao") : TABS;

  const monthStart = toYmd(startOfMonth(new Date()));
  const today = toYmd(new Date());
  const [persistedUiState, setPersistedUiState] = useLocalStorageState<DashboardEstrategicoUiState>(
    "dashboardEstrategicoUiStateV1",
    {
      tab: "visao",
      metric: "visitas",
      from: monthStart,
      to: today,
      selectedSupervisor: "all",
      selectedSeller: "all",
      draftFrom: monthStart,
      draftTo: today,
      draftSelectedSupervisor: "all",
      draftSelectedSeller: "all",
    },
  );
  const [tab, setTab] = useState<TabKey>(persistedUiState.tab);
  const [metric, setMetric] = useState<LineMetric>(persistedUiState.metric);
  const [from, setFrom] = useState(normalizeYmd(persistedUiState.from, monthStart));
  const [to, setTo] = useState(normalizeYmd(persistedUiState.to, today));
  const [selectedSupervisor, setSelectedSupervisor] = useState(persistedUiState.selectedSupervisor ?? "all");
  const [selectedSeller, setSelectedSeller] = useState(persistedUiState.selectedSeller);
  const [commercialHighlight, setCommercialHighlight] = useState<CommercialHighlight>(null);
  const [kpiDetailMode, setKpiDetailMode] = useState<DashboardKpiDetailMode | null>(null);
  const [draftFrom, setDraftFrom] = useState(normalizeYmd(persistedUiState.draftFrom, monthStart));
  const [draftTo, setDraftTo] = useState(normalizeYmd(persistedUiState.draftTo, today));
  const [draftSelectedSupervisor, setDraftSelectedSupervisor] = useState(persistedUiState.draftSelectedSupervisor ?? "all");
  const [draftSelectedSeller, setDraftSelectedSeller] = useState(persistedUiState.draftSelectedSeller);

  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingReason, setExportingReason] = useState<string | null>(null);
  const [exportReasonError, setExportReasonError] = useState<string | null>(null);
  const [visits, setVisits] = useState<VisitLite[]>([]);
  const [historicalVisits, setHistoricalVisits] = useState<VisitLite[]>([]);
  const [aceites, setAceites] = useState<AceiteLite[]>([]);
  const [previousVisits, setPreviousVisits] = useState<VisitLite[]>([]);
  const [previousMonthVisits, setPreviousMonthVisits] = useState<VisitLite[]>([]);
  const [previousAceites, setPreviousAceites] = useState<AceiteLite[]>([]);
  const [clientesMap, setClientesMap] = useState<Map<string, ClienteLite>>(new Map());
  const [allClientes, setAllClientes] = useState<ClienteLite[]>([]);
  const [profilesMap, setProfilesMap] = useState<Map<string, string>>(new Map());
  const [vendorSupervisorMap, setVendorSupervisorMap] = useState<Map<string, string>>(new Map());
  const [supervisorNameMap, setSupervisorNameMap] = useState<Map<string, string>>(new Map());
  const [totalClientes, setTotalClientes] = useState(0);
  const dashboardCacheKey = buildDashboardDataCacheKey(session?.user?.id, from, to);

  const hasPendingFilterChanges =
    draftFrom !== from ||
    draftTo !== to ||
    draftSelectedSupervisor !== selectedSupervisor ||
    draftSelectedSeller !== selectedSeller;

  const handleApplyFilters = () => {
    const safeFrom = normalizeYmd(draftFrom, monthStart);
    const safeTo = normalizeYmd(draftTo, today);
    setFrom(safeFrom);
    setTo(safeTo);
    if (safeFrom !== draftFrom) setDraftFrom(safeFrom);
    if (safeTo !== draftTo) setDraftTo(safeTo);
    setSelectedSupervisor(draftSelectedSupervisor);
    setSelectedSeller(draftSelectedSeller);
  };

  const handleClearFilters = () => {
    setDraftFrom(monthStart);
    setDraftTo(today);
    setDraftSelectedSupervisor("all");
    setDraftSelectedSeller("all");
    setFrom(monthStart);
    setTo(today);
    setSelectedSupervisor("all");
    setSelectedSeller("all");
    setCommercialHighlight(null);
  };

  useEffect(() => {
    setPersistedUiState({
      tab,
      metric,
      from,
      to,
      selectedSupervisor,
      selectedSeller,
      draftFrom,
      draftTo,
      draftSelectedSupervisor,
      draftSelectedSeller,
    });
  }, [
    draftFrom,
    draftSelectedSupervisor,
    draftSelectedSeller,
    draftTo,
    from,
    metric,
    selectedSupervisor,
    selectedSeller,
    setPersistedUiState,
    tab,
    to,
  ]);

  useEffect(() => {
    if (!isVendor) return;
    setTab("visao");
    setSelectedSupervisor("all");
    setSelectedSeller("all");
    setDraftSelectedSupervisor("all");
    setDraftSelectedSeller("all");
  }, [isVendor]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!hasLoadedOnce && typeof window !== "undefined") {
        try {
          const raw = window.sessionStorage.getItem(dashboardCacheKey);
          if (raw) {
            const cached = JSON.parse(raw) as DashboardEstrategicoDataCache;
            setVisits(cached.visits ?? []);
            setHistoricalVisits(cached.historicalVisits ?? []);
            setPreviousVisits(cached.previousVisits ?? []);
            setPreviousMonthVisits(cached.previousMonthVisits ?? []);
            setAceites(cached.aceites ?? []);
            setPreviousAceites(cached.previousAceites ?? []);
            setClientesMap(new Map(cached.clientesMapEntries ?? []));
            setAllClientes(cached.allClientes ?? []);
            setProfilesMap(new Map(cached.profilesMapEntries ?? []));
            setVendorSupervisorMap(new Map(cached.vendorSupervisorEntries ?? []));
            setSupervisorNameMap(new Map(cached.supervisorNameEntries ?? []));
            setTotalClientes(cached.totalClientes ?? 0);
            setHasLoadedOnce(true);
            setLoading(false);
          }
        } catch {
          // ignore cache parse failures
        }
      }
      setLoading(true);
      setError(null);
      const toExclusive = endExclusive(to);
      const { prevFrom, prevTo } = getPreviousRange(from, to);
      const prevToExclusive = endExclusive(prevTo);
      const { prevMonthFrom, prevMonthTo } = getPreviousMonthSameRange(from, to);
      const prevMonthToExclusive = endExclusive(prevMonthTo);

      const fetchVisitsRange = async (fromDate: string, toExclusiveDate: string) => {
        const accumulator: VisitLite[] = [];
        let fromIndex = 0;
        while (true) {
          let query = supabaseDash
            .from("v_dash_visits_active")
            .select(
              "id, cliente_id, visit_date, completed_at, no_visit_reason, assigned_to_user_id, assigned_to_name, completed_vidas",
            )
            .gte("visit_date", fromDate)
            .lt("visit_date", toExclusiveDate)
            .order("visit_date", { ascending: true })
            .range(fromIndex, fromIndex + VISITS_PAGE_SIZE - 1);
          if (isVendor && session?.user.id) query = query.eq("assigned_to_user_id", session.user.id);
          const { data, error: pageError } = await query;
          if (pageError) throw new Error(pageError.message);
          const page = (data ?? []) as VisitLite[];
          accumulator.push(...page);
          if (page.length < VISITS_PAGE_SIZE) break;
          fromIndex += VISITS_PAGE_SIZE;
        }
        return accumulator;
      };

      const fetchHistoricalVisits = async () => {
        const accumulator: VisitLite[] = [];
        let fromIndex = 0;
        while (true) {
          let query = supabaseDash
            .from("v_dash_visits_active")
            .select(
              "id, cliente_id, visit_date, completed_at, no_visit_reason, assigned_to_user_id, assigned_to_name, completed_vidas",
            )
            .not("visit_date", "is", null)
            .order("visit_date", { ascending: true })
            .range(fromIndex, fromIndex + VISITS_PAGE_SIZE - 1);
          if (isVendor && session?.user.id) query = query.eq("assigned_to_user_id", session.user.id);
          const { data, error: pageError } = await query;
          if (pageError) throw new Error(pageError.message);
          const page = (data ?? []) as VisitLite[];
          accumulator.push(...page);
          if (page.length < VISITS_PAGE_SIZE) break;
          fromIndex += VISITS_PAGE_SIZE;
        }
        return accumulator;
      };

      const fetchAceitesRange = async (fromDate: string, toExclusiveDate: string) => {
        let query = supabaseDash
          .from("v_dash_aceite_digital_active")
          .select("entry_date, vendor_user_id, vidas")
          .gte("entry_date", fromDate)
          .lt("entry_date", toExclusiveDate);
        if (isVendor && session?.user.id) query = query.eq("vendor_user_id", session.user.id);
        const { data, error: aceiteError } = await query;
        if (aceiteError) throw new Error(aceiteError.message);
        return (data ?? []) as AceiteLite[];
      };

      let visitsAccumulator: VisitLite[] = [];
      let historicalVisitsAccumulator: VisitLite[] = [];
      let previousVisitsAccumulator: VisitLite[] = [];
      let previousMonthVisitsAccumulator: VisitLite[] = [];
      let aceiteData: AceiteLite[] = [];
      let previousAceiteData: AceiteLite[] = [];
      try {
        [
          visitsAccumulator,
          historicalVisitsAccumulator,
          previousVisitsAccumulator,
          previousMonthVisitsAccumulator,
          aceiteData,
          previousAceiteData,
        ] = await Promise.all([
          fetchVisitsRange(from, toExclusive),
          fetchHistoricalVisits(),
          fetchVisitsRange(prevFrom, prevToExclusive),
          fetchVisitsRange(prevMonthFrom, prevMonthToExclusive),
          fetchAceitesRange(from, toExclusive),
          fetchAceitesRange(prevFrom, prevToExclusive),
        ]);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Erro ao carregar dados");
        setLoading(false);
        return;
      }

      const clienteIds = Array.from(
        new Set(
          [...visitsAccumulator, ...historicalVisitsAccumulator, ...previousVisitsAccumulator, ...previousMonthVisitsAccumulator]
            .map((v) => v.cliente_id)
            .filter(Boolean),
        ),
      ) as string[];
      const clientesById = new Map<string, ClienteLite>();
      for (let i = 0; i < clienteIds.length; i += 500) {
        const chunk = clienteIds.slice(i, i + 500);
        const { data: clientesData, error: clientesError } = await supabaseDash
          .from("v_dash_clientes_active")
          .select("id, codigo, empresa, cidade, bairro, situacao, vendedor, categoria, grupo")
          .in("id", chunk);
        if (clientesError) {
          if (!active) return;
          setError(clientesError.message);
          setLoading(false);
          return;
        }
        (clientesData ?? []).forEach((row) => {
          const item = row as ClienteLite;
          clientesById.set(item.id, item);
        });
      }

      const clientesUniverse: ClienteLite[] = [];
      let clientesFrom = 0;
      while (true) {
        const { data: pageClientes, error: pageClientesError } = await supabaseDash
          .from("v_dash_clientes_active")
          .select("id, codigo, empresa, cidade, bairro, situacao, vendedor, categoria, grupo")
          .order("empresa", { ascending: true })
          .range(clientesFrom, clientesFrom + CLIENTES_UNIVERSE_PAGE_SIZE - 1);
        if (pageClientesError) {
          // Non-blocking: keep dashboard alive even if full universe fails.
          break;
        }
        const page = (pageClientes ?? []) as ClienteLite[];
        clientesUniverse.push(...page);
        if (page.length < CLIENTES_UNIVERSE_PAGE_SIZE) break;
        clientesFrom += CLIENTES_UNIVERSE_PAGE_SIZE;
      }

      const [{ data: profilesData, error: profilesError }, { count, error: countError }] =
        await Promise.all([
          supabaseDash.from("v_dash_profiles_active").select("id, user_id, display_name, role, supervisor_id").in("role", ["VENDEDOR", "SUPERVISOR"]),
          supabaseDash.from("v_dash_clientes_active").select("id", { head: true, count: "exact" }),
        ]);

      if (!active) return;
      if (profilesError) {
        setError(profilesError.message);
        setLoading(false);
        return;
      }
      if (countError) {
        // Non-blocking: fallback to loaded universe size.
      }

      const profileMap = new Map<string, string>();
      const vendorSupervisorByUserId = new Map<string, string>();
      const supervisorNameById = new Map<string, string>();
      (profilesData ?? []).forEach((row) => {
        const profile = row as ProfileLite;
        if (profile.user_id) profileMap.set(profile.user_id, profile.display_name ?? profile.user_id);
        if (profile.role === "SUPERVISOR" && profile.id) {
          supervisorNameById.set(profile.id, profile.display_name ?? profile.user_id ?? profile.id);
        }
      });
      (profilesData ?? []).forEach((row) => {
        const profile = row as ProfileLite;
        if (profile.role === "VENDEDOR" && profile.user_id && profile.supervisor_id) {
          vendorSupervisorByUserId.set(profile.user_id, profile.supervisor_id);
        }
      });

      setVisits(visitsAccumulator);
      setHistoricalVisits(historicalVisitsAccumulator);
      setPreviousVisits(previousVisitsAccumulator);
      setPreviousMonthVisits(previousMonthVisitsAccumulator);
      setAceites(aceiteData);
      setPreviousAceites(previousAceiteData);
      setClientesMap(clientesById);
      setAllClientes(clientesUniverse);
      setProfilesMap(profileMap);
      setVendorSupervisorMap(vendorSupervisorByUserId);
      setSupervisorNameMap(supervisorNameById);
      setTotalClientes(count ?? clientesUniverse.length);
      setLoading(false);
      setHasLoadedOnce(true);
      if (typeof window !== "undefined") {
        try {
          const payload: DashboardEstrategicoDataCache = {
            visits: visitsAccumulator,
            historicalVisits: historicalVisitsAccumulator,
            previousVisits: previousVisitsAccumulator,
            previousMonthVisits: previousMonthVisitsAccumulator,
            aceites: aceiteData,
            previousAceites: previousAceiteData,
            clientesMapEntries: Array.from(clientesById.entries()),
            allClientes: clientesUniverse,
            profilesMapEntries: Array.from(profileMap.entries()),
            vendorSupervisorEntries: Array.from(vendorSupervisorByUserId.entries()),
            supervisorNameEntries: Array.from(supervisorNameById.entries()),
            totalClientes: count ?? clientesUniverse.length,
            cachedAt: Date.now(),
          };
          window.sessionStorage.setItem(dashboardCacheKey, JSON.stringify(payload));
        } catch {
          // ignore cache write failures
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [dashboardCacheKey, from, hasLoadedOnce, isVendor, session?.user.id, to]);

  const supervisors = useMemo(() => {
    return Array.from(supervisorNameMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [supervisorNameMap]);

  const vendorOptions = useMemo(() => {
    const vendors = Array.from(vendorSupervisorMap.entries())
      .map(([userId, supervisorId]) => ({
        userId,
        supervisorId,
        name: profilesMap.get(userId) ?? userId,
      }))
      .filter((vendor) => draftSelectedSupervisor === "all" || vendor.supervisorId === draftSelectedSupervisor)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    const seen = new Set<string>();
    return vendors.filter((vendor) => {
      const key = normalizeFilterValue(vendor.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [draftSelectedSupervisor, profilesMap, vendorSupervisorMap]);

  const selectedVendorOptions = useMemo(() => {
    const vendors = Array.from(vendorSupervisorMap.entries())
      .map(([userId, supervisorId]) => ({
        userId,
        supervisorId,
        name: profilesMap.get(userId) ?? userId,
      }))
      .filter((vendor) => selectedSupervisor === "all" || vendor.supervisorId === selectedSupervisor)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    const seen = new Set<string>();
    return vendors.filter((vendor) => {
      const key = normalizeFilterValue(vendor.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [profilesMap, selectedSupervisor, vendorSupervisorMap]);

  useEffect(() => {
    if (
      draftSelectedSeller !== "all" &&
      !vendorOptions.some((vendor) => normalizeFilterValue(vendor.name) === normalizeFilterValue(draftSelectedSeller))
    ) {
      setDraftSelectedSeller("all");
    }
  }, [draftSelectedSeller, vendorOptions]);

  useEffect(() => {
    if (
      selectedSeller !== "all" &&
      !selectedVendorOptions.some((vendor) => normalizeFilterValue(vendor.name) === normalizeFilterValue(selectedSeller))
    ) {
      setSelectedSeller("all");
    }
  }, [selectedSeller, selectedVendorOptions]);

  const filteredVisits = useMemo(() => {
    return visits.filter((visit) => {
      const sellerLabel =
        visit.assigned_to_name ??
        (visit.assigned_to_user_id ? profilesMap.get(visit.assigned_to_user_id) ?? visit.assigned_to_user_id : null);
      const supervisorId = visit.assigned_to_user_id ? vendorSupervisorMap.get(visit.assigned_to_user_id) ?? null : null;
      const supervisorOk = selectedSupervisor === "all" || supervisorId === selectedSupervisor;
      const sellerOk =
        selectedSeller === "all" ||
        normalizeFilterValue(sellerLabel) === normalizeFilterValue(selectedSeller);
      return supervisorOk && sellerOk;
    });
  }, [profilesMap, selectedSeller, selectedSupervisor, vendorSupervisorMap, visits]);

  const filteredAceites = useMemo(() => {
    return aceites.filter((entry) => {
      const sellerLabel = entry.vendor_user_id ? profilesMap.get(entry.vendor_user_id) ?? entry.vendor_user_id : null;
      const supervisorId = entry.vendor_user_id ? vendorSupervisorMap.get(entry.vendor_user_id) ?? null : null;
      if (selectedSupervisor !== "all" && supervisorId !== selectedSupervisor) {
        return false;
      }
      if (
        selectedSeller !== "all" &&
        normalizeFilterValue(sellerLabel) !== normalizeFilterValue(selectedSeller)
      ) {
        return false;
      }
      return true;
    });
  }, [aceites, profilesMap, selectedSeller, selectedSupervisor, vendorSupervisorMap]);

  const previousFilteredVisits = useMemo(() => {
    return previousVisits.filter((visit) => {
      const sellerLabel =
        visit.assigned_to_name ??
        (visit.assigned_to_user_id ? profilesMap.get(visit.assigned_to_user_id) ?? visit.assigned_to_user_id : null);
      const supervisorId = visit.assigned_to_user_id ? vendorSupervisorMap.get(visit.assigned_to_user_id) ?? null : null;
      const supervisorOk = selectedSupervisor === "all" || supervisorId === selectedSupervisor;
      const sellerOk =
        selectedSeller === "all" ||
        normalizeFilterValue(sellerLabel) === normalizeFilterValue(selectedSeller);
      return supervisorOk && sellerOk;
    });
  }, [previousVisits, profilesMap, selectedSeller, selectedSupervisor, vendorSupervisorMap]);

  const previousMonthFilteredVisits = useMemo(() => {
    return previousMonthVisits.filter((visit) => {
      const sellerLabel =
        visit.assigned_to_name ??
        (visit.assigned_to_user_id ? profilesMap.get(visit.assigned_to_user_id) ?? visit.assigned_to_user_id : null);
      const supervisorId = visit.assigned_to_user_id ? vendorSupervisorMap.get(visit.assigned_to_user_id) ?? null : null;
      const supervisorOk = selectedSupervisor === "all" || supervisorId === selectedSupervisor;
      const sellerOk =
        selectedSeller === "all" ||
        normalizeFilterValue(sellerLabel) === normalizeFilterValue(selectedSeller);
      return supervisorOk && sellerOk;
    });
  }, [previousMonthVisits, profilesMap, selectedSeller, selectedSupervisor, vendorSupervisorMap]);

  const previousFilteredAceites = useMemo(() => {
    return previousAceites.filter((entry) => {
      const sellerLabel = entry.vendor_user_id ? profilesMap.get(entry.vendor_user_id) ?? entry.vendor_user_id : null;
      const supervisorId = entry.vendor_user_id ? vendorSupervisorMap.get(entry.vendor_user_id) ?? null : null;
      if (selectedSupervisor !== "all" && supervisorId !== selectedSupervisor) {
        return false;
      }
      if (
        selectedSeller !== "all" &&
        normalizeFilterValue(sellerLabel) !== normalizeFilterValue(selectedSeller)
      ) {
        return false;
      }
      return true;
    });
  }, [previousAceites, profilesMap, selectedSeller, selectedSupervisor, vendorSupervisorMap]);

  const model = useMemo(() => {
    const total = filteredVisits.length;
    const concluidas = filteredVisits.filter((v) => Boolean(v.completed_at)).length;
    const naoRealizadas = filteredVisits.filter((v) => Boolean(v.completed_at) && Boolean(v.no_visit_reason)).length;
    const realizadas = concluidas - naoRealizadas;
    const pendentes = total - concluidas;

    const vidasVisitas = filteredVisits.reduce((acc, v) => acc + Number(v.completed_vidas ?? 0), 0);
    const vidasAceite = filteredAceites.reduce((acc, v) => acc + Number(v.vidas ?? 0), 0);
    const vidasTotal = vidasVisitas + vidasAceite;
    const taxaExecucao = total > 0 ? (realizadas / total) * 100 : 0;

    const empresasVisitadasSet = new Set(filteredVisits.map((v) => v.cliente_id).filter(Boolean));
    const empresasVisitadas = empresasVisitadasSet.size;
    const cobertura = totalClientes > 0 ? (empresasVisitadas / totalClientes) * 100 : 0;

    const byDay = new Map<string, { visitas: number; concluidas: number; vidas: number }>();
    filteredVisits.forEach((visit) => {
      const day = String(visit.visit_date ?? "").slice(0, 10);
      if (!day) return;
      const current = byDay.get(day) ?? { visitas: 0, concluidas: 0, vidas: 0 };
      current.visitas += 1;
      if (visit.completed_at) current.concluidas += 1;
      current.vidas += Number(visit.completed_vidas ?? 0);
      byDay.set(day, current);
    });
    filteredAceites.forEach((item) => {
      const day = String(item.entry_date ?? "").slice(0, 10);
      if (!day) return;
      const current = byDay.get(day) ?? { visitas: 0, concluidas: 0, vidas: 0 };
      current.vidas += Number(item.vidas ?? 0);
      byDay.set(day, current);
    });
    const byDaySeries: Array<[string, { visitas: number; concluidas: number; vidas: number }]> = [];
    if (from && to) {
      const start = new Date(`${from}T12:00:00`);
      const end = new Date(`${to}T12:00:00`);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end) {
        const cursor = new Date(start);
        while (cursor <= end) {
          const dayKey = toYmd(cursor);
          byDaySeries.push([dayKey, byDay.get(dayKey) ?? { visitas: 0, concluidas: 0, vidas: 0 }]);
          cursor.setDate(cursor.getDate() + 1);
        }
      }
    }
    if (byDaySeries.length === 0) {
      byDaySeries.push(...Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0])));
    }

    const bySellerMap = new Map<string, { visitas: number; concluidas: number; vidasVisita: number; vidasAceite: number }>();
    filteredVisits.forEach((visit) => {
      const key =
        visit.assigned_to_name ??
        (visit.assigned_to_user_id ? profilesMap.get(visit.assigned_to_user_id) ?? visit.assigned_to_user_id : "Sem nome");
      const current = bySellerMap.get(key) ?? { visitas: 0, concluidas: 0, vidasVisita: 0, vidasAceite: 0 };
      current.visitas += 1;
      if (visit.completed_at) current.concluidas += 1;
      current.vidasVisita += Number(visit.completed_vidas ?? 0);
      bySellerMap.set(key, current);
    });
    filteredAceites.forEach((entry) => {
      const key = entry.vendor_user_id ? profilesMap.get(entry.vendor_user_id) ?? entry.vendor_user_id : "Sem nome";
      const current = bySellerMap.get(key) ?? { visitas: 0, concluidas: 0, vidasVisita: 0, vidasAceite: 0 };
      current.vidasAceite += Number(entry.vidas ?? 0);
      bySellerMap.set(key, current);
    });
    const bySeller = Array.from(bySellerMap.entries())
      .map(([seller, item]) => ({
        seller,
        ...item,
        vidasTotal: item.vidasVisita + item.vidasAceite,
      }))
      .sort((a, b) => b.visitas - a.visitas)
      .slice(0, 12);

    const byCityMap = new Map<string, number>();
    filteredVisits.forEach((visit) => {
      if (!visit.cliente_id) return;
      const city = clientesMap.get(visit.cliente_id)?.cidade ?? "Sem cidade";
      byCityMap.set(city, (byCityMap.get(city) ?? 0) + 1);
    });
    const byCity = Array.from(byCityMap.entries())
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const byReasonMap = new Map<string, number>();
    filteredVisits.forEach((visit) => {
      if (!visit.no_visit_reason) return;
      byReasonMap.set(visit.no_visit_reason, (byReasonMap.get(visit.no_visit_reason) ?? 0) + 1);
    });
    const byReason = Array.from(byReasonMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    const universeInScope = allClientes;
    const totalClientesInScope = universeInScope.length;
    const coberturaInScope = totalClientesInScope > 0 ? (empresasVisitadas / totalClientesInScope) * 100 : 0;

    const byCompanyCount = new Map<string, number>();
    filteredVisits.forEach((visit) => {
      if (!visit.cliente_id) return;
      byCompanyCount.set(visit.cliente_id, (byCompanyCount.get(visit.cliente_id) ?? 0) + 1);
    });
    const companyNameById = new Map(
      universeInScope.map((cliente) => [
        cliente.id,
        `${cliente.codigo ? `${cliente.codigo} - ` : ""}${cliente.empresa ?? "Sem nome"}`,
      ]),
    );
    const companiesWithVisits = Array.from(byCompanyCount.entries())
      .map(([id, count]) => ({
        id,
        name: companyNameById.get(id) ?? id,
        count,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));
    const mostVisitedCompanies = companiesWithVisits.slice(0, 10);
    const leastVisitedNonZeroCompanies = [...companiesWithVisits]
      .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name, "pt-BR"))
      .slice(0, 10);
    const neverVisitedCompanies = universeInScope
      .filter((cliente) => !empresasVisitadasSet.has(cliente.id))
      .map((cliente) => ({
        id: cliente.id,
        name: `${cliente.codigo ? `${cliente.codigo} - ` : ""}${cliente.empresa ?? "Sem nome"}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .slice(0, 10);

    const semCliente = filteredVisits.filter((v) => !v.cliente_id).length;
    const semResponsavel = filteredVisits.filter((v) => !v.assigned_to_name && !v.assigned_to_user_id).length;
    const semData = filteredVisits.filter((v) => !v.visit_date).length;

    return {
      total,
      concluidas,
      pendentes,
      naoRealizadas,
      realizadas,
      vidasVisitas,
      vidasAceite,
      vidasTotal,
      taxaExecucao,
      empresasVisitadas,
      cobertura,
      coberturaInScope,
      byDaySeries,
      bySeller,
      byCity,
      byReason,
      mostVisitedCompanies,
      leastVisitedNonZeroCompanies,
      neverVisitedCompanies,
      totalClientesInScope,
      semCliente,
      semResponsavel,
      semData,
    };
  }, [allClientes, clientesMap, filteredAceites, filteredVisits, from, profilesMap, to, totalClientes]);

  const exportNoVisitReason = async (reason: string) => {
    setExportingReason(reason);
    setExportReasonError(null);

    try {
      const xlsxModule = await import("xlsx");
      const XLSX = xlsxModule.default ?? xlsxModule;
      const rows = filteredVisits
        .filter((visit) => visit.no_visit_reason === reason)
        .map((visit) => {
          const cliente = clientesMap.get(visit.cliente_id ?? "");
          const vendedor = getSellerLabelFromVisit(visit, profilesMap);
          const supervisorId = visit.assigned_to_user_id
            ? vendorSupervisorMap.get(visit.assigned_to_user_id) ?? null
            : null;

          return {
            "Motivo da nao visita": visit.no_visit_reason ?? reason,
            "Data da visita": formatDateBr(visit.visit_date),
            Vendedor: vendedor,
            Supervisor: supervisorId ? supervisorNameMap.get(supervisorId) ?? supervisorId : "-",
            "Codigo da empresa": cliente?.codigo ?? "-",
            Empresa: cliente?.empresa ?? "Sem nome",
            "Cidade da empresa": cliente?.cidade ?? "-",
            "Bairro da empresa": cliente?.bairro ?? "-",
            "Situacao da empresa": cliente?.situacao ?? "-",
            "Vendedor cadastrado na empresa": cliente?.vendedor ?? "-",
            Categoria: cliente?.categoria ?? "-",
            Grupo: cliente?.grupo ?? "-",
            "Vidas registradas": visit.completed_vidas ?? 0,
            Status: visit.completed_at ? "Nao realizada" : "Pendente",
          };
        });

      if (rows.length === 0) {
        setExportReasonError("Nenhum registro encontrado para este motivo no recorte atual.");
        return;
      }

      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet["!autofilter"] = { ref: worksheet["!ref"] ?? "A1" };
      worksheet["!cols"] = Object.keys(rows[0]).map((key) => ({
        wch: Math.min(36, Math.max(14, key.length + 2)),
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Motivos nao visita");

      const safeReason = normalizeFilterValue(reason).replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
      XLSX.writeFile(workbook, `motivo_nao_visita_${safeReason || "sem_motivo"}_${from}_${to}.xlsx`);
    } catch (exportError) {
      setExportReasonError(
        exportError instanceof Error ? exportError.message : "Nao foi possivel gerar o arquivo XLSX.",
      );
    } finally {
      setExportingReason(null);
    }
  };

  const kpiDetailItems = useMemo(() => {
    const formatCompany = (visit: VisitLite) => {
      const cliente = clientesMap.get(visit.cliente_id ?? "");
      return `${cliente?.codigo ? `${cliente.codigo} - ` : ""}${cliente?.empresa ?? "Sem nome"}`;
    };
    const topSellers = Array.from(
      filteredVisits.reduce((acc, visit) => {
        const seller = getSellerLabelFromVisit(visit, profilesMap);
        const current = acc.get(seller) ?? { visits: 0, companies: new Set<string>(), vidas: 0 };
        current.visits += 1;
        current.vidas += Number(visit.completed_vidas ?? 0);
        if (visit.cliente_id) current.companies.add(visit.cliente_id);
        acc.set(seller, current);
        return acc;
      }, new Map<string, { visits: number; companies: Set<string>; vidas: number }>()),
    )
      .map(([seller, value]) => ({
        seller,
        visits: value.visits,
        companies: value.companies.size,
        vidas: value.vidas,
      }))
      .sort((a, b) => b.visits - a.visits || b.vidas - a.vidas)
      .slice(0, 8);

    switch (kpiDetailMode) {
      case "visitas":
        return [
          { title: "Total de visitas", subtitle: `${formatNumber(model.total)} registros no periodo.`, badge: "Resumo" },
          { title: "Concluidas", subtitle: `${formatNumber(model.concluidas)} visitas finalizadas.`, badge: "Status" },
          { title: "Pendentes", subtitle: `${formatNumber(model.pendentes)} sem conclusao.`, badge: "Alerta" },
          ...filteredVisits.slice(0, 12).map((visit) => ({
            title: formatCompany(visit),
            subtitle: `${visit.visit_date ? formatMonthTick(visit.visit_date) : "-"} | ${getSellerLabelFromVisit(visit, profilesMap)}`,
            badge: visit.completed_at ? "Concluida" : "Pendente",
          })),
        ];
      case "concluidas":
        return [
          { title: "Visitas concluidas", subtitle: `${formatNumber(model.concluidas)} no periodo.`, badge: "Total" },
          { title: "Nao realizadas", subtitle: `${formatNumber(model.naoRealizadas)} com motivo registrado.`, badge: "Motivo" },
          ...filteredVisits
            .filter((visit) => Boolean(visit.completed_at))
            .slice(0, 12)
            .map((visit) => ({
              title: formatCompany(visit),
              subtitle: `${visit.visit_date ? formatMonthTick(visit.visit_date) : "-"} | ${getSellerLabelFromVisit(visit, profilesMap)}`,
              badge: visit.no_visit_reason ? "Nao visita" : "Concluida",
            })),
        ];
      case "pendentes":
        return [
          { title: "Visitas pendentes", subtitle: `${formatNumber(model.pendentes)} sem conclusao.`, badge: "Alerta" },
          { title: "Taxa de execucao", subtitle: formatPercent(model.taxaExecucao), badge: "Efetividade" },
          ...filteredVisits
            .filter((visit) => !visit.completed_at)
            .slice(0, 12)
            .map((visit) => ({
              title: formatCompany(visit),
              subtitle: `${visit.visit_date ? formatMonthTick(visit.visit_date) : "-"} | ${getSellerLabelFromVisit(visit, profilesMap)}`,
              badge: "Pendente",
            })),
        ];
      case "empresas":
      case "cobertura":
        return [
          { title: "Cobertura", subtitle: `${formatPercent(model.coberturaInScope)} da carteira em escopo.`, badge: "Carteira" },
          { title: "Empresas visitadas", subtitle: `${formatNumber(model.empresasVisitadas)} empresas distintas.`, badge: "Alcance" },
          { title: "Empresas nunca visitadas", subtitle: `${formatNumber(model.totalClientesInScope - model.empresasVisitadas)} fora do radar.`, badge: "Gap" },
          ...topSellers.map((item) => ({
            title: item.seller,
            subtitle: `${formatNumber(item.companies)} empresas distintas | ${formatNumber(item.visits)} visitas`,
            badge: "Alcance",
          })),
        ];
      case "vidas":
        return [
          { title: "Vidas em visitas", subtitle: `${formatNumber(model.vidasVisitas)} no periodo.`, badge: "Visitas" },
          { title: "Vidas em aceite digital", subtitle: `${formatNumber(model.vidasAceite)} no periodo.`, badge: "Aceite" },
          { title: "Vidas totais", subtitle: `${formatNumber(model.vidasTotal)} somadas.`, badge: "Total" },
          ...topSellers.map((item) => ({
            title: item.seller,
            subtitle: `${formatNumber(item.vidas)} vidas | ${formatNumber(item.visits)} visitas`,
            badge: "Top",
          })),
        ];
      case "taxa":
        return [
          { title: "Taxa de execucao", subtitle: `${formatPercent(model.taxaExecucao)} concluídas sem não visita / total.`, badge: "Resumo" },
          { title: "Realizadas", subtitle: `${formatNumber(model.realizadas)} visitas efetivas.`, badge: "Numerador" },
          { title: "Pendentes", subtitle: `${formatNumber(model.pendentes)} sem conclusão.`, badge: "Gap" },
          { title: "Nao realizadas", subtitle: `${formatNumber(model.naoRealizadas)} com motivo de não visita.`, badge: "Motivo" },
          ...model.byReason.slice(0, 8).map((item) => ({
            title: item.reason,
            subtitle: `${formatNumber(item.count)} ocorrência(s)`,
            badge: "Motivo",
          })),
        ];
      default:
        return [];
    }
  }, [clientesMap, filteredVisits, kpiDetailMode, model, profilesMap]);

  const kpiDetailFrame = useMemo(() => {
    if (!kpiDetailMode) return null;
    switch (kpiDetailMode) {
      case "cobertura":
        return {
          title: "Cobertura",
          summary: `${formatPercent(model.coberturaInScope)} da carteira em escopo.`,
          insight: `A cobertura é de ${formatNumber(model.empresasVisitadas)} empresas sobre ${formatNumber(model.totalClientesInScope)} no universo filtrado.`,
          highlights: [
            { label: "Empresas visitadas", value: formatNumber(model.empresasVisitadas) },
            { label: "Empresas em aberto", value: formatNumber(model.totalClientesInScope - model.empresasVisitadas) },
            { label: "Taxa em escopo", value: formatPercent(model.coberturaInScope) },
          ],
        };
      case "vidas":
        return {
          title: "Vidas totais",
          summary: `${formatNumber(model.vidasTotal)} vidas somadas no periodo.`,
          insight: `As visitas responderam por ${formatNumber(model.vidasVisitas)} e o aceite digital por ${formatNumber(model.vidasAceite)}.`,
          highlights: [
            { label: "Visitas", value: formatNumber(model.vidasVisitas) },
            { label: "Aceite digital", value: formatNumber(model.vidasAceite) },
            { label: "Total", value: formatNumber(model.vidasTotal) },
          ],
        };
      case "taxa":
        return {
          title: "Taxa de execução",
          summary: `${formatPercent(model.taxaExecucao)} no recorte atual.`,
          insight: `Foram ${formatNumber(model.realizadas)} realizadas, ${formatNumber(model.pendentes)} pendentes e ${formatNumber(model.naoRealizadas)} não realizadas.`,
          highlights: [
            { label: "Realizadas", value: formatNumber(model.realizadas) },
            { label: "Pendentes", value: formatNumber(model.pendentes) },
            { label: "Nao realizadas", value: formatNumber(model.naoRealizadas) },
          ],
        };
      case "visitas":
        return {
          title: "Visitas totais",
          summary: `${formatNumber(model.total)} registros no periodo.`,
          insight: `${formatNumber(model.concluidas)} foram concluídas e ${formatNumber(model.pendentes)} ficaram pendentes.`,
          highlights: [
            { label: "Total", value: formatNumber(model.total) },
            { label: "Concluidas", value: formatNumber(model.concluidas) },
            { label: "Pendentes", value: formatNumber(model.pendentes) },
          ],
        };
      case "concluidas":
        return {
          title: "Concluidas",
          summary: `${formatNumber(model.concluidas)} finalizadas no periodo.`,
          insight: `${formatNumber(model.naoRealizadas)} delas tiveram motivo de não visita.`,
          highlights: [
            { label: "Concluidas", value: formatNumber(model.concluidas) },
            { label: "Nao realizadas", value: formatNumber(model.naoRealizadas) },
            { label: "Taxa de execucao", value: formatPercent(model.taxaExecucao) },
          ],
        };
      case "pendentes":
        return {
          title: "Pendentes",
          summary: `${formatNumber(model.pendentes)} visitas sem conclusão.`,
          insight: `Esse bloco costuma indicar gargalo de agenda ou atraso operacional.`,
          highlights: [
            { label: "Pendentes", value: formatNumber(model.pendentes) },
            { label: "Taxa de execucao", value: formatPercent(model.taxaExecucao) },
            { label: "Total", value: formatNumber(model.total) },
          ],
        };
      case "empresas":
      default:
        return {
          title: "Empresas visitadas",
          summary: `${formatNumber(model.empresasVisitadas)} empresas distintas.`,
          insight: `O recorte mostra ${formatNumber(model.totalClientesInScope - model.empresasVisitadas)} empresas ainda sem visita.`,
          highlights: [
            { label: "Visitadas", value: formatNumber(model.empresasVisitadas) },
            { label: "Nao visitadas", value: formatNumber(model.totalClientesInScope - model.empresasVisitadas) },
            { label: "Cobertura", value: formatPercent(model.coberturaInScope) },
          ],
        };
    }
  }, [kpiDetailMode, model]);

  const lineLabels = model.byDaySeries.map(([day]) => day);
  const lineValues = model.byDaySeries.map(([, v]) =>
    metric === "visitas" ? v.visitas : metric === "concluidas" ? v.concluidas : v.vidas,
  );
  const metricLabel = metric === "visitas" ? "Visitas" : metric === "concluidas" ? "Concluidas" : "Vidas";
  const trendSummary = useMemo<TrendSummary>(() => {
    const currentTotal =
      metric === "visitas"
        ? filteredVisits.length
        : metric === "concluidas"
        ? filteredVisits.filter((v) => Boolean(v.completed_at)).length
          : filteredVisits.reduce((acc, v) => acc + Number(v.completed_vidas ?? 0), 0) +
            filteredAceites.reduce((acc, v) => acc + Number(v.vidas ?? 0), 0);
    const previousTotal =
      metric === "visitas"
        ? previousFilteredVisits.length
        : metric === "concluidas"
          ? previousFilteredVisits.filter((v) => Boolean(v.completed_at)).length
          : previousFilteredVisits.reduce((acc, v) => acc + Number(v.completed_vidas ?? 0), 0) +
            previousFilteredAceites.reduce((acc, v) => acc + Number(v.vidas ?? 0), 0);
    const days = Math.max(1, lineValues.length);
    const currentDailyAverage = currentTotal / days;
    const previousDailyAverage = previousTotal / days;
    const variationPct =
      previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : currentTotal > 0 ? 100 : 0;
    if (variationPct <= -20) {
      return {
        currentTotal,
        previousTotal,
        variationPct,
        dailyAverage: currentDailyAverage,
        previousDailyAverage,
        alertLevel: "critical",
        alertMessage: "Queda forte vs periodo anterior. Priorizar analise por supervisor.",
      };
    }
    if (variationPct < -8) {
      return {
        currentTotal,
        previousTotal,
        variationPct,
        dailyAverage: currentDailyAverage,
        previousDailyAverage,
        alertLevel: "warning",
        alertMessage: "Desaceleracao detectada. Monitorar os proximos dias.",
      };
    }
    return {
      currentTotal,
      previousTotal,
      variationPct,
      dailyAverage: currentDailyAverage,
      previousDailyAverage,
      alertLevel: "ok",
      alertMessage: "Ritmo estavel/positivo no recorte atual.",
    };
  }, [filteredAceites, filteredVisits, lineValues.length, metric, previousFilteredAceites, previousFilteredVisits]);

  const kpiCards = [
    { label: "Visitas totais", value: formatNumber(model.total), icon: CalendarDays, tone: "text-ink" },
    { label: "Concluidas", value: formatNumber(model.concluidas), icon: CheckCircle2, tone: "text-sea" },
    { label: "Pendentes", value: formatNumber(model.pendentes), icon: AlertTriangle, tone: "text-amber-700" },
    { label: "Empresas visitadas (UNICAS)", value: formatNumber(model.empresasVisitadas), icon: Building2, tone: "text-ink" },
    { label: "Cobertura", value: formatPercent(model.cobertura), icon: MapPinned, tone: "text-sea" },
    { label: "Vidas totais", value: formatNumber(model.vidasTotal), icon: TrendingUp, tone: "text-sea" },
    { label: "Taxa de execucao", value: formatPercent(model.taxaExecucao), icon: Users, tone: "text-sea" },
  ];
  const commercialModel = useMemo(() => {
    const sellerTotals = new Map<string, number>();
    const sellerMonthTotals = new Map<string, Map<string, number>>();
    const teamTotals = new Map<string, number>();
    const addValue = (seller: string, month: string | null, value: number) => {
      if (!month || !Number.isFinite(value) || value <= 0) return;
      sellerTotals.set(seller, (sellerTotals.get(seller) ?? 0) + value);
      const byMonth = sellerMonthTotals.get(seller) ?? new Map<string, number>();
      byMonth.set(month, (byMonth.get(month) ?? 0) + value);
      sellerMonthTotals.set(seller, byMonth);
    };

    filteredVisits.forEach((visit) => {
      const seller = getSellerLabelFromVisit(visit, profilesMap);
      const value = Number(visit.completed_vidas ?? 0);
      addValue(seller, getMonthKey(visit.visit_date ?? visit.completed_at), value);
      const supervisorId = visit.assigned_to_user_id ? vendorSupervisorMap.get(visit.assigned_to_user_id) : null;
      if (supervisorId && Number.isFinite(value) && value > 0) {
        teamTotals.set(supervisorId, (teamTotals.get(supervisorId) ?? 0) + value);
      }
    });

    const sellersTotals = Array.from(sellerTotals.entries())
      .map(([seller, total], index) => {
        const profileEntry = Array.from(profilesMap.entries()).find(([, label]) => label === seller);
        const supervisorId = profileEntry ? (vendorSupervisorMap.get(profileEntry[0]) ?? null) : null;
        return {
          seller,
          total,
          supervisorId,
          color: COMMERCIAL_COLORS[index % COMMERCIAL_COLORS.length],
        };
      })
      .sort((a, b) => b.total - a.total || a.seller.localeCompare(b.seller, "pt-BR"));
    const activeSeller =
      commercialHighlight?.type === "seller" && sellerTotals.has(commercialHighlight.value)
        ? commercialHighlight.value
        : null;
    const activeTeam = commercialHighlight?.type === "team" ? commercialHighlight.value : null;
    const selectedTotals = activeSeller
      ? sellerMonthTotals.get(activeSeller) ?? new Map<string, number>()
      : Array.from(sellerMonthTotals.values()).reduce((acc, byMonth) => {
          byMonth.forEach((value, month) => acc.set(month, (acc.get(month) ?? 0) + value));
          return acc;
        }, new Map<string, number>());

    const historicalMonthlyTotals = new Map<string, number>();
    historicalVisits.forEach((visit) => {
      const seller = getSellerLabelFromVisit(visit, profilesMap);
      const supervisorId = visit.assigned_to_user_id ? vendorSupervisorMap.get(visit.assigned_to_user_id) : null;
      if (selectedSupervisor !== "all" && supervisorId !== selectedSupervisor) return;
      if (selectedSeller !== "all" && normalizeFilterValue(seller) !== normalizeFilterValue(selectedSeller)) return;
      if (activeSeller && normalizeFilterValue(seller) !== normalizeFilterValue(activeSeller)) return;
      if (activeTeam && supervisorId !== activeTeam) return;
      const month = getMonthKey(visit.visit_date ?? visit.completed_at);
      const value = Number(visit.completed_vidas ?? 0);
      if (!month || !Number.isFinite(value) || value <= 0) return;
      historicalMonthlyTotals.set(month, (historicalMonthlyTotals.get(month) ?? 0) + value);
    });

    const monthSet = new Set<string>();
    if (from && to) {
      const start = new Date(`${from.slice(0, 7)}-01T12:00:00`);
      const end = new Date(`${to.slice(0, 7)}-01T12:00:00`);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end) {
        const cursor = new Date(start);
        while (cursor <= end) {
          monthSet.add(toYmd(cursor).slice(0, 7));
          cursor.setMonth(cursor.getMonth() + 1);
        }
      }
    }
    selectedTotals.forEach((_, month) => monthSet.add(month));
    const sortedHistoricalMonths = Array.from(historicalMonthlyTotals.keys()).sort((a, b) => a.localeCompare(b));
    const firstHistoricalMonth = sortedHistoricalMonths[0] ?? from.slice(0, 7);
    const historicalMonthKeys: string[] = [];
    const firstMonthDate = new Date(`${firstHistoricalMonth}-01T12:00:00`);
    if (!Number.isNaN(firstMonthDate.getTime())) {
      for (let index = 0; index < 12; index += 1) {
        const cursor = new Date(firstMonthDate);
        cursor.setMonth(firstMonthDate.getMonth() + index);
        historicalMonthKeys.push(toYmd(cursor).slice(0, 7));
      }
    }
    sortedHistoricalMonths.forEach((month) => {
      if (!historicalMonthKeys.includes(month)) historicalMonthKeys.push(month);
    });
    const monthlyRows = historicalMonthKeys.map((month) => ({ month, total: historicalMonthlyTotals.get(month) ?? 0 }));
    const analysisRows = Array.from(monthSet)
      .sort((a, b) => a.localeCompare(b))
      .map((month) => ({ month, total: selectedTotals.get(month) ?? 0 }));
    const total = analysisRows.reduce((acc, row) => acc + row.total, 0);
    const previousTotal = previousMonthFilteredVisits.reduce((acc, visit) => {
      if (activeSeller && normalizeFilterValue(getSellerLabelFromVisit(visit, profilesMap)) !== normalizeFilterValue(activeSeller)) {
        return acc;
      }
      return acc + Number(visit.completed_vidas ?? 0);
    }, 0);
    const nonZeroRows = analysisRows.filter((row) => row.total > 0);
    const last = analysisRows[analysisRows.length - 1] ?? { month: "", total: 0 };
    const variationPct = previousTotal > 0 ? ((total - previousTotal) / previousTotal) * 100 : total > 0 ? 100 : null;
    const average = analysisRows.length > 0 ? total / analysisRows.length : 0;
    const recentRows = nonZeroRows.slice(-3);
    const forecastNextMonth =
      recentRows.length > 0 ? recentRows.reduce((acc, row) => acc + row.total, 0) / recentRows.length : average;
    const best = nonZeroRows.reduce((acc, row) => (row.total > acc.total ? row : acc), { month: "", total: 0 });
    const worst = nonZeroRows.reduce(
      (acc, row) => (acc.total === 0 || row.total < acc.total ? row : acc),
      { month: "", total: 0 },
    );
    const selectedColor =
      sellersTotals.find((item) => item.seller === activeSeller)?.color ?? COMMERCIAL_COLORS[0];
    const bestTeamEntry = Array.from(teamTotals.entries()).sort((a, b) => b[1] - a[1])[0] ?? null;
    const bestTeam = bestTeamEntry
      ? {
          supervisorId: bestTeamEntry[0],
          supervisorName: supervisorNameMap.get(bestTeamEntry[0]) ?? "Supervisor sem nome",
          total: bestTeamEntry[1],
        }
      : null;
    const bestSeller = sellersTotals[0] ?? null;
    const visibleSellersTotals =
      commercialHighlight?.type === "team"
        ? sellersTotals.filter((item) => item.supervisorId === commercialHighlight.value)
        : sellersTotals;

    return {
      sellersTotals,
      visibleSellersTotals,
      activeSeller,
      monthlyRows,
      total,
      previousTotal,
      average,
      last,
      variationPct,
      forecastNextMonth,
      best,
      worst,
      selectedColor,
      bestTeam,
      bestSeller,
    };
  }, [
    clientesMap,
    commercialHighlight,
    filteredVisits,
    from,
    historicalVisits,
    previousMonthFilteredVisits,
    profilesMap,
    selectedSeller,
    selectedSupervisor,
    supervisorNameMap,
    to,
    vendorSupervisorMap,
  ]);

  useEffect(() => {
    if (
      commercialHighlight?.type === "seller" &&
      !commercialModel.sellersTotals.some((item) => item.seller === commercialHighlight.value)
    ) {
      setCommercialHighlight(null);
    }
    if (commercialHighlight?.type === "team" && commercialModel.visibleSellersTotals.length === 0) {
      setCommercialHighlight(null);
    }
  }, [commercialHighlight, commercialModel.sellersTotals, commercialModel.visibleSellersTotals.length]);

  const isSoftRefreshing = loading && hasLoadedOnce && tab !== "visao";
  const showBlockingLoader = loading && !hasLoadedOnce && tab !== "visao";

  return (
    <div className="space-y-5 md:space-y-6">
      <header className="rounded-2xl border border-sea/15 bg-white/90 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-ink">Dashboard</h2>
            <p className="mt-2 text-sm text-ink/65">
              Analise robusta com cruzamento de visitas, vidas registradas, aceite digital e cobertura comercial.
            </p>
          </div>
          {tab !== "visao" ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs font-semibold text-ink/70">
                De
                <input
                  type="date"
                  value={draftFrom}
                  onChange={(event) => setDraftFrom(event.target.value)}
                  className="mt-1 block rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink outline-none focus:border-sea"
                />
              </label>
              <label className="text-xs font-semibold text-ink/70">
                Ate
                <input
                  type="date"
                  value={draftTo}
                  onChange={(event) => setDraftTo(event.target.value)}
                  className="mt-1 block rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink outline-none focus:border-sea"
                />
              </label>
              <label className="text-xs font-semibold text-ink/70">
                Supervisor
                <select
                  value={draftSelectedSupervisor}
                  onChange={(event) => {
                    setDraftSelectedSupervisor(event.target.value);
                    setDraftSelectedSeller("all");
                  }}
                  className="mt-1 block rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink outline-none focus:border-sea"
                >
                  <option value="all">Todos</option>
                  {supervisors.map((supervisor) => (
                    <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-ink/70">
                Vendedor
                <select
                  value={draftSelectedSeller}
                  onChange={(event) => setDraftSelectedSeller(event.target.value)}
                  className="mt-1 block rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink outline-none focus:border-sea"
                >
                  <option value="all">Todos</option>
                  {vendorOptions.map((vendor) => (
                    <option key={`${vendor.supervisorId}-${vendor.userId}`} value={vendor.name}>{vendor.name}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleApplyFilters}
                className={[
                  "inline-flex h-10 items-center gap-2 self-end rounded-lg border px-3 text-xs font-semibold transition",
                  hasPendingFilterChanges
                    ? "border-sea bg-sea/10 text-sea hover:bg-sea/15"
                    : "cursor-not-allowed border-sea/20 bg-white/70 text-ink/45",
                ].join(" ")}
                disabled={!hasPendingFilterChanges}
                aria-label="Aplicar filtros"
                title="Aplicar filtros"
              >
                <Check size={14} />
                Aplicar
              </button>
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex h-10 items-center gap-2 self-end rounded-lg border border-sea/20 bg-white/80 px-3 text-xs font-semibold text-ink/70 transition hover:border-sea/40 hover:bg-white"
                aria-label="Limpar filtros"
                title="Limpar filtros"
              >
                Limpar
              </button>
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
            {visibleTabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={[
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                tab === item.key
                  ? "border-sea bg-sea/10 text-sea"
                  : "border-sea/20 bg-white text-ink/70 hover:border-sea/40",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
          <span className="inline-flex items-center gap-1 rounded-full border border-sea/20 bg-white px-3 py-1.5 text-[11px] text-ink/60">
            <Filter size={12} />
            Dados combinados
          </span>
        </div>
      </header>

      {tab === "visao" ? (
        <DashboardLegacy />
      ) : showBlockingLoader ? (
        <div className="dashboard-card rounded-2xl p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-5 w-48 rounded bg-sea/10" />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="h-24 rounded-xl bg-sea/10" />
              <div className="h-24 rounded-xl bg-sea/10" />
              <div className="h-24 rounded-xl bg-sea/10" />
              <div className="h-24 rounded-xl bg-sea/10" />
            </div>
            <div className="h-56 rounded-xl bg-sea/10" />
          </div>
        </div>
      ) : error ? (
        <div className="dashboard-status-danger rounded-2xl border p-6 text-sm">{error}</div>
      ) : (
        <>
          <section className={["grid gap-3 sm:grid-cols-2 xl:grid-cols-4", isSoftRefreshing ? "opacity-80 transition-opacity" : ""].join(" ")}>
            {kpiCards.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setKpiDetailMode(
                    item.label === "Visitas totais" ? "visitas" :
                    item.label === "Concluidas" ? "concluidas" :
                    item.label === "Pendentes" ? "pendentes" :
                    item.label === "Empresas visitadas (UNICAS)" ? "empresas" :
                    item.label === "Cobertura" ? "cobertura" :
                    item.label === "Vidas totais" ? "vidas" : "taxa"
                  )}
                  className={[
                    "dashboard-card rounded-2xl p-4 text-left transition hover:border-sea/35 hover:shadow-sm",
                    isSoftRefreshing ? "animate-pulse" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-ink/65">{item.label}</p>
                    <Icon size={16} className="text-sea" />
                  </div>
                  <p className={`mt-2 font-display text-3xl ${item.tone}`}>{item.value}</p>
                </button>
              );
            })}
            <article className="dashboard-card rounded-2xl p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/70">Legenda dos indicadores</h4>
              <div className="mt-2 space-y-1 text-[11px] text-ink/75">
                <p><span className="font-semibold">Visitas totais:</span> registros no período.</p>
                <p><span className="font-semibold">Concluídas:</span> visitas finalizadas.</p>
                <p><span className="font-semibold">Pendentes:</span> visitas sem conclusão.</p>
                <p><span className="font-semibold">Cobertura:</span> % de empresas visitadas no recorte.</p>
                <p><span className="font-semibold">Taxa de execução:</span> concluídas sem motivo de não visita / total.</p>
              </div>
            </article>
          </section>

          <DashboardModal
            open={Boolean(kpiDetailMode)}
            title={kpiDetailFrame?.title ?? "Detalhe"}
            subtitle="Clique fora para fechar."
            onClose={() => setKpiDetailMode(null)}
            maxWidthClassName="max-w-3xl"
          >
            <div className="space-y-4">
              <section className="grid gap-3 md:grid-cols-3">
                {kpiDetailFrame?.highlights.map((item) => (
                  <article key={item.label} className="rounded-2xl border border-sea/15 bg-sand/20 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-ink/55">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-ink">{item.value}</p>
                  </article>
                ))}
              </section>
              <section className="rounded-2xl border border-sea/15 bg-white/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/55">Leitura</p>
                <p className="mt-2 text-sm text-ink/80">{kpiDetailFrame?.summary}</p>
                <p className="mt-2 text-sm text-ink/60">{kpiDetailFrame?.insight}</p>
              </section>
              {kpiDetailItems.length > 0 ? (
                <section className="rounded-2xl border border-sea/15 bg-sand/20">
                  <div className="flex items-center justify-between px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/55">Top 6</p>
                    <span className="text-[11px] text-ink/55">contexto complementar</span>
                  </div>
                  <div className="divide-y divide-sea/10">
                    {kpiDetailItems.slice(0, 6).map((item, index) => (
                      <div key={`${item.title}-${index}`} className="px-4 py-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-ink">{index + 1}. {item.title}</span>
                          <span className="rounded-full bg-sea/10 px-2 py-0.5 text-[10px] font-semibold text-sea">
                            {item.badge}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-ink/60">{item.subtitle}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </DashboardModal>

          {tab === "performance" && (
            <section className="space-y-4">
              <div className={["dashboard-card rounded-2xl p-4", isSoftRefreshing ? "animate-pulse" : ""].join(" ")}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-lg text-ink">Tendencia temporal</h3>
                  <div className="flex gap-2">
                    {(["visitas", "concluidas", "vidas"] as LineMetric[]).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setMetric(item)}
                        className={[
                          "rounded-full border px-3 py-1 text-xs font-semibold",
                          metric === item ? "border-sea bg-sea/10 text-sea" : "border-sea/20 bg-white text-ink/70",
                        ].join(" ")}
                      >
                        {item === "visitas" ? "Visitas" : item === "concluidas" ? "Concluidas" : "Vidas"}
                      </button>
                    ))}
                  </div>
                </div>
                <DailyBarChart
                  title="Serie diaria"
                  labels={lineLabels}
                  values={lineValues}
                  color={
                    metric === "vidas"
                      ? "rgb(16 185 129)"
                      : "rgb(14 165 233)"
                  }
                  metricLabel={metricLabel}
                  averageValue={trendSummary.dailyAverage}
                />
                <div className="mt-3 rounded-lg border border-sea/15 bg-white/70 p-3 text-[11px] text-ink/75">
                  <p><span className="font-semibold">O que este grafico mostra:</span> barras diarias do periodo selecionado.</p>
                  <p className="mt-1"><span className="font-semibold">Linha tracejada:</span> media diaria do periodo. Barras acima dela indicam dias acima da media.</p>
                  <p className="mt-1"><span className="font-semibold">Metricas:</span> `Visitas` (agendadas/registradas), `Concluidas` (finalizadas), `Vidas` (visitas + aceite digital).</p>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-4">
                  <div className="rounded-lg border border-sea/20 bg-white/70 p-3">
                    <p className="text-[11px] text-ink/60">Total atual</p>
                    <p className="text-sm font-semibold text-ink">{formatNumber(trendSummary.currentTotal)}</p>
                  </div>
                  <div className="rounded-lg border border-sea/20 bg-white/70 p-3">
                    <p className="text-[11px] text-ink/60">Periodo anterior</p>
                    <p className="text-sm font-semibold text-ink">{formatNumber(trendSummary.previousTotal)}</p>
                  </div>
                  <div className="rounded-lg border border-sea/20 bg-white/70 p-3">
                    <p className="text-[11px] text-ink/60">Media diaria atual</p>
                    <p className="text-sm font-semibold text-ink">{trendSummary.dailyAverage.toFixed(1)}</p>
                  </div>
                  <div
                    className={[
                      "rounded-lg border p-3",
                      trendSummary.alertLevel === "critical"
                        ? "border-red-300 bg-red-50 text-red-700"
                        : trendSummary.alertLevel === "warning"
                          ? "border-amber-300 bg-amber-50 text-amber-800"
                          : "border-emerald-300 bg-emerald-50 text-emerald-700",
                    ].join(" ")}
                  >
                    <p className="text-[11px]">Variacao</p>
                    <p className="text-sm font-semibold">
                      {trendSummary.variationPct === null ? "-" : `${trendSummary.variationPct >= 0 ? "+" : ""}${trendSummary.variationPct.toFixed(1)}%`}
                    </p>
                  </div>
                </div>
                <p
                  className={[
                    "mt-2 text-xs",
                    trendSummary.alertLevel === "critical"
                      ? "text-red-600"
                      : trendSummary.alertLevel === "warning"
                        ? "text-amber-700"
                        : "text-emerald-700",
                  ].join(" ")}
                >
                  {trendSummary.alertMessage}
                </p>
                {isSoftRefreshing ? (
                  <p className="mt-2 text-[11px] text-ink/60">Atualizando dados em segundo plano...</p>
                ) : null}
              </div>

              <article className={["dashboard-card rounded-2xl p-4", isSoftRefreshing ? "animate-pulse" : ""].join(" ")}>
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg text-ink">Ranking por supervisor</h3>
                  <BarChart3 size={16} className="text-sea" />
                </div>
                <p className="mt-1 text-[11px] text-ink/65">Compara volume e eficiencia dos vendedores do supervisor selecionado.</p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-[760px] w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-sea/15 text-ink/65">
                        <th className="py-2">Vendedor</th>
                        <th className="py-2 text-right">Visitas</th>
                        <th className="py-2 text-right">Concluidas</th>
                        <th className="py-2 text-right">Taxa</th>
                        <th className="py-2 text-right">Vidas visita</th>
                        <th className="py-2 text-right">Vidas aceite</th>
                        <th className="py-2 text-right">Vidas total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.bySeller.map((item) => {
                        const taxa = item.visitas > 0 ? (item.concluidas / item.visitas) * 100 : 0;
                        return (
                          <tr key={item.seller} className="border-b border-sea/10">
                            <td className="py-2">{item.seller}</td>
                            <td className="py-2 text-right">{formatNumber(item.visitas)}</td>
                            <td className="py-2 text-right">{formatNumber(item.concluidas)}</td>
                            <td className="py-2 text-right">{taxa.toFixed(1)}%</td>
                            <td className="py-2 text-right">{formatNumber(item.vidasVisita)}</td>
                            <td className="py-2 text-right">{formatNumber(item.vidasAceite)}</td>
                            <td className="py-2 text-right font-semibold text-sea">{formatNumber(item.vidasTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          )}

          {tab === "comercial" && (
            <section className="space-y-4">
              <section className="grid gap-4 xl:grid-cols-[1fr_220px]">
                <article className={["dashboard-card rounded-2xl p-4", isSoftRefreshing ? "animate-pulse" : ""].join(" ")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                    <h3 className="font-display text-lg text-ink">Nome vendedor x quantidade de vidas em visitas</h3>
                      <p className="mt-1 text-xs text-ink/65">
                        Clique em um vendedor grafico para isolar a analise comercial abaixo.
                      </p>
                    </div>
                  {commercialHighlight ? (
                    <button
                      type="button"
                      onClick={() => setCommercialHighlight(null)}
                      className="rounded-lg border border-sea/25 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-sea"
                    >
                      Limpar selecao
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-4">
                    <CommercialDonutChart
                      items={commercialModel.visibleSellersTotals}
                      highlight={commercialHighlight}
                      onSelectSeller={(seller) => setCommercialHighlight(seller ? { type: "seller", value: seller } : null)}
                    />
                  </div>
                </article>

                <aside className="dashboard-card rounded-2xl p-4 xl:self-start">
                  <div>
                    <p className="max-w-[150px] truncate text-xs font-semibold text-ink/65" title="Quantidade de Vidas">
                      Quantidade de Vidas
                    </p>
                    <p className="mt-1 font-display text-3xl text-ink">{formatNumber(commercialModel.total)}</p>
                    <p className="mt-2 text-[11px] text-ink/55">
                      {commercialModel.activeSeller
                        ? commercialModel.activeSeller
                        : commercialHighlight?.type === "team"
                          ? `Equipe ${commercialModel.bestTeam?.supervisorName ?? ""}`
                          : "Todos os vendedores"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setCommercialHighlight(
                        commercialModel.bestTeam
                          ? { type: "team", value: commercialModel.bestTeam.supervisorId }
                          : null,
                      )
                    }
                    className="mt-4 block w-full border-t border-sea/15 pt-4 text-left transition hover:text-sea disabled:hover:text-inherit"
                    disabled={!commercialModel.bestTeam}
                  >
                    <p className="text-xs font-semibold text-ink/65">Melhor Equipe</p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {commercialModel.bestTeam?.supervisorName ?? "-"}
                    </p>
                    <p className="mt-1 font-display text-2xl text-sea">
                      {formatNumber(commercialModel.bestTeam?.total ?? 0)}
                    </p>
                    <p className="mt-1 text-[11px] text-ink/55">Somatorio dos vendedores do supervisor.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCommercialHighlight(
                        commercialModel.bestSeller
                          ? { type: "seller", value: commercialModel.bestSeller.seller }
                          : null,
                      )
                    }
                    className="mt-4 block w-full border-t border-sea/15 pt-4 text-left transition hover:text-sea disabled:hover:text-inherit"
                    disabled={!commercialModel.bestSeller}
                  >
                    <p className="text-xs font-semibold text-ink/65">Melhor Vendedor</p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {commercialModel.bestSeller?.seller ?? "-"}
                    </p>
                    <p className="mt-1 font-display text-2xl text-sea">
                      {formatNumber(commercialModel.bestSeller?.total ?? 0)}
                    </p>
                    <p className="mt-1 text-[11px] text-ink/55">Maior volume geral de vidas em visitas.</p>
                  </button>
                </aside>
              </section>

              <article className={["dashboard-card rounded-2xl p-4", isSoftRefreshing ? "animate-pulse" : ""].join(" ")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-lg text-ink">Vidas em visitas mes a mes</h3>
                    <p className="mt-1 text-xs text-ink/65">
                      {commercialModel.activeSeller
                        ? `Historico mensal de vidas em visitas de ${commercialModel.activeSeller}.`
                        : commercialHighlight?.type === "team"
                          ? `Historico mensal de vidas em visitas da equipe ${commercialModel.bestTeam?.supervisorName ?? ""}.`
                        : "Historico mensal de vidas em visitas de todos os vendedores."}
                    </p>
                  </div>
                  <span className="rounded-full border border-sea/20 bg-white px-3 py-1.5 text-[11px] font-semibold text-ink/65">
                    Total: {formatNumber(commercialModel.total)}
                  </span>
                </div>
                <MonthlyCommercialBarChart
                  rows={commercialModel.monthlyRows}
                  color={commercialModel.selectedColor}
                />
              </article>

              <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <article className="dashboard-card rounded-2xl p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Rendimento medio</p>
                  <p className="mt-2 text-2xl font-semibold text-sea">{formatNumber(Math.round(commercialModel.average))}</p>
                  <p className="mt-1 text-xs text-ink/60">Media mensal de vidas no periodo.</p>
                </article>
                <article
                  className={[
                    "rounded-2xl border p-4",
                    commercialModel.variationPct === null
                      ? "border-sea/20 bg-white/80 text-ink"
                      : commercialModel.variationPct < -10
                      ? "border-red-300 bg-red-50 text-red-700"
                      : commercialModel.variationPct < 0
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : "border-emerald-300 bg-emerald-50 text-emerald-700",
                  ].join(" ")}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide">Variacao recente</p>
                  <p className="mt-2 text-2xl font-semibold">
                    {commercialModel.variationPct === null
                      ? "-"
                      : `${commercialModel.variationPct >= 0 ? "+" : ""}${commercialModel.variationPct.toFixed(1)}%`}
                  </p>
                  <p className="mt-1 text-xs">
                    Mesmo periodo do mes anterior.
                  </p>
                </article>
                <article className="dashboard-card rounded-2xl p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Previsao proximo mes</p>
                  <p className="mt-2 text-2xl font-semibold text-ink">
                    {formatNumber(Math.round(commercialModel.forecastNextMonth))}
                  </p>
                  <p className="mt-1 text-xs text-ink/60">Baseada na media dos ultimos meses com movimento.</p>
                </article>
                <article className="dashboard-card rounded-2xl p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Melhor x menor mes</p>
                  <div className="mt-2 space-y-1 text-sm">
                    <p>
                      <span className="font-semibold text-sea">{formatMonthTick(commercialModel.best.month)}:</span>{" "}
                      {formatNumber(commercialModel.best.total)}
                    </p>
                    <p>
                      <span className="font-semibold text-amber-700">{formatMonthTick(commercialModel.worst.month)}:</span>{" "}
                      {formatNumber(commercialModel.worst.total)}
                    </p>
                  </div>
                </article>
              </section>

              <article className="dashboard-card rounded-2xl p-4">
                <h3 className="font-display text-lg text-ink">Leitura analitica</h3>
                <div className="mt-3 grid gap-3 text-sm text-ink/75 md:grid-cols-3">
                  <div className="rounded-xl border border-sea/15 bg-white/70 p-3">
                    <p className="font-semibold text-ink">Queda</p>
                    <p className="mt-1 text-xs">
                      {commercialModel.variationPct === null
                        ? "Sem dados no mesmo periodo do mes anterior para comparar."
                        : commercialModel.variationPct < 0
                        ? `Houve queda de ${Math.abs(commercialModel.variationPct).toFixed(1)}% contra o mesmo periodo do mes anterior.`
                        : "Nao ha queda contra o mesmo periodo do mes anterior."}
                    </p>
                  </div>
                  <div className="rounded-xl border border-sea/15 bg-white/70 p-3">
                    <p className="font-semibold text-ink">Rendimento</p>
                    <p className="mt-1 text-xs">
                      {commercialModel.activeSeller ?? "Equipe"} registrou {formatNumber(commercialModel.total)} vidas em visitas,
                      com media de {formatNumber(Math.round(commercialModel.average))} vidas/mes.
                    </p>
                  </div>
                  <div className="rounded-xl border border-sea/15 bg-white/70 p-3">
                    <p className="font-semibold text-ink">Acao sugerida</p>
                    <p className="mt-1 text-xs">
                      {commercialModel.variationPct !== null && commercialModel.variationPct < -10
                        ? "Priorizar contato com empresas recentes e revisar agenda do vendedor selecionado."
                        : "Manter acompanhamento mensal e comparar os vendedores com maior volume."}
                    </p>
                  </div>
                </div>
              </article>
            </section>
          )}

          {tab === "cobertura" && (
            <section className="grid gap-4 lg:grid-cols-3">
              <article className="dashboard-card rounded-2xl p-4">
                <h3 className="font-display text-lg text-ink">Cobertura de carteira</h3>
                <p className="mt-2 text-3xl font-semibold text-sea">{formatPercent(model.coberturaInScope)}</p>
                <p className="mt-1 text-sm text-ink/65">
                  {formatNumber(model.empresasVisitadas)} de {formatNumber(model.totalClientesInScope)} empresas
                </p>
              </article>
              <article className="dashboard-card rounded-2xl p-4 lg:col-span-2">
                <h3 className="font-display text-lg text-ink">Cruzamentos de cobertura</h3>
                <ul className="mt-3 space-y-2 text-sm text-ink/75">
                  <li>Analise por supervisor revela bolsões de baixa cobertura.</li>
                  <li>Combine cobertura com taxa de execucao para separar volume de efetividade.</li>
                  <li>Cruze com vidas totais para priorizar áreas com maior retorno comercial.</li>
                </ul>
              </article>
              <article className="dashboard-card rounded-2xl p-4">
                <h3 className="font-display text-lg text-ink">Mais visitadas</h3>
                <div className="mt-3 space-y-2 text-sm">
                  {model.mostVisitedCompanies.length === 0 ? (
                    <p className="text-ink/60">Sem dados.</p>
                  ) : (
                    model.mostVisitedCompanies.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-2">
                        <span className="truncate text-ink/70">{item.name}</span>
                        <span className="font-semibold text-sea">{formatNumber(item.count)}</span>
                      </div>
                    ))
                  )}
                </div>
              </article>
              <article className="dashboard-card rounded-2xl p-4">
                <h3 className="font-display text-lg text-ink">Menos visitadas (&gt;0)</h3>
                <div className="mt-3 space-y-2 text-sm">
                  {model.leastVisitedNonZeroCompanies.length === 0 ? (
                    <p className="text-ink/60">Sem dados.</p>
                  ) : (
                    model.leastVisitedNonZeroCompanies.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-2">
                        <span className="truncate text-ink/70">{item.name}</span>
                        <span className="font-semibold text-amber-700">{formatNumber(item.count)}</span>
                      </div>
                    ))
                  )}
                </div>
              </article>
              <article className="dashboard-card rounded-2xl p-4">
                <h3 className="font-display text-lg text-ink">Nunca visitadas</h3>
                <div className="mt-3 space-y-2 text-sm">
                  {model.neverVisitedCompanies.length === 0 ? (
                    <p className="text-ink/60">Sem dados.</p>
                  ) : (
                    model.neverVisitedCompanies.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-2">
                        <span className="truncate text-ink/70">{item.name}</span>
                        <span className="font-semibold text-red-500">0</span>
                      </div>
                    ))
                  )}
                </div>
              </article>
            </section>
          )}

          {tab === "qualidade" && (
            <section className="grid gap-4 xl:grid-cols-3">
              <article className="dashboard-card rounded-2xl p-4">
                <h3 className="font-display text-lg text-ink">Integridade de dados</h3>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-ink/70">Sem cliente</span><span className="font-semibold text-amber-700">{formatNumber(model.semCliente)}</span></div>
                  <div className="flex justify-between"><span className="text-ink/70">Sem responsavel</span><span className="font-semibold text-amber-700">{formatNumber(model.semResponsavel)}</span></div>
                  <div className="flex justify-between"><span className="text-ink/70">Sem data</span><span className="font-semibold text-amber-700">{formatNumber(model.semData)}</span></div>
                </div>
              </article>
              <article className="dashboard-card rounded-2xl p-4 xl:col-span-2">
                <h3 className="font-display text-lg text-ink">Motivos de nao visita</h3>
                {exportReasonError ? (
                  <p className="mt-2 text-xs text-red-600">{exportReasonError}</p>
                ) : null}
                <div className="mt-3 space-y-2">
                  {model.byReason.length === 0 ? (
                    <p className="text-sm text-ink/60">Sem registros de nao visita no recorte.</p>
                  ) : (
                    model.byReason.map((item) => (
                      <div key={item.reason} className="flex items-center justify-between text-sm">
                        <span className="text-ink/70">{item.reason}</span>
                        <button
                          type="button"
                          onClick={() => void exportNoVisitReason(item.reason)}
                          disabled={exportingReason !== null}
                          className="rounded px-1 font-semibold text-amber-700 transition hover:bg-amber-100 hover:text-amber-800 disabled:cursor-wait disabled:opacity-60"
                          title="Baixar XLSX com os registros deste motivo"
                          aria-label={`Baixar XLSX de ${item.reason}`}
                        >
                          {exportingReason === item.reason ? "..." : formatNumber(item.count)}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </article>
            </section>
          )}

          {!canViewTeam && (
            <p className="text-xs text-ink/60">
              Visao do vendedor: os dados sao limitados ao proprio usuario para preservar regras de permissao.
            </p>
          )}
        </>
      )}
    </div>
  );
}



