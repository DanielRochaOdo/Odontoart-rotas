import { useEffect, useMemo, useRef, useState } from "react";
import "./kpi-glass-v2.css";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";

type KpiPeriodDays = 1 | 7 | 15 | 30;

type KpiSnapshotRow = {
  id: string;
  sync_run_id: string | null;
  source: "api_daily" | "manual_upload" | "manual_sync" | null;
  period_days: number;
  codigo: string;
  empresa: string | null;
  categoria: string;
  vidas_qtde: number | null;
  status: string;
  snapshot_at: string;
  snapshot_date: string;
  previous_vidas_qtde: number | null;
  delta: number;
  vendas_qtde: number;
  cancelamentos_qtde: number;
  created_at: string;
};

type KpiStatus = "inativo" | "so_perda" | "queda" | "crescimento" | "so_ganho" | "neutro";
const KPI_STATUS_LABELS: Record<KpiStatus, string> = {
  inativo: "Inativo",
  so_perda: "Só perda",
  queda: "Queda",
  crescimento: "Crescimento",
  so_ganho: "Só ganho",
  neutro: "Neutro",
};

type SyncRunBanner = {
  id: string;
  status: string;
  total_codes: number;
  processed_codes: number;
  failed_codes: number;
  started_at: string;
  finished_at: string | null;
  source: string;
  current_code: string | null;
  current_stage: string | null;
  current_code_started_at: string | null;
  current_attempt: number | null;
  last_progress_at: string | null;
  period_start_date: string | null;
  period_end_date: string | null;
} | null;

type DonutSlice = {
  label: string;
  value: number;
  color: string;
};

type KpiCardDetailModalState = {
  title: string;
  metricLabel: string;
  rows: Array<{
    empresa: string;
    codigo: string;
    value: number;
  }>;
};

type KpiCardDetailModalViewState = {
  page: number;
  search: string;
};

const KPI_SNAPSHOT_READ_CHUNK_SIZE = 1000;
const KPI_ACTIVE_RUN_STORAGE_KEY = "kpi_active_sync_run_id";
const DONUT_SIZE = 160;
const DONUT_STROKE = 22;
const DONUT_RADIUS = (DONUT_SIZE - DONUT_STROKE) / 2;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

const toLocalIsoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const getDefaultKpiDateRange = () => {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return { start: toLocalIsoDate(start), end: toLocalIsoDate(end) };
};

const normalizeCode = (value: unknown) =>
  String(value ?? "")
    .replace(/\.0+$/, "")
    .trim();

const dedupeRowsByCodigo = (rows: KpiSnapshotRow[]) => {
  const byCode = new Map<string, KpiSnapshotRow>();
  rows.forEach((row) => {
    const codigo = normalizeCode(row.codigo);
    if (!codigo) return;
    byCode.set(codigo, { ...row, codigo });
  });
  return Array.from(byCode.values()).sort((a, b) => a.codigo.localeCompare(b.codigo));
};

const resolveKpiStatus = (vendas: number, cancelamentos: number): KpiStatus => {
  if (vendas === 0 && cancelamentos === 0) return "inativo";
  if (vendas === 0 && cancelamentos > 0) return "so_perda";
  if (vendas > 0 && cancelamentos === 0) return "so_ganho";
  if (vendas > cancelamentos) return "crescimento";
  if (cancelamentos > vendas) return "queda";
  return "neutro";
};

const KPI_SYNC_RUN_SELECT_COLUMNS =
  "id, status, total_codes, processed_codes, failed_codes, started_at, finished_at, source, current_code, current_stage, current_code_started_at, current_attempt, last_progress_at, period_start_date, period_end_date";

const fetchAllKpiSnapshotRows = async (periodDays: KpiPeriodDays) => {
  const allRows: KpiSnapshotRow[] = [];

  for (let offset = 0; ; offset += KPI_SNAPSHOT_READ_CHUNK_SIZE) {
      const { data, error } = await supabase
      .from("kpi_sync_snapshots")
      .select(
        "id, sync_run_id, source, period_days, codigo, empresa, categoria, vidas_qtde, status, snapshot_at, snapshot_date, previous_vidas_qtde, delta, vendas_qtde, cancelamentos_qtde, created_at",
      )
      .eq("period_days", periodDays)
      .order("snapshot_at", { ascending: false })
      .range(offset, offset + KPI_SNAPSHOT_READ_CHUNK_SIZE - 1);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as KpiSnapshotRow[];
    allRows.push(...rows);
    if (rows.length < KPI_SNAPSHOT_READ_CHUNK_SIZE) break;
  }

  return allRows;
};

const fetchAllKpiSnapshotRowsByRunId = async (syncRunId: string) => {
  const allRows: KpiSnapshotRow[] = [];
  let lastCodigo = "";

  for (;;) {
    let query = supabase
      .from("kpi_sync_snapshots")
      .select(
        "id, sync_run_id, source, period_days, codigo, empresa, categoria, vidas_qtde, status, snapshot_at, snapshot_date, previous_vidas_qtde, delta, vendas_qtde, cancelamentos_qtde, created_at",
      )
      .eq("sync_run_id", syncRunId)
      .order("codigo", { ascending: true })
      .order("id", { ascending: true })
      .limit(KPI_SNAPSHOT_READ_CHUNK_SIZE);

    if (lastCodigo) {
      query = query.gt("codigo", lastCodigo);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as KpiSnapshotRow[];
    allRows.push(...rows);
    if (rows.length < KPI_SNAPSHOT_READ_CHUNK_SIZE) break;
    lastCodigo = rows[rows.length - 1]?.codigo ?? lastCodigo;
    if (!lastCodigo) break;
  }

  return allRows;
};

const fetchLatestSyncRunBanner = async () => {
  const { data: runningData, error: runningError } = await supabase
    .from("kpi_sync_runs")
    .select(KPI_SYNC_RUN_SELECT_COLUMNS)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runningError) throw new Error(runningError.message);
  if (runningData) return runningData as SyncRunBanner;

  const { data: lastSuccessData, error: successError } = await supabase
    .from("kpi_sync_runs")
    .select(KPI_SYNC_RUN_SELECT_COLUMNS)
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (successError) throw new Error(successError.message);
  return (lastSuccessData as SyncRunBanner) ?? null;
};

const fetchLatestFinishedSyncRunId = async () => {
  const { data, error } = await supabase
    .from("kpi_sync_runs")
    .select("id, status")
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? String((data as { id: string }).id) : null;
};

const fetchSyncRunBannerById = async (syncRunId: string) => {
  const { data, error } = await supabase
    .from("kpi_sync_runs")
    .select(KPI_SYNC_RUN_SELECT_COLUMNS)
    .eq("id", syncRunId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SyncRunBanner) ?? null;
};

const readActiveSyncRunId = () => {
  try {
    return window.localStorage.getItem(KPI_ACTIVE_RUN_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
};

const writeActiveSyncRunId = (syncRunId: string | null) => {
  try {
    if (syncRunId) {
      window.localStorage.setItem(KPI_ACTIVE_RUN_STORAGE_KEY, syncRunId);
    } else {
      window.localStorage.removeItem(KPI_ACTIVE_RUN_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const formatLastSync = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${getPart("day")}/${getPart("month")}/${getPart("year")} as ${getPart("hour")}:${getPart("minute")} Hrs`;
};

const formatChartNumber = (value: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);

const DonutChartCard = ({
  title,
  subtitle,
  data,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  data: DonutSlice[];
  emptyLabel: string;
}) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let progress = 0;

  return (
    <div className="rotas-kpi-v2-chart rounded-xl border border-sea/15 bg-white/90 p-4">
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <p className="mt-1 text-[11px] text-ink/60">{subtitle}</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="relative h-40 w-40">
          <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} className="h-40 w-40">
            <circle
              cx={DONUT_SIZE / 2}
              cy={DONUT_SIZE / 2}
              r={DONUT_RADIUS}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth={DONUT_STROKE}
            />
            {total > 0
              ? data.map((item) => {
                  const fraction = item.value / total;
                  const segmentLength = fraction * DONUT_CIRCUMFERENCE;
                  const dashOffset = DONUT_CIRCUMFERENCE * (1 - progress);
                  progress += fraction;
                  return (
                    <circle
                      key={item.label}
                      cx={DONUT_SIZE / 2}
                      cy={DONUT_SIZE / 2}
                      r={DONUT_RADIUS}
                      fill="none"
                      stroke={item.color}
                      strokeWidth={DONUT_STROKE}
                      strokeLinecap="butt"
                      strokeDasharray={`${segmentLength} ${DONUT_CIRCUMFERENCE - segmentLength}`}
                      strokeDashoffset={dashOffset}
                      transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}
                    />
                  );
                })
              : null}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] uppercase tracking-[0.2em] text-ink/50">Total</span>
            <span className="text-xl font-semibold text-ink">{total}</span>
          </div>
        </div>
        <div className="min-w-[210px] flex-1 space-y-2">
          {total === 0 ? (
            <p className="text-xs text-ink/60">{emptyLabel}</p>
          ) : (
            data.map((item) => {
              const percent = total > 0 ? (item.value / total) * 100 : 0;
              return (
                <div key={item.label} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-ink/70">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span>{item.label}</span>
                  </div>
                  <span className="font-semibold text-ink">
                    {item.value} ({percent.toFixed(1)}%)
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

const DoubleBarChartCard = ({
  title,
  subtitle,
  labels,
  firstSeries,
  secondSeries,
  signedValues = false,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  labels: string[];
  firstSeries: { label: string; color: string; values: number[] };
  secondSeries: { label: string; color: string; values: number[] };
  signedValues?: boolean;
  emptyLabel: string;
}) => {
  const valuesA = firstSeries.values;
  const valuesB = secondSeries.values;
  const flattenedValues = [...valuesA, ...valuesB];
  const hasData = labels.length > 0 && flattenedValues.some((value) => value !== 0);
  const maxAbs = Math.max(1, ...flattenedValues.map((value) => Math.abs(value)));
  const totalForShare = labels.reduce((acc, _, index) => {
    const first = Math.max(0, valuesA[index] ?? 0);
    const second = Math.max(0, valuesB[index] ?? 0);
    return acc + first + second;
  }, 0);

  const resolveSignedBarStyle = (rawValue: number, baseColor: string) => {
    const height = Math.max(6, Math.round((Math.abs(rawValue) / maxAbs) * 78));
    if (rawValue >= 0) {
      return {
        className: "absolute bottom-1/2 left-0 w-4 rounded-t-lg",
        style: { height: `${height}px`, backgroundColor: baseColor },
      };
    }
    return {
      className: "absolute top-1/2 left-0 w-4 rounded-b-lg",
      style: { height: `${height}px`, backgroundColor: "#ef4444" },
    };
  };

  return (
    <div className="rotas-kpi-v2-chart rounded-xl border border-sea/15 bg-white/90 p-4">
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <p className="mt-1 text-[11px] text-ink/60">{subtitle}</p>

      {!hasData ? (
        <p className="mt-4 text-xs text-ink/60">{emptyLabel}</p>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink/60">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: firstSeries.color }} />
              {firstSeries.label}
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: secondSeries.color }} />
              {secondSeries.label}
            </span>
            {signedValues && (
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm bg-red-500" />
                Queda (valor negativo)
              </span>
            )}
          </div>

          <div className="flex items-end gap-4 overflow-x-auto pb-2">
            {labels.map((label, index) => {
              const firstRaw = valuesA[index] ?? 0;
              const secondRaw = valuesB[index] ?? 0;
              const firstHeight = Math.max(6, Math.round((Math.abs(firstRaw) / maxAbs) * 160));
              const secondHeight = Math.max(6, Math.round((Math.abs(secondRaw) / maxAbs) * 160));
              const total = Math.max(0, firstRaw) + Math.max(0, secondRaw);
              const percent = totalForShare ? ((total / totalForShare) * 100).toFixed(1) : "0.0";
              const firstSigned = `${firstRaw >= 0 ? "+" : ""}${formatChartNumber(firstRaw)}`;
              const secondSigned = `${secondRaw >= 0 ? "+" : ""}${formatChartNumber(secondRaw)}`;
              const firstSignedBar = resolveSignedBarStyle(firstRaw, firstSeries.color);
              const secondSignedBar = resolveSignedBarStyle(secondRaw, secondSeries.color);

              return (
                <div
                  key={`bar-group-${label}`}
                  className="flex min-w-[72px] flex-col items-center gap-2"
                  title={`${label} • ${firstSeries.label}: ${firstSigned} • ${secondSeries.label}: ${secondSigned}`}
                >
                  <span className="text-[11px] font-semibold text-ink">
                    {signedValues
                      ? `${firstSigned} | ${secondSigned}`
                      : formatChartNumber(total)}
                  </span>

                  {signedValues ? (
                    <div className="relative flex h-40 items-center gap-1">
                      <div className="absolute inset-x-0 top-1/2 border-t border-sea/25" />
                      <div className="relative h-40 w-4">
                        <div className={firstSignedBar.className} style={firstSignedBar.style} />
                      </div>
                      <div className="relative h-40 w-4">
                        <div className={secondSignedBar.className} style={secondSignedBar.style} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-40 items-end gap-1">
                      <div
                        className="w-4 rounded-t-lg"
                        style={{ height: firstHeight, backgroundColor: firstSeries.color }}
                      />
                      <div
                        className="w-4 rounded-t-lg"
                        style={{ height: secondHeight, backgroundColor: secondSeries.color }}
                      />
                    </div>
                  )}

                  <span className="w-20 truncate text-center text-[11px] text-ink/70">{label}</span>
                  <span className="text-[10px] text-ink/50">
                    {signedValues ? "variacao" : `${percent}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const TopCodesChartCard = ({
  title,
  subtitle,
  rows,
  accentColor,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  rows: Array<{
    codigo: string;
    empresa: string | null;
    saldo: number;
  }>;
  accentColor: string;
  emptyLabel: string;
}) => {
  const hasData = rows.length > 0;
  const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(row.saldo)));

  return (
    <div className="rotas-kpi-v2-chart rounded-xl border border-sea/15 bg-white/90 p-4">
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <p className="mt-1 text-[11px] text-ink/60">{subtitle}</p>
      {!hasData ? (
        <p className="mt-4 text-xs text-ink/60">{emptyLabel}</p>
      ) : (
        <div className="mt-4 space-y-2">
          {rows.map((row) => {
            const width = `${Math.max(8, Math.round((Math.abs(row.saldo) / maxAbs) * 100))}%`;
            const isNegative = row.saldo < 0;
            return (
              <div key={row.codigo} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-ink">{row.codigo}</span>
                  <span className={`font-semibold ${isNegative ? "text-red-600" : "text-emerald-600"}`}>
                    {formatChartNumber(row.saldo)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-sea/10">
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width,
                      backgroundColor: isNegative ? "#dc2626" : accentColor,
                    }}
                  />
                </div>
                <p className="truncate text-[10px] text-ink/50">{row.empresa ?? "Sem empresa"}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default function KPI() {
  const { role } = useAuth();
  const canAccess = role === "SUPERVISOR" || role === "ASSISTENTE";

  const [pdfError, setPdfError] = useState<string | null>(null);
  const [kpiCardDetailModal, setKpiCardDetailModal] = useState<KpiCardDetailModalState | null>(null);
  const [kpiCardDetailModalView, setKpiCardDetailModalView] = useState<KpiCardDetailModalViewState>({
    page: 1,
    search: "",
  });
  const [exportingPdf, setExportingPdf] = useState(false);
  const defaultPeriod = getDefaultKpiDateRange();
  const [periodStartDate, setPeriodStartDate] = useState(defaultPeriod.start);
  const [periodEndDate, setPeriodEndDate] = useState(defaultPeriod.end);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [syncingKpi, setSyncingKpi] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncRunBanner, setSyncRunBanner] = useState<SyncRunBanner>(null);
  const [syncPersistedCounts, setSyncPersistedCounts] = useState<{ snapshots: number; errors: number } | null>(null);
  const [currentSnapshotRows, setCurrentSnapshotRows] = useState<KpiSnapshotRow[]>([]);
  const [codesSearch, setCodesSearch] = useState("");
  const [codesSortKey, setCodesSortKey] = useState<"codigo" | "empresa" | "entradas" | "saidas" | "saldo" | "categoria">("codigo");
  const [codesSortDirection, setCodesSortDirection] = useState<"asc" | "desc">("asc");
  const [codesPage, setCodesPage] = useState(1);
  const snapshotLoadSequenceRef = useRef(0);
  const snapshotLoadKeyRef = useRef("");

  const syncProgressPercent =
    syncRunBanner && syncRunBanner.total_codes > 0
      ? Math.min(100, Math.round((syncRunBanner.processed_codes / syncRunBanner.total_codes) * 100))
      : 0;
  const syncCurrentCodeDuration =
    syncRunBanner?.current_code_started_at && syncRunBanner.status === "running"
      ? Math.max(0, Math.round((Date.now() - new Date(syncRunBanner.current_code_started_at).getTime()) / 1000))
      : null;
  const syncHealthWarning = useMemo(() => {
    if (!syncRunBanner || syncRunBanner.status !== "running" || !syncRunBanner.last_progress_at) return null;
    const ageMs = Date.now() - new Date(syncRunBanner.last_progress_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 5 * 60 * 1000) return null;
    if (ageMs < 15 * 60 * 1000) return "Sincronização sem progresso recente.";
    return "Sincronização sem atualização há muito tempo.";
  }, [syncRunBanner]);
  const uniqueSnapshotRows = useMemo(
    () => dedupeRowsByCodigo(currentSnapshotRows),
    [currentSnapshotRows],
  );

  const kpiPeriodAnalysis = useMemo(() => {
    return uniqueSnapshotRows
      .map((row) => {
        const entradas = Math.max(0, Number(row.vendas_qtde ?? 0));
        const saidas = Math.max(0, Number(row.cancelamentos_qtde ?? 0));
        return {
          codigo: normalizeCode(row.codigo),
          empresa: row.empresa,
          vendas: entradas,
          cancelamentos: saidas,
          saldo: entradas - saidas,
          status: resolveKpiStatus(entradas, saidas),
        };
      })
      .filter((row) => row.codigo)
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [uniqueSnapshotRows]);

  const categoryBreakdown = useMemo(() => {
    const labels: Record<KpiStatus, string> = {
      inativo: "Inativo",
      so_perda: "Só perda",
      queda: "Queda",
      crescimento: "Crescimento",
      so_ganho: "Só ganho",
      neutro: "Neutro",
    };
    const statuses: KpiStatus[] = ["so_perda", "so_ganho", "crescimento", "queda", "neutro", "inativo"];
    return statuses.map((status) => ({
      status,
      categoria: labels[status],
      total: kpiPeriodAnalysis.filter((row) => row.status === status).length,
    }));
  }, [kpiPeriodAnalysis]);

  const categoryDonutData = useMemo<DonutSlice[]>(
    () => [
      { label: "Só perda", value: categoryBreakdown.find((item) => item.status === "so_perda")?.total ?? 0, color: "#dc2626" },
      { label: "Só ganho", value: categoryBreakdown.find((item) => item.status === "so_ganho")?.total ?? 0, color: "#0f766e" },
      { label: "Crescimento", value: categoryBreakdown.find((item) => item.status === "crescimento")?.total ?? 0, color: "#16a34a" },
      { label: "Queda", value: categoryBreakdown.find((item) => item.status === "queda")?.total ?? 0, color: "#d97706" },
      { label: "Neutro", value: categoryBreakdown.find((item) => item.status === "neutro")?.total ?? 0, color: "#0284c7" },
      { label: "Inativo", value: categoryBreakdown.find((item) => item.status === "inativo")?.total ?? 0, color: "#64748b" },
    ],
    [categoryBreakdown],
  );

  const topGrowthRows = useMemo(
    () =>
    [...kpiPeriodAnalysis]
        .filter((row) => row.saldo > 0)
        .sort((a, b) => b.saldo - a.saldo)
        .slice(0, 10),
    [kpiPeriodAnalysis],
  );

  const topLossRows = useMemo(
    () =>
    [...kpiPeriodAnalysis]
        .filter((row) => row.saldo < 0)
        .sort((a, b) => a.saldo - b.saldo)
        .slice(0, 10),
    [kpiPeriodAnalysis],
  );

  const topMovementRows = useMemo(
    () => [...kpiPeriodAnalysis].sort((a, b) => (b.vendas + b.cancelamentos) - (a.vendas + a.cancelamentos)).slice(0, 10),
    [kpiPeriodAnalysis],
  );

  const companySeries = useMemo(() => {
    const grouped = new Map<string, number>();
    kpiPeriodAnalysis.forEach((row) => {
      const empresa = row.empresa ?? "Sem empresa";
      grouped.set(empresa, (grouped.get(empresa) ?? 0) + row.vendas + row.cancelamentos);
    });
    const rows = Array.from(grouped.entries())
      .map(([empresa, total]) => ({ empresa, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    return {
      labels: rows.map((row) => row.empresa),
      values: rows.map((row) => row.total),
    };
  }, [kpiPeriodAnalysis]);

  const filteredRows = useMemo(() => {
    const query = codesSearch.trim().toLowerCase();
    return kpiPeriodAnalysis.filter((row) => {
      if (!query) return true;
      return [
        row.codigo,
        row.empresa ?? "",
        row.status,
        KPI_STATUS_LABELS[row.status],
        String(row.vendas ?? ""),
        String(row.cancelamentos ?? ""),
        String(row.saldo ?? ""),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [codesSearch, kpiPeriodAnalysis]);

  useEffect(() => {
    setCodesPage(1);
  }, [codesSearch, codesSortKey, codesSortDirection]);

  const filteredCodeRows = useMemo(() => {
    const rows = filteredRows;

    const direction = codesSortDirection === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => {
      const leftValue =
          codesSortKey === "codigo"
          ? left.codigo
          : codesSortKey === "empresa"
            ? left.empresa ?? ""
          : codesSortKey === "categoria"
            ? KPI_STATUS_LABELS[left.status]
            : Number(codesSortKey === "entradas" ? left.vendas : codesSortKey === "saidas" ? left.cancelamentos : left.saldo);
      const rightValue =
        codesSortKey === "codigo"
          ? right.codigo
          : codesSortKey === "empresa"
            ? right.empresa ?? ""
          : codesSortKey === "categoria"
            ? KPI_STATUS_LABELS[right.status]
            : Number(codesSortKey === "entradas" ? right.vendas : codesSortKey === "saidas" ? right.cancelamentos : right.saldo);

      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue), "pt-BR", { sensitivity: "base" }) * direction;
    });
  }, [codesSortDirection, codesSortKey, filteredRows]);

  const codesPageSize = 10;
  const codesTotalPages = Math.max(1, Math.ceil(filteredCodeRows.length / codesPageSize));
  const safeCodesPage = Math.min(codesPage, codesTotalPages);
  const pagedCodeRows = useMemo(() => {
    const start = (safeCodesPage - 1) * codesPageSize;
    return filteredCodeRows.slice(start, start + codesPageSize);
  }, [filteredCodeRows, safeCodesPage]);

  const summaryCards = useMemo(
    () => [
      { key: "total_codigos", label: "Total de codigos", value: kpiPeriodAnalysis.length },
      { key: "total_entradas", label: "Total de entradas", value: kpiPeriodAnalysis.reduce((sum, row) => sum + row.vendas, 0) },
      { key: "total_saidas", label: "Total de saidas", value: kpiPeriodAnalysis.reduce((sum, row) => sum + row.cancelamentos, 0) },
      { key: "inativos", label: "Inativo", value: kpiPeriodAnalysis.filter((row) => row.status === "inativo").length },
      { key: "so_perda", label: "Só perda", value: kpiPeriodAnalysis.filter((row) => row.status === "so_perda").length },
      { key: "queda", label: "Queda", value: kpiPeriodAnalysis.filter((row) => row.status === "queda").length },
      { key: "crescimento", label: "Crescimento", value: kpiPeriodAnalysis.filter((row) => row.status === "crescimento").length },
      { key: "so_ganho", label: "Só ganho", value: kpiPeriodAnalysis.filter((row) => row.status === "so_ganho").length },
      { key: "neutros", label: "Neutro", value: kpiPeriodAnalysis.filter((row) => row.status === "neutro").length },
    ],
    [kpiPeriodAnalysis],
  );

  const openKpiCardDetailModal = (key: string, label: string) => {
    const modalMap: Record<
      string,
      {
        title: string;
        metricLabel: string;
        rows: Array<{ empresa: string; codigo: string; value: number }>;
      }
    > = {
      total_codigos: {
        title: "Total de codigos",
        metricLabel: "Codigos",
        rows: kpiPeriodAnalysis.map((row) => ({
          empresa: row.empresa ?? "-",
          codigo: row.codigo,
          value: 1,
        })),
      },
      total_entradas: {
        title: "Total de entradas",
        metricLabel: "Entradas",
        rows: kpiPeriodAnalysis.map((row) => ({
          empresa: row.empresa ?? "-",
          codigo: row.codigo,
          value: row.vendas,
        })),
      },
      total_saidas: {
        title: "Total de saidas",
        metricLabel: "Saidas",
        rows: kpiPeriodAnalysis.map((row) => ({
          empresa: row.empresa ?? "-",
          codigo: row.codigo,
          value: row.cancelamentos,
        })),
      },
      inativos: {
        title: "Inativo",
        metricLabel: "Saldo",
        rows: kpiPeriodAnalysis
          .filter((row) => row.status === "inativo")
          .map((row) => ({
            empresa: row.empresa ?? "-",
            codigo: row.codigo,
            value: 0,
          })),
      },
      so_perda: {
        title: "So perda",
        metricLabel: "Saidas",
        rows: kpiPeriodAnalysis
          .filter((row) => row.status === "so_perda")
          .map((row) => ({
            empresa: row.empresa ?? "-",
            codigo: row.codigo,
            value: row.cancelamentos,
          })),
      },
      queda: {
        title: "Queda",
        metricLabel: "Saidas",
        rows: kpiPeriodAnalysis
          .filter((row) => row.status === "queda")
          .map((row) => ({
            empresa: row.empresa ?? "-",
            codigo: row.codigo,
            value: row.cancelamentos,
          })),
      },
      crescimento: {
        title: "Crescimento",
        metricLabel: "Entradas",
        rows: kpiPeriodAnalysis
          .filter((row) => row.status === "crescimento")
          .map((row) => ({
            empresa: row.empresa ?? "-",
            codigo: row.codigo,
            value: row.saldo,
          })),
      },
      so_ganho: {
        title: "So ganho",
        metricLabel: "Entradas",
        rows: kpiPeriodAnalysis
          .filter((row) => row.status === "so_ganho")
          .map((row) => ({
            empresa: row.empresa ?? "-",
            codigo: row.codigo,
            value: row.vendas,
          })),
      },
      neutros: {
        title: "Neutro",
        metricLabel: "Entradas e saidas",
        rows: kpiPeriodAnalysis
          .filter((row) => row.status === "neutro")
          .map((row) => ({
            empresa: row.empresa ?? "-",
            codigo: row.codigo,
            value: row.vendas,
          })),
      },
    };

    const next = modalMap[key];
    setKpiCardDetailModal(next ?? { title: label, metricLabel: "Quantidade", rows: [] });
    setKpiCardDetailModalView({ page: 1, search: "" });
  };

  const filteredKpiCardDetailRows = useMemo(() => {
    if (!kpiCardDetailModal) return [];
    const search = kpiCardDetailModalView.search.trim().toLowerCase();
    const rows = search
      ? kpiCardDetailModal.rows.filter((row) => row.codigo.toLowerCase().includes(search))
      : kpiCardDetailModal.rows;
    return rows.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [kpiCardDetailModal, kpiCardDetailModalView.search]);

  const kpiCardDetailTotalPages = Math.max(1, Math.ceil(filteredKpiCardDetailRows.length / 20));
  const kpiCardDetailPage = Math.min(kpiCardDetailModalView.page, kpiCardDetailTotalPages);
  const pagedKpiCardDetailRows = useMemo(() => {
    const start = (kpiCardDetailPage - 1) * 20;
    return filteredKpiCardDetailRows.slice(start, start + 20);
  }, [filteredKpiCardDetailRows, kpiCardDetailPage]);

  const exportKpiExcel = async () => {
    const [{ default: XLSX }] = await Promise.all([import("xlsx")]);
    const workbook = XLSX.utils.book_new();
    const rows = filteredCodeRows.map((row) => ({
      codigo: row.codigo,
      empresa: row.empresa ?? "",
      status: KPI_STATUS_LABELS[row.status],
      entradas: row.vendas,
      saidas: row.cancelamentos,
      saldo: row.saldo,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, "kpi");
    XLSX.writeFile(workbook, `kpi_resultado_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportKpiPdf = async () => {
    setPdfError(null);
    setExportingPdf(true);
    const root = document.getElementById("kpi-export-root");
    if (!root) {
      setPdfError("Nao foi possivel preparar o PDF do modulo KPI.");
      setExportingPdf(false);
      return;
    }

    let tempContainer: HTMLDivElement | null = null;
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const clone = root.cloneNode(true) as HTMLElement;
      // A exportacao usa o mesmo relatorio solido de antes do tema Glass V2.
      clone.classList.remove("rotas-kpi-v2");
      clone.querySelectorAll('[data-pdf-exclude="true"]').forEach((element) => element.remove());
      clone.style.background = "#ffffff";

      tempContainer = document.createElement("div");
      tempContainer.style.position = "fixed";
      tempContainer.style.left = "-100000px";
      tempContainer.style.top = "0";
      tempContainer.style.width = `${Math.max(root.clientWidth, 1100)}px`;
      tempContainer.style.background = "#ffffff";
      tempContainer.style.zIndex = "-1";
      tempContainer.appendChild(clone);
      document.body.appendChild(tempContainer);

      try {
        const fontsReady = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
        if (fontsReady) await fontsReady;
      } catch {
        // ignore font readiness issues and continue
      }

      const images = Array.from(clone.querySelectorAll("img"));
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
      const canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        foreignObjectRendering: true,
      });

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidthMm = 210;
      const pageHeightMm = 297;
      const marginMm = 10;
      const contentWidthMm = pageWidthMm - marginMm * 2;
      const contentHeightMm = pageHeightMm - marginMm * 2;

      const pageHeightPx = Math.floor((contentHeightMm * canvas.width) / contentWidthMm);
      let renderedHeightPx = 0;
      let pageIndex = 0;

      while (renderedHeightPx < canvas.height) {
        const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedHeightPx);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeightPx;
        const pageCtx = pageCanvas.getContext("2d");
        if (!pageCtx) throw new Error("Falha ao preparar paginas do PDF.");

        pageCtx.drawImage(
          canvas,
          0,
          renderedHeightPx,
          canvas.width,
          sliceHeightPx,
          0,
          0,
          canvas.width,
          sliceHeightPx,
        );

        if (pageIndex > 0) {
          pdf.addPage();
        }
        const imgData = pageCanvas.toDataURL("image/png");
        const sliceHeightMm = (sliceHeightPx * contentWidthMm) / canvas.width;
        pdf.addImage(imgData, "PNG", marginMm, marginMm, contentWidthMm, sliceHeightMm, undefined, "FAST");

        renderedHeightPx += sliceHeightPx;
        pageIndex += 1;
      }

      const now = new Date();
      const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate(),
      ).padStart(2, "0")}`;
      pdf.save(`kpi-${dateKey}.pdf`);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "Falha ao gerar o PDF.");
    } finally {
      if (tempContainer && tempContainer.parentNode) {
        tempContainer.parentNode.removeChild(tempContainer);
      }
      setExportingPdf(false);
    }
  };

  const loadKpiSnapshots = async (periodDays: KpiPeriodDays) => {
    const rows = await fetchAllKpiSnapshotRows(periodDays);
    if (rows.length === 0) {
      setCurrentSnapshotRows([]);
      return;
    }

    const latestSnapshotAt = rows[0]?.snapshot_at ?? null;
    setCurrentSnapshotRows(dedupeRowsByCodigo(rows.filter((row) => row.snapshot_at === latestSnapshotAt)));
  };

  const loadKpiSnapshotsForRun = async (syncRunId: string, loadSequence: number) => {
    console.info("[KPI] snapshot-load-start", {
      runId: syncRunId,
      processedCodes: syncRunBanner?.processed_codes,
      sequence: loadSequence,
      currentSequence: snapshotLoadSequenceRef.current,
    });
    const rows = await fetchAllKpiSnapshotRowsByRunId(syncRunId);
    console.info("[KPI] snapshot-load-finished", {
      runId: syncRunId,
      loadedRows: rows.length,
      sequence: loadSequence,
      currentSequence: snapshotLoadSequenceRef.current,
    });
    if (loadSequence !== snapshotLoadSequenceRef.current) return;
    if (rows.length === 0) {
      setCurrentSnapshotRows([]);
      return;
    }

    setCurrentSnapshotRows(dedupeRowsByCodigo(rows));
  };

  const runKpiSync = async () => {
    if (syncingKpi) return;
    if (syncRunBanner?.status === "running") {
      setSyncMessage("Sincronização em andamento");
      return;
    }

    setSyncingKpi(true);
    setSyncError(null);
    setSyncMessage(null);

    const startTime = Date.parse(`${periodStartDate}T00:00:00Z`);
    const endTime = Date.parse(`${periodEndDate}T00:00:00Z`);
    const spanDays = (endTime - startTime) / 86400000 + 1;
    if (!isIsoDate(periodStartDate) || !isIsoDate(periodEndDate) || !Number.isFinite(spanDays)) {
      setPeriodError("Informe datas validas para consultar o periodo.");
      setSyncingKpi(false);
      return;
    }
    if (spanDays < 1 || spanDays > 366) {
      setPeriodError("A data inicial deve ser anterior ou igual a data final, e o periodo deve ter no maximo 366 dias.");
      setSyncingKpi(false);
      return;
    }
    setPeriodError(null);

    try {
      const { data, error } = await supabase.functions.invoke("kpi-sync-daily", {
        body: {
          source: "api_daily",
          triggered_by: "manual_ui_full_sync",
          data_inicio: periodStartDate,
          data_fim: periodEndDate,
        },
      });
      if (error) throw new Error(error.message);
      if (data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string") {
        throw new Error(String((data as { error?: string }).error));
      }
      if (data && typeof data === "object") {
        const payload = data as {
          sync_run_id?: string;
          run_id?: string;
          status?: string;
          total_codes?: number;
          processed_codes?: number;
          remaining_codes?: number;
          current_stage?: string | null;
          data_inicio?: string;
          data_fim?: string;
        };
        const runId = payload.sync_run_id ?? payload.run_id;
        if (runId) {
          writeActiveSyncRunId(runId);
          setSyncRunBanner((current) => ({
            id: runId,
            status: payload.status ?? "running",
            total_codes: payload.total_codes ?? current?.total_codes ?? 0,
            processed_codes: payload.processed_codes ?? current?.processed_codes ?? 0,
            failed_codes: current?.failed_codes ?? 0,
            started_at: current?.started_at ?? new Date().toISOString(),
            finished_at: current?.finished_at ?? null,
            source: current?.source ?? "api_daily",
            current_code: current?.current_code ?? null,
            current_stage: payload.current_stage ?? current?.current_stage ?? "queued",
            current_code_started_at: current?.current_code_started_at ?? null,
            current_attempt: current?.current_attempt ?? null,
            last_progress_at: current?.last_progress_at ?? new Date().toISOString(),
            period_start_date: payload.data_inicio ?? periodStartDate,
            period_end_date: payload.data_fim ?? periodEndDate,
          }));
        }
      }
      setSyncMessage("Sincronização completa iniciada.");
      const banner = await fetchLatestSyncRunBanner();
      setSyncRunBanner(banner);
      if (banner?.id) writeActiveSyncRunId(banner.id);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Falha ao iniciar sincronização.");
    } finally {
      setSyncingKpi(false);
    }
  };

  const loadSyncPersistedCounts = async (syncRunId: string) => {
    const [{ count: snapshotsCount }, { count: errorsCount }] = await Promise.all([
      supabase.from("kpi_sync_snapshots").select("id", { count: "exact", head: true }).eq("sync_run_id", syncRunId),
      supabase.from("kpi_sync_run_errors").select("id", { count: "exact", head: true }).eq("sync_run_id", syncRunId),
    ]);
    setSyncPersistedCounts({
      snapshots: snapshotsCount ?? 0,
      errors: errorsCount ?? 0,
    });
  };

  const stopKpiSync = async () => {
    if (!syncRunBanner?.id || syncRunBanner.status !== "running") return;
    setSyncingKpi(true);
    setSyncError(null);
    try {
      const { data, error } = await supabase.functions.invoke("kpi-sync-daily", {
        body: {
          mode: "stop",
          sync_run_id: syncRunBanner.id,
        },
      });
      if (error) throw new Error(error.message);
      if (data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string") {
        throw new Error(String((data as { error?: string }).error));
      }
      const banner = await fetchLatestSyncRunBanner();
      setSyncRunBanner(banner);
      if (banner?.status !== "running") writeActiveSyncRunId(null);
      setSyncMessage("Sincronização interrompida.");
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Falha ao interromper sincronização.");
    } finally {
      setSyncingKpi(false);
    }
  };

  useEffect(() => {
    if (!canAccess) return;
    let cancelled = false;

    const hydratePersistedSnapshots = async () => {
      try {
        const activeRunId = readActiveSyncRunId();
        if (activeRunId) return;
        const banner = await fetchLatestSyncRunBanner();
        if (cancelled) return;
        if (banner?.status === "running") return;
        if (banner?.period_start_date && banner?.period_end_date) {
          setPeriodStartDate(banner.period_start_date);
          setPeriodEndDate(banner.period_end_date);
        }
        const finishedRunId = await fetchLatestFinishedSyncRunId();
        if (cancelled) return;
        if (finishedRunId) {
          const loadSequence = snapshotLoadSequenceRef.current + 1;
          snapshotLoadSequenceRef.current = loadSequence;
          await loadKpiSnapshotsForRun(finishedRunId, loadSequence);
          return;
        }
        await loadKpiSnapshots(30);
      } catch (error) {
        if (!cancelled) {
          setSyncError(error instanceof Error ? error.message : "Erro ao carregar snapshots persistidos.");
        }
      }
    };

    void hydratePersistedSnapshots();

    return () => {
      cancelled = true;
    };
  }, [canAccess]);

  useEffect(() => {
    if (!canAccess) return;
    let cancelled = false;
    let timeoutId: number | null = null;
    const activeRunId = readActiveSyncRunId();

    const refreshSyncRunBanner = async () => {
      try {
        const banner = activeRunId ? await fetchSyncRunBannerById(activeRunId) : await fetchLatestSyncRunBanner();
        if (!cancelled) setSyncRunBanner(banner);
        if (!cancelled && activeRunId && (!banner || banner.status !== "running")) {
          writeActiveSyncRunId(null);
        }
        if (!cancelled && banner?.id && banner.status === "running") {
          const loadKey = `${banner.id}:${banner.processed_codes}:${banner.status}`;
          if (snapshotLoadKeyRef.current === loadKey) return;
          snapshotLoadKeyRef.current = loadKey;
          const loadSequence = snapshotLoadSequenceRef.current + 1;
          snapshotLoadSequenceRef.current = loadSequence;
          console.info("[KPI] snapshot-load-requested", {
            runId: banner.id,
            processedCodes: banner.processed_codes,
            sequence: loadSequence,
            trigger: "polling",
          });

          void loadKpiSnapshotsForRun(banner.id, loadSequence).catch((error) => {
            if (loadSequence !== snapshotLoadSequenceRef.current) return;
            setSyncError(error instanceof Error ? error.message : "Erro ao carregar snapshots do KPI.");
          });
        }
        if (!cancelled && banner?.status === "failed") {
          const lastSuccessRunId = await fetchLatestFinishedSyncRunId();
          if (lastSuccessRunId) {
            const loadKey = `success:${lastSuccessRunId}`;
            if (snapshotLoadKeyRef.current !== loadKey) {
              snapshotLoadKeyRef.current = loadKey;
              const loadSequence = snapshotLoadSequenceRef.current + 1;
              snapshotLoadSequenceRef.current = loadSequence;
              void loadKpiSnapshotsForRun(lastSuccessRunId, loadSequence).catch((error) => {
                if (loadSequence !== snapshotLoadSequenceRef.current) return;
                setSyncError(error instanceof Error ? error.message : "Erro ao carregar ultimo KPI concluido.");
              });
            }
          } else {
            setCurrentSnapshotRows([]);
          }
        }
        if (!cancelled && banner?.id) {
          void loadSyncPersistedCounts(banner.id).catch((error) => {
            if (!cancelled) {
              setSyncError(error instanceof Error ? error.message : "Erro ao carregar contagem persistida do KPI.");
            }
          });
        } else if (!cancelled) {
          setSyncPersistedCounts(null);
        }
      } catch (error) {
        if (!cancelled) {
          setSyncError(error instanceof Error ? error.message : "Erro ao carregar status da sincronizacao.");
        }
      }
    };

    const scheduleRefresh = (delayMs: number) => {
      if (cancelled) return;
      timeoutId = window.setTimeout(async () => {
        await refreshSyncRunBanner();
        if (cancelled) return;
        const nextDelay = syncRunBanner?.status === "running" ? 5000 : 15000;
        scheduleRefresh(nextDelay);
      }, delayMs);
    };

    void refreshSyncRunBanner().finally(() => {
      scheduleRefresh(5000);
    });

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [canAccess]);

  if (!canAccess) {
    return (
      <div className="glass-pane rounded-2xl p-4 text-sm text-ink/70 md:p-6">
        Este modulo e restrito a supervisao e assistencia.
      </div>
    );
  }

  return (
    <div id="kpi-export-root" className="rotas-kpi-v2 space-y-4 md:space-y-6">
      <header className="rotas-kpi-v2-hero flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="rotas-kpi-v2-eyebrow">ODONTOART · INTELIGENCIA COMERCIAL</span>
          <h2 className="font-display text-2xl text-ink">KPI</h2>
          <p className="mt-2 text-sm text-ink/60">
            Entradas, saidas e status calculados pela movimentacao real de cada empresa no periodo selecionado.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex flex-col gap-1 text-[10px] font-semibold text-ink/60">
            Data inicial
            <input type="date" value={periodStartDate} max={periodEndDate} onChange={(event) => setPeriodStartDate(event.target.value)} className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold text-ink/60">
            Data final
            <input type="date" value={periodEndDate} min={periodStartDate} onChange={(event) => setPeriodEndDate(event.target.value)} className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink" />
          </label>
          <button
            type="button"
            onClick={() => void runKpiSync()}
            disabled={syncingKpi || syncRunBanner?.status === "running"}
            className="rounded-lg border border-sea/30 bg-sea px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60 print:hidden"
          >
            {syncingKpi ? "Iniciando..." : syncRunBanner?.status === "running" ? "Sincronização em andamento" : "Sincronizar"}
          </button>
          {syncRunBanner?.status === "running" ? (
            <button
              type="button"
              onClick={() => void stopKpiSync()}
              disabled={syncingKpi}
              className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:border-red-500 hover:text-red-800 disabled:opacity-60 print:hidden"
            >
              Parar
            </button>
          ) : null}
          <button
            type="button"
            onClick={exportKpiPdf}
            disabled={exportingPdf}
            data-pdf-exclude="true"
            className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60 print:hidden"
          >
            {exportingPdf ? "Gerando PDF..." : "Exportar PDF"}
          </button>
          <button
            type="button"
            onClick={exportKpiExcel}
            className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea print:hidden"
          >
            Exportar Excel
          </button>
        </div>
      </header>
      <p className="-mt-2 text-[11px] text-ink/55">Padrao: mes fechado anterior. O intervalo pode ter ate 366 dias.</p>
      {periodError ? <p className="text-xs text-red-600">{periodError}</p> : null}

      <div className="rotas-kpi-v2-status rounded-2xl border border-sea/20 bg-white/90 p-3 text-xs text-ink/70">
        {syncRunBanner?.status === "running" ? (
          <div className="space-y-2">
            <p className="font-semibold text-amber-700">Consulta de movimentacoes em andamento</p>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <p>
                  Processados: {syncRunBanner.processed_codes} de {syncRunBanner.total_codes} codigos
                </p>
                <p className="font-semibold text-ink">{syncProgressPercent}%</p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-sea/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-300"
                  style={{ width: `${syncProgressPercent}%` }}
                />
              </div>
            </div>
            {syncRunBanner.current_code ? <p>Codigo atual: {syncRunBanner.current_code}</p> : null}
            {syncRunBanner.current_stage ? <p>Etapa: {syncRunBanner.current_stage}</p> : null}
            {syncCurrentCodeDuration !== null ? <p>Tempo no codigo: {syncCurrentCodeDuration}s</p> : null}
            {syncRunBanner.current_attempt ? <p>Tentativa: {syncRunBanner.current_attempt}</p> : null}
            {syncRunBanner.last_progress_at ? <p>Ultima atualizacao: {formatDateTime(syncRunBanner.last_progress_at)}</p> : null}
            {syncHealthWarning ? <p className="text-amber-700">{syncHealthWarning}</p> : null}
            <p>Snapshots carregados: {currentSnapshotRows.length}</p>
            {syncPersistedCounts ? (
              <p>Persistido: {syncPersistedCounts.snapshots} snapshots e {syncPersistedCounts.errors} erros</p>
            ) : null}
            <p>Falhas: {syncRunBanner.failed_codes}</p>
            <p>Iniciada em: {formatDateTime(syncRunBanner.started_at)}</p>
          </div>
        ) : (
          <p className="text-emerald-700">
            Base consolidada: ultimo periodo consultado.
            {syncRunBanner?.period_start_date && syncRunBanner?.period_end_date
              ? ` | Periodo ${syncRunBanner.period_start_date} a ${syncRunBanner.period_end_date}`
              : ""}
            {formatLastSync(syncRunBanner?.finished_at) ? ` | Ultima sincronização em ${formatLastSync(syncRunBanner?.finished_at)}` : ""}
          </p>
        )}
        {syncError && <p className="mt-1 text-red-600">{syncError}</p>}
      </div>

      <section className="rotas-kpi-v2-main rounded-2xl border border-sea/20 bg-sand/30 p-3 md:p-4">
        <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {summaryCards.map((card) => (
            <button
              key={card.label}
              type="button"
              onClick={() => openKpiCardDetailModal(card.key, card.label)}
              className="rotas-kpi-v2-metric rounded-xl border border-sea/15 bg-white p-3 text-left transition hover:border-sea/40 hover:shadow-sm"
            >
              <p className="text-[11px] uppercase tracking-[0.16em] text-ink/50">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{card.value}</p>
            </button>
          ))}
        </div>

        {kpiCardDetailModal && typeof document !== "undefined"
          ? createPortal(
              <div className="rotas-kpi-v2-portal fixed inset-0 z-[70] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-labelledby="kpi-detail-dialog-title">
                <button
                  type="button"
                  className="absolute inset-0 bg-ink/40"
                  onClick={() => setKpiCardDetailModal(null)}
                />
                <div className="rotas-kpi-v2-dialog relative w-full max-w-lg rounded-3xl border border-sea/20 bg-white p-5 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 id="kpi-detail-dialog-title" className="font-display text-lg text-ink">{kpiCardDetailModal.title}</h3>
                      <p className="mt-1 text-xs text-ink/60">{kpiCardDetailModal.metricLabel}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setKpiCardDetailModal(null)}
                      className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
                    >
                      Fechar
                    </button>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <input
                      value={kpiCardDetailModalView.search}
                      onChange={(event) =>
                        setKpiCardDetailModalView((prev) => ({
                          ...prev,
                          search: event.target.value,
                          page: 1,
                        }))
                      }
                      placeholder="Buscar codigo"
                      className="w-full rounded-lg border border-sea/20 bg-sand/10 px-3 py-2 text-xs text-ink outline-none focus:border-sea sm:w-56"
                    />
                    <span className="text-xs text-ink/60">
                      {filteredKpiCardDetailRows.length} resultado(s)
                    </span>
                  </div>
                  <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                    {pagedKpiCardDetailRows.length === 0 ? (
                      <p className="text-sm text-ink/60">Nenhum registro para exibir.</p>
                    ) : (
                      pagedKpiCardDetailRows.map((row) => (
                        <div
                          key={`${row.codigo}-${row.empresa}`}
                          className="rotas-kpi-v2-detail rounded-xl border border-sea/15 bg-sand/30 px-3 py-2 text-sm text-ink/80"
                        >
                          <p className="font-semibold text-ink">{row.empresa}</p>
                          <p className="text-xs text-ink/60">Codigo: {row.codigo}</p>
                          <p className="text-xs text-ink/60">
                            {kpiCardDetailModal.metricLabel}: {formatChartNumber(row.value)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                  {filteredKpiCardDetailRows.length > 20 ? (
                    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-ink/70">
                      <button
                        type="button"
                        onClick={() =>
                          setKpiCardDetailModalView((prev) => ({
                            ...prev,
                            page: Math.max(1, prev.page - 1),
                          }))
                        }
                        disabled={kpiCardDetailPage <= 1}
                        className="rounded-lg border border-sea/20 bg-white px-3 py-2 font-semibold disabled:opacity-50"
                      >
                        Anterior
                      </button>
                      <span>
                        Pagina {kpiCardDetailPage} de {kpiCardDetailTotalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setKpiCardDetailModalView((prev) => ({
                            ...prev,
                            page: Math.min(kpiCardDetailTotalPages, prev.page + 1),
                          }))
                        }
                        disabled={kpiCardDetailPage >= kpiCardDetailTotalPages}
                        className="rounded-lg border border-sea/20 bg-white px-3 py-2 font-semibold disabled:opacity-50"
                      >
                        Proxima
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>,
              document.body,
            )
          : null}

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <DonutChartCard
            title="Distribuicao por status"
            subtitle="Clique num status para filtrar os demais graficos."
            data={categoryDonutData}
            emptyLabel="Ainda nao existe fechamento consolidado para este grafico."
          />
          <TopCodesChartCard
            title="Top 10 Crescimentos"
            subtitle="Maiores saldos positivos no filtro atual."
            rows={topGrowthRows}
            accentColor="#16a34a"
            emptyLabel="Nenhum codigo com crescimento para este filtro."
          />
          <TopCodesChartCard
            title="Top 10 Quedas"
            subtitle="Maiores saldos negativos no filtro atual."
            rows={topLossRows}
            accentColor="#f97316"
            emptyLabel="Nenhum codigo com queda para este filtro."
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <div className="rotas-kpi-v2-chart rounded-xl border border-sea/15 bg-white/90 p-4">
            <h4 className="text-sm font-semibold text-ink">Movimentacoes por empresa</h4>
            <p className="mt-1 text-[11px] text-ink/60">Entradas e saidas somadas no periodo consultado.</p>
            <div className="mt-3 space-y-2">
              {companySeries.labels.length === 0 ? (
                <p className="text-xs text-ink/60">Nenhuma empresa encontrada para o filtro atual.</p>
              ) : (
                companySeries.labels.map((empresa, index) => {
                  const value = companySeries.values[index] ?? 0;
                  const maxValue = Math.max(1, ...companySeries.values);
                  const width = `${Math.max(8, Math.round((value / maxValue) * 100))}%`;
                  return (
                    <button
                      key={empresa}
                      type="button"
                      onClick={() => setCodesSearch(empresa)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-ink">{empresa}</span>
                        <span className="font-semibold text-ink">{formatChartNumber(value)}</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-sea/10">
                        <div className="h-2 rounded-full bg-teal-600" style={{ width }} />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <DoubleBarChartCard
            title="Entradas x saidas por codigo"
            subtitle="Totais reais do intervalo selecionado."
            labels={topMovementRows.map((row) => row.codigo)}
            firstSeries={{ label: "Entradas", color: "#16a34a", values: topMovementRows.map((row) => row.vendas) }}
            secondSeries={{ label: "Saidas", color: "#dc2626", values: topMovementRows.map((row) => row.cancelamentos) }}
            emptyLabel="Ainda nao ha movimentacoes para este periodo."
          />
        </div>

        <div className="rotas-kpi-v2-chart-note mt-3 rounded-xl border border-sea/20 bg-white px-3 py-2 text-[11px] text-ink dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
          <span className="font-semibold text-ink dark:text-slate-100">Periodo selecionado para consulta:</span>{" "}
          {periodStartDate} a {periodEndDate}. Os indicadores exibidos correspondem ao periodo da ultima consulta concluida.
        </div>
        <div className="rotas-kpi-v2-table-panel mt-3 rounded-xl border border-sea/20 bg-white p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
            <p className="text-xs font-semibold text-ink">Movimentacao por codigo</p>
              <p className="mt-1 text-[11px] text-ink/60">
                Pesquise por expressao e clique nos titulos para ordenar.
              </p>
            </div>
            <input
              value={codesSearch}
              onChange={(event) => setCodesSearch(event.target.value)}
              placeholder="Pesquisar codigo, empresa, status ou quantidade"
              className="w-full max-w-sm rounded-lg border border-sea/20 bg-sand/10 px-3 py-2 text-xs text-ink outline-none focus:border-sea md:w-auto"
            />
          </div>

          <div className="rotas-kpi-v2-table-scroll mt-3 overflow-x-auto">
            <table className="rotas-kpi-v2-table w-full text-left text-xs text-ink/70">
              <thead>
                <tr className="border-b border-sea/20">
                  {[
                    ["codigo", "Codigo"],
                    ["empresa", "Empresa"],
                    ["categoria", "Status"],
                    ["entradas", "Entradas"],
                    ["saidas", "Saidas"],
                    ["saldo", "Saldo"],
                  ].map(([key, label]) => (
                    <th key={key} className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (codesSortKey === key) {
                            setCodesSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
                          } else {
                            setCodesSortKey(key as typeof codesSortKey);
                            setCodesSortDirection("asc");
                          }
                        }}
                        className="inline-flex items-center gap-1 font-semibold text-ink hover:text-sea"
                      >
                        {label}
                        {codesSortKey === key ? (
                          <span className="text-[10px] text-ink/50">{codesSortDirection === "asc" ? "↑" : "↓"}</span>
                        ) : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredCodeRows.length === 0 ? (
                  <tr>
                    <td className="px-2 py-4 text-center text-xs text-ink/50" colSpan={6}>
                      Nenhum codigo encontrado.
                    </td>
                  </tr>
                ) : (
                  pagedCodeRows.map((row) => (
                    <tr key={row.codigo} className="border-b border-sea/10">
                      <td className="px-2 py-2 font-semibold text-ink">{row.codigo}</td>
                      <td className="px-2 py-2">{row.empresa ?? "-"}</td>
                      <td className="px-2 py-2">{KPI_STATUS_LABELS[row.status]}</td>
                      <td className="px-2 py-2">{formatChartNumber(row.vendas)}</td>
                      <td className="px-2 py-2">{formatChartNumber(row.cancelamentos)}</td>
                      <td className={`px-2 py-2 font-semibold ${row.saldo >= 0 ? "text-emerald-700" : "text-red-600"}`}>{formatChartNumber(row.saldo)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filteredCodeRows.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-sea/10 pt-3 text-xs text-ink/60">
              <p>
                Mostrando {Math.min((safeCodesPage - 1) * codesPageSize + 1, filteredCodeRows.length)}-
                {Math.min(safeCodesPage * codesPageSize, filteredCodeRows.length)} de {filteredCodeRows.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCodesPage((prev) => Math.max(1, prev - 1))}
                  disabled={safeCodesPage === 1}
                  className="rounded-lg border border-sea/20 px-3 py-1.5 font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="min-w-20 text-center font-semibold text-ink">
                  {safeCodesPage}/{codesTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCodesPage((prev) => Math.min(codesTotalPages, prev + 1))}
                  disabled={safeCodesPage === codesTotalPages}
                  className="rounded-lg border border-sea/20 px-3 py-1.5 font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Proxima
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {pdfError && <p className="mt-3 text-xs text-red-500">{pdfError}</p>}
      </section>
    </div>
  );
}


