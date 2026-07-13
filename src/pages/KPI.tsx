import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { normalizeText } from "../lib/textNormalize";
import {
  CATEGORIA_DESCRIPTIONS,
  CATEGORIA_OPTIONS,
  type CategoriaValue,
} from "../lib/categorias";

import * as XLSX from "xlsx";
type ParsedKpiRow = {
  codigo: string;
  associadoTotal: number;
  sourceRow: number;
  vidasIn?: number;
  vidasOut?: number;
  monthKey?: string;
  categoria?: CategoriaValue;
};

type ParseSummary = {
  rowsInFile: number;
  validRows: number;
  ignoredRows: number;
  uniqueCodes: number;
  unvalidatedCodes: number;
  columns: {
    codigo: string;
    associadoTotal: string;
    month: string | null;
  };
};

type ApplySummary = {
  uniqueCodes: number;
  foundCodes: number;
  missingCodes: number;
  estimatedCompaniesUpdated: number;
  updatedRows: number;
};

type KpiPeriodDays = 1 | 7 | 15 | 30;

type KpiSnapshotRow = {
  id: string;
  sync_run_id: string | null;
  source: "api_daily" | "manual_upload" | "manual_sync" | null;
  period_days: number;
  codigo: string;
  empresa: string | null;
  categoria: CategoriaValue;
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

type KpiStatus = "inativo" | "so_perda" | "queda" | "crescimento" | "so_venda" | "neutro";

type PersistedColumns = {
  codigo: string;
  associadoTotal: string;
  month?: string | null;
  vidasIn?: string;
  vidasOut?: string;
};

type KpiImportHistoryRow = {
  id: string;
  source_filename: string;
  rows_in_file: number;
  valid_rows: number;
  ignored_rows: number;
  unique_codes: number;
  unvalidated_codes: number;
  status: "VALIDADO" | "APLICADO";
  detected_columns: PersistedColumns | null;
  found_codes: number | null;
  missing_codes: number | null;
  estimated_companies_updated: number | null;
  updated_rows: number | null;
  created_at: string;
  applied_at: string | null;
};

type SyncRunBanner = {
  id: string;
  status: string;
  total_codes: number;
  processed_codes: number;
  failed_codes: number;
  started_at: string;
  source: string;
  current_code: string | null;
  current_stage: string | null;
  current_code_started_at: string | null;
  current_attempt: number | null;
} | null;

type DonutSlice = {
  label: string;
  value: number;
  color: string;
};

const LOOKUP_CHUNK_SIZE = 400;
const UPDATE_CHUNK_SIZE = 300;
const CLIENTS_READ_CHUNK_SIZE = 1000;
const KPI_SNAPSHOT_READ_CHUNK_SIZE = 1000;
const KPI_PERIOD_OPTIONS: KpiPeriodDays[] = [1, 7, 15, 30];
const DONUT_SIZE = 160;
const DONUT_STROKE = 22;
const DONUT_RADIUS = (DONUT_SIZE - DONUT_STROKE) / 2;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

const normalizeHeader = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeCode = (value: unknown) =>
  String(value ?? "")
    .replace(/\.0+$/, "")
    .trim();

const parseNonNegativeNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  }

  if (value === null || value === undefined) return 0;
  const text = String(value).trim();
  if (!text) return 0;

  const normalized = text
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const findColumnKey = (keys: string[], aliases: string[]) => {
  const normalizedKeys = keys.map((key) => ({
    raw: key,
    normalized: normalizeHeader(key),
  }));
  for (const alias of aliases) {
    const found = normalizedKeys.find((item) => item.normalized === alias);
    if (found) return found.raw;
  }
  return null;
};

const chunk = <T,>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const dedupeRowsByCodigo = (rows: KpiSnapshotRow[]) => {
  const byCode = new Map<string, KpiSnapshotRow>();
  rows.forEach((row) => {
    const codigo = normalizeCode(row.codigo);
    if (!codigo) return;
    byCode.set(codigo, { ...row, codigo });
  });
  return Array.from(byCode.values()).sort((a, b) => a.codigo.localeCompare(b.codigo));
};

const buildStatusFromDelta = (vendas: number, cancelamentos: number): string =>
  resolveKpiStatus(vendas, cancelamentos);

const getSnapshotDeltaPayload = (current: number | null, previous: number | null) => {
  const currentValue = Number(current ?? 0);
  const previousValue = Number(previous ?? 0);
  const delta = currentValue - previousValue;
  return {
    previous_vidas_qtde: previous,
    delta,
    vendas_qtde: delta > 0 ? delta : 0,
    cancelamentos_qtde: delta < 0 ? Math.abs(delta) : 0,
  };
};

const resolveKpiStatus = (vendas: number, cancelamentos: number): KpiStatus => {
  if (vendas === 0 && cancelamentos === 0) return "inativo";
  if (vendas === 0 && cancelamentos > 0) return "so_perda";
  if (vendas > 0 && cancelamentos === 0) return "so_venda";
  if (vendas > cancelamentos) return "crescimento";
  if (cancelamentos > vendas) return "queda";
  return "neutro";
};

const CLIENTS_SELECT_COLUMNS = "id, codigo, empresa, vidas_qtde";
const KPI_SYNC_RUN_SELECT_COLUMNS =
  "id, status, total_codes, processed_codes, failed_codes, started_at, source, current_code, current_stage, current_code_started_at, current_attempt";

const fetchAllClientesRows = async () => {
  const allRows: Array<{
    id: string;
    codigo: string | null;
    empresa: string | null;
    vidas_qtde: number | null;
  }> = [];

  for (let offset = 0; ; offset += CLIENTS_READ_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from("clientes")
      .select(CLIENTS_SELECT_COLUMNS)
      .order("id", { ascending: true })
      .range(offset, offset + CLIENTS_READ_CHUNK_SIZE - 1);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as typeof allRows;
    allRows.push(...rows);
    if (rows.length < CLIENTS_READ_CHUNK_SIZE) break;
  }

  return allRows;
};

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

const getCurrentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const parseMonthKey = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const directIso = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (directIso) {
    const year = Number(directIso[1]);
    const month = Number(directIso[2]);
    if (month >= 1 && month <= 12) return `${year}-${String(month).padStart(2, "0")}`;
  }

  const slashYmd = raw.match(/^(\d{4})\/(\d{1,2})$/);
  if (slashYmd) {
    const year = Number(slashYmd[1]);
    const month = Number(slashYmd[2]);
    if (month >= 1 && month <= 12) return `${year}-${String(month).padStart(2, "0")}`;
  }

  const slashMdy = raw.match(/^(\d{1,2})\/(\d{4})$/);
  if (slashMdy) {
    const month = Number(slashMdy[1]);
    const year = Number(slashMdy[2]);
    if (month >= 1 && month <= 12) return `${year}-${String(month).padStart(2, "0")}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsedDate = XLSX.SSF.parse_date_code(value);
    if (parsedDate?.y && parsedDate?.m) {
      return `${parsedDate.y}-${String(parsedDate.m).padStart(2, "0")}`;
    }
  }

  const fallbackDate = new Date(raw);
  if (!Number.isNaN(fallbackDate.getTime())) {
    return `${fallbackDate.getFullYear()}-${String(fallbackDate.getMonth() + 1).padStart(2, "0")}`;
  }

  return null;
};

const formatMonthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(
    new Date(year, month - 1, 1),
  );
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

const formatChartNumber = (value: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);

const isSituacaoAtiva = (situacao: string | null | undefined) => {
  const normalized = normalizeText(situacao, { letterCase: "upper" });
  return normalized.startsWith("ATIV");
};

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
    <div className="rounded-xl border border-sea/15 bg-white/90 p-4">
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
    <div className="rounded-xl border border-sea/15 bg-white/90 p-4">
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

export default function KPI() {
  const { role, profile, session } = useAuth();
  const canAccess = role === "SUPERVISOR" || role === "ASSISTENTE";

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [parseSummary, setParseSummary] = useState<ParseSummary | null>(null);
  const [applySummary, setApplySummary] = useState<ApplySummary | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedKpiRow[]>([]);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [historicalChartRows, setHistoricalChartRows] = useState<ParsedKpiRow[]>([]);
  const [historicalChartLoading, setHistoricalChartLoading] = useState(false);
  const [historicalChartError, setHistoricalChartError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [selectedPeriodDays, setSelectedPeriodDays] = useState<KpiPeriodDays>(30);
  const [syncingKpi, setSyncingKpi] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncRunBanner, setSyncRunBanner] = useState<SyncRunBanner>(null);
  const [manualUploadOpen, setManualUploadOpen] = useState(false);
  const [manualUploadFile, setManualUploadFile] = useState<File | null>(null);
  const [currentSnapshotRows, setCurrentSnapshotRows] = useState<KpiSnapshotRow[]>([]);
  const [previousSnapshotRows, setPreviousSnapshotRows] = useState<KpiSnapshotRow[]>([]);
  const [codesSearch, setCodesSearch] = useState("");
  const [codesSortKey, setCodesSortKey] = useState<"codigo" | "empresa" | "vidas_qtde" | "categoria">("codigo");
  const [codesSortDirection, setCodesSortDirection] = useState<"asc" | "desc">("asc");
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
  const fallbackMonthKey = useMemo(() => getCurrentMonthKey(), []);

  const uniqueSnapshotRows = useMemo(
    () => dedupeRowsByCodigo(currentSnapshotRows),
    [currentSnapshotRows],
  );

  const kpiPeriodAnalysis = useMemo(() => {
    const grouped = new Map<string, KpiSnapshotRow[]>();
    [...currentSnapshotRows, ...previousSnapshotRows].forEach((row) => {
      const key = normalizeCode(row.codigo);
      if (!key) return;
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    });

    return Array.from(grouped.entries())
      .map(([codigo, rows]) => {
        const ordered = [...rows].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
        const vendas = ordered.reduce((sum, row) => sum + Math.max(0, Number(row.vendas_qtde ?? 0)), 0);
        const cancelamentos = ordered.reduce((sum, row) => sum + Math.max(0, Number(row.cancelamentos_qtde ?? 0)), 0);
        const saldo = vendas - cancelamentos;
        const current = ordered[ordered.length - 1] ?? null;
        return {
          codigo,
          empresa: current?.empresa ?? null,
          associadoTotalAtual: Number(current?.vidas_qtde ?? 0),
          vendas,
          cancelamentos,
          saldo,
          status: resolveKpiStatus(vendas, cancelamentos),
        };
      })
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [currentSnapshotRows, previousSnapshotRows]);

  const categoryBreakdown = useMemo(() => {
    const totals = new Map<CategoriaValue, number>();
    CATEGORIA_OPTIONS.forEach((categoria) => totals.set(categoria, 0));
    kpiPeriodAnalysis.forEach((row) => {
      const categoria = row.status === "inativo"
        ? "Inativo"
        : row.status === "so_perda"
          ? "So perda"
          : row.status === "queda"
            ? "Queda"
            : row.status === "crescimento"
              ? "Crescimento"
              : row.status === "so_venda"
                ? "So venda"
                : "Neutro";
      totals.set(categoria as CategoriaValue, (totals.get(categoria as CategoriaValue) ?? 0) + 1);
    });
    return CATEGORIA_OPTIONS.map((categoria) => ({
      categoria,
      total: totals.get(categoria) ?? 0,
    }));
  }, [uniqueSnapshotRows]);

  const categoryDonutData = useMemo<DonutSlice[]>(
    () => [
      { label: "Inativo", value: categoryBreakdown.find((item) => item.categoria === "Inativo")?.total ?? 0, color: "#64748b" },
      { label: "So perda", value: categoryBreakdown.find((item) => item.categoria === "So perda")?.total ?? 0, color: "#dc2626" },
      { label: "Queda", value: categoryBreakdown.find((item) => item.categoria === "Queda")?.total ?? 0, color: "#d97706" },
      { label: "Crescimento", value: categoryBreakdown.find((item) => item.categoria === "Crescimento")?.total ?? 0, color: "#16a34a" },
      { label: "So venda", value: categoryBreakdown.find((item) => item.categoria === "So venda")?.total ?? 0, color: "#0f766e" },
      { label: "Neutro", value: categoryBreakdown.find((item) => item.categoria === "Neutro")?.total ?? 0, color: "#0284c7" },
    ],
    [categoryBreakdown],
  );

  const vidasDonutData = useMemo<DonutSlice[]>(() => {
    const vidasInTotal = kpiPeriodAnalysis.reduce((sum, row) => sum + row.associadoTotalAtual, 0);
    const vidasOutTotal = 0;
    return [
      { label: "Vidas In", value: vidasInTotal, color: "#16a34a" },
      { label: "Vidas Out", value: vidasOutTotal, color: "#dc2626" },
    ];
  }, [kpiPeriodAnalysis]);

  const monthSeries = useMemo(() => {
    const currentTotal = kpiPeriodAnalysis.reduce((sum, row) => sum + row.associadoTotalAtual, 0);
    const previousTotal = 0;
    return {
      labels: [`${selectedPeriodDays} dia(s)`],
      vidasInValues: [currentTotal],
      vidasOutValues: [previousTotal],
    };
  }, [kpiPeriodAnalysis, selectedPeriodDays]);

  const vidasGrowthSeries = useMemo(() => {
    if (monthSeries.labels.length <= 1) {
      return {
        labels: [] as string[],
        vidasInGrowth: [] as number[],
        vidasOutGrowth: [] as number[],
      };
    }

    const labels = monthSeries.labels.slice(1);
    const vidasInGrowth = monthSeries.vidasInValues.slice(1).map((value, index) => {
      const previous = monthSeries.vidasInValues[index] ?? 0;
      return value - previous;
    });
    const vidasOutGrowth = monthSeries.vidasOutValues.slice(1).map((value, index) => {
      const previous = monthSeries.vidasOutValues[index] ?? 0;
      return value - previous;
    });

    return { labels, vidasInGrowth, vidasOutGrowth };
  }, [monthSeries]);

  const filteredRows = useMemo(() => {
    const query = codesSearch.trim().toLowerCase();
    return kpiPeriodAnalysis.filter((row) => {
      if (!query) return true;
      return [
        row.codigo,
        row.empresa ?? "",
        row.status,
        String(row.associadoTotalAtual ?? ""),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [codesSearch, kpiPeriodAnalysis]);

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
              ? left.status
              : Number(left.associadoTotalAtual ?? 0);
      const rightValue =
        codesSortKey === "codigo"
          ? right.codigo
          : codesSortKey === "empresa"
            ? right.empresa ?? ""
            : codesSortKey === "categoria"
              ? right.status
              : Number(right.associadoTotalAtual ?? 0);

      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue), "pt-BR", { sensitivity: "base" }) * direction;
    });
  }, [codesSortDirection, codesSortKey, filteredRows]);

  const summaryCards = useMemo(
    () => [
      { label: "Total de codigos", value: filteredRows.length },
      { label: "Total de vidas atual", value: filteredRows.reduce((sum, row) => sum + row.associadoTotalAtual, 0) },
      { label: "Vendas no periodo", value: filteredRows.reduce((sum, row) => sum + row.vendas, 0) },
      { label: "Cancelamentos no periodo", value: filteredRows.reduce((sum, row) => sum + row.cancelamentos, 0) },
      { label: "Saldo de vidas", value: filteredRows.reduce((sum, row) => sum + row.saldo, 0) },
      { label: "Crescimento", value: filteredRows.filter((row) => row.status === "crescimento").length },
      { label: "Queda", value: filteredRows.filter((row) => row.status === "queda").length },
      { label: "Inativos", value: filteredRows.filter((row) => row.status === "inativo").length },
      { label: "Neutros", value: filteredRows.filter((row) => row.status === "neutro").length },
    ],
    [filteredRows],
  );

  const handleExportTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const dataSheet = XLSX.utils.aoa_to_sheet([
      ["codigo", "AssociadoTitular"],
    ]);
    const rulesSheet = XLSX.utils.aoa_to_sheet([
      ["categoria", "descricao"],
      ...CATEGORIA_OPTIONS.map((categoria) => [categoria, CATEGORIA_DESCRIPTIONS[categoria]]),
    ]);

    XLSX.utils.book_append_sheet(workbook, dataSheet, "kpi");
    XLSX.utils.book_append_sheet(workbook, rulesSheet, "regras");
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = String(now.getFullYear()).slice(-2);
    XLSX.writeFile(workbook, `modelo_importacao_kpi_${day}_${month}_${year}.xlsx`);
  };

  const exportKpiExcel = () => {
    const workbook = XLSX.utils.book_new();
    const rows = filteredCodeRows.map((row) => ({
      codigo: row.codigo,
      empresa: row.empresa ?? "",
      status: row.status,
      associadoTotal: row.associadoTotalAtual,
      vendas: row.vendas,
      cancelamentos: row.cancelamentos,
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
      setPreviousSnapshotRows([]);
      return;
    }

    const latestSnapshotAt = rows[0]?.snapshot_at ?? null;
    const current = dedupeRowsByCodigo(rows.filter((row) => row.snapshot_at === latestSnapshotAt));
      const previousStamp = rows.find((row) => row.snapshot_at !== latestSnapshotAt)?.snapshot_at ?? null;
    const previous = previousStamp ? dedupeRowsByCodigo(rows.filter((row) => row.snapshot_at === previousStamp)) : [];
    setCurrentSnapshotRows(current);
    setPreviousSnapshotRows(previous);
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
      setPreviousSnapshotRows([]);
      return;
    }

    setCurrentSnapshotRows(dedupeRowsByCodigo(rows));
    setPreviousSnapshotRows([]);
  };

  const createSyncSnapshotFromRows = async ({
    source,
    rowsByCode,
  }: {
    source: "api_daily" | "manual_upload" | "manual_sync";
    rowsByCode: Map<string, { associadoTotal: number; empresa: string | null }>;
  }) => {
    const snapshotAt = new Date().toISOString();
    const snapshotDate = snapshotAt.slice(0, 10);
    const normalizedCodes = Array.from(rowsByCode.keys()).sort((a, b) => a.localeCompare(b));

    const syncRunInsert = await supabase
      .from("kpi_sync_runs")
      .insert({
        source,
        status: "running",
        started_at: snapshotAt,
        requested_by_user_id: session?.user?.id ?? null,
        total_codes: normalizedCodes.length,
      })
      .select("id")
      .single();
    if (syncRunInsert.error) throw new Error(syncRunInsert.error.message);
    const syncRunId = String((syncRunInsert.data as { id: string }).id);

    const { data: previousSnapshotsData, error: previousSnapshotsError } = await supabase
      .from("kpi_sync_snapshots")
      .select("codigo, vidas_qtde, snapshot_at")
      .eq("period_days", selectedPeriodDays)
      .order("snapshot_at", { ascending: false });
    if (previousSnapshotsError) throw new Error(previousSnapshotsError.message);

    const previousByCode = new Map<string, number>();
    (previousSnapshotsData ?? []).forEach((item) => {
      const codigo = normalizeCode((item as { codigo: string | null }).codigo);
      if (!codigo || previousByCode.has(codigo)) return;
      previousByCode.set(codigo, Number((item as { vidas_qtde: number | null }).vidas_qtde ?? 0));
    });

    const snapshotRows: KpiSnapshotRow[] = normalizedCodes.map((codigo) => {
      const entry = rowsByCode.get(codigo);
      const current = Number(entry?.associadoTotal ?? 0);
      const previous = previousByCode.get(codigo) ?? null;
      const deltaPayload = getSnapshotDeltaPayload(current, previous);
      return {
        id: `sync-${syncRunId}-${codigo}`,
        sync_run_id: syncRunId,
        source,
        period_days: selectedPeriodDays,
        codigo,
        empresa: entry?.empresa ?? null,
        categoria: "Neutro" as CategoriaValue,
        vidas_qtde: current,
        status: buildStatusFromDelta(deltaPayload.vendas_qtde, deltaPayload.cancelamentos_qtde),
        snapshot_at: snapshotAt,
        snapshot_date: snapshotDate,
        previous_vidas_qtde: previous,
        delta: deltaPayload.delta,
        vendas_qtde: deltaPayload.vendas_qtde,
        cancelamentos_qtde: deltaPayload.cancelamentos_qtde,
        created_at: snapshotAt,
      };
    });

    const { error: insertSnapshotError } = await supabase.from("kpi_sync_snapshots").insert(snapshotRows);
    if (insertSnapshotError) throw new Error(insertSnapshotError.message);

    for (const codeBatch of chunk(normalizedCodes, LOOKUP_CHUNK_SIZE)) {
      const batchRows = codeBatch
        .map((codigo) => ({ codigo, associadoTotal: rowsByCode.get(codigo)?.associadoTotal ?? 0 }))
        .filter((item) => item.codigo);
      if (batchRows.length === 0) continue;
      for (const item of batchRows) {
        const { error } = await supabase
          .from("clientes")
          .update({ vidas_qtde: item.associadoTotal })
          .eq("codigo", item.codigo);
        if (error) throw new Error(error.message);
      }
    }

    const finishedAt = new Date().toISOString();
    const { error: runUpdateError } = await supabase
      .from("kpi_sync_runs")
      .update({
        status: "success",
        finished_at: finishedAt,
        processed_codes: snapshotRows.length,
        changed_codes: snapshotRows.filter((row) => row.delta !== 0).length,
        failed_codes: 0,
      })
      .eq("id", syncRunId);
    if (runUpdateError) throw new Error(runUpdateError.message);

    return { syncRunId, snapshotRows };
  };

  const runKpiSync = async () => {
    setSyncingKpi(true);
    setSyncError(null);
    setSyncMessage(null);

    try {
      const rows = await fetchAllClientesRows();
      const rowsByCode = new Map<string, { associadoTotal: number; empresa: string | null }>();
      rows.forEach((row) => {
        const code = normalizeCode(row.codigo);
        if (!code) return;
        rowsByCode.set(code, {
          associadoTotal: Number(row.vidas_qtde ?? 0),
          empresa: row.empresa ?? null,
        });
      });

      const { snapshotRows } = await createSyncSnapshotFromRows({
        source: "manual_sync",
        rowsByCode,
      });
      setCurrentSnapshotRows(snapshotRows as KpiSnapshotRow[]);
      setPreviousSnapshotRows([]);
      setSyncMessage(`Snapshot do KPI atualizado a partir de clientes. ${snapshotRows.length} registro(s).`);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Falha ao atualizar KPI.");
    } finally {
      setSyncingKpi(false);
    }
  };

  const loadHistoricalChartRows = async () => {
    if (!canAccess) return;
    setHistoricalChartLoading(true);
    setHistoricalChartError(null);
    try {
      const { data: snapshotsData, error: snapshotsError } = await supabase
        .from("kpi_sync_snapshots")
        .select("codigo, vidas_qtde, snapshot_at, previous_vidas_qtde, delta, vendas_qtde, cancelamentos_qtde, source, period_days, empresa, categoria, status")
        .eq("period_days", selectedPeriodDays)
        .order("snapshot_at", { ascending: false });
      if (snapshotsError) throw new Error(snapshotsError.message);

      const snapshots = (snapshotsData ?? []) as KpiSnapshotRow[];
      if (snapshots.length === 0) {
        setHistoricalChartRows([]);
        return;
      }
      const ordered = [...snapshots].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
      setHistoricalChartRows(ordered.map((row) => ({
        codigo: row.codigo,
        associadoTotal: Number(row.vidas_qtde ?? 0),
        sourceRow: 0,
        monthKey: row.snapshot_date,
        categoria: row.categoria,
        vidasIn: Number(row.delta > 0 ? row.delta : 0),
        vidasOut: Number(row.delta < 0 ? Math.abs(row.delta) : 0),
      })));
    } catch (error) {
      setHistoricalChartRows([]);
      setHistoricalChartError(
        error instanceof Error ? error.message : "Erro ao carregar dados historicos para os graficos.",
      );
    } finally {
      setHistoricalChartLoading(false);
    }
  };

  useEffect(() => {
    void loadHistoricalChartRows();
  }, [canAccess, selectedPeriodDays]);

  useEffect(() => {
    if (!canAccess) return;
    let cancelled = false;

    const refreshSyncRunBanner = async () => {
      try {
        const banner = await fetchLatestSyncRunBanner();
        if (!cancelled) setSyncRunBanner(banner);
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
      } catch (error) {
        if (!cancelled) {
          setSyncError(error instanceof Error ? error.message : "Erro ao carregar status da sincronizacao.");
        }
      }
    };

    void refreshSyncRunBanner();
    const timer = window.setInterval(() => {
      void refreshSyncRunBanner();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canAccess]);

  const parseFile = async () => {
    if (!file) {
      setParseError("Selecione um arquivo para continuar.");
      return;
    }

    setParsing(true);
    setParseError(null);
    setApplyError(null);
    setPdfError(null);
    setApplySummary(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error("Arquivo sem abas para leitura.");

      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
      if (rows.length === 0) throw new Error("Arquivo sem linhas de dados.");

      const keys = Object.keys(rows[0] ?? {});
      const codigoKey = findColumnKey(keys, ["codigo", "cod", "cod_1", "cod1"]);
      const associadoTotalKey = findColumnKey(keys, [
        "associadotitular",
        "associado_titular",
        "associado titular",
        "total_titulares",
      ]);

      if (!codigoKey) throw new Error("Coluna de codigo nao encontrada. Esperado: codigo/cod.");
      if (!associadoTotalKey) throw new Error("Coluna de AssociadoTitular nao encontrada.");

      const invalidRows: number[] = [];
      const validRows: ParsedKpiRow[] = [];
      let ignoredRows = 0;
      const byCode = new Map<string, ParsedKpiRow>();

      rows.forEach((row, index) => {
        const sourceRow = index + 2;
        const codigo = normalizeCode(row[codigoKey]);
        const hasTotal = String(row[associadoTotalKey] ?? "").trim().length > 0;
        const hasAnyValue = Boolean(codigo || hasTotal);

        if (!hasAnyValue) {
          ignoredRows += 1;
          return;
        }

        const associadoTotal = parseNonNegativeNumber(row[associadoTotalKey]);
        if (!codigo || associadoTotal === null) {
          invalidRows.push(sourceRow);
          return;
        }

        const existing = byCode.get(codigo);
        if (existing && existing.associadoTotal !== associadoTotal) {
          invalidRows.push(sourceRow);
          return;
        }

        const parsedRow = { codigo, associadoTotal, sourceRow };
        byCode.set(codigo, parsedRow);
        validRows.push(parsedRow);
      });

      if (invalidRows.length > 0) {
        const sample = invalidRows.slice(0, 10).join(", ");
        throw new Error(`Linhas invalidas: ${invalidRows.length}. Exemplos: ${sample}`);
      }

      if (validRows.length === 0) {
        throw new Error("Nenhuma linha valida encontrada no arquivo.");
      }

      const normalizedRows = Array.from(byCode.values()).sort((a, b) =>
        a.codigo.localeCompare(b.codigo),
      );

      const parseSummaryDraft: ParseSummary = {
        rowsInFile: rows.length,
        validRows: validRows.length,
        ignoredRows,
        uniqueCodes: normalizedRows.length,
        unvalidatedCodes: 0,
        columns: {
          codigo: codigoKey,
          associadoTotal: associadoTotalKey,
          month: null,
        },
      };

      const rowsByCode = new Map(
        normalizedRows.map((row) => [row.codigo, { associadoTotal: row.associadoTotal, empresa: null }] as const),
      );
      const { syncRunId } = await createSyncSnapshotFromRows({
        source: "manual_upload",
        rowsByCode,
      });

      setParsedRows(normalizedRows);
      setParseSummary(parseSummaryDraft);
      setApplySummary({
        uniqueCodes: normalizedRows.length,
        foundCodes: normalizedRows.length,
        missingCodes: 0,
        estimatedCompaniesUpdated: normalizedRows.length,
        updatedRows: normalizedRows.length,
      });
    } catch (error) {
      setParsedRows([]);
      setParseSummary(null);
      setParseError(error instanceof Error ? error.message : "Erro ao ler arquivo.");
    } finally {
      setParsing(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="glass-pane rounded-2xl p-4 text-sm text-ink/70 md:p-6">
        Este modulo e restrito a supervisao e assistencia.
      </div>
    );
  }

  return (
    <div id="kpi-export-root" className="space-y-4 md:space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">KPI</h2>
          <p className="mt-2 text-sm text-ink/60">
            Indicadores baseados no AssociadoTitular por codigo, com historico de snapshots e comparacao por periodo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setManualUploadOpen(true)}
            className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60 print:hidden"
          >
            Atualizar por planilha
          </button>
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

      <div className="rounded-2xl border border-sea/20 bg-white/90 p-3 text-xs text-ink/70">
        {syncRunBanner?.status === "running" ? (
          <div className="space-y-2">
            <p className="font-semibold text-amber-700">Sincronizacao automatica em andamento</p>
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
            <p>Snapshots carregados: {currentSnapshotRows.length}</p>
            <p>Falhas: {syncRunBanner.failed_codes}</p>
            <p>Iniciada em: {formatDateTime(syncRunBanner.started_at)}</p>
          </div>
        ) : (
          <p className="text-emerald-700">Base consolidada: ultimo fechamento concluido.</p>
        )}
        {syncError && <p className="mt-1 text-red-600">{syncError}</p>}
      </div>

      <section className="rounded-2xl border border-sea/20 bg-sand/30 p-3 md:p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="rounded-xl border border-sea/15 bg-white/85 p-3 text-xs text-ink/70 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
            <p className="font-semibold text-ink">Filtros</p>
            <p className="mt-1">
              Base consolidada do ultimo fechamento concluido. Use filtros para isolar periodos, c&oacute;digos e empresas.
            </p>
          </div>
          <div className="flex gap-2">
            <select
              value={selectedPeriodDays}
              onChange={(event) => setSelectedPeriodDays(Number(event.target.value) as KpiPeriodDays)}
              className="h-10 rounded-lg border border-sea/30 bg-white px-3 text-xs font-semibold text-ink/70 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              {KPI_PERIOD_OPTIONS.map((period) => (
                <option key={period} value={period}>
                  Ultimos {period} dia(s)
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-sea/15 bg-white/80 p-3 text-xs text-ink/70 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
          <p className="font-semibold text-ink/80 dark:text-slate-100">Snapshots</p>
          <p className="mt-1">
            Base consolidada: ultimo fechamento concluido.
          </p>
          {syncMessage ? <p className="mt-1 text-emerald-700">{syncMessage}</p> : null}
          {syncError ? <p className="mt-1 text-red-600">{syncError}</p> : null}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-sea/15 bg-white p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-ink/50">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <DonutChartCard
            title="Distribuicao por status"
            subtitle="Quantidade de codigos por status na base consolidada."
            data={categoryDonutData}
            emptyLabel="Ainda nao existe fechamento consolidado para este grafico."
          />
          <DonutChartCard
            title="Comparativo de vidas"
            subtitle="Soma total de AssociadoTitular na base consolidada."
            data={vidasDonutData}
            emptyLabel="Ainda nao existe fechamento consolidado para este grafico."
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-sea/20 bg-white px-3 py-2 text-[11px] text-ink dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
            <span className="font-semibold text-ink dark:text-slate-100">Base dos graficos comparativos:</span>{" "}
            ultimo fechamento concluido.
            {historicalChartLoading ? " Atualizando dados..." : ""}
            {historicalChartError ? ` Erro ao carregar historico: ${historicalChartError}` : ""}
          </div>
          <DoubleBarChartCard
            title="Evolucao por periodo"
            subtitle="Evolucao do AssociadoTitular com base no ultimo fechamento."
            labels={monthSeries.labels}
            firstSeries={{ label: "Vidas In", color: "#16a34a", values: monthSeries.vidasInValues }}
            secondSeries={{ label: "Vidas Out", color: "#dc2626", values: monthSeries.vidasOutValues }}
            emptyLabel="Valide um arquivo para visualizar este grafico."
          />
          <DoubleBarChartCard
            title="Tendencia de variacao"
            subtitle="Variacao mensal do AssociadoTitular. Valores positivos indicam crescimento e negativos indicam queda."
            labels={vidasGrowthSeries.labels}
            firstSeries={{ label: "Variacao Vidas In", color: "#16a34a", values: vidasGrowthSeries.vidasInGrowth }}
            secondSeries={{ label: "Variacao Vidas Out", color: "#dc2626", values: vidasGrowthSeries.vidasOutGrowth }}
            signedValues
            emptyLabel="Sao necessarios pelo menos dois meses para calcular tendencia."
          />
        </div>

        <div className="mt-3 rounded-xl border border-sea/20 bg-white p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-ink">Codigos e valores</p>
              <p className="mt-1 text-[11px] text-ink/60">
                Pesquise por expressao e clique nos titulos para ordenar.
              </p>
            </div>
            <input
              value={codesSearch}
              onChange={(event) => setCodesSearch(event.target.value)}
              placeholder="Pesquisar codigo, empresa, categoria ou valor"
              className="w-full max-w-sm rounded-lg border border-sea/20 bg-sand/10 px-3 py-2 text-xs text-ink outline-none focus:border-sea md:w-auto"
            />
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs text-ink/70">
              <thead>
                <tr className="border-b border-sea/20">
                  {[
                    ["codigo", "Codigo"],
                    ["empresa", "Empresa"],
                    ["categoria", "Status"],
                    ["vidas_qtde", "Total de titulares"],
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
                    <td className="px-2 py-4 text-center text-xs text-ink/50" colSpan={4}>
                      Nenhum codigo encontrado.
                    </td>
                  </tr>
                ) : (
                  filteredCodeRows.map((row) => (
                    <tr key={row.codigo} className="border-b border-sea/10">
                      <td className="px-2 py-2 font-semibold text-ink">{row.codigo}</td>
                      <td className="px-2 py-2">{row.empresa ?? "-"}</td>
                      <td className="px-2 py-2">{row.status}</td>
                      <td className="px-2 py-2">{row.associadoTotalAtual}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {parseError && <p className="mt-3 text-xs text-red-500">{parseError}</p>}
        {applyError && <p className="mt-3 text-xs text-red-500">{applyError}</p>}
        {pdfError && <p className="mt-3 text-xs text-red-500">{pdfError}</p>}
      </section>

      {manualUploadOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="font-display text-xl text-ink">Atualizacao manual de vidas</h3>
            <p className="mt-2 text-sm text-ink/60">
              Use este recurso apenas para atualizacoes forcadas fora da rotina automatica do ERP.
              Envie uma planilha com codigo e AssociadoTitular/vidas_qtde.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={handleExportTemplate} className="rounded-lg border px-3 py-2 text-xs font-semibold">
                Baixar modelo
              </button>
              <label className="cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold">
                Selecionar planilha
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(event) => setManualUploadFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                disabled={!manualUploadFile}
                onClick={() => {
                  if (!manualUploadFile) return;
                  setFile(manualUploadFile);
                  void parseFile();
                }}
                className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                Validar planilha
              </button>
              <button
                type="button"
                disabled={!manualUploadFile || parsing || applying}
                onClick={() => {
                  if (!manualUploadFile) return;
                  setFile(manualUploadFile);
                  void parseFile().then(() => setManualUploadOpen(false));
                }}
                className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                Confirmar atualizacao
              </button>
              <button
                type="button"
                onClick={() => setManualUploadOpen(false)}
                className="rounded-lg border px-3 py-2 text-xs font-semibold"
              >
                Cancelar
              </button>
            </div>
            {manualUploadFile ? <p className="mt-3 text-xs text-ink/60">Arquivo: {manualUploadFile.name}</p> : null}
          </div>
        </div>
      ) : null}

      {null}
    </div>
  );
}


