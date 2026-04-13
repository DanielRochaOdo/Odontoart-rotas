import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { normalizeText } from "../lib/textNormalize";
import {
  CATEGORIA_DESCRIPTIONS,
  CATEGORIA_OPTIONS,
  type CategoriaValue,
} from "../lib/categorias";

type ParsedKpiRow = {
  codigo: string;
  vidasIn: number;
  vidasOut: number;
  categoria: CategoriaValue;
  monthKey: string;
  sourceRow: number;
};

type ParseSummary = {
  rowsInFile: number;
  validRows: number;
  ignoredRows: number;
  uniqueCodes: number;
  unvalidatedCodes: number;
  columns: {
    codigo: string;
    vidasIn: string;
    vidasOut: string;
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

type PersistedColumns = {
  codigo: string;
  vidasIn: string;
  vidasOut: string;
  month: string | null;
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

type LatestValidationMeta = {
  importId: string;
  sourceFilename: string;
  createdAt: string;
};

type PersistedImportRow = {
  import_id: string;
  codigo: string;
  vidas_in: number;
  vidas_out: number;
  categoria: CategoriaValue;
  month_key: string;
  source_row: number | null;
};

type UnvalidatedCode = {
  codigo: string;
  reason: "NAO_CADASTRADO" | "NAO_ATIVO";
};

type DonutSlice = {
  label: string;
  value: number;
  color: string;
};

const LOOKUP_CHUNK_SIZE = 400;
const UPDATE_CHUNK_SIZE = 300;
const IMPORT_SAVE_CHUNK_SIZE = 500;
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

const classifyCategoria = (vidasIn: number, vidasOut: number): CategoriaValue => {
  if (vidasIn === 0 && vidasOut === 0) return "Inativo";
  if (vidasIn === 0 && vidasOut > 0) return "So perda";
  if (vidasIn > 0 && vidasOut === 0) return "So venda";
  if (vidasIn > vidasOut) return "Crescimento";
  if (vidasOut > vidasIn) return "Queda";
  return "Neutro";
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

const unvalidatedReasonLabel: Record<UnvalidatedCode["reason"], string> = {
  NAO_CADASTRADO: "Codigo nao cadastrado",
  NAO_ATIVO: "Situacao de cadastro nao ativa",
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
                  title={`${label} â€¢ ${firstSeries.label}: ${firstSigned} â€¢ ${secondSeries.label}: ${secondSigned}`}
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
  const [missingCodeSamples, setMissingCodeSamples] = useState<string[]>([]);
  const [unvalidatedCodes, setUnvalidatedCodes] = useState<UnvalidatedCode[]>([]);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<KpiImportHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [consultingImportId, setConsultingImportId] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historicalChartRows, setHistoricalChartRows] = useState<ParsedKpiRow[]>([]);
  const [historicalChartLoading, setHistoricalChartLoading] = useState(false);
  const [historicalChartError, setHistoricalChartError] = useState<string | null>(null);
  const [latestValidationRows, setLatestValidationRows] = useState<ParsedKpiRow[]>([]);
  const [latestValidationMeta, setLatestValidationMeta] = useState<LatestValidationMeta | null>(null);
  const [latestValidationLoading, setLatestValidationLoading] = useState(false);
  const [latestValidationError, setLatestValidationError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const fallbackMonthKey = useMemo(() => getCurrentMonthKey(), []);

  const donutSourceRows = useMemo(
    () => (latestValidationRows.length > 0 ? latestValidationRows : parsedRows),
    [latestValidationRows, parsedRows],
  );

  const categoryBreakdown = useMemo(() => {
    const totals = new Map<CategoriaValue, number>();
    CATEGORIA_OPTIONS.forEach((categoria) => totals.set(categoria, 0));
    donutSourceRows.forEach((row) => {
      totals.set(row.categoria, (totals.get(row.categoria) ?? 0) + 1);
    });
    return CATEGORIA_OPTIONS.map((categoria) => ({
      categoria,
      total: totals.get(categoria) ?? 0,
    }));
  }, [donutSourceRows]);

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

  const categoryValidationAnalysis = useMemo(
    () =>
      CATEGORIA_OPTIONS.map((categoria) => {
        const rows = parsedRows.filter((row) => row.categoria === categoria);
        const vidasInTotal = rows.reduce((sum, row) => sum + row.vidasIn, 0);
        const vidasOutTotal = rows.reduce((sum, row) => sum + row.vidasOut, 0);
        return {
          categoria,
          quantidade: rows.length,
          vidasInTotal,
          vidasOutTotal,
          saldo: vidasInTotal - vidasOutTotal,
        };
      }),
    [parsedRows],
  );

  const vidasDonutData = useMemo<DonutSlice[]>(() => {
    const vidasInTotal = donutSourceRows.reduce((sum, row) => sum + row.vidasIn, 0);
    const vidasOutTotal = donutSourceRows.reduce((sum, row) => sum + row.vidasOut, 0);
    return [
      { label: "Vidas In", value: vidasInTotal, color: "#16a34a" },
      { label: "Vidas Out", value: vidasOutTotal, color: "#dc2626" },
    ];
  }, [donutSourceRows]);

  const trendSourceRows = useMemo(
    () => (historicalChartRows.length > 0 ? historicalChartRows : parsedRows),
    [historicalChartRows, parsedRows],
  );

  const monthSeries = useMemo(() => {
    const monthMap = new Map<string, { vidasIn: number; vidasOut: number }>();

    trendSourceRows.forEach((row) => {
      const current = monthMap.get(row.monthKey) ?? {
        vidasIn: 0,
        vidasOut: 0,
      };
      current.vidasIn += row.vidasIn;
      current.vidasOut += row.vidasOut;
      monthMap.set(row.monthKey, current);
    });

    const monthKeys = Array.from(monthMap.keys()).sort((a, b) => a.localeCompare(b));
    const labels = monthKeys.map((monthKey) => formatMonthLabel(monthKey));

    const vidasInValues = monthKeys.map((monthKey) => monthMap.get(monthKey)?.vidasIn ?? 0);
    const vidasOutValues = monthKeys.map((monthKey) => monthMap.get(monthKey)?.vidasOut ?? 0);

    return {
      labels,
      vidasInValues,
      vidasOutValues,
    };
  }, [trendSourceRows]);

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

  const handleExportTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const dataSheet = XLSX.utils.aoa_to_sheet([
      ["codigo", "vidas_in", "vidas_out"],
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

  const loadImportHistory = async () => {
    if (!canAccess) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const { data, error } = await supabase
        .from("kpi_imports")
        .select("id, source_filename, rows_in_file, valid_rows, ignored_rows, unique_codes, unvalidated_codes, status, detected_columns, found_codes, missing_codes, estimated_companies_updated, updated_rows, created_at, applied_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      setHistoryRows((data ?? []) as KpiImportHistoryRow[]);
    } catch (error) {
      setHistoryRows([]);
      setHistoryError(error instanceof Error ? error.message : "Erro ao carregar historico de importacoes.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadHistoricalChartRows = async () => {
    if (!canAccess) return;
    setHistoricalChartLoading(true);
    setHistoricalChartError(null);
    try {
      const { data: importsData, error: importsError } = await supabase
        .from("kpi_imports")
        .select("id, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (importsError) throw new Error(importsError.message);

      const imports = (importsData ?? []) as Array<{ id: string; created_at: string }>;
      if (imports.length === 0) {
        setHistoricalChartRows([]);
        return;
      }

      const importCreatedAtMsById = new Map<string, number>();
      imports.forEach((item) => {
        const ms = new Date(item.created_at).getTime();
        importCreatedAtMsById.set(item.id, Number.isFinite(ms) ? ms : 0);
      });

      const importIds = imports.map((item) => item.id);
      const allRows: PersistedImportRow[] = [];
      for (const batch of chunk(importIds, LOOKUP_CHUNK_SIZE)) {
        const { data: rowsData, error: rowsError } = await supabase
          .from("kpi_import_rows")
          .select("import_id, codigo, vidas_in, vidas_out, categoria, month_key, source_row")
          .in("import_id", batch);
        if (rowsError) throw new Error(rowsError.message);
        allRows.push(...((rowsData ?? []) as PersistedImportRow[]));
      }

      const dedupByMonthAndCode = new Map<
        string,
        { importMs: number; row: ParsedKpiRow }
      >();
      allRows.forEach((item) => {
        const code = normalizeCode(item.codigo);
        const monthKey = String(item.month_key ?? "").trim();
        if (!code || !monthKey) return;
        const importMs = importCreatedAtMsById.get(item.import_id) ?? 0;
        const key = `${monthKey}::${code}`;
        const row: ParsedKpiRow = {
          codigo: code,
          vidasIn: Number(item.vidas_in ?? 0),
          vidasOut: Number(item.vidas_out ?? 0),
          categoria: item.categoria,
          monthKey,
          sourceRow: Number(item.source_row ?? 0) || 0,
        };

        const current = dedupByMonthAndCode.get(key);
        if (!current || importMs >= current.importMs) {
          dedupByMonthAndCode.set(key, { importMs, row });
        }
      });

      setHistoricalChartRows(
        Array.from(dedupByMonthAndCode.values())
          .map((item) => item.row)
          .sort((a, b) => a.monthKey.localeCompare(b.monthKey) || a.codigo.localeCompare(b.codigo)),
      );
    } catch (error) {
      setHistoricalChartRows([]);
      setHistoricalChartError(
        error instanceof Error ? error.message : "Erro ao carregar dados historicos para os graficos.",
      );
    } finally {
      setHistoricalChartLoading(false);
    }
  };

  const loadLatestValidationRows = async () => {
    if (!canAccess) return;
    setLatestValidationLoading(true);
    setLatestValidationError(null);
    try {
      const { data: importData, error: importError } = await supabase
        .from("kpi_imports")
        .select("id, source_filename, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (importError) throw new Error(importError.message);

      if (!importData) {
        setLatestValidationRows([]);
        setLatestValidationMeta(null);
        return;
      }

      const latestImport = importData as {
        id: string;
        source_filename: string | null;
        created_at: string;
      };

      const { data: rowsData, error: rowsError } = await supabase
        .from("kpi_import_rows")
        .select("codigo, vidas_in, vidas_out, categoria, month_key, source_row")
        .eq("import_id", latestImport.id)
        .order("codigo", { ascending: true });
      if (rowsError) throw new Error(rowsError.message);

      const mappedRows: ParsedKpiRow[] = (rowsData ?? []).map((item, index) => {
        const row = item as {
          codigo: string | null;
          vidas_in: number | null;
          vidas_out: number | null;
          categoria: CategoriaValue | null;
          month_key: string | null;
          source_row: number | null;
        };
        const vidasIn = Number(row.vidas_in ?? 0);
        const vidasOut = Number(row.vidas_out ?? 0);
        return {
          codigo: normalizeCode(row.codigo),
          vidasIn: Number.isFinite(vidasIn) ? vidasIn : 0,
          vidasOut: Number.isFinite(vidasOut) ? vidasOut : 0,
          categoria: row.categoria ?? classifyCategoria(vidasIn, vidasOut),
          monthKey: row.month_key ?? fallbackMonthKey,
          sourceRow: row.source_row ?? index + 2,
        };
      });

      setLatestValidationRows(mappedRows);
      setLatestValidationMeta({
        importId: latestImport.id,
        sourceFilename: latestImport.source_filename ?? "-",
        createdAt: latestImport.created_at,
      });
    } catch (error) {
      setLatestValidationRows([]);
      setLatestValidationMeta(null);
      setLatestValidationError(
        error instanceof Error ? error.message : "Erro ao carregar a ultima validacao para os graficos de rosca.",
      );
    } finally {
      setLatestValidationLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([loadImportHistory(), loadHistoricalChartRows(), loadLatestValidationRows()]);
  }, [canAccess]);

  const persistValidatedImport = async ({
    sourceFilename,
    parseSummaryDraft,
    validatedRows,
    unvalidatedRows,
  }: {
    sourceFilename: string;
    parseSummaryDraft: ParseSummary;
    validatedRows: ParsedKpiRow[];
    unvalidatedRows: UnvalidatedCode[];
  }) => {
    const { data: insertedImport, error: insertImportError } = await supabase
      .from("kpi_imports")
      .insert({
        source_filename: sourceFilename,
        rows_in_file: parseSummaryDraft.rowsInFile,
        valid_rows: parseSummaryDraft.validRows,
        ignored_rows: parseSummaryDraft.ignoredRows,
        unique_codes: parseSummaryDraft.uniqueCodes,
        unvalidated_codes: parseSummaryDraft.unvalidatedCodes,
        detected_columns: parseSummaryDraft.columns,
        created_by_name: profile?.display_name ?? profile?.nome ?? null,
      })
      .select("id")
      .single();
    if (insertImportError) throw new Error(insertImportError.message);

    const importId = String((insertedImport as { id: string }).id ?? "").trim();
    if (!importId) throw new Error("Falha ao salvar historico KPI.");

    const importRowsPayload = validatedRows.map((row) => ({
      import_id: importId,
      codigo: row.codigo,
      vidas_in: row.vidasIn,
      vidas_out: row.vidasOut,
      categoria: row.categoria,
      month_key: row.monthKey,
      source_row: row.sourceRow,
    }));
    for (const batch of chunk(importRowsPayload, IMPORT_SAVE_CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      const { error } = await supabase.from("kpi_import_rows").insert(batch);
      if (error) throw new Error(error.message);
    }

    const unvalidatedPayload = unvalidatedRows.map((row) => ({
      import_id: importId,
      codigo: row.codigo,
      reason: row.reason,
    }));
    for (const batch of chunk(unvalidatedPayload, IMPORT_SAVE_CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      const { error } = await supabase.from("kpi_import_unvalidated_codes").insert(batch);
      if (error) throw new Error(error.message);
    }

    return importId;
  };

  const consultImport = async (importRow: KpiImportHistoryRow) => {
    setConsultingImportId(importRow.id);
    setParseError(null);
    setApplyError(null);
    setPdfError(null);
    try {
      const { data: rowsData, error: rowsError } = await supabase
        .from("kpi_import_rows")
        .select("codigo, vidas_in, vidas_out, categoria, month_key, source_row")
        .eq("import_id", importRow.id)
        .order("codigo", { ascending: true });
      if (rowsError) throw new Error(rowsError.message);

      const { data: unvalidatedData, error: unvalidatedError } = await supabase
        .from("kpi_import_unvalidated_codes")
        .select("codigo, reason")
        .eq("import_id", importRow.id)
        .order("codigo", { ascending: true });
      if (unvalidatedError) throw new Error(unvalidatedError.message);

      const restoredRows: ParsedKpiRow[] = (rowsData ?? []).map((item, index) => {
        const row = item as {
          codigo: string | null;
          vidas_in: number | null;
          vidas_out: number | null;
          categoria: CategoriaValue | null;
          month_key: string | null;
          source_row: number | null;
        };
        const vidasIn = Number(row.vidas_in ?? 0);
        const vidasOut = Number(row.vidas_out ?? 0);
        return {
          codigo: normalizeCode(row.codigo),
          vidasIn: Number.isFinite(vidasIn) ? vidasIn : 0,
          vidasOut: Number.isFinite(vidasOut) ? vidasOut : 0,
          categoria: row.categoria ?? classifyCategoria(vidasIn, vidasOut),
          monthKey: row.month_key ?? fallbackMonthKey,
          sourceRow: row.source_row ?? index + 2,
        };
      });

      const restoredUnvalidated: UnvalidatedCode[] = (unvalidatedData ?? []).map((item) => {
        const row = item as { codigo: string | null; reason: "NAO_CADASTRADO" | "NAO_ATIVO" };
        return {
          codigo: normalizeCode(row.codigo),
          reason: row.reason,
        };
      });

      setFile(null);
      setParsedRows(restoredRows);
      setUnvalidatedCodes(restoredUnvalidated);
      setMissingCodeSamples([]);
      setApplySummary(
        importRow.status === "APLICADO"
          ? {
              uniqueCodes: importRow.unique_codes,
              foundCodes: importRow.found_codes ?? 0,
              missingCodes: importRow.missing_codes ?? 0,
              estimatedCompaniesUpdated: importRow.estimated_companies_updated ?? 0,
              updatedRows: importRow.updated_rows ?? 0,
            }
          : null,
      );

      const columns = importRow.detected_columns;
      setParseSummary({
        rowsInFile: importRow.rows_in_file,
        validRows: importRow.valid_rows,
        ignoredRows: importRow.ignored_rows,
        uniqueCodes: importRow.unique_codes,
        unvalidatedCodes: importRow.unvalidated_codes,
        columns: {
          codigo: columns?.codigo ?? "codigo",
          vidasIn: columns?.vidasIn ?? "vidas_in",
          vidasOut: columns?.vidasOut ?? "vidas_out",
          month: columns?.month ?? null,
        },
      });
      setActiveImportId(importRow.id);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Erro ao consultar importacao salva.");
    } finally {
      setConsultingImportId(null);
    }
  };

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
    setMissingCodeSamples([]);
    setUnvalidatedCodes([]);

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
      const vidasInKey = findColumnKey(keys, [
        "vidas_in",
        "vidasin",
        "vidas_entrada",
        "vidas_venda",
        "vendas",
        "venda",
      ]);
      const vidasOutKey = findColumnKey(keys, [
        "vidas_out",
        "vidasout",
        "vidas_saida",
        "vidas_cancelamento",
        "cancelamentos",
        "cancelamento",
      ]);
      const monthKey = findColumnKey(keys, [
        "mes",
        "competencia",
        "referencia",
        "month",
      ]);

      if (!codigoKey) throw new Error("Coluna de codigo nao encontrada. Esperado: codigo/cod.");
      if (!vidasInKey) throw new Error("Coluna de vidas_in nao encontrada. Esperado: vidas_in.");
      if (!vidasOutKey) throw new Error("Coluna de vidas_out nao encontrada. Esperado: vidas_out.");
      if (vidasInKey === vidasOutKey) {
        throw new Error("Colunas de vidas_in e vidas_out conflitaram. Ajuste o cabecalho do arquivo.");
      }

      const invalidRows: number[] = [];
      const validRows: ParsedKpiRow[] = [];
      let ignoredRows = 0;

      rows.forEach((row, index) => {
        const sourceRow = index + 2;
        const codigo = normalizeCode(row[codigoKey]);
        const hasIn = String(row[vidasInKey] ?? "").trim().length > 0;
        const hasOut = String(row[vidasOutKey] ?? "").trim().length > 0;
        const hasAnyValue = Boolean(codigo || hasIn || hasOut);

        if (!hasAnyValue) {
          ignoredRows += 1;
          return;
        }

        const vidasIn = parseNonNegativeNumber(row[vidasInKey]);
        const vidasOut = parseNonNegativeNumber(row[vidasOutKey]);
        const parsedMonth = monthKey ? parseMonthKey(row[monthKey]) : fallbackMonthKey;

        if (!codigo || vidasIn === null || vidasOut === null || !parsedMonth) {
          invalidRows.push(sourceRow);
          return;
        }

        validRows.push({
          codigo,
          vidasIn,
          vidasOut,
          categoria: classifyCategoria(vidasIn, vidasOut),
          monthKey: parsedMonth,
          sourceRow,
        });
      });

      if (invalidRows.length > 0) {
        const sample = invalidRows.slice(0, 10).join(", ");
        throw new Error(`Linhas invalidas: ${invalidRows.length}. Exemplos: ${sample}`);
      }

      if (validRows.length === 0) {
        throw new Error("Nenhuma linha valida encontrada no arquivo.");
      }

      const uniqueCodes = Array.from(new Set(validRows.map((row) => row.codigo)));
      const codeStatus = new Map<string, { hasAny: boolean; hasActive: boolean }>();
      uniqueCodes.forEach((code) => codeStatus.set(code, { hasAny: false, hasActive: false }));
      for (const codeBatch of chunk(uniqueCodes, LOOKUP_CHUNK_SIZE)) {
        const { data, error } = await supabase
          .from("clientes")
          .select("codigo, situacao")
          .in("codigo", codeBatch);
        if (error) throw new Error(error.message);

        (data ?? []).forEach((item) => {
          const codigo = normalizeCode((item as { codigo: string | null }).codigo);
          if (!codigo) return;
          const current = codeStatus.get(codigo) ?? { hasAny: false, hasActive: false };
          current.hasAny = true;
          current.hasActive = current.hasActive || isSituacaoAtiva((item as { situacao: string | null }).situacao);
          codeStatus.set(codigo, current);
        });
      }

      const unvalidatedMap = new Map<string, UnvalidatedCode>();
      uniqueCodes.forEach((code) => {
        const status = codeStatus.get(code) ?? { hasAny: false, hasActive: false };
        if (!status.hasAny) {
          unvalidatedMap.set(code, { codigo: code, reason: "NAO_CADASTRADO" });
          return;
        }
        if (!status.hasActive) {
          unvalidatedMap.set(code, { codigo: code, reason: "NAO_ATIVO" });
        }
      });
      const allowedCodeSet = new Set(
        uniqueCodes.filter((code) => !unvalidatedMap.has(code)),
      );
      const rowsForValidation = validRows.filter((row) => allowedCodeSet.has(row.codigo));

      const byCode = new Map<string, ParsedKpiRow>();
      const conflicts: string[] = [];
      rowsForValidation.forEach((row) => {
        const existing = byCode.get(row.codigo);
        if (!existing) {
          byCode.set(row.codigo, row);
          return;
        }
        if (existing.categoria !== row.categoria) {
          conflicts.push(
            `codigo ${row.codigo}: ${existing.categoria} x ${row.categoria} (linha ${row.sourceRow})`,
          );
        }
      });

      if (conflicts.length > 0) {
        const preview = conflicts.slice(0, 8).join("; ");
        throw new Error(`Conflito de categoria para o mesmo codigo. ${preview}`);
      }

      const normalizedRows = Array.from(byCode.values()).sort((a, b) =>
        a.codigo.localeCompare(b.codigo),
      );
      const unvalidatedSorted = Array.from(unvalidatedMap.values()).sort((a, b) =>
        a.codigo.localeCompare(b.codigo),
      );

      const parseSummaryDraft: ParseSummary = {
        rowsInFile: rows.length,
        validRows: rowsForValidation.length,
        ignoredRows,
        uniqueCodes: normalizedRows.length,
        unvalidatedCodes: unvalidatedSorted.length,
        columns: {
          codigo: codigoKey,
          vidasIn: vidasInKey,
          vidasOut: vidasOutKey,
          month: monthKey,
        },
      };

      const persistedImportId = await persistValidatedImport({
        sourceFilename: file.name,
        parseSummaryDraft,
        validatedRows: normalizedRows,
        unvalidatedRows: unvalidatedSorted,
      });

      setParsedRows(normalizedRows);
      setUnvalidatedCodes(unvalidatedSorted);
      setParseSummary(parseSummaryDraft);
      setActiveImportId(persistedImportId);
      await applyCategoriasForRows(normalizedRows, persistedImportId);
    } catch (error) {
      setParsedRows([]);
      setParseSummary(null);
      setUnvalidatedCodes([]);
      setActiveImportId(null);
      setParseError(error instanceof Error ? error.message : "Erro ao ler arquivo.");
    } finally {
      setParsing(false);
    }
  };

  const applyCategoriasForRows = async (rows: ParsedKpiRow[], importId: string | null) => {
    if (rows.length === 0) return;
    setApplying(true);
    setApplyError(null);
    setPdfError(null);
    setApplySummary(null);
    setMissingCodeSamples([]);

    try {
      const codeToCategoria = new Map(rows.map((row) => [row.codigo, row.categoria] as const));
      const allCodes = Array.from(codeToCategoria.keys());

      const codeCountMap = new Map<string, number>();
      const activeRows: Array<{ id: string; codigo: string }> = [];
      for (const codeBatch of chunk(allCodes, LOOKUP_CHUNK_SIZE)) {
        const { data, error } = await supabase
          .from("clientes")
          .select("id, codigo, situacao")
          .in("codigo", codeBatch);
        if (error) throw new Error(error.message);

        (data ?? []).forEach((item) => {
          const codigo = normalizeCode((item as { codigo: string | null }).codigo);
          if (!codigo) return;
          if (!isSituacaoAtiva((item as { situacao: string | null }).situacao)) return;
          codeCountMap.set(codigo, (codeCountMap.get(codigo) ?? 0) + 1);
          const id = String((item as { id: string }).id ?? "").trim();
          if (id) activeRows.push({ id, codigo });
        });
      }

      const foundCodes = allCodes.filter((code) => codeCountMap.has(code));
      const missingCodes = allCodes.filter((code) => !codeCountMap.has(code));

      const groupedByCategoria = new Map<CategoriaValue, string[]>();
      activeRows.forEach((row) => {
        const categoria = codeToCategoria.get(row.codigo);
        if (!categoria) return;
        const current = groupedByCategoria.get(categoria) ?? [];
        current.push(row.id);
        groupedByCategoria.set(categoria, current);
      });

      let updatedRows = 0;
      for (const [categoria, ids] of groupedByCategoria.entries()) {
        for (const idBatch of chunk(ids, UPDATE_CHUNK_SIZE)) {
          const { error } = await supabase
            .from("clientes")
            .update({ categoria })
            .in("id", idBatch);
          if (error) throw new Error(error.message);
          updatedRows += idBatch.length;
        }
      }

      const estimatedCompaniesUpdated = foundCodes.reduce(
        (sum, code) => sum + (codeCountMap.get(code) ?? 0),
        0,
      );

      setMissingCodeSamples(missingCodes.slice(0, 20));
      const applySummaryDraft: ApplySummary = {
        uniqueCodes: allCodes.length,
        foundCodes: foundCodes.length,
        missingCodes: missingCodes.length,
        estimatedCompaniesUpdated,
        updatedRows,
      };
      setApplySummary(applySummaryDraft);

      if (importId) {
        const { error: updateImportError } = await supabase
          .from("kpi_imports")
          .update({
            status: "APLICADO",
            applied_at: new Date().toISOString(),
            applied_by_user_id: session?.user?.id ?? null,
            found_codes: applySummaryDraft.foundCodes,
            missing_codes: applySummaryDraft.missingCodes,
            estimated_companies_updated: applySummaryDraft.estimatedCompaniesUpdated,
            updated_rows: applySummaryDraft.updatedRows,
          })
          .eq("id", importId);
        if (updateImportError) throw new Error(updateImportError.message);
      }
      await Promise.all([loadImportHistory(), loadHistoricalChartRows(), loadLatestValidationRows()]);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : "Erro ao aplicar categorias.");
    } finally {
      setApplying(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
        Este modulo e restrito a supervisao e assistencia.
      </div>
    );
  }

  return (
    <div id="kpi-export-root" className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">KPI</h2>
          <p className="mt-2 text-sm text-ink/60">
            Upload de arquivo com codigo, vidas_in e vidas_out para atualizar categoria das empresas.
          </p>
        </div>
        <button
          type="button"
          onClick={exportKpiPdf}
          disabled={exportingPdf}
          data-pdf-exclude="true"
          className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60 print:hidden"
        >
          {exportingPdf ? "Gerando PDF..." : "Exportar PDF"}
        </button>
      </header>

      <section className="rounded-2xl border border-sea/20 bg-sand/30 p-4">
        <div data-pdf-exclude="true" className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
            Arquivo
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setParseError(null);
                setApplyError(null);
                setPdfError(null);
                setParseSummary(null);
                setApplySummary(null);
                setParsedRows([]);
                setMissingCodeSamples([]);
                setUnvalidatedCodes([]);
                setActiveImportId(null);
              }}
              className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink outline-none focus:border-sea"
            />
          </label>
          <button
            type="button"
            onClick={parseFile}
            disabled={!file || parsing || applying}
            className="h-10 rounded-lg bg-sea px-4 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
          >
            {parsing || applying ? "Processando..." : "Validar, salvar e aplicar"}
          </button>
          <button
            type="button"
            onClick={handleExportTemplate}
            disabled={parsing || applying}
            className="h-10 rounded-lg border border-sea/30 bg-white/90 px-4 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
          >
            Exportar modelo
          </button>
        </div>

        <div className="mt-3 rounded-xl border border-sea/15 bg-white/80 p-3 text-xs text-ink/70">
          <p className="font-semibold text-ink/80">Regras de classificacao</p>
          <div className="mt-2 grid gap-1 md:grid-cols-2">
            {CATEGORIA_OPTIONS.map((categoria) => (
              <p key={categoria}>
                <span className="font-semibold text-ink">{categoria}:</span>{" "}
                {CATEGORIA_DESCRIPTIONS[categoria]}
              </p>
            ))}
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-sea/15 bg-white/80 px-3 py-2 text-[11px] text-slate-70">
          <span className="font-semibold text-slate-80">Base dos graficos de rosca:</span>{" "}
          ultima validacao salva no KPI.
          {latestValidationMeta
            ? ` ${formatDateTime(latestValidationMeta.createdAt)} - arquivo ${latestValidationMeta.sourceFilename}.`
            : " Nenhuma validacao salva ainda."}
          {latestValidationLoading ? " Atualizando..." : ""}
          {latestValidationError ? ` Erro ao carregar: ${latestValidationError}` : ""}
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <DonutChartCard
            title="Distribuicao por categoria"
            subtitle="Quantidade de codigos por categoria na ultima validacao salva."
            data={categoryDonutData}
            emptyLabel="Ainda nao existe validacao salva para este grafico."
          />
          <DonutChartCard
            title="Comparativo de vidas"
            subtitle="Soma total de vidas_in e vidas_out na ultima validacao salva."
            data={vidasDonutData}
            emptyLabel="Ainda nao existe validacao salva para este grafico."
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-sea/20 bg-white px-3 py-2 text-[11px] text-ink">
            <span className="font-semibold text-ink">Base dos graficos comparativos:</span>{" "}
            dados historicos salvos no modulo KPI (na ausencia de historico, usa dados da validacao atual).
            {historicalChartLoading ? " Atualizando historico..." : ""}
            {historicalChartError ? ` Erro ao carregar historico: ${historicalChartError}` : ""}
          </div>
          <DoubleBarChartCard
            title="Historico mes a mes"
            subtitle="Evolucao mensal de vidas_in e vidas_out com base no historico registrado."
            labels={monthSeries.labels}
            firstSeries={{ label: "Vidas In", color: "#16a34a", values: monthSeries.vidasInValues }}
            secondSeries={{ label: "Vidas Out", color: "#dc2626", values: monthSeries.vidasOutValues }}
            emptyLabel="Valide um arquivo para visualizar este grafico."
          />
          <DoubleBarChartCard
            title="Tendencia de crescimento/queda de vidas"
            subtitle="Variacao mensal de vidas_in e vidas_out. Valores positivos indicam crescimento e negativos indicam queda."
            labels={vidasGrowthSeries.labels}
            firstSeries={{ label: "Variacao Vidas In", color: "#16a34a", values: vidasGrowthSeries.vidasInGrowth }}
            secondSeries={{ label: "Variacao Vidas Out", color: "#dc2626", values: vidasGrowthSeries.vidasOutGrowth }}
            signedValues
            emptyLabel="Sao necessarios pelo menos dois meses para calcular tendencia."
          />
        </div>

        {parseError && <p className="mt-3 text-xs text-red-500">{parseError}</p>}
        {applyError && <p className="mt-3 text-xs text-red-500">{applyError}</p>}
        {pdfError && <p className="mt-3 text-xs text-red-500">{pdfError}</p>}
      </section>

      {parseSummary && (
        <section className="rounded-2xl border border-sea/20 bg-white/90 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg text-ink">Resumo da validacao</h3>
              <p className="mt-1 text-xs text-ink/60">
                Colunas: codigo="{parseSummary.columns.codigo}" | vidas_in="
                {parseSummary.columns.vidasIn}" | vidas_out="{parseSummary.columns.vidasOut}" | mes="
                {parseSummary.columns.month ?? "nao informado (usa mes atual)"}"
              </p>
              {activeImportId && (
                <p className="mt-1 text-[11px] text-ink/55">
                  Importacao salva no historico (ID: {activeImportId}).
                </p>
              )}
              <p className="mt-1 text-[11px] text-ink/55">
                Aplicacao de categorias: automatica apos a validacao.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-5">
            <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2 text-xs text-ink/70">
              Linhas no arquivo: <span className="font-semibold text-ink">{parseSummary.rowsInFile}</span>
            </div>
            <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2 text-xs text-ink/70">
              Linhas validas: <span className="font-semibold text-ink">{parseSummary.validRows}</span>
            </div>
            <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2 text-xs text-ink/70">
              Linhas ignoradas: <span className="font-semibold text-ink">{parseSummary.ignoredRows}</span>
            </div>
            <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2 text-xs text-ink/70">
              Codigos unicos: <span className="font-semibold text-ink">{parseSummary.uniqueCodes}</span>
            </div>
            <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2 text-xs text-ink/70">
              Codigos nao validados: <span className="font-semibold text-ink">{parseSummary.unvalidatedCodes}</span>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {categoryBreakdown.map((item) => (
              <div
                key={item.categoria}
                className="rounded-xl border border-sea/15 bg-white px-3 py-2 text-xs text-ink/70"
              >
                {item.categoria}: <span className="font-semibold text-ink">{item.total}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-sea/15 bg-sand/20 p-3">
            <p className="text-xs font-semibold text-ink/70">Analise por categoria</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs text-ink/70">
                <thead>
                  <tr className="border-b border-sea/20">
                    <th className="px-2 py-1">Categoria</th>
                    <th className="px-2 py-1 text-right">Qtd. codigos</th>
                    <th className="px-2 py-1 text-right">Vidas In</th>
                    <th className="px-2 py-1 text-right">Vidas Out</th>
                    <th className="px-2 py-1 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryValidationAnalysis.map((row) => (
                    <tr key={`analysis-${row.categoria}`} className="border-b border-sea/10">
                      <td className="px-2 py-1">{row.categoria}</td>
                      <td className="px-2 py-1 text-right">{row.quantidade}</td>
                      <td className="px-2 py-1 text-right">{row.vidasInTotal}</td>
                      <td className="px-2 py-1 text-right">{row.vidasOutTotal}</td>
                      <td
                        className={`px-2 py-1 text-right font-semibold ${
                          row.saldo >= 0 ? "text-emerald-700" : "text-red-600"
                        }`}
                      >
                        {row.saldo}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-sea/20 bg-white/70 font-semibold text-ink">
                    <td className="px-2 py-1">Total</td>
                    <td className="px-2 py-1 text-right">
                      {categoryValidationAnalysis.reduce((sum, row) => sum + row.quantidade, 0)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {categoryValidationAnalysis.reduce((sum, row) => sum + row.vidasInTotal, 0)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {categoryValidationAnalysis.reduce((sum, row) => sum + row.vidasOutTotal, 0)}
                    </td>
                    <td
                      className={`px-2 py-1 text-right ${
                        categoryValidationAnalysis.reduce((sum, row) => sum + row.saldo, 0) >= 0
                          ? "text-emerald-700"
                          : "text-red-600"
                      }`}
                    >
                      {categoryValidationAnalysis.reduce((sum, row) => sum + row.saldo, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </section>
      )}

      {applySummary && (
        <section className="rounded-2xl border border-sea/20 bg-white/90 p-4">
          <h3 className="font-display text-lg text-ink">Resultado da aplicacao</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-5">
            <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2 text-xs text-ink/70">
              Codigos no arquivo: <span className="font-semibold text-ink">{applySummary.uniqueCodes}</span>
            </div>
            <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2 text-xs text-ink/70">
              Codigos encontrados: <span className="font-semibold text-ink">{applySummary.foundCodes}</span>
            </div>
            <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2 text-xs text-ink/70">
              Codigos sem match: <span className="font-semibold text-ink">{applySummary.missingCodes}</span>
            </div>
            <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2 text-xs text-ink/70">
              Empresas atualizadas (estimado):{" "}
              <span className="font-semibold text-ink">{applySummary.estimatedCompaniesUpdated}</span>
            </div>
            <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2 text-xs text-ink/70">
              Linhas ativas atualizadas:{" "}
              <span className="font-semibold text-ink">{applySummary.updatedRows}</span>
            </div>
          </div>

          {missingCodeSamples.length > 0 && (
            <p className="mt-3 text-xs text-amber-700">
              Exemplos de codigos sem correspondencia: {missingCodeSamples.join(", ")}
            </p>
          )}
        </section>
      )}

      <section data-pdf-exclude="true" className="rounded-2xl border border-sea/20 bg-white/90 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setHistoryExpanded((prev) => !prev)}
            className="flex items-center gap-2 rounded-lg border border-sea/25 bg-sand/20 px-3 py-2 text-left hover:border-sea/45"
          >
            <span className="text-[11px] text-ink/70">{historyExpanded ? "▲" : "▼"}</span>
            <div>
              <h3 className="font-display text-lg text-ink">Historico de importacoes</h3>
              <p className="mt-1 text-xs text-ink/60">
                Os dados validados ficam salvos para consulta posterior.
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              void Promise.all([loadImportHistory(), loadHistoricalChartRows(), loadLatestValidationRows()]);
            }}
            disabled={historyLoading}
            className="rounded-lg border border-sea/30 bg-white px-3 py-1.5 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
          >
            {historyLoading ? "Atualizando..." : "Atualizar historico"}
          </button>
        </div>

        {historyExpanded && (
          <>
            {historyError && <p className="mt-3 text-xs text-red-500">{historyError}</p>}
            {historyLoading && historyRows.length === 0 ? (
              <p className="mt-3 text-xs text-ink/60">Carregando historico...</p>
            ) : historyRows.length === 0 ? (
              <p className="mt-3 text-xs text-ink/60">Nenhuma importacao salva.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs text-ink/70">
                  <thead>
                    <tr className="border-b border-sea/20">
                      <th className="px-2 py-1">Data</th>
                      <th className="px-2 py-1">Arquivo</th>
                      <th className="px-2 py-1">Status</th>
                      <th className="px-2 py-1">Validos</th>
                      <th className="px-2 py-1">Nao validados</th>
                      <th className="px-2 py-1">Acao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((row) => (
                      <tr
                        key={row.id}
                        className={`border-b border-sea/10 ${activeImportId === row.id ? "bg-sea/5" : ""}`}
                      >
                        <td className="px-2 py-1">{formatDateTime(row.created_at)}</td>
                        <td className="px-2 py-1">{row.source_filename}</td>
                        <td className="px-2 py-1">
                          {row.status === "APLICADO" ? "Aplicado" : "Validado"}
                        </td>
                        <td className="px-2 py-1">{row.valid_rows}</td>
                        <td className="px-2 py-1">{row.unvalidated_codes}</td>
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            onClick={() => {
                              void consultImport(row);
                            }}
                            disabled={Boolean(consultingImportId)}
                            className="rounded-md border border-sea/30 px-2 py-1 text-[11px] font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
                          >
                            {consultingImportId === row.id ? "Carregando..." : "Consultar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="rounded-2xl border border-sea/20 bg-white/90 p-4">
        <h3 className="font-display text-lg text-ink">Codigos nao validados</h3>
        <p className="mt-1 text-xs text-ink/60">
          Esta lista inclui codigos nao cadastrados ou com situacao de cadastro nao ativa.
        </p>

        {unvalidatedCodes.length === 0 ? (
          <p className="mt-3 text-xs text-ink/60">Nenhum codigo nao validado.</p>
        ) : (
          <div className="mt-3 max-h-[280px] overflow-y-auto rounded-xl border border-sea/15 bg-sand/20 p-2">
            <table className="w-full text-left text-xs text-ink/70">
              <thead>
                <tr className="border-b border-sea/20">
                  <th className="px-2 py-1">Codigo</th>
                  <th className="px-2 py-1">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {unvalidatedCodes.map((item) => (
                  <tr key={`unvalidated-${item.codigo}`} className="border-b border-sea/10">
                    <td className="px-2 py-1">{item.codigo}</td>
                    <td className="px-2 py-1">{unvalidatedReasonLabel[item.reason]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
