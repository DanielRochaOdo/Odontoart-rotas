import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  ChevronDown,
  ChevronUp,
  DollarSign,
  LoaderCircle,
  Map as MapIcon,
  MapPin,
  SquareCenterlineDashedHorizontal,
  X,
} from "lucide-react";
import {
  flexRender,
  type ColumnDef,
  type SortingState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  fetchAgenda,
  fetchAgendaForGeneration,
  fetchAgendaScheduledVisits,
  fetchAgendaVisitVendors,
  fetchDistinctOptions,
  fetchSupervisores,
  fetchVendedores,
  type AgendaScheduledVisit,
  type AgendaVisitVendor,
} from "../lib/agendaApi";
import type { AgendaRow } from "../types/agenda";
import { useAgendaFilters } from "../hooks/useAgendaFilters";
import MultiSelectFilter from "../components/agenda/MultiSelectFilter";
import CategoriaLegendPopover from "../components/agenda/CategoriaLegendPopover";
import AgendaDrawer from "../components/agenda/AgendaDrawer";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { onProfilesUpdated } from "../lib/profileEvents";
import {
  clearRoutesModuleDraft,
  readRoutesModuleDraft,
  writeRoutesModuleDraft,
} from "../lib/routesModuleDraft";
import {
  PERFIL_VISITA_PRESETS,
  extractCustomTimes,
  getSingleTimePerfilBase,
  getSingleTimePerfilValue,
  isPresetPerfilVisita,
  normalizePerfilVisita,
} from "../lib/perfilVisita";
import { normalizeSearchText, normalizeText } from "../lib/textNormalize";
import { CATEGORIA_OPTIONS } from "../lib/categorias";
import {
  extractOdontoartPlanoValores,
  fetchEmpresaByEmpresaId,
  type OdontoartPlanoValor,
} from "../lib/odontoartEmpresaApi";

const FILTER_SOURCES: Record<string, string[]> = {
  supervisor: ["supervisor"],
  vendedor: ["vendedor"],
  cod_1: ["cod_1"],
  bairro: ["bairro"],
  cidade: ["cidade"],
  uf: ["uf"],
  grupo: ["grupo"],
  perfil_visita: ["perfil_visita"],
  empresa_nome: ["empresa"],
  situacao: ["situacao"],
  categoria: ["categoria"],
};

const FILTER_LABELS: Record<string, string> = {
  supervisor: "Supervisor",
  vendedor: "Vendedor",
  cod_1: "Codigo",
  bairro: "Bairro",
  cidade: "Cidade",
  uf: "UF",
  grupo: "Grupo",
  perfil_visita: "Perfil Visita",
  empresa_nome: "Empresa",
  situacao: "Situacao",
  categoria: "Categoria",
};

const SITUACAO_FILTER_OPTIONS = ["Ativo", "Suspenso/Inadimplente", "Cancelado"];
const COLUMN_CHIP_MODAL_PAGE_SIZE = 25;

const parseDateValue = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00`);
  }
  return new Date(value);
};

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR").format(date);
};

const formatPerfilVisitaDisplay = (value: string | null) => {
  if (!value) return "-";
  const parts = value
    .replace(/â€¢/g, "•")
    .split(/[,\u2022]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0) return "-";

  const formatted = parts.map((item) => {
    const base = getSingleTimePerfilBase(item);
    if (!base) return item;
    const time = getSingleTimePerfilValue(item);
    return time ? `${base} - ${time}` : base;
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

const formatVisitBadge = (value: string | null) => {
  if (!value) return "-";
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return value;
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  }).format(date);
  return formatted.replace(".", "").toUpperCase();
};

const formatCurrency = (value: number | null) => {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
};

const normalizeNumberInput = (value: string) => value.replace(/\D/g, "");

const toSortableTimestamp = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = parseDateValue(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime();
};

const compareNullableTimestamps = (
  left: number | null,
  right: number | null,
  descending: boolean,
) => {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return descending ? right - left : left - right;
};

const MONTH_OPTIONS = [
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Marco" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

type ScheduleDraft = {
  id?: string;
  vendorId: string;
  vendorName: string;
  date: string;
  perfil: string;
  customTimes?: string[];
  perfilCustom?: boolean;
  perfilSingleTimeBase?: string;
  perfilSingleTimeValue?: string;
  routeId?: string | null;
};

type PendingAgendaModalState = {
  schedule: {
    open: boolean;
    rowId: string | null;
    drafts: ScheduleDraft[];
  } | null;
};

type ImpactedCompanyPreview = {
  id: string;
  companyName: string;
  code: string;
  city: string;
  neighborhood: string;
  filterValue: string;
};

type ColumnChipRemovalModalState = {
  filterKey: string;
  filterLabel: string;
  triggerValue: string;
  options: string[];
  selectedValues: string[];
  selectedCompanyIds: string[];
  hasManualCompanySelection: boolean;
};

type PlanoValoresModalState = {
  codigo: string;
  empresa: string | null;
  valores: OdontoartPlanoValor[];
  loading: boolean;
  error: string | null;
};

type VendorHistoryModalState = {
  empresa: string;
  codigo: string;
  assignments: Array<{ name: string; visitDate: string | null }>;
};

const hasPlanoValores = (planos: OdontoartPlanoValor[]) =>
  planos.some((plano) => plano.valorTitular !== null || plano.valorDependente !== null);

const normalizeFilterMatchValue = (value: string | null | undefined) =>
  normalizeText(value, { letterCase: "upper" });

const getCategoriaBadgeStyles = (value: string | null | undefined) => {
  const normalized = normalizeText(value, { letterCase: "upper" });
  const baseClassName =
    "inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.02em]";
  if (!normalized) {
    return {
      label: "-",
      className: `${baseClassName} bg-slate-700 text-slate-100`,
    };
  }
  if (normalized === "INATIVO") {
    return {
      label: value?.trim() || "Inativo",
      className: `${baseClassName} bg-[#f2f2f2] text-black`,
    };
  }
  if (normalized === "SO PERDA") {
    return {
      label: value?.trim() || "So perda",
      className: `${baseClassName} bg-[#8b0000] text-[#ff8c8c]`,
    };
  }
  if (normalized === "CRESCIMENTO") {
    return {
      label: value?.trim() || "Crescimento",
      className: `${baseClassName} bg-[#1f5f1f] text-[#8fff8f]`,
    };
  }
  if (normalized === "QUEDA") {
    return {
      label: value?.trim() || "Queda",
      className: `${baseClassName} bg-[#6b5a00] text-[#ffe45c]`,
    };
  }
  if (normalized === "SO VENDA") {
    return {
      label: value?.trim() || "So venda",
      className: `${baseClassName} bg-[#004e7a] text-[#7de2ff]`,
    };
  }
  if (normalized === "NEUTRO") {
    return {
      label: value?.trim() || "Neutro",
      className: `${baseClassName} bg-[#006a78] text-[#85f7ff]`,
    };
  }
  return {
    label: value?.trim() || "-",
    className: `${baseClassName} bg-slate-700 text-slate-100`,
  };
};

const getAgendaFilterValueFromRow = (row: AgendaRow, filterKey: string) => {
  const map: Record<string, string | null | undefined> = {
    supervisor: row.supervisor,
    vendedor: row.vendedor,
    cod_1: row.cod_1,
    bairro: row.bairro,
    cidade: row.cidade,
    uf: row.uf,
    grupo: row.grupo,
    perfil_visita: row.perfil_visita,
    empresa_nome: row.empresa ?? row.nome_fantasia,
    categoria: row.categoria,
  };
  return map[filterKey] ?? "";
};

const sameStringArray = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

type AgendaPageCacheEntry = {
  requestKey: string;
  data: AgendaRow[];
  count: number;
  cachedAt: number;
};

const AGENDA_PAGE_CACHE_STORAGE_KEY = "agendaPageCacheV2";
let agendaPageMemoryCache: AgendaPageCacheEntry | null = null;

const readAgendaPageCache = (requestKey: string): AgendaPageCacheEntry | null => {
  if (agendaPageMemoryCache?.requestKey === requestKey) {
    return agendaPageMemoryCache;
  }
  try {
    const raw = sessionStorage.getItem(AGENDA_PAGE_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgendaPageCacheEntry>;
    if (
      parsed.requestKey !== requestKey ||
      !Array.isArray(parsed.data) ||
      typeof parsed.count !== "number"
    ) {
      return null;
    }
    const entry: AgendaPageCacheEntry = {
      requestKey,
      data: parsed.data as AgendaRow[],
      count: parsed.count,
      cachedAt: typeof parsed.cachedAt === "number" ? parsed.cachedAt : Date.now(),
    };
    agendaPageMemoryCache = entry;
    return entry;
  } catch {
    return null;
  }
};

const writeAgendaPageCache = (entry: AgendaPageCacheEntry) => {
  agendaPageMemoryCache = entry;
  try {
    sessionStorage.setItem(AGENDA_PAGE_CACHE_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // ignore storage failures
  }
};

export default function Agenda() {
  const { role, session } = useAuth();
  const canAccess = role === "SUPERVISOR" || role === "ASSISTENTE";
  const { filters, setFilters, clearFilters } = useAgendaFilters("routesTableFiltersV2");
  const [companyNameQuery, setCompanyNameQuery] = useState("");
  const [companyCodeQuery, setCompanyCodeQuery] = useState("");
  const [data, setData] = useState<AgendaRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [selectedRow, setSelectedRow] = useState<AgendaRow | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedAgendaIds, setSelectedAgendaIds] = useState<string[]>([]);
  const [scheduledVisitsByAgenda, setScheduledVisitsByAgenda] = useState<
    Record<string, AgendaScheduledVisit[]>
  >({});
  const [visitVendorsByAgenda, setVisitVendorsByAgenda] = useState<
    Record<string, AgendaVisitVendor[]>
  >({});
  const [scheduleModalRow, setScheduleModalRow] = useState<AgendaRow | null>(null);
  const [scheduleDrafts, setScheduleDrafts] = useState<ScheduleDraft[]>([]);
  const [scheduleOriginal, setScheduleOriginal] = useState<AgendaScheduledVisit[]>([]);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [vendedores, setVendedores] = useState<
    { user_id: string; display_name: string | null; role: string; supervisor_id?: string | null }[]
  >([]);
  const [supervisores, setSupervisores] = useState<
    { id?: string; user_id: string; display_name: string | null; role: string }[]
  >([]);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [vendorQuery, setVendorQuery] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [detailsModalRow, setDetailsModalRow] = useState<AgendaRow | null>(null);
  const [detailsObsExpanded, setDetailsObsExpanded] = useState(false);
  const [detailsInstructionDraft, setDetailsInstructionDraft] = useState("");
  const [detailsInstructionSaving, setDetailsInstructionSaving] = useState(false);
  const [detailsInstructionMessage, setDetailsInstructionMessage] = useState<string | null>(null);
  const [planoValoresModal, setPlanoValoresModal] = useState<PlanoValoresModalState | null>(null);
  const [vendorHistoryModal, setVendorHistoryModal] = useState<VendorHistoryModalState | null>(null);
  const [excludedAgendaIds, setExcludedAgendaIds] = useState<string[]>([]);
  const [columnChipRemovalModal, setColumnChipRemovalModal] = useState<ColumnChipRemovalModalState | null>(null);
  const [columnChipRemovalPageIndex, setColumnChipRemovalPageIndex] = useState(0);
  const detailsObsRequestRef = useRef(0);
  const restoredViewRef = useRef(false);
  const restoredModalRef = useRef(false);
  const restoredRoutesDraftRef = useRef(false);
  const pendingModalRestoreRef = useRef<PendingAgendaModalState | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (restoredViewRef.current) return;
    try {
      const raw = sessionStorage.getItem("agendaViewState");
      if (!raw) {
        restoredViewRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as Partial<{
        pageIndex: number;
        pageSize: number;
        sorting: SortingState;
        selectedRowId: string | null;
      }>;
      if (typeof parsed.pageIndex === "number") setPageIndex(parsed.pageIndex);
      if (typeof parsed.pageSize === "number") setPageSize(parsed.pageSize);
      if (Array.isArray(parsed.sorting)) setSorting(parsed.sorting);
      if (typeof parsed.selectedRowId === "string") setSelectedRowId(parsed.selectedRowId);
      restoredViewRef.current = true;
    } catch {
      restoredViewRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!restoredViewRef.current) return;
    const payload = {
      pageIndex,
      pageSize,
      sorting,
      selectedRowId,
    };
    try {
      sessionStorage.setItem("agendaViewState", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [pageIndex, pageSize, selectedRowId, sorting]);

  useEffect(() => {
    if (restoredModalRef.current) return;
    try {
      const raw = sessionStorage.getItem("agendaModalState");
      if (!raw) {
        restoredModalRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as Partial<{
        generate: {
          open: boolean;
          selectedVendorIds: string[];
          vendorQuery: string;
          visitDate: string;
        };
        schedule: {
          open: boolean;
          rowId: string | null;
          drafts: ScheduleDraft[];
        };
      }>;

      if (parsed.generate?.open) {
        setShowGenerateModal(true);
        setSelectedVendorIds(parsed.generate.selectedVendorIds ?? []);
        setVendorQuery(parsed.generate.vendorQuery ?? "");
        setVisitDate(parsed.generate.visitDate ?? "");
      }

      pendingModalRestoreRef.current = {
        schedule: parsed.schedule
          ? {
              open: Boolean(parsed.schedule.open),
              rowId: parsed.schedule.rowId ?? null,
              drafts: Array.isArray(parsed.schedule.drafts) ? parsed.schedule.drafts : [],
            }
          : null,
      };
      restoredModalRef.current = true;
    } catch {
      restoredModalRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!restoredModalRef.current) return;
    const pending = pendingModalRestoreRef.current;
    if (!pending?.schedule?.open || !pending.schedule.rowId) return;
    if (scheduleModalRow) {
      pendingModalRestoreRef.current = null;
      return;
    }
    const row = data.find((item) => item.id === pending.schedule?.rowId);
    if (!row) return;
    const visits = scheduledVisitsByAgenda[row.id] ?? [];
    setScheduleModalRow(row);
    if (pending.schedule.drafts.length > 0) {
      setScheduleDrafts(pending.schedule.drafts);
	    } else {
	      const drafts = visits.map((visit) => {
        const basePerfil = visit.perfil_visita ?? row.perfil_visita ?? "";
        const singleTimeBase = getSingleTimePerfilBase(basePerfil);
        const isCustom = Boolean(basePerfil && !isPresetPerfilVisita(basePerfil) && !singleTimeBase);
        return {
          id: visit.id,
          vendorId: visit.assigned_to_user_id ?? "",
          vendorName: visit.assigned_to_name ?? "",
          date: visit.visit_date,
          perfil: basePerfil,
          customTimes: isCustom
            ? (() => {
                const times = extractCustomTimes(basePerfil);
                return times.length ? times : [""];
              })()
            : [],
          perfilCustom: isCustom,
          perfilSingleTimeBase: singleTimeBase ?? "",
          perfilSingleTimeValue: getSingleTimePerfilValue(basePerfil),
          routeId: visit.route_id ?? null,
        };
      });
      setScheduleDrafts(drafts);
    }
    setScheduleOriginal(visits);
    setScheduleError(null);
    pendingModalRestoreRef.current = null;
  }, [data, scheduleModalRow, scheduledVisitsByAgenda]);

  useEffect(() => {
    if (!restoredModalRef.current) return;
    const payload = {
      generate: {
        open: showGenerateModal,
        selectedVendorIds,
        vendorQuery,
        visitDate,
      },
      schedule: {
        open: Boolean(scheduleModalRow),
        rowId: scheduleModalRow?.id ?? null,
        drafts: scheduleDrafts,
      },
    };
    try {
      sessionStorage.setItem("agendaModalState", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [
    scheduleDrafts,
    scheduleModalRow,
    selectedVendorIds,
    showGenerateModal,
    vendorQuery,
    visitDate,
  ]);

  const canGenerate = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canEdit = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canManageInstruction = role === "SUPERVISOR";

  useEffect(() => {
    if (restoredRoutesDraftRef.current) return;
    restoredRoutesDraftRef.current = true;
    const draft = readRoutesModuleDraft();
    if (typeof draft.companyNameQuery === "string") {
      setCompanyNameQuery(draft.companyNameQuery);
    }
    if (typeof draft.companyCodeQuery === "string") {
      setCompanyCodeQuery(draft.companyCodeQuery);
    }
    if (Array.isArray(draft.selectedAgendaIds)) {
      setSelectedAgendaIds(Array.from(new Set(draft.selectedAgendaIds.filter(Boolean))));
    }
  }, []);

  useEffect(() => {
    const situacoes = filters.columns.situacao ?? [];
    if (situacoes.length !== 1) return;
    if (normalizeText(situacoes[0], { letterCase: "upper" }) !== "ATIVO") return;
    setFilters((prev) => ({
      ...prev,
      columns: {
        ...prev.columns,
        situacao: [],
      },
    }));
  }, [filters.columns.situacao, setFilters]);

  useEffect(() => {
    if (!filters.global) return;
    setFilters((prev) => (prev.global ? { ...prev, global: "" } : prev));
  }, [filters.global, setFilters]);

  const vendorOptions = useMemo(
    () =>
      vendedores
        .map((vendor) => ({
          value: vendor.display_name ?? vendor.user_id,
          label: vendor.display_name ?? vendor.user_id,
        }))
        .filter((option) => option.value),
    [vendedores],
  );

  const vendorById = useMemo(
    () =>
      new Map<string, string>(
        vendedores.map((vendor) => [vendor.user_id, vendor.display_name ?? vendor.user_id] as const),
      ),
    [vendedores],
  );
  const supervisorByProfileId = useMemo(
    () =>
      new Map<string, string>(
        supervisores
          .map((supervisor) => [supervisor.id ?? "", supervisor.display_name ?? ""] as const)
          .filter(([id, name]) => Boolean(id && name)),
      ),
    [supervisores],
  );
  const supervisorByUserId = useMemo(
    () =>
      new Map<string, string>(
        supervisores
          .map((supervisor) => [supervisor.user_id ?? "", supervisor.display_name ?? ""] as const)
          .filter(([id, name]) => Boolean(id && name)),
      ),
    [supervisores],
  );
  const supervisorNameByVendorId = useMemo(
    () =>
      new Map<string, string>(
        vendedores.map((vendor) => {
          const mappedName =
            (vendor.supervisor_id ? supervisorByProfileId.get(vendor.supervisor_id) : "") ||
            (vendor.supervisor_id ? supervisorByUserId.get(vendor.supervisor_id) : "") ||
            "";
          return [vendor.user_id, mappedName] as const;
        }),
      ),
    [supervisorByProfileId, supervisorByUserId, vendedores],
  );

  const resolveVendorsForAgenda = (agendaId: string, fallback?: string | null) => {
    const visits = visitVendorsByAgenda[agendaId] ?? scheduledVisitsByAgenda[agendaId] ?? [];
    const fallbackAssignments = Array.from(
      new Set(
        (fallback ?? "")
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    )
      .slice(0, 2)
      .map((name) => ({ name, visitDate: null as string | null, userId: null as string | null }));

    if (!visits.length) return fallbackAssignments;

    const sortedVisits = [...visits].sort((left, right) => {
      const leftVisitDate = toSortableTimestamp(left.visit_date);
      const rightVisitDate = toSortableTimestamp(right.visit_date);
      if (leftVisitDate === null && rightVisitDate !== null) return 1;
      if (leftVisitDate !== null && rightVisitDate === null) return -1;
      if (leftVisitDate !== null && rightVisitDate !== null && leftVisitDate !== rightVisitDate) {
        return rightVisitDate - leftVisitDate;
      }

      const leftCompletedAt = toSortableTimestamp(left.completed_at);
      const rightCompletedAt = toSortableTimestamp(right.completed_at);
      if (leftCompletedAt === null && rightCompletedAt !== null) return 1;
      if (leftCompletedAt !== null && rightCompletedAt === null) return -1;
      if (leftCompletedAt !== null && rightCompletedAt !== null && leftCompletedAt !== rightCompletedAt) {
        return rightCompletedAt - leftCompletedAt;
      }
      return 0;
    });

    const picked: Array<{ name: string; visitDate: string | null; userId: string | null }> = [];
    const seen = new Set<string>();
    for (const visit of sortedVisits) {
      const vendorName =
        visit.assigned_to_name ??
        (visit.assigned_to_user_id ? vendorById.get(visit.assigned_to_user_id) : null) ??
        "";
      const normalizedName = vendorName.trim();
      if (!normalizedName || seen.has(normalizedName)) continue;
      seen.add(normalizedName);
      picked.push({
        name: normalizedName,
        visitDate: visit.visit_date ?? null,
        userId: visit.assigned_to_user_id ?? null,
      });
      if (picked.length >= 2) break;
    }

    return picked.length ? picked : fallbackAssignments;
  };

  const resolveLastCompletedVidas = (agendaId: string, fallback?: number | null) => {
    const visits = visitVendorsByAgenda[agendaId] ?? [];
    const latestCompleted = visits.find((visit) => Boolean(visit.completed_at));
    if (latestCompleted) {
      if (
        latestCompleted.completed_vidas !== null &&
        latestCompleted.completed_vidas !== undefined
      ) {
        return String(latestCompleted.completed_vidas);
      }
      return "-";
    }
    if (fallback !== null && fallback !== undefined) return String(fallback);
    return "-";
  };

  const resolveLastCompletedVisitDate = (agendaId: string, fallback?: string | null) => {
    const visits = visitVendorsByAgenda[agendaId] ?? [];
    const latestCompleted = visits.find((visit) => Boolean(visit.completed_at));
    if (latestCompleted) {
      const noVisitReason = latestCompleted.no_visit_reason?.trim();
      if (noVisitReason) return noVisitReason;
      if (latestCompleted.visit_date) return formatDate(latestCompleted.visit_date);
    }
    return formatDate(fallback ?? null);
  };

  const resolveScheduledObsVisit = (agendaId: string, rowInstructions?: string | null) => {
    const visits = scheduledVisitsByAgenda[agendaId] ?? [];
    if (visits.length === 0) return null;

    const latestVisit = visits.reduce<AgendaScheduledVisit | null>((latest, visit) => {
      if (!latest) return visit;
      const latestTimestamp = toSortableTimestamp(latest.visit_date);
      const visitTimestamp = toSortableTimestamp(visit.visit_date);
      if (visitTimestamp === null) return latest;
      if (latestTimestamp === null || visitTimestamp > latestTimestamp) return visit;
      return latest;
    }, null);

    const instructions =
      rowInstructions?.trim() ||
      latestVisit?.instructions?.trim() ||
      visits.find((visit) => visit.instructions?.trim())?.instructions?.trim() ||
      "";

    return {
      visitDate: latestVisit?.visit_date ?? null,
      instructions,
    };
  };

  useEffect(() => {
    setPageIndex(0);
  }, [companyCodeQuery, companyNameQuery, filters, sorting]);

  useEffect(() => {
    if (!restoredRoutesDraftRef.current) return;
    writeRoutesModuleDraft({
      selectedAgendaIds,
      companyNameQuery,
      companyCodeQuery,
    });
  }, [companyCodeQuery, companyNameQuery, selectedAgendaIds]);

  useEffect(() => {
    if (!canAccess) return;
    let active = true;

    const loadOptions = async () => {
      const entries: Array<readonly [string, string[]]> = [];
      for (const [key, sources] of Object.entries(FILTER_SOURCES)) {
        if (!active) return;
        try {
          const options = await fetchDistinctOptions(key, sources);
          entries.push([key, options] as const);
        } catch (error) {
          console.error(`Falha ao carregar opcoes do filtro "${key}".`, error);
          entries.push([key, []] as const);
        }
      }
      if (!active) return;
      const nextOptions: Record<string, string[]> = Object.fromEntries(entries);
      setFilterOptions(nextOptions);
    };

    loadOptions().catch((err) => {
      console.error(err);
    });
    return () => {
      active = false;
    };
  }, [canAccess]);

  useEffect(() => {
    if (!canGenerate) return;
    let active = true;
    const loadVendedores = () => {
      fetchVendedores()
        .then((data) => {
          if (active) setVendedores(data);
        })
        .catch((err) => {
          console.error(err);
        });
    };
    const loadSupervisores = () => {
      fetchSupervisores()
        .then((data) => {
          if (active) setSupervisores(data);
        })
        .catch((err) => {
          console.error(err);
        });
    };
    loadVendedores();
    loadSupervisores();
    const unsubscribe = onProfilesUpdated(() => {
      loadVendedores();
      loadSupervisores();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [canGenerate]);

  useEffect(() => {
    let active = true;
    const requestKey = JSON.stringify({
      pageIndex,
      pageSize,
      sorting,
      filters,
      companyNameQuery: companyNameQuery.trim(),
      companyCodeQuery: companyCodeQuery.trim(),
    });
    const cached = readAgendaPageCache(requestKey);

    if (cached) {
      setData(cached.data);
      setTotalCount(cached.count);
      setLoading(false);
      setError(null);
    } else {
      setLoading(true);
      setError(null);
    }

    const load = async () => {
      try {
        const result = await fetchAgenda(pageIndex, pageSize, sorting, filters, {
          companyName: companyNameQuery,
          companyCode: companyCodeQuery,
        });
        if (!active) return;
        setData(result.data);
        setTotalCount(result.count);
        setError(null);
        writeAgendaPageCache({
          requestKey,
          data: result.data,
          count: result.count,
          cachedAt: Date.now(),
        });
      } catch (err) {
        if (!active) return;
        if (cached) {
          console.error("Falha ao atualizar agenda em background:", err);
          return;
        }
        setError(err instanceof Error ? err.message : "Erro ao carregar agenda");
        setData([]);
        setTotalCount(0);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [companyCodeQuery, companyNameQuery, filters, pageIndex, pageSize, refreshKey, sorting]);

  useEffect(() => {
    let active = true;
    const agendaIds = data.map((row) => row.id);
    if (agendaIds.length === 0) {
      setScheduledVisitsByAgenda({});
      setVisitVendorsByAgenda({});
      return () => {
        active = false;
      };
    }

    Promise.all([fetchAgendaScheduledVisits(agendaIds), fetchAgendaVisitVendors(agendaIds)])
      .then(([scheduledVisits, vendorVisits]) => {
        if (!active) return;
        const groupedScheduled: Record<string, AgendaScheduledVisit[]> = {};
        scheduledVisits.forEach((visit) => {
          if (!visit.cliente_id) return;
          if (!groupedScheduled[visit.cliente_id]) groupedScheduled[visit.cliente_id] = [];
          groupedScheduled[visit.cliente_id].push(visit);
        });
        const groupedVendors: Record<string, AgendaVisitVendor[]> = {};
        vendorVisits.forEach((visit) => {
          if (!visit.cliente_id) return;
          if (!groupedVendors[visit.cliente_id]) groupedVendors[visit.cliente_id] = [];
          groupedVendors[visit.cliente_id].push(visit);
        });
        setScheduledVisitsByAgenda(groupedScheduled);
        setVisitVendorsByAgenda(groupedVendors);
      })
      .catch((err) => {
        console.error(err);
        if (active) {
          setScheduledVisitsByAgenda({});
          setVisitVendorsByAgenda({});
        }
      });

    return () => {
      active = false;
    };
  }, [data, scheduleRefreshKey]);

  useEffect(() => {
    if (!selectedRowId) return;
    if (selectedRow?.id === selectedRowId) return;
    const found = data.find((row) => row.id === selectedRowId);
    if (found) {
      setSelectedRow(found);
    }
  }, [data, selectedRow, selectedRowId]);

  const filteredVendedores = useMemo(() => {
    if (!vendorQuery.trim()) return vendedores;
    const term = normalizeSearchText(vendorQuery);
    return vendedores.filter((vendor) =>
      normalizeSearchText(vendor.display_name ?? vendor.user_id ?? "").includes(term),
    );
  }, [vendorQuery, vendedores]);

  const excludedAgendaSet = useMemo(() => new Set(excludedAgendaIds), [excludedAgendaIds]);

  const displayData = useMemo(() => {
    const sortedRows =
      data.length <= 1
        ? data
        : (() => {
            const primarySort = sorting[0];
            if (primarySort && primarySort.id !== "obs") {
              return data;
            }

            const descending = primarySort?.desc ?? true;
            return [...data].sort((left, right) => {
              const leftObsTimestamp = toSortableTimestamp(
                resolveScheduledObsVisit(left.id, left.instructions)?.visitDate,
              );
              const rightObsTimestamp = toSortableTimestamp(
                resolveScheduledObsVisit(right.id, right.instructions)?.visitDate,
              );
              const obsComparison = compareNullableTimestamps(leftObsTimestamp, rightObsTimestamp, descending);
              if (obsComparison !== 0) return obsComparison;

              const leftLastVisit = toSortableTimestamp(left.data_da_ultima_visita);
              const rightLastVisit = toSortableTimestamp(right.data_da_ultima_visita);
              const lastVisitComparison = compareNullableTimestamps(leftLastVisit, rightLastVisit, true);
              if (lastVisitComparison !== 0) return lastVisitComparison;

              return (left.empresa ?? left.nome_fantasia ?? "").localeCompare(
                right.empresa ?? right.nome_fantasia ?? "",
                "pt-BR",
              );
            });
          })();

    if (excludedAgendaSet.size === 0) return sortedRows;
    return sortedRows.filter((row) => !excludedAgendaSet.has(row.id));
  }, [data, excludedAgendaSet, scheduledVisitsByAgenda, sorting]);

  const selectedAgendaSet = useMemo(() => new Set(selectedAgendaIds), [selectedAgendaIds]);
  const visibleAgendaIds = useMemo(() => displayData.map((row) => row.id), [displayData]);
  const allVisibleSelected =
    visibleAgendaIds.length > 0 && visibleAgendaIds.every((id) => selectedAgendaSet.has(id));
  const someVisibleSelected =
    visibleAgendaIds.some((id) => selectedAgendaSet.has(id)) && !allVisibleSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const toggleAgendaSelection = (agendaId: string) => {
    setSelectedAgendaIds((prev) =>
      prev.includes(agendaId) ? prev.filter((id) => id !== agendaId) : [...prev, agendaId],
    );
  };

  const setVisibleSelection = (checked: boolean) => {
    setSelectedAgendaIds((prev) => {
      if (checked) {
        const next = new Set(prev);
        visibleAgendaIds.forEach((id) => next.add(id));
        return Array.from(next);
      }
      return prev.filter((id) => !visibleAgendaIds.includes(id));
    });
  };

  const handleToggleVendor = (vendorId: string) => {
    setSelectedVendorIds((prev) =>
      prev.includes(vendorId) ? prev.filter((id) => id !== vendorId) : [...prev, vendorId],
    );
  };

  const handleGenerateVisits = async () => {
    if (!canGenerate) return;
    const selectedVendors = vendedores.filter((vendor) => selectedVendorIds.includes(vendor.user_id));
    if (selectedVendors.length === 0) {
      setGenerateMessage("Selecione pelo menos um vendedor para gerar visitas.");
      return;
    }
    if (selectedAgendaIds.length === 0) {
      setGenerateMessage("Selecione pelo menos uma empresa para gerar visitas.");
      return;
    }
    if (!visitDate) {
      setGenerateMessage("Selecione a data da visita.");
      return;
    }

    setGenerating(true);
    setGenerateMessage(null);

    try {
      const rows = await fetchAgendaForGeneration(filters, selectedAgendaIds);
      if (rows.length === 0) {
        setGenerateMessage("Nenhum registro encontrado para gerar visitas.");
        return;
      }

      const chunkSize = 500;
      const agendaIds = rows.map((row) => row.id);
      const visitBase = new Date(`${visitDate}T12:00:00`);
      const routeDate = visitDate;
      const displayDate = new Intl.DateTimeFormat("pt-BR").format(visitBase);
      const vendorNames = Array.from(
        new Set(
          selectedVendors
            .map((vendor) => vendor.display_name ?? vendor.user_id ?? "")
            .map((name) => name.trim())
            .filter(Boolean),
        ),
      ).join(", ");
      const supervisorNames = Array.from(
        new Set(
          selectedVendors
            .map((vendor) => supervisorNameByVendorId.get(vendor.user_id) ?? "")
            .map((name) => name.trim())
            .filter(Boolean),
        ),
      ).join(", ");

      for (const vendor of selectedVendors) {
        const routeName = `Visitas ${displayDate} - ${vendor.display_name ?? "Vendedor"}`;

        const { data: route, error: routeError } = await supabase
          .from("routes")
          .insert({
            name: routeName,
            date: routeDate,
            assigned_to_user_id: vendor.user_id,
            created_by: session?.user.id ?? null,
          })
          .select("id")
          .single();

        if (routeError || !route) {
          throw new Error(routeError?.message ?? "Erro ao criar rota de visitas.");
        }

        const stopRows = rows.map((row, index) => ({
          route_id: route.id,
          cliente_id: row.id,
          stop_order: index + 1,
        }));

        for (let i = 0; i < stopRows.length; i += chunkSize) {
          const chunk = stopRows.slice(i, i + chunkSize);
          const { error: stopError } = await supabase.from("route_stops").insert(chunk);
          if (stopError) {
            throw new Error(stopError.message);
          }
        }

        const visitRows = rows.map((row) => ({
          cliente_id: row.id,
          assigned_to_user_id: vendor.user_id,
          assigned_to_name: vendor.display_name ?? vendor.user_id,
          visit_date: routeDate,
          perfil_visita: row.perfil_visita ?? null,
          instructions: row.instructions?.trim() || null,
          route_id: route.id,
          created_by: session?.user.id ?? null,
        }));

        for (let i = 0; i < visitRows.length; i += chunkSize) {
          const chunk = visitRows.slice(i, i + chunkSize);
          const { error: visitError } = await supabase
            .from("visits")
            .upsert(chunk, {
              onConflict: "cliente_id,assigned_to_user_id,visit_date",
              ignoreDuplicates: true,
            });

          if (visitError) {
            throw new Error(visitError.message);
          }
        }
      }

      for (let i = 0; i < agendaIds.length; i += chunkSize) {
        const chunkIds = agendaIds.slice(i, i + chunkSize);
        const { error: updateError } = await supabase
          .from("clientes")
          .update({ visit_generated_at: visitBase.toISOString() })
          .in("id", chunkIds);

        if (updateError) {
          throw new Error(updateError.message);
        }

        const { error: vendorError } = await supabase
          .from("clientes")
          .update({ vendedor: vendorNames || null, supervisor: supervisorNames || null })
          .in("id", chunkIds);
        if (vendorError) {
          throw new Error(vendorError.message);
        }
      }

      const totalVisits = rows.length * selectedVendors.length;
      setGenerateMessage(
        `Geradas ${totalVisits} visitas (${rows.length} empresa(s)) para ${selectedVendors.length} vendedor(es).`,
      );
      setSelectedAgendaIds([]);
      setSelectedVendorIds([]);
      setVendorQuery("");
      setVisitDate("");
      setShowGenerateModal(false);
      clearRoutesModuleDraft();
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setGenerateMessage(err instanceof Error ? err.message : "Erro ao gerar visitas.");
    } finally {
      setGenerating(false);
    }
  };

  const handleDrawerUpdated = (updated: AgendaRow) => {
    setSelectedRow(updated);
    setSelectedRowId(updated.id);
    setRefreshKey((value) => value + 1);
  };

  const handleDrawerDeleted = () => {
    setSelectedRow(null);
    setSelectedRowId(null);
    setRefreshKey((value) => value + 1);
  };

  const openScheduleModal = (row: AgendaRow) => {
    const visits = scheduledVisitsByAgenda[row.id] ?? [];
    const drafts = visits.map((visit) => {
      const basePerfil = visit.perfil_visita ?? "";
      const singleTimeBase = getSingleTimePerfilBase(basePerfil);
      return {
        id: visit.id,
        vendorId: visit.assigned_to_user_id ?? "",
        vendorName: visit.assigned_to_name ?? "",
        date: visit.visit_date,
        perfil: basePerfil,
        perfilCustom: Boolean(basePerfil && !isPresetPerfilVisita(basePerfil) && !singleTimeBase),
        perfilSingleTimeBase: singleTimeBase ?? "",
        perfilSingleTimeValue: getSingleTimePerfilValue(basePerfil),
        routeId: visit.route_id ?? null,
      };
    });
    setScheduleModalRow(row);
    setScheduleDrafts(drafts);
    setScheduleOriginal(visits);
    setScheduleError(null);
  };

  const closeScheduleModal = () => {
    setScheduleModalRow(null);
    setScheduleDrafts([]);
    setScheduleOriginal([]);
    setScheduleError(null);
  };

  const closeDetailsModal = () => {
    detailsObsRequestRef.current += 1;
    setDetailsModalRow(null);
    setDetailsObsExpanded(false);
    setDetailsInstructionDraft("");
    setDetailsInstructionMessage(null);
    setDetailsInstructionSaving(false);
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

  const handleSaveDetailsInstruction = async () => {
    if (!detailsModalRow || !canManageInstruction) return;
    const rowId = detailsModalRow.id;
    const previousInstructions = detailsModalRow.instructions ?? null;
    const nextInstructions = detailsInstructionDraft.trim() || null;

    if ((previousInstructions ?? null) === (nextInstructions ?? null)) {
      setDetailsInstructionMessage("Sem alteracoes para salvar.");
      return;
    }

    setDetailsInstructionSaving(true);
    setDetailsInstructionMessage(null);

    const applyLocalInstruction = (value: string | null) => {
      setData((prev) =>
        prev.map((row) =>
          row.id === rowId ? { ...row, instructions: value } : row,
        ),
      );
      setSelectedRow((prev) =>
        prev?.id === rowId ? { ...prev, instructions: value } : prev,
      );
      setDetailsModalRow((prev) =>
        prev?.id === rowId ? { ...prev, instructions: value } : prev,
      );
      setScheduledVisitsByAgenda((prev) => {
        const visits = prev[rowId];
        if (!visits || visits.length === 0) return prev;
        return {
          ...prev,
          [rowId]: visits.map((visit) => ({ ...visit, instructions: value })),
        };
      });
    };

    applyLocalInstruction(nextInstructions);

    try {
      const { error: updateAgendaError } = await supabase
        .from("clientes")
        .update({ instructions: nextInstructions })
        .eq("id", rowId);
      if (updateAgendaError) throw new Error(updateAgendaError.message);

      setDetailsInstructionMessage("Instrucoes atualizadas.");

      void supabase
        .from("visits")
        .update({ instructions: nextInstructions })
        .eq("cliente_id", rowId)
        .is("completed_at", null)
        .then(({ error: updateVisitsError }) => {
          if (updateVisitsError) {
            console.error(updateVisitsError);
            setDetailsInstructionMessage(
              "Instrucao salva. Houve atraso ao sincronizar visitas abertas.",
            );
          }
        });
    } catch (err) {
      applyLocalInstruction(previousInstructions);
      setDetailsInstructionMessage(err instanceof Error ? err.message : "Erro ao salvar instrucoes.");
    } finally {
      setDetailsInstructionSaving(false);
    }
  };

  const handleAddScheduleDraft = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    const fallbackDate = scheduleDrafts[0]?.date ?? local.toISOString().slice(0, 10);
    const fallbackPerfil = scheduleModalRow?.perfil_visita ?? "";
    const singleTimeBase = getSingleTimePerfilBase(fallbackPerfil);
    const isCustom = Boolean(fallbackPerfil && !isPresetPerfilVisita(fallbackPerfil) && !singleTimeBase);
    setScheduleDrafts((prev) => [
      ...prev,
      {
        vendorId: "",
        vendorName: "",
        date: fallbackDate,
        perfil: fallbackPerfil,
        customTimes: isCustom
          ? (() => {
              const times = extractCustomTimes(fallbackPerfil);
              return times.length ? times : [""];
            })()
          : [],
        perfilCustom: isCustom,
        perfilSingleTimeBase: singleTimeBase ?? "",
        perfilSingleTimeValue: getSingleTimePerfilValue(fallbackPerfil),
      },
    ]);
  };

  const updateScheduleDraft = (index: number, patch: Partial<(typeof scheduleDrafts)[number]>) => {
    setScheduleDrafts((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)),
    );
  };

  const removeScheduleDraft = (index: number) => {
    setScheduleDrafts((prev) => prev.filter((_, idx) => idx !== index));
  };

  const buildVisitPerfilPayload = (perfil: string) => {
    const cleaned = perfil.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      return { perfil_visita: null as string | null, perfil_visita_opcoes: null as string | null };
    }
    const singleTimeBase = getSingleTimePerfilBase(cleaned);
    const isPreset = isPresetPerfilVisita(cleaned);
    const customTimes = extractCustomTimes(cleaned);
    const hasMultipleTimes = customTimes.length > 1;
    const isCustom = !isPreset && !singleTimeBase;
    return {
      perfil_visita: cleaned,
      perfil_visita_opcoes: hasMultipleTimes || isCustom ? cleaned : null,
    };
  };

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

    const displayDate = new Intl.DateTimeFormat("pt-BR").format(new Date(`${dateValue}T12:00:00`));
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

  const removeRouteStop = async (routeId: string, empresaId: string) => {
    const { error } = await supabase
      .from("route_stops")
      .delete()
      .eq("route_id", routeId)
      .eq("cliente_id", empresaId);
    if (error) throw new Error(error.message);
  };

  const handleScheduleSave = async () => {
    if (!scheduleModalRow) return;

    for (const draft of scheduleDrafts) {
      if (!draft.vendorId) {
        setScheduleError("Selecione o vendedor.");
        return;
      }
      if (!draft.date) {
        setScheduleError("Selecione a data da visita.");
        return;
      }
    }

    const seen = new Set<string>();
    for (const draft of scheduleDrafts) {
      const key = `${draft.vendorId}::${draft.date}`;
      if (seen.has(key)) {
        setScheduleError("Nao e permitido repetir o mesmo vendedor na mesma data.");
        return;
      }
      seen.add(key);
    }

    setScheduleSaving(true);
    setScheduleError(null);
    try {
      const originalById = new Map(scheduleOriginal.map((visit) => [visit.id, visit]));
      const draftIds = new Set(scheduleDrafts.filter((item) => item.id).map((item) => item.id as string));
      const removed = scheduleOriginal.filter((visit) => !draftIds.has(visit.id));

      for (const visit of removed) {
        if (visit.route_id && visit.cliente_id) {
          await removeRouteStop(visit.route_id, visit.cliente_id);
        }
        const { error } = await supabase.from("visits").delete().eq("id", visit.id);
        if (error) throw new Error(error.message);
      }

      for (const draft of scheduleDrafts) {
        const vendorName =
          vendorById.get(draft.vendorId) ?? draft.vendorName ?? draft.vendorId ?? "Vendedor";
        if (!draft.id) {
          const routeId = await ensureRoute(draft.vendorId, vendorName, draft.date);
          const perfilPayload = buildVisitPerfilPayload(draft.perfil);
          const { data, error } = await supabase
            .from("visits")
            .insert({
              cliente_id: scheduleModalRow.id,
              assigned_to_user_id: draft.vendorId,
              assigned_to_name: vendorName,
              visit_date: draft.date,
              perfil_visita: perfilPayload.perfil_visita,
              perfil_visita_opcoes: perfilPayload.perfil_visita_opcoes,
              instructions: scheduleModalRow.instructions?.trim() || null,
              route_id: routeId,
              created_by: session?.user.id ?? null,
            })
            .select("id")
            .single();
          if (error || !data) throw new Error(error?.message ?? "Erro ao adicionar visita.");
          await ensureRouteStop(routeId, scheduleModalRow.id);
          continue;
        }

        const original = originalById.get(draft.id);
        if (!original) continue;

        const vendorChanged = (original.assigned_to_user_id ?? "") !== draft.vendorId;
        const dateChanged = original.visit_date !== draft.date;
        const perfilChanged = (original.perfil_visita ?? "") !== draft.perfil;

        if (vendorChanged || dateChanged) {
          const routeId = await ensureRoute(draft.vendorId, vendorName, draft.date);
          const perfilPayload = buildVisitPerfilPayload(draft.perfil);
          if (original.route_id && original.route_id !== routeId && original.cliente_id) {
            await removeRouteStop(original.route_id, original.cliente_id);
          }
          await ensureRouteStop(routeId, scheduleModalRow.id);

          const { error } = await supabase
            .from("visits")
            .update({
              assigned_to_user_id: draft.vendorId,
              assigned_to_name: vendorName,
              visit_date: draft.date,
              perfil_visita: perfilPayload.perfil_visita,
              perfil_visita_opcoes: perfilPayload.perfil_visita_opcoes,
              instructions: scheduleModalRow.instructions?.trim() || null,
              route_id: routeId,
            })
            .eq("id", draft.id);
          if (error) throw new Error(error.message);
        } else if (perfilChanged) {
          const perfilPayload = buildVisitPerfilPayload(draft.perfil);
          const { error } = await supabase
            .from("visits")
            .update({
              perfil_visita: perfilPayload.perfil_visita,
              perfil_visita_opcoes: perfilPayload.perfil_visita_opcoes,
            })
            .eq("id", draft.id);
          if (error) throw new Error(error.message);
        }
      }

      const vendorNames = Array.from(
        new Set(
          scheduleDrafts
            .map((draft) => vendorById.get(draft.vendorId) ?? draft.vendorName ?? draft.vendorId ?? "")
            .map((name) => name.trim())
            .filter(Boolean),
        ),
      ).join(", ");
      const supervisorNames = Array.from(
        new Set(
          scheduleDrafts
            .map((draft) => supervisorNameByVendorId.get(draft.vendorId) ?? "")
            .map((name) => name.trim())
            .filter(Boolean),
        ),
      ).join(", ");

      if (scheduleDrafts.length === 0) {
        const { error } = await supabase
          .from("clientes")
          .update({ visit_generated_at: null, vendedor: null, supervisor: null })
          .eq("id", scheduleModalRow.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from("clientes")
          .update({ visit_generated_at: new Date().toISOString() })
          .eq("id", scheduleModalRow.id)
          .is("visit_generated_at", null);
        if (error) throw new Error(error.message);

        const { error: vendorError } = await supabase
          .from("clientes")
          .update({ vendedor: vendorNames || null, supervisor: supervisorNames || null })
          .eq("id", scheduleModalRow.id);
        if (vendorError) throw new Error(vendorError.message);
      }

      if (scheduleDrafts.length > 0) {
        const resolvedPerfilValues = Array.from(
          new Set(
            scheduleDrafts
              .map((draft) => draft.perfil.replace(/\s+/g, " ").trim())
              .filter((value) => value.length > 0),
          ),
        );
        const resolvedPerfil = resolvedPerfilValues.length > 0 ? resolvedPerfilValues.join(" • ") : null;
        const currentPerfil = scheduleModalRow.perfil_visita ?? null;

        if (resolvedPerfil !== currentPerfil) {
          const { error: agendaPerfilError } = await supabase
            .from("clientes")
            .update({ perfil_visita: resolvedPerfil })
            .eq("id", scheduleModalRow.id);
          if (agendaPerfilError) throw new Error(agendaPerfilError.message);

          setData((prev) =>
            prev.map((row) =>
              row.id === scheduleModalRow.id ? { ...row, perfil_visita: resolvedPerfil } : row,
            ),
          );
          setSelectedRow((prev) =>
            prev?.id === scheduleModalRow.id ? { ...prev, perfil_visita: resolvedPerfil } : prev,
          );
        }
      }

      setScheduleModalRow(null);
      setScheduleDrafts([]);
      setScheduleOriginal([]);
      setData((prev) =>
        prev.map((row) =>
          row.id === scheduleModalRow.id
            ? {
                ...row,
                vendedor: scheduleDrafts.length ? vendorNames || null : null,
                supervisor: scheduleDrafts.length ? supervisorNames || null : null,
              }
            : row,
        ),
      );
      setSelectedRow((prev) =>
        prev?.id === scheduleModalRow.id
          ? {
              ...prev,
              vendedor: scheduleDrafts.length ? vendorNames || null : null,
              supervisor: scheduleDrafts.length ? supervisorNames || null : null,
            }
          : prev,
      );
      setScheduleRefreshKey((prev) => prev + 1);
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : "Erro ao salvar visitas.");
    } finally {
      setScheduleSaving(false);
    }
  };

  const columns = useMemo<ColumnDef<AgendaRow>[]>(
    () => {
      const renderSortLabel = (
        column: {
          getToggleSortingHandler: () => ((event: unknown) => void) | undefined;
          getIsSorted: () => false | "asc" | "desc";
          getCanSort: () => boolean;
        },
        label: string,
      ) => {
        const handler = column.getToggleSortingHandler();
        return (
          <button
            type="button"
            onClick={handler}
            disabled={!column.getCanSort() || !handler}
            className="inline-flex items-center justify-center gap-1 text-center disabled:opacity-70"
          >
            <span className="leading-tight">{label}</span>
            {column.getIsSorted() ? (
              <span className="text-sea">
                {column.getIsSorted() === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </span>
            ) : null}
          </button>
        );
      };

      return [
      {
        id: "select",
        header: () => (
          <div className="flex items-center justify-center">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => setVisibleSelection(event.target.checked)}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="h-4 w-4 accent-sea"
              aria-label="Selecionar todos nesta pagina"
              title="Selecionar todos nesta pagina"
            />
          </div>
        ),
        cell: (info) => {
          const rowId = info.row.original.id;
          const checked = selectedAgendaSet.has(rowId);
          return (
            <div className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleAgendaSelection(rowId)}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                className="h-4 w-4 accent-sea"
                aria-label="Selecionar empresa"
              />
            </div>
          );
        },
        enableSorting: false,
        size: 25,
      },
      {
        id: "obs",
        header: ({ column }) => renderSortLabel(column, "Obs"),
        cell: (info) => {
          const row = info.row.original;
          const scheduledObs = resolveScheduledObsVisit(row.id, row.instructions);
          if (!scheduledObs) return null;
          const firstInstructions = scheduledObs.instructions ?? "";
          const buttonLabel = scheduledObs.visitDate ? formatDate(scheduledObs.visitDate) : "Ver";
          const titleText = firstInstructions ? `Instrucoes: ${firstInstructions}` : "Abrir agenda";
          return (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openScheduleModal(info.row.original);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className="inline-flex min-h-6 items-center justify-center rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700 hover:border-red-300"
              title={titleText}
              aria-label={titleText}
            >
              {buttonLabel}
            </button>
          );
        },
        size: 160,
      },
      {
        accessorKey: "data_da_ultima_visita",
        header: ({ column }) => renderSortLabel(column, "Ultima visita"),
        cell: (info) => {
          const row = info.row.original;
          return resolveLastCompletedVisitDate(row.id, info.getValue() as string | null);
        },
        size: 92,
      },
      {
        accessorKey: "visit_completed_vidas",
        header: ({ column }) => renderSortLabel(column, "Vidas ultima visita"),
        cell: (info) => {
          const row = info.row.original;
          const value = info.getValue<number | null>();
          return resolveLastCompletedVidas(row.id, value);
        },
        size: 170,
      },
      {
        accessorKey: "empresa",
        header: ({ column }) => (
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            {renderSortLabel(column, "Empresa")}
            <MultiSelectFilter
              label={
                (filters.columns.empresa_nome ?? []).length
                  ? `Filtro (${filters.columns.empresa_nome.length})`
                  : "Filtro"
              }
              options={filterOptions.empresa_nome ?? []}
              value={filters.columns.empresa_nome}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, empresa_nome: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => {
          const row = info.row.original;
          const name = row.empresa ?? "-";
          const codigo = row.cod_1 ?? "-";
          return (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-ink">{name}</p>
                <span className="rounded-full bg-sea/10 px-2 py-0.5 text-[10px] font-semibold text-sea">
                  COD {codigo}
                </span>
              </div>
            </div>
          );
        },
        size: 180,
      },
      {
        accessorKey: "categoria",
        header: ({ column }) => (
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            {renderSortLabel(column, "Categoria")}
            <MultiSelectFilter
              label={
                (filters.columns.categoria ?? []).length
                  ? `Filtro (${filters.columns.categoria.length})`
                  : "Filtro"
              }
              options={filterOptions.categoria ?? []}
              value={filters.columns.categoria}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, categoria: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => {
          const badge = getCategoriaBadgeStyles(info.getValue<string | null>());
          return (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
            >
              {badge.label}
            </span>
          );
        },
        size: 90,
      },
      {
        accessorKey: "bairro",
        header: ({ column }) => (
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            {renderSortLabel(column, "Bairro")}
            <MultiSelectFilter
              label={
                (filters.columns.bairro ?? []).length
                  ? `Filtro (${filters.columns.bairro.length})`
                  : "Filtro"
              }
              options={filterOptions.bairro ?? []}
              value={filters.columns.bairro}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, bairro: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
        size: 90,
      },
      {
        accessorKey: "cidade",
        header: ({ column }) => (
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            {renderSortLabel(column, "Cidade")}
            <MultiSelectFilter
              label={
                (filters.columns.cidade ?? []).length
                  ? `Filtro (${filters.columns.cidade.length})`
                  : "Filtro"
              }
              options={filterOptions.cidade ?? []}
              value={filters.columns.cidade}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, cidade: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
        size: 84,
      },
      {
        accessorKey: "vendedor",
        header: ({ column }) => (
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            {renderSortLabel(column, "Vendedor")}
            <MultiSelectFilter
              label={
                (filters.columns.vendedor ?? []).length
                  ? `Filtro (${filters.columns.vendedor.length})`
                  : "Filtro"
              }
              options={filterOptions.vendedor ?? []}
              value={filters.columns.vendedor}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, vendedor: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => {
          const row = info.row.original;
          const recentVendors = resolveVendorsForAgenda(row.id, row.vendedor);
          const vendorLabel =
            recentVendors.length > 0
              ? recentVendors.map((item) => item.name).join(", ")
              : "-";
          const historyTooltip = "Ver historico de atribuicao";
          const hasAnyHistoryDate = recentVendors.some((item) => Boolean(item.visitDate));
          return (
            <div className="relative min-h-[28px] pr-6">
              <p>{vendorLabel}</p>
              {hasAnyHistoryDate ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setVendorHistoryModal({
                      empresa: row.empresa ?? row.nome_fantasia ?? "Sem empresa",
                      codigo: row.cod_1 ?? "-",
                      assignments: recentVendors.map((item) => ({
                        name: item.name,
                        visitDate: item.visitDate,
                      })),
                    });
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="absolute right-0 top-0 inline-flex h-4 w-4 items-center justify-center rounded-full border border-orange-300 bg-orange-50 text-orange-600 hover:border-orange-400 hover:text-orange-700"
                  title={historyTooltip}
                  aria-label={historyTooltip}
                >
                  <Clock3 size={10} />
                </button>
              ) : null}
            </div>
          );
        },
        size: 105,
      },
      {
        accessorKey: "grupo",
        header: ({ column }) => (
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            {renderSortLabel(column, "Grupo")}
            <MultiSelectFilter
              label={
                (filters.columns.grupo ?? []).length
                  ? `Filtro (${filters.columns.grupo.length})`
                  : "Filtro"
              }
              options={filterOptions.grupo ?? []}
              value={filters.columns.grupo}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, grupo: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
        size: 82,
      },
      {
        accessorKey: "perfil_visita",
        header: ({ column }) => (
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            {renderSortLabel(column, "Perfil Visita")}
            <MultiSelectFilter
              label={
                (filters.columns.perfil_visita ?? []).length
                  ? `Filtro (${filters.columns.perfil_visita.length})`
                  : "Filtro"
              }
              options={filterOptions.perfil_visita ?? []}
              value={filters.columns.perfil_visita}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, perfil_visita: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => formatPerfilVisitaDisplay(info.getValue<string | null>()),
        size: 120,
      },
    ];
    },
    [
      allVisibleSelected,
      filterOptions,
      filters.columns,
      openScheduleModal,
      selectedAgendaSet,
      scheduledVisitsByAgenda,
      resolveScheduledObsVisit,
      resolveVendorsForAgenda,
      resolveLastCompletedVidas,
      resolveLastCompletedVisitDate,
      setFilters,
      setVisibleSelection,
      toggleAgendaSelection,
    ],
  );

  const table = useReactTable({
    data: displayData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    state: { sorting },
    onSortingChange: setSorting,
    pageCount: Math.ceil(totalCount / pageSize),
  });

  const compactColumnWidths: Record<string, number> = {
    select: 30,
    obs: 120,
    data_da_ultima_visita: 92,
    visit_completed_vidas: 86,
    empresa: 180,
    categoria: 90,
    bairro: 90,
    cidade: 84,
    vendedor: 105,
    grupo: 82,
    perfil_visita: 120,
  };

  const activeChips = useMemo(() => {
    const chips: { id: string; label: string; onRemove: () => void }[] = [];

    if (companyNameQuery) {
      chips.push({
        id: "chip-company-name",
        label: `Nome: ${companyNameQuery}`,
        onRemove: () => setCompanyNameQuery(""),
      });
    }

    if (companyCodeQuery) {
      chips.push({
        id: "chip-company-code",
        label: `Codigo: ${companyCodeQuery}`,
        onRemove: () => setCompanyCodeQuery(""),
      });
    }

    Object.keys(FILTER_SOURCES).forEach((key) => {
      const values = filters.columns[key] ?? [];
      values.forEach((value, index) => {
        const chipId = `chip-column-${key}-${index}-${value}`;
        chips.push({
          id: chipId,
          label: `${FILTER_LABELS[key] ?? key}: ${value}`,
          onRemove: () => {
            const selectedValues = Array.from(new Set(filters.columns[key] ?? []));
            setColumnChipRemovalModal({
              filterKey: key,
              filterLabel: FILTER_LABELS[key] ?? key,
              triggerValue: value,
              options: selectedValues,
              selectedValues: [value],
              selectedCompanyIds: [],
              hasManualCompanySelection: false,
            });
          },
        });
      });
    });

    if (filters.dateRanges.data_da_ultima_visita.from || filters.dateRanges.data_da_ultima_visita.to) {
      const fromLabel = filters.dateRanges.data_da_ultima_visita.from
        ? formatDate(filters.dateRanges.data_da_ultima_visita.from)
        : "";
      const toLabel = filters.dateRanges.data_da_ultima_visita.to
        ? formatDate(filters.dateRanges.data_da_ultima_visita.to)
        : "";
      const isInsideRange = Boolean(filters.dateRanges.data_da_ultima_visita.invert);
      chips.push({
        id: "chip-date-range",
        label: isInsideRange
          ? `Ultima visita: ${fromLabel} - ${toLabel}`
          : `Ultima visita (fora): ${fromLabel} - ${toLabel}`,
        onRemove: () =>
          setFilters((prev) => ({
            ...prev,
            dateRanges: { ...prev.dateRanges, data_da_ultima_visita: {} },
          })),
      });
    }

    if (filters.dateRanges.data_da_ultima_visita.year) {
      const monthLabel = filters.dateRanges.data_da_ultima_visita.month
        ? MONTH_OPTIONS.find((option) => option.value === filters.dateRanges.data_da_ultima_visita.month)?.label
        : null;
      const isInsideRange = Boolean(filters.dateRanges.data_da_ultima_visita.invert);
      chips.push({
        id: "chip-month-year",
        label: monthLabel
          ? `${isInsideRange ? "Mes/Ano" : "Mes/Ano (fora)"}: ${monthLabel} ${
              filters.dateRanges.data_da_ultima_visita.year
            }`
          : `${isInsideRange ? "Ano" : "Ano (fora)"}: ${filters.dateRanges.data_da_ultima_visita.year}`,
        onRemove: () =>
          setFilters((prev) => ({
            ...prev,
            dateRanges: {
              ...prev.dateRanges,
              data_da_ultima_visita: {
                ...prev.dateRanges.data_da_ultima_visita,
                month: undefined,
                year: undefined,
                invert: false,
              },
            },
          })),
      });
    }

    if (
      filters.ranges.vidas_ultima_visita.from ||
      filters.ranges.vidas_ultima_visita.to
    ) {
      const fromLabel = filters.ranges.vidas_ultima_visita.from ?? "";
      const toLabel = filters.ranges.vidas_ultima_visita.to ?? "";
      const label =
        fromLabel && toLabel
          ? `Vidas ultima visita: ${fromLabel} a ${toLabel}`
          : fromLabel
            ? `Vidas ultima visita: a partir de ${fromLabel}`
            : `Vidas ultima visita: ate ${toLabel}`;
      chips.push({
        id: "chip-vidas-range",
        label,
        onRemove: () =>
          setFilters((prev) => ({
            ...prev,
            ranges: { ...prev.ranges, vidas_ultima_visita: {} },
          })),
      });
    }

    return chips;
  }, [companyCodeQuery, companyNameQuery, filters, setFilters]);

  const hasActiveCompanySearch = useMemo(
    () =>
      Boolean(normalizeSearchText(companyNameQuery)) ||
      Boolean(normalizeSearchText(companyCodeQuery)),
    [companyCodeQuery, companyNameQuery],
  );

  const impactedCompaniesPreview = useMemo<ImpactedCompanyPreview[]>(() => {
    if (!columnChipRemovalModal) return [];
    const selectedSet = new Set(
      columnChipRemovalModal.selectedValues.map((value) => normalizeFilterMatchValue(value)),
    );
    if (selectedSet.size === 0) return [];

    return displayData
      .filter((row) =>
        selectedSet.has(
          normalizeFilterMatchValue(getAgendaFilterValueFromRow(row, columnChipRemovalModal.filterKey)),
        ),
      )
      .map((row) => ({
        id: row.id,
        companyName: row.empresa ?? row.nome_fantasia ?? "Sem empresa",
        code: row.cod_1 ?? "-",
        city: row.cidade ?? "-",
        neighborhood: row.bairro ?? "-",
        filterValue: String(getAgendaFilterValueFromRow(row, columnChipRemovalModal.filterKey) ?? "-"),
      }));
  }, [columnChipRemovalModal, displayData]);

  const impactedCompaniesPageCount = useMemo(
    () => Math.max(1, Math.ceil(impactedCompaniesPreview.length / COLUMN_CHIP_MODAL_PAGE_SIZE)),
    [impactedCompaniesPreview.length],
  );

  const pagedImpactedCompanies = useMemo(() => {
    const start = columnChipRemovalPageIndex * COLUMN_CHIP_MODAL_PAGE_SIZE;
    return impactedCompaniesPreview.slice(start, start + COLUMN_CHIP_MODAL_PAGE_SIZE);
  }, [columnChipRemovalPageIndex, impactedCompaniesPreview]);

  useEffect(() => {
    if (!columnChipRemovalModal) {
      setColumnChipRemovalPageIndex(0);
      return;
    }
    setColumnChipRemovalPageIndex(0);
  }, [
    columnChipRemovalModal?.filterKey,
    columnChipRemovalModal?.triggerValue,
    columnChipRemovalModal?.selectedValues.join("||"),
  ]);

  useEffect(() => {
    setColumnChipRemovalPageIndex((prev) => {
      const maxIndex = Math.max(0, impactedCompaniesPageCount - 1);
      return prev > maxIndex ? maxIndex : prev;
    });
  }, [impactedCompaniesPageCount]);

  useEffect(() => {
    const impactedIds = impactedCompaniesPreview.map((company) => company.id);
    setColumnChipRemovalModal((prev) => {
      if (!prev) return prev;
      const keptSelected = prev.selectedCompanyIds.filter((id) => impactedIds.includes(id));
      const nextSelected = prev.hasManualCompanySelection
        ? keptSelected
        : keptSelected.length > 0
          ? keptSelected
          : impactedIds;
      if (sameStringArray(nextSelected, prev.selectedCompanyIds)) {
        return prev;
      }
      return { ...prev, selectedCompanyIds: nextSelected };
    });
  }, [impactedCompaniesPreview]);

  const selectAllColumnChipModalValues = () => {
    setColumnChipRemovalModal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        selectedValues: [...prev.options],
        selectedCompanyIds: [],
        hasManualCompanySelection: false,
      };
    });
  };

  const selectOnlyTriggeredColumnChipValue = () => {
    setColumnChipRemovalModal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        selectedValues: [prev.triggerValue],
        selectedCompanyIds: [],
        hasManualCompanySelection: false,
      };
    });
  };

  const selectAllImpactedCompaniesForRemoval = () => {
    setColumnChipRemovalModal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        selectedCompanyIds: impactedCompaniesPreview.map((company) => company.id),
        hasManualCompanySelection: true,
      };
    });
  };

  const clearImpactedCompaniesSelection = () => {
    setColumnChipRemovalModal((prev) => {
      if (!prev) return prev;
      return { ...prev, selectedCompanyIds: [], hasManualCompanySelection: true };
    });
  };

  const toggleImpactedCompanySelection = (companyId: string) => {
    setColumnChipRemovalModal((prev) => {
      if (!prev) return prev;
      const hasCompany = prev.selectedCompanyIds.includes(companyId);
      const next = hasCompany
        ? prev.selectedCompanyIds.filter((id) => id !== companyId)
        : [...prev.selectedCompanyIds, companyId];
      return { ...prev, selectedCompanyIds: next, hasManualCompanySelection: true };
    });
  };

  const applyColumnChipRemoval = () => {
    if (!columnChipRemovalModal) return;
    const removeFilterValueSet = new Set(
      columnChipRemovalModal.selectedValues.map((value) => normalizeFilterMatchValue(value)),
    );
    if (removeFilterValueSet.size > 0) {
      setFilters((prev) => {
        const currentValues = prev.columns[columnChipRemovalModal.filterKey] ?? [];
        const nextValues = currentValues.filter(
          (value) => !removeFilterValueSet.has(normalizeFilterMatchValue(value)),
        );
        return {
          ...prev,
          columns: {
            ...prev.columns,
            [columnChipRemovalModal.filterKey]: nextValues,
          },
        };
      });
    }

    const removeSet = new Set(columnChipRemovalModal.selectedCompanyIds);
    if (removeSet.size > 0) {
      setExcludedAgendaIds((prev) => Array.from(new Set([...prev, ...Array.from(removeSet)])));
      setSelectedAgendaIds((prev) => prev.filter((id) => !removeSet.has(id)));
      setSelectedRow((prev) => (prev && removeSet.has(prev.id) ? null : prev));
      setSelectedRowId((prev) => (prev && removeSet.has(prev) ? null : prev));
    }
    setColumnChipRemovalModal(null);
  };

  if (!canAccess) {
    return (
      <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
        Este modulo e restrito a supervisao e assistencia.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-ink">Rotas</h2>
        <a
          href="/rotas/mapa"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-sea/30 bg-white/90 px-3 py-2 text-xs font-semibold text-ink hover:border-sea hover:text-sea"
        >
          <MapIcon size={14} />
          Abrir modo mapa
        </a>
      </header>

      <section className="rounded-2xl border border-sea/20 bg-sand/30 p-4">
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,0.95fr)_minmax(0,0.55fr)_minmax(180px,220px)_minmax(180px,220px)] md:items-end">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-ink/70">Termo por nome (palavra exata)</span>
              <input
                value={companyNameQuery}
                onChange={(event) => setCompanyNameQuery(event.target.value)}
                placeholder="Ex.: rio"
                id="agenda-company-name-search"
                name="agendaCompanyNameSearch"
                className="w-full rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-sm outline-none focus:border-sea"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-ink/70">Busca exata por codigo</span>
              <input
                value={companyCodeQuery}
                onChange={(event) => setCompanyCodeQuery(event.target.value)}
                placeholder="Busca exata por codigo"
                id="agenda-company-code-search"
                name="agendaCompanyCodeSearch"
                className="w-full rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-sm outline-none focus:border-sea"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink/70">
                Categoria
                <CategoriaLegendPopover />
              </span>
              <div className="flex h-10 items-center justify-between rounded-lg border border-sea/20 bg-white/90 px-3">
                <span className="text-xs text-ink/60">
                  {(filters.columns.categoria ?? []).length
                    ? `${(filters.columns.categoria ?? []).length} selecionada(s)`
                    : "Selecione"}
                </span>
                <MultiSelectFilter
                  label={
                    (filters.columns.categoria ?? []).length
                      ? `Categoria (${filters.columns.categoria.length})`
                      : "Categoria"
                  }
                  options={filterOptions.categoria ?? [...CATEGORIA_OPTIONS]}
                  value={filters.columns.categoria ?? []}
                  onApply={(next) =>
                    setFilters((prev) => ({
                      ...prev,
                      columns: { ...prev.columns, categoria: next },
                    }))
                  }
                />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-ink/70">Situacao da empresa</span>
              <div className="flex h-10 items-center justify-between rounded-lg border border-sea/20 bg-white/90 px-3">
                <span className="text-xs text-ink/60">
                  {(filters.columns.situacao ?? []).length
                    ? `${(filters.columns.situacao ?? []).length} selecionada(s)`
                    : "Ativo"}
                </span>
                <MultiSelectFilter
                  label={
                    (filters.columns.situacao ?? []).length
                      ? `Situacao (${filters.columns.situacao.length})`
                      : "Situacao"
                  }
                  options={filterOptions.situacao ?? [...SITUACAO_FILTER_OPTIONS]}
                  value={filters.columns.situacao ?? []}
                  onApply={(next) =>
                    setFilters((prev) => ({
                      ...prev,
                      columns: { ...prev.columns, situacao: next },
                    }))
                  }
                />
              </div>
            </label>
          </div>

          <div className="grid gap-4">
            <div className="flex flex-col gap-1 md:hidden">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-ink/70">Bairro</label>
                <MultiSelectFilter
                  label={
                    (filters.columns.bairro ?? []).length
                      ? `Selecionados (${filters.columns.bairro.length})`
                      : "Selecionar"
                  }
                  options={filterOptions.bairro ?? []}
                  value={filters.columns.bairro}
                  onApply={(next) =>
                    setFilters((prev) => ({
                      ...prev,
                      columns: { ...prev.columns, bairro: next },
                    }))
                  }
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-end gap-2 md:flex-nowrap">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-ink/70">Ultima visita</span>
                  <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
                    <input
                      type="date"
                      value={filters.dateRanges.data_da_ultima_visita.from ?? ""}
                      onChange={(event) =>
                        setFilters((prev) => ({
                          ...prev,
                          dateRanges: {
                            ...prev.dateRanges,
                            data_da_ultima_visita: {
                              ...prev.dateRanges.data_da_ultima_visita,
                              from: event.target.value || undefined,
                              month: undefined,
                              year: undefined,
                            },
                          },
                        }))
                      }
                      id="agenda-duv-from"
                      name="agendaDuvFrom"
                      className="w-52 shrink-0 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                    />
                    <span className="text-xs text-ink/50">ate</span>
                    <input
                      type="date"
                      value={filters.dateRanges.data_da_ultima_visita.to ?? ""}
                      onChange={(event) =>
                        setFilters((prev) => ({
                          ...prev,
                          dateRanges: {
                            ...prev.dateRanges,
                            data_da_ultima_visita: {
                              ...prev.dateRanges.data_da_ultima_visita,
                              to: event.target.value || undefined,
                              month: undefined,
                              year: undefined,
                            },
                          },
                        }))
                      }
                      id="agenda-duv-to"
                      name="agendaDuvTo"
                      className="w-52 shrink-0 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                    />
                    <span className="w-full text-left text-xs font-semibold text-ink/50 md:w-auto md:pt-2">
                      Ou
                    </span>
                    <select
                      value={filters.dateRanges.data_da_ultima_visita.month ?? ""}
                      onChange={(event) =>
                        setFilters((prev) => ({
                          ...prev,
                          dateRanges: {
                            ...prev.dateRanges,
                            data_da_ultima_visita: {
                              ...prev.dateRanges.data_da_ultima_visita,
                              month: event.target.value || undefined,
                              year:
                                event.target.value && !prev.dateRanges.data_da_ultima_visita.year
                                  ? String(new Date().getFullYear())
                                  : prev.dateRanges.data_da_ultima_visita.year,
                              from: undefined,
                              to: undefined,
                            },
                          },
                        }))
                      }
                      id="agenda-duv-month"
                      name="agendaDuvMonth"
                      className="min-w-[120px] rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                    >
                      <option value="">Mes</option>
                      {MONTH_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="Ano"
                      value={filters.dateRanges.data_da_ultima_visita.year ?? ""}
                      onChange={(event) =>
                        setFilters((prev) => ({
                          ...prev,
                          dateRanges: {
                            ...prev.dateRanges,
                            data_da_ultima_visita: {
                              ...prev.dateRanges.data_da_ultima_visita,
                              year: event.target.value || undefined,
                              from: undefined,
                              to: undefined,
                            },
                          },
                        }))
                      }
                      id="agenda-duv-year"
                      name="agendaDuvYear"
                      className="w-24 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                    />
                    <label className="flex items-center gap-2 text-[11px] font-semibold text-ink/60">
                      <button
                        type="button"
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            dateRanges: {
                              ...prev.dateRanges,
                              data_da_ultima_visita: {
                                ...prev.dateRanges.data_da_ultima_visita,
                                invert: !prev.dateRanges.data_da_ultima_visita.invert,
                              },
                            },
                          }))
                        }
                        aria-label="Alternar inversao do filtro de ultima visita"
                        className={[
                          "inline-flex h-6 w-6 items-center justify-center rounded-md border transition",
                          filters.dateRanges.data_da_ultima_visita.invert
                            ? "border-sea bg-sea/10 text-sea"
                            : "border-sea/30 bg-white text-ink/50 hover:border-sea hover:text-sea",
                        ].join(" ")}
                      >
                        <SquareCenterlineDashedHorizontal size={14} />
                      </button>
                      Inverter
                    </label>
                  </div>
                </div>
                <div className="flex flex-col gap-1 md:ml-2">
                  <label className="text-[11px] font-semibold text-ink/70">Vidas ultima visita</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={filters.ranges.vidas_ultima_visita.from ?? ""}
                      onChange={(event) => {
                        const nextValue = normalizeNumberInput(event.target.value);
                        setFilters((prev) => ({
                          ...prev,
                          ranges: {
                            ...prev.ranges,
                            vidas_ultima_visita: {
                              ...prev.ranges.vidas_ultima_visita,
                              from: nextValue || undefined,
                            },
                          },
                        }));
                      }}
                      placeholder="De"
                      id="agenda-vidas-from"
                      name="agendaVidasFrom"
                      className="w-24 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                    />
                    <span className="text-xs text-ink/50">ate</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={filters.ranges.vidas_ultima_visita.to ?? ""}
                      onChange={(event) => {
                        const nextValue = normalizeNumberInput(event.target.value);
                        setFilters((prev) => ({
                          ...prev,
                          ranges: {
                            ...prev.ranges,
                            vidas_ultima_visita: {
                              ...prev.ranges.vidas_ultima_visita,
                              to: nextValue || undefined,
                            },
                          },
                        }));
                      }}
                      placeholder="Ate"
                      id="agenda-vidas-to"
                      name="agendaVidasTo"
                      className="w-24 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                    />
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-3 self-end">
                  <button
                    type="button"
                    onClick={() => {
                      clearFilters();
                      setCompanyNameQuery("");
                      setCompanyCodeQuery("");
                      setExcludedAgendaIds([]);
                    }}
                    className="rounded-lg border border-sea/30 bg-white/80 px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
                  >
                    Limpar filtros
                  </button>
                </div>
              </div>
              {canGenerate && (
                <div className="mt-2 flex items-center justify-start gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setGenerateMessage(null);
                      setShowGenerateModal(true);
                    }}
                    disabled={selectedAgendaIds.length === 0}
                    className="inline-flex items-center gap-1 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                  >
                    <MapPin size={14} />
                    Gerar rota
                  </button>
                  <div className="text-xs text-ink/60 text-right">
                    <div>Empresas: {totalCount}</div>
                    <div className="flex items-center justify-end gap-1">
                      <span>Selecionadas: {selectedAgendaIds.length}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedAgendaIds([])}
                        disabled={selectedAgendaIds.length === 0}
                        title="Limpar empresas selecionadas"
                        aria-label="Limpar empresas selecionadas"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink/50 transition hover:bg-sea/10 hover:text-sea disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>

          
        </div>
      </section>

      {generateMessage && (
        <div className="rounded-xl border border-sea/20 bg-white/80 px-3 py-2 text-xs text-ink/70">
          {generateMessage}
        </div>
      )}

      {columnChipRemovalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setColumnChipRemovalModal(null)}
          />
          <div className="relative w-full max-w-lg rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">
              Remover do filtro: {columnChipRemovalModal.filterLabel}
            </h3>
            <p className="mt-1 text-xs text-ink/60">
              Visualize as empresas impactadas antes de remover este filtro.
            </p>

            <div className="mt-3 flex items-center justify-between text-xs text-ink/70">
              <button
                type="button"
                className="text-sea hover:text-seaLight"
                onClick={selectOnlyTriggeredColumnChipValue}
              >
                Somente valor clicado
              </button>
              <button
                type="button"
                className="text-sea hover:text-seaLight"
                onClick={selectAllColumnChipModalValues}
              >
                Todos desta coluna
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {columnChipRemovalModal.selectedValues.map((value) => (
                <span
                  key={value}
                  className="rounded-full border border-sea/25 bg-sea/10 px-2 py-1 text-[11px] font-semibold text-sea"
                >
                  {columnChipRemovalModal.filterLabel}: {value}
                </span>
              ))}
            </div>

            <div className="mt-3 max-h-64 space-y-2 overflow-auto rounded-xl border border-sea/15 bg-white/90 p-2">
              {impactedCompaniesPreview.length === 0 ? (
                <p className="px-2 py-1 text-xs text-ink/60">Nenhuma empresa impactada na pagina atual.</p>
              ) : (
                pagedImpactedCompanies.map((company) => {
                  const checked = columnChipRemovalModal.selectedCompanyIds.includes(company.id);
                  return (
                    <label
                      key={company.id}
                      className="flex cursor-pointer items-start justify-between gap-2 rounded-lg border border-sea/10 bg-white px-2 py-2 text-xs text-ink hover:bg-sea/5"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{company.companyName}</p>
                        <p className="mt-1 text-[11px] text-ink/60">
                          COD: {company.code} | {company.neighborhood} - {company.city}
                        </p>
                        <p className="text-[11px] text-ink/60">
                          Valor do filtro: {company.filterValue || "-"}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleImpactedCompanySelection(company.id)}
                        className="mt-1 h-4 w-4 shrink-0 accent-sea"
                      />
                    </label>
                  );
                })
              )}
            </div>

            {impactedCompaniesPreview.length > 0 && (
              <div className="mt-2 flex items-center justify-between text-[11px] text-ink/70">
                <span>
                  Pagina {columnChipRemovalPageIndex + 1} de {impactedCompaniesPageCount} (
                  {impactedCompaniesPreview.length} empresas)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setColumnChipRemovalPageIndex((prev) => Math.max(prev - 1, 0))
                    }
                    disabled={columnChipRemovalPageIndex === 0}
                    className="rounded border border-sea/30 px-2 py-1 disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setColumnChipRemovalPageIndex((prev) =>
                        Math.min(prev + 1, impactedCompaniesPageCount - 1),
                      )
                    }
                    disabled={columnChipRemovalPageIndex >= impactedCompaniesPageCount - 1}
                    className="rounded border border-sea/30 px-2 py-1 disabled:opacity-50"
                  >
                    Proxima
                  </button>
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between text-[11px] text-ink/70">
              <button
                type="button"
                className="text-sea hover:text-seaLight"
                onClick={selectAllImpactedCompaniesForRemoval}
              >
                Selecionar todas empresas
              </button>
              <button
                type="button"
                className="text-ink/70 hover:text-ink"
                onClick={clearImpactedCompaniesSelection}
              >
                Limpar selecao
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-xs text-ink/60">
                Selecionadas para sair: {columnChipRemovalModal.selectedCompanyIds.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setColumnChipRemovalModal(null)}
                  className="rounded-lg border border-sea/30 bg-white/90 px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={applyColumnChipRemoval}
                  className="rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                  disabled={columnChipRemovalModal.selectedValues.length === 0}
                >
                  Aplicar remocao
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => (generating ? null : setShowGenerateModal(false))}
          />
          <div className="relative w-full max-w-lg rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Gerar visitas</h3>
            <p className="mt-1 text-xs text-ink/60">
              Selecione os vendedores, a data e as empresas marcadas na lista para gerar as visitas.
            </p>
            <p className="mt-2 text-xs text-ink/60">
              Empresas selecionadas: {selectedAgendaIds.length}
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-2 text-xs font-semibold text-ink/70">
                Vendedores destino
                <div className="rounded-xl border border-sea/20 bg-white/90 p-3">
                  <input
                    value={vendorQuery}
                    onChange={(event) => setVendorQuery(event.target.value)}
                    placeholder="Buscar vendedor..."
                    id="agenda-generate-vendor-search"
                    name="agendaGenerateVendorSearch"
                    className="w-full rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                  />
                  <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                    {filteredVendedores.length === 0 ? (
                      <p className="text-xs text-ink/60">Nenhum vendedor encontrado.</p>
                    ) : (
                      filteredVendedores.map((vendor) => {
                        const checked = selectedVendorIds.includes(vendor.user_id);
                        return (
                          <label
                            key={vendor.user_id}
                            className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1 text-xs text-ink hover:bg-sea/10"
                          >
                            <span>{vendor.display_name ?? vendor.user_id}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleVendor(vendor.user_id)}
                              name={`agendaGenerateVendor-${vendor.user_id}`}
                              className="h-4 w-4 accent-sea"
                            />
                          </label>
                        );
                      })
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-ink/60">
                    <button
                      type="button"
                      className="text-sea"
                      onClick={() => setSelectedVendorIds(vendedores.map((vendor) => vendor.user_id))}
                    >
                      Selecionar todos
                    </button>
                    <button type="button" onClick={() => setSelectedVendorIds([])}>
                      Limpar
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-ink/60">
                    Selecionados: {selectedVendorIds.length}
                  </p>
                </div>
              </div>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                Data da visita
                <input
                  type="date"
                  value={visitDate}
                  onChange={(event) => setVisitDate(event.target.value)}
                  id="agenda-generate-visit-date"
                  name="agendaGenerateVisitDate"
                  className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                />
              </label>
            </div>
            {generateMessage && (
              <p className="mt-3 text-xs text-ink/70">{generateMessage}</p>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowGenerateModal(false)}
                disabled={generating}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGenerateVisits}
                disabled={
                  selectedVendorIds.length === 0 ||
                  selectedAgendaIds.length === 0 ||
                  !visitDate ||
                  generating
                }
                className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {generating ? "Gerando..." : `Confirmar (${selectedAgendaIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {scheduleModalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => (scheduleSaving ? null : closeScheduleModal())}
          />
          <div className="relative w-full max-w-3xl rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg text-ink">Visitas agendadas</h3>
                <p className="mt-1 text-xs text-ink/60">
                  {scheduleModalRow.empresa ?? "Empresa"}
                </p>
              </div>
              <span className="rounded-full bg-sea/10 px-2 py-1 text-[10px] font-semibold text-sea">
                COD {scheduleModalRow.cod_1 ?? "-"}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {scheduleDrafts.length === 0 ? (
                <p className="text-xs text-ink/60">Nenhuma visita agendada.</p>
              ) : (
                scheduleDrafts.map((draft, index) => (
                  <div
                    key={draft.id ?? `draft-${index}`}
                    className="rounded-2xl border border-sea/20 bg-white/90 p-3"
                  >
                    <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr_auto] md:items-end">
                      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                        Vendedor
                        <select
                          value={draft.vendorId}
                          onChange={(event) =>
                            updateScheduleDraft(index, { vendorId: event.target.value })
                          }
                          disabled={scheduleSaving}
                          className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea disabled:opacity-60"
                        >
                          <option value="">Selecione</option>
                          {draft.vendorId &&
                            !vendedores.some((vendor) => vendor.user_id === draft.vendorId) && (
                              <option value={draft.vendorId}>
                                {vendorById.get(draft.vendorId) ?? draft.vendorName ?? draft.vendorId}
                              </option>
                            )}
                          {vendedores.map((vendor) => (
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
                          value={draft.date}
                          onChange={(event) => updateScheduleDraft(index, { date: event.target.value })}
                          disabled={scheduleSaving}
                          className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea disabled:opacity-60"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                        Perfil visita
                        <select
                          value={
                            draft.perfilCustom
                              ? "__custom__"
                              : draft.perfilSingleTimeBase || getSingleTimePerfilBase(draft.perfil) || normalizePerfilVisita(draft.perfil)
                          }
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value === "__custom__") {
                              updateScheduleDraft(index, {
                                perfilCustom: true,
                                perfilSingleTimeBase: "",
                                perfilSingleTimeValue: "",
                                perfil: draft.perfilCustom ? draft.perfil : "",
                                customTimes:
                                  draft.perfilCustom && (draft.customTimes?.length ?? 0) > 0
                                    ? draft.customTimes
                                    : [""],
                              });
                              return;
                            }
                            if (value === "ALMOCO" || value === "JANTAR") {
                              updateScheduleDraft(index, {
                                perfilCustom: false,
                                perfilSingleTimeBase: value,
                                perfilSingleTimeValue: "",
                                perfil: value,
                                customTimes: [],
                              });
                              return;
                            }
                            updateScheduleDraft(index, {
                              perfilCustom: false,
                              perfilSingleTimeBase: "",
                              perfilSingleTimeValue: "",
                              perfil: value,
                              customTimes: [],
                            });
                          }}
                          disabled={scheduleSaving}
                          className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea disabled:opacity-60"
                        >
                          <option value="">Selecione</option>
                          {PERFIL_VISITA_PRESETS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                          <option value="__custom__">Horario customizado</option>
                        </select>
                        {!draft.perfilCustom &&
                          ((draft.perfilSingleTimeBase || getSingleTimePerfilBase(draft.perfil)) === "ALMOCO" ||
                            (draft.perfilSingleTimeBase || getSingleTimePerfilBase(draft.perfil)) === "JANTAR") && (
                          <input
                            type="time"
                            value={draft.perfilSingleTimeValue ?? getSingleTimePerfilValue(draft.perfil)}
                            onChange={(event) =>
                              updateScheduleDraft(index, {
                                perfilSingleTimeValue: event.target.value,
                                perfil: event.target.value
                                  ? `${draft.perfilSingleTimeBase || getSingleTimePerfilBase(draft.perfil)} ${event.target.value}`
                                  : draft.perfilSingleTimeBase || getSingleTimePerfilBase(draft.perfil) || "",
                              })
                            }
                            disabled={scheduleSaving}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-[11px] text-ink outline-none focus:border-sea disabled:opacity-60"
                          />
                        )}
                        {draft.perfilCustom && (
                          <div className="flex flex-wrap items-center gap-2">
                            {(draft.customTimes && draft.customTimes.length ? draft.customTimes : [""]).map(
                              (time, timeIndex) => (
                                <div
                                  key={`${draft.id ?? index}-custom-${timeIndex}`}
                                  className="flex items-center gap-2"
                                >
                                  <input
                                    type="time"
                                    value={time}
                                    onChange={(event) => {
                                      const base = draft.customTimes && draft.customTimes.length ? draft.customTimes : [""];
                                      const next = [...base];
                                      next[timeIndex] = event.target.value;
                                      const cleaned = next.map((item) => item.trim()).filter(Boolean);
                                      updateScheduleDraft(index, {
                                        customTimes: next,
                                        perfil: cleaned.join(" • "),
                                      });
                                    }}
                                    disabled={scheduleSaving}
                                    className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-[11px] text-ink outline-none focus:border-sea disabled:opacity-60"
                                  />
                                  {timeIndex === (draft.customTimes && draft.customTimes.length ? draft.customTimes.length : 1) - 1 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const base = draft.customTimes && draft.customTimes.length ? draft.customTimes : [""];
                                        updateScheduleDraft(index, { customTimes: [...base, ""] });
                                      }}
                                      disabled={scheduleSaving}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-60"
                                      title="Adicionar horario"
                                      aria-label="Adicionar horario"
                                    >
                                      +
                                    </button>
                                  )}
                                  {(draft.customTimes?.length ?? 0) > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const base = draft.customTimes && draft.customTimes.length ? draft.customTimes : [""];
                                        const next = base.filter((_, idx) => idx !== timeIndex);
                                        const cleaned = next.map((item) => item.trim()).filter(Boolean);
                                        updateScheduleDraft(index, {
                                          customTimes: next.length ? next : [""],
                                          perfil: cleaned.join(" • "),
                                        });
                                      }}
                                      disabled={scheduleSaving}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-60"
                                      title="Remover horario"
                                      aria-label="Remover horario"
                                    >
                                      -
                                    </button>
                                  )}
                                </div>
                              ),
                            )}
                          </div>
                        )}
                      </label>
                      <button
                        type="button"
                        onClick={() => removeScheduleDraft(index)}
                        disabled={scheduleSaving}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600 hover:border-red-300 disabled:opacity-60"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {scheduleError && (
              <p className="mt-3 text-xs text-red-500">{scheduleError}</p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleAddScheduleDraft}
                disabled={scheduleSaving}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
              >
                Adicionar vendedor
              </button>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={closeScheduleModal}
                  disabled={scheduleSaving}
                  className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleScheduleSave}
                  disabled={scheduleSaving}
                  className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                >
                  {scheduleSaving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailsModalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => {
              closeDetailsModal();
            }}
          />
          <div className="relative w-full max-w-lg rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-lg text-ink">Detalhes da empresa</h3>
              <button
                type="button"
                onClick={() => {
                  closeDetailsModal();
                }}
                className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Fechar
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-ink/80">
              <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                <p className="text-[11px] font-semibold text-ink/60">Nome da empresa</p>
                <p className="mt-1 font-semibold text-ink">
                  {detailsModalRow.empresa ?? "-"}{" "}
                  <span className="text-sea/80">{"{"}COD {detailsModalRow.cod_1 ?? "-"}{"}"}</span>
                </p>
              </div>
              <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                <p className="text-[11px] font-semibold text-ink/60">Endereco e numero</p>
                <p className="mt-1">
                  {[detailsModalRow.endereco, detailsModalRow.complemento].filter(Boolean).join(", ") || "-"}
                </p>
              </div>
              <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold text-ink/60">Corte | Vencimento</p>
                  <button
                    type="button"
                    onClick={() => void openPlanoValoresModal(detailsModalRow.cod_1, detailsModalRow.empresa)}
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
                <p className="mt-1">
                  {(detailsModalRow.corte ?? "-")} | {(detailsModalRow.venc ?? "-")}
                </p>
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
                  <p className="mt-1 whitespace-pre-wrap">{detailsModalRow.instructions?.trim() || "-"}</p>
                )}
                {detailsInstructionMessage ? (
                  <p className="mt-2 text-xs text-ink/70">{detailsInstructionMessage}</p>
                ) : null}
              </div>
              <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold text-ink/60">Obs</p>
                  {detailsModalRow.obs_contrato_1?.trim() ? (
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
                {detailsModalRow.obs_contrato_1?.trim() ? (
                  detailsObsExpanded ? (
                    <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-all text-sm">
                      {detailsModalRow.obs_contrato_1}
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

      {vendorHistoryModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setVendorHistoryModal(null)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-lg text-ink">Historico de vendedores</h3>
              <button
                type="button"
                onClick={() => setVendorHistoryModal(null)}
                className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Fechar
              </button>
            </div>
            <p className="mt-2 text-xs text-ink/60">
              Empresa: {vendorHistoryModal.empresa} | COD {vendorHistoryModal.codigo}
            </p>
            <div className="mt-4 space-y-2 text-sm text-ink/80">
              <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                <p className="text-[11px] font-semibold text-ink/60">Ultimo vendedor</p>
                <p className="mt-1 font-semibold text-ink">
                  {vendorHistoryModal.assignments[0]?.name ?? "-"}
                </p>
                <p className="text-xs text-ink/60">
                  Data: {formatDate(vendorHistoryModal.assignments[0]?.visitDate ?? null)}
                </p>
              </div>
              <div className="rounded-xl border border-sea/15 bg-sand/30 px-3 py-2">
                <p className="text-[11px] font-semibold text-ink/60">Penultimo vendedor</p>
                <p className="mt-1 font-semibold text-ink">
                  {vendorHistoryModal.assignments[1]?.name ?? "-"}
                </p>
                <p className="text-xs text-ink/60">
                  Data: {formatDate(vendorHistoryModal.assignments[1]?.visitDate ?? null)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}


      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={chip.onRemove}
              className="inline-flex items-center gap-1 rounded-full border border-sea/30 bg-white/80 px-3 py-1 text-xs text-sea hover:border-sea hover:text-seaLight"
            >
              <span>{chip.label}</span>
              <X size={12} aria-hidden />
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-sea/15 bg-white/90">
        <div className="md:hidden">
          {loading ? (
            <div className="px-4 py-6 text-center text-sm text-ink/60">Carregando agenda...</div>
          ) : error ? (
            <div className="px-4 py-6 text-center text-sm text-red-500">{error}</div>
          ) : displayData.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-ink/60">
              {hasActiveCompanySearch ? "Termo nao encontrado." : "Nenhum registro encontrado."}
            </div>
          ) : (
            <div className="space-y-4 px-4 py-4">
              {displayData.map((row) => {
                const empresaLabel = row.empresa ?? "Sem empresa";
                const recentVendors = resolveVendorsForAgenda(row.id, row.vendedor);
                const mobileVendorLabel = recentVendors.length
                  ? recentVendors.map((item) => item.name).join(", ")
                  : "-";
                return (
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedRow(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedRow(row);
                      }
                    }}
                    className="w-full rounded-2xl border border-sea/15 bg-white/95 p-5 text-left shadow-sm transition hover:shadow-card focus:outline-none focus:ring-2 focus:ring-sea/50"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-2">
                          <p className="break-words text-sm font-semibold text-ink">{empresaLabel}</p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full bg-sea/10 px-2 py-0.5 text-[10px] font-semibold text-sea">
                              COD {row.cod_1 ?? "-"}
                            </span>
                            {row.categoria ? (() => {
                              const badge = getCategoriaBadgeStyles(row.categoria);
                              return <span className={badge.className}>{badge.label}</span>;
                            })() : null}
                          </div>
                        </div>
                        <div
                          className="shrink-0"
                          onClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <label className="inline-flex items-center gap-1 rounded-full border border-sea/20 bg-white px-2 py-1 text-[10px] text-ink/70">
                            <input
                              type="checkbox"
                              checked={selectedAgendaSet.has(row.id)}
                              onChange={() => toggleAgendaSelection(row.id)}
                              className="h-3.5 w-3.5 accent-sea"
                              aria-label="Selecionar empresa"
                            />
                            Sel.
                          </label>
                        </div>
                      </div>

                      <div className="grid gap-1 text-[11px] text-ink/70">
                        <p className="break-words">
                          <span className="font-semibold text-ink/80">Cidade:</span>{" "}
                          {(row.cidade ?? "-")} / {(row.uf ?? "-")}
                        </p>
                        <p className="break-words">
                          <span className="font-semibold text-ink/80">Bairro:</span> {row.bairro ?? "-"}
                        </p>
                        <p className="break-words">
                          <span className="font-semibold text-ink/80">Vendedor:</span> {mobileVendorLabel}
                        </p>
                        <p className="break-words">
                          <span className="font-semibold text-ink/80">Ultima visita:</span>{" "}
                          {resolveLastCompletedVisitDate(row.id, row.data_da_ultima_visita)}
                        </p>
                        <p className="break-words">
                          <span className="font-semibold text-ink/80">Vidas ultima visita:</span>{" "}
                          {resolveLastCompletedVidas(row.id, row.visit_completed_vidas)}
                        </p>
                      </div>

                      {(() => {
                        const scheduledObs = resolveScheduledObsVisit(row.id, row.instructions);
                        const hasAnyHistoryDate = recentVendors.some((item) => Boolean(item.visitDate));
                        if (!scheduledObs && !hasAnyHistoryDate) return null;
                        const visitDate = scheduledObs?.visitDate ?? null;
                        const firstInstructions = scheduledObs?.instructions ?? "";
                        const badgeText = formatVisitBadge(visitDate);
                        const titleText = visitDate
                          ? `Visita agendada: ${formatDate(visitDate)}${
                              firstInstructions ? ` | Instrucoes: ${firstInstructions}` : ""
                            }`
                          : firstInstructions
                            ? `Instrucoes: ${firstInstructions}`
                            : "Visita agendada";
                        const historyTooltip = "Ver historico de atribuicao";
                        return (
                          <div className="flex flex-wrap items-start gap-2">
                            {scheduledObs ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openScheduleModal(row);
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                className="inline-flex min-h-7 items-center justify-center rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-700"
                                title={titleText}
                                aria-label={titleText}
                              >
                                {badgeText}
                              </button>
                            ) : null}
                            {hasAnyHistoryDate ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setVendorHistoryModal({
                                    empresa: row.empresa ?? row.nome_fantasia ?? "Sem empresa",
                                    codigo: row.cod_1 ?? "-",
                                    assignments: recentVendors.map((item) => ({
                                      name: item.name,
                                      visitDate: item.visitDate,
                                    })),
                                  });
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-orange-300 bg-orange-50 text-orange-600 hover:border-orange-400 hover:text-orange-700"
                                title={historyTooltip}
                                aria-label={historyTooltip}
                              >
                                <Clock3 size={12} />
                              </button>
                            ) : null}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sea/15 px-4 py-3 text-xs text-ink/60">
            <div>
              Pagina {pageIndex + 1} de {Math.max(1, Math.ceil(totalCount / pageSize))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                disabled={pageIndex === 0}
                className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setPageIndex((prev) => prev + 1)}
                disabled={(pageIndex + 1) * pageSize >= totalCount}
                className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1 disabled:opacity-50"
              >
                Proxima
              </button>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1"
              >
                {[25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size} / pagina
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-xs">
              <thead className="sticky top-0 z-30 bg-sand/60 shadow-sm overflow-visible">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const isTight = header.column.id === "select" || header.column.id === "obs";
                      const explicitWidth = compactColumnWidths[header.column.id];
                      const columnStyles = explicitWidth
                        ? {
                            width: explicitWidth,
                            minWidth: explicitWidth,
                            maxWidth: explicitWidth,
                          }
                        : undefined;
                      return (
                        <th
                          key={header.id}
                          style={columnStyles}
                          className={`relative align-top whitespace-normal border-b border-sea/20 py-2 text-[11px] font-semibold text-ink/70 text-center overflow-visible ${
                            isTight ? "px-1" : "px-2"
                          }`}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-ink/60">
                      Carregando agenda...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-red-500">
                      {error}
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-ink/60">
                      {hasActiveCompanySearch ? "Termo nao encontrado." : "Nenhum registro encontrado."}
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b border-sea/10 hover:bg-sea/10"
                      onClick={() => {
                        setSelectedRow(row.original);
                        setSelectedRowId(row.original.id);
                      }}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const isTight = cell.column.id === "select" || cell.column.id === "obs";
                        const explicitWidth = compactColumnWidths[cell.column.id];
                        const columnStyles = explicitWidth
                          ? {
                              width: explicitWidth,
                              minWidth: explicitWidth,
                              maxWidth: explicitWidth,
                            }
                          : undefined;
                        return (
                          <td
                            key={cell.id}
                            style={columnStyles}
                            className={`whitespace-normal break-words py-2 text-xs text-ink ${
                              isTight ? "px-1 text-center" : "px-2"
                            }`}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sea/15 px-4 py-3 text-xs text-ink/60">
            <div>
              Pagina {pageIndex + 1} de {Math.max(1, Math.ceil(totalCount / pageSize))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                disabled={pageIndex === 0}
                className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setPageIndex((prev) => prev + 1)}
                disabled={(pageIndex + 1) * pageSize >= totalCount}
                className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1 disabled:opacity-50"
              >
                Proxima
              </button>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1"
              >
                {[25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size} / pagina
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <AgendaDrawer
        key={selectedRow?.id ?? "agenda-drawer"}
        row={selectedRow}
        onClose={() => {
          setSelectedRow(null);
          setSelectedRowId(null);
        }}
        canEdit={canEdit}
        canManageInstruction={canManageInstruction}
        userEmail={session?.user.email ?? null}
        vendorOptions={vendorOptions}
        supervisorOptions={supervisores
          .map((supervisor) => supervisor.display_name)
          .filter((value): value is string => Boolean(value))}
        onUpdated={handleDrawerUpdated}
        onDeleted={handleDrawerDeleted}
      />
    </div>
  );
}




