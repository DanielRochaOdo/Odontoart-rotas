import { supabase } from "./supabase";
import type { AgendaFilters, AgendaRow } from "../types/agenda";
import type { SortingState } from "@tanstack/react-table";
import { normalizeText } from "./textNormalize";
import {
  buildCategoriaRawMap,
  CATEGORIA_FILTER_SEM_CATEGORIA,
  CATEGORIA_OPTIONS,
} from "./categorias";
import {
  fetchFilaRoutingBlockLists,
  isMissingFilaBackendError,
  type FilaRoutingBlockLists,
} from "./filaApi";

const GLOBAL_SEARCH_COLUMNS = [
  "empresa",
  "cidade",
  "uf",
  "vendedor",
  "supervisor",
  "situacao",
  "categoria",
  "grupo",
  "perfil_visita",
  "endereco",
  "bairro",
];

const normalizeOption = (value: string) =>
  value.trim().replace(/\s+/g, " ").toUpperCase();

const CATEGORIA_SEM_CATEGORIA_NORMALIZED = normalizeOption(CATEGORIA_FILTER_SEM_CATEGORIA);

const formatOrValues = (values: string[]) =>
  values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",");

const SITUACAO_OPTIONS = ["Ativo", "Suspenso/Inadimplente", "Cancelado"] as const;

const buildSituacaoRawMap = () => {
  const rawMap = new Map<string, string[]>();
  rawMap.set(normalizeOption("Ativo"), ["Ativo", "ATIVO"]);
  rawMap.set(normalizeOption("Suspenso/Inadimplente"), [
    "Suspenso/Inadimplente",
    "Suspenso/Inadimlente",
    "SUSPENSO/INADIMPLENTE",
    "SUSPENSO/INADIMLENTE",
  ]);
  rawMap.set(normalizeOption("Cancelado"), ["Cancelado", "CANCELADO", "Cancelado1", "CANCELADO1"]);
  return rawMap;
};

const expandSituacaoValues = (values: string[]) => {
  const rawMap = buildSituacaoRawMap();
  const normalized = values.map((value) => normalizeOption(value)).filter(Boolean);
  const expanded = normalized.flatMap((value) => rawMap.get(value) ?? [value]);
  return Array.from(new Set(expanded)).filter(Boolean);
};

const normalizeMatchKey = (value: string) =>
  normalizeText(normalizeOption(value), { letterCase: "upper" });

const normalizePerfilVisitaOption = (value: string) => {
  const match = normalizeMatchKey(value);
  if (!match) return "";
  if (match.includes("ALMOCO")) return "ALMOCO";
  if (match.includes("JANTAR")) return "JANTAR";
  if (match.includes("HORARIO COMERCIAL")) return "HORARIO COMERCIAL";
  if (match.includes("HORARIO CUSTOMIZADO")) return "HORARIO CUSTOMIZADO";
  if (/\b\d{1,2}:\d{2}\b/.test(match)) return "HORARIO CUSTOMIZADO";
  return normalizeOption(value);
};

const extractPerfilVisitaOptions = (value: string) => {
  const match = normalizeMatchKey(value);
  if (!match) return [] as string[];

  const tags = new Set<string>();
  if (match.includes("ALMOCO")) tags.add("ALMOCO");
  if (match.includes("JANTAR")) tags.add("JANTAR");
  if (match.includes("HORARIO COMERCIAL")) tags.add("HORARIO COMERCIAL");
  if (match.includes("HORARIO CUSTOMIZADO")) tags.add("HORARIO CUSTOMIZADO");
  if (/\b\d{1,2}:\d{2}\b/.test(match)) tags.add("HORARIO CUSTOMIZADO");
  if (tags.size === 0) tags.add(normalizeOption(value));
  return Array.from(tags);
};

const buildPerfilVisitaCondition = (value: string) => {
  const normalized = normalizePerfilVisitaOption(value);
  if (normalized === "ALMOCO") {
    return "perfil_visita.ilike.%ALMO%";
  }
  if (normalized === "JANTAR") {
    return "perfil_visita.ilike.%JANTAR%";
  }
  if (normalized === "HORARIO COMERCIAL") {
    return "perfil_visita.ilike.%COMERCIAL%";
  }
  if (normalized === "HORARIO CUSTOMIZADO") {
    return "perfil_visita.ilike.%CUSTOMIZADO%";
  }
  return `perfil_visita.eq.${normalized}`;
};

const parseOptionalNumber = (value?: string) => {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const isStatementTimeoutError = (message?: string | null) =>
  (message ?? "").toLowerCase().includes("statement timeout");

const dedupeAgendaRows = <T extends Partial<AgendaRow>>(rows: T[]) => {
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (!row.id) continue;
    if (!byId.has(row.id)) {
      byId.set(row.id, row);
    }
  }
  return Array.from(byId.values());
};

const applyFilaRoutingExclusionsToClientesQuery = <T,>(
  query: T,
  blocks: Pick<FilaRoutingBlockLists, "blockedEmpresaIds" | "blockedCodigos"> | null,
): T => {
  // Avoid generating huge `id=not.in(...)` URLs that trigger statement timeout.
  // Exclusions are applied client-side for first-page list flow.
  void blocks;
  return query;
};

const resolveFilaRoutingBlocks = async () => {
  try {
    const blocks = await fetchFilaRoutingBlockLists();
    if (!blocks.blockedEmpresaIds.length) return null;
    return blocks;
  } catch (error) {
    const maybeError = error as { code?: string; message?: string };
    if (isMissingFilaBackendError(maybeError)) return null;
    throw error;
  }
};

const mapAgendaColumnToClientes = (column: string) => {
  if (column === "cod_1") return "codigo";
  if (column === "obs_contrato_1") return "obs_comercial";
  return column;
};

const getVidasRange = (filters: AgendaFilters) => {
  const range = filters.ranges?.vidas_ultima_visita;
  const from = parseOptionalNumber(range?.from);
  const to = parseOptionalNumber(range?.to);
  if (from === null && to === null) return null;
  return { from, to };
};

const stripVidasRange = (filters: AgendaFilters): AgendaFilters => ({
  ...filters,
  ranges: {
    ...filters.ranges,
    vidas_ultima_visita: {},
  },
});

type VisitCompletedRow = {
  cliente_id: string | null;
  completed_vidas: number | null;
  completed_at: string | null;
  visit_date: string | null;
  visit_type?: string | null;
};

type LatestVisitDateBounds = {
  from: string | null;
  to: string | null;
  invert: boolean;
  active: boolean;
};

const fetchAgendaIdsByLatestCompletedVidas = async (range: { from: number | null; to: number | null }) => {
  const latestByCliente = new Map<string, number>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("visits")
      .select("cliente_id, completed_vidas, completed_at, visit_date")
      .not("cliente_id", "is", null)
      .not("completed_vidas", "is", null)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .order("visit_date", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as VisitCompletedRow[];
    if (rows.length === 0) break;

    rows.forEach((row) => {
      if (!row.cliente_id) return;
      if (latestByCliente.has(row.cliente_id)) return;
      if (row.completed_vidas === null || row.completed_vidas === undefined) return;
      latestByCliente.set(row.cliente_id, row.completed_vidas);
    });

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const clienteIds: string[] = [];
  latestByCliente.forEach((vidas, clienteId) => {
    if (range.from !== null && vidas < range.from) return;
    if (range.to !== null && vidas > range.to) return;
    clienteIds.push(clienteId);
  });

  return clienteIds;
};

const isVendorVisitTypeValue = (visitType?: string | null) =>
  (visitType ?? "VENDEDOR") === "VENDEDOR";

const resolveLastVisitDateBounds = (filters: AgendaFilters): LatestVisitDateBounds => {
  const { month, year, from, to, invert } = filters.dateRanges.data_da_ultima_visita;
  const hasMonthYear = Boolean(month || year);

  if (!hasMonthYear) {
    return {
      from: from?.trim() || null,
      to: to?.trim() || null,
      invert: Boolean(invert),
      active: Boolean(from?.trim() || to?.trim()),
    };
  }

  const fallbackYear = year || (month ? String(new Date().getFullYear()) : undefined);
  if (!fallbackYear) {
    return { from: null, to: null, invert: Boolean(invert), active: false };
  }

  const numericYear = Number(fallbackYear);
  if (!Number.isFinite(numericYear)) {
    return { from: null, to: null, invert: Boolean(invert), active: false };
  }

  if (month) {
    const numericMonth = Number(month);
    if (!Number.isFinite(numericMonth) || numericMonth < 1 || numericMonth > 12) {
      return { from: null, to: null, invert: Boolean(invert), active: false };
    }
    const startDate = new Date(numericYear, numericMonth - 1, 1);
    const endDate = new Date(numericYear, numericMonth, 0);
    return {
      from: startDate.toISOString().slice(0, 10),
      to: endDate.toISOString().slice(0, 10),
      invert: Boolean(invert),
      active: true,
    };
  }

  return {
    from: new Date(numericYear, 0, 1).toISOString().slice(0, 10),
    to: new Date(numericYear, 11, 31).toISOString().slice(0, 10),
    invert: Boolean(invert),
    active: true,
  };
};

const isDateWithinBounds = (dateKey: string, bounds: LatestVisitDateBounds) => {
  const afterStart = !bounds.from || dateKey >= bounds.from;
  const beforeEnd = !bounds.to || dateKey <= bounds.to;
  const inside = afterStart && beforeEnd;
  return bounds.invert ? !inside : inside;
};

const stripLastVisitDateRange = (filters: AgendaFilters): AgendaFilters => ({
  ...filters,
  dateRanges: {
    ...filters.dateRanges,
    data_da_ultima_visita: {},
  },
});

const excludeFilaBlockedIds = (
  ids: string[] | null,
  filaBlocks: Pick<FilaRoutingBlockLists, "blockedEmpresaIds"> | null,
) => {
  if (!ids || !filaBlocks?.blockedEmpresaIds.length) return ids;
  const blocked = new Set(filaBlocks.blockedEmpresaIds);
  return ids.filter((id) => !blocked.has(id));
};

const fetchAgendaIdsByLatestRegisteredVisitDate = async (
  filters: AgendaFilters,
  candidateAgendaIds?: string[] | null,
) => {
  const bounds = resolveLastVisitDateBounds(filters);
  if (!bounds.active) return null;
  if (candidateAgendaIds && candidateAgendaIds.length === 0) return [];

  const latestByCliente = new Map<string, string>();
  const pageSize = 1000;
  const visitPageSize = candidateAgendaIds ? 100 : pageSize;

  const collectRows = (rows: VisitCompletedRow[]) => {
    rows.forEach((row) => {
      if (!row.cliente_id || !row.visit_date) return;
      if (!isVendorVisitTypeValue(row.visit_type)) return;
      if (latestByCliente.has(row.cliente_id)) return;
      latestByCliente.set(row.cliente_id, row.visit_date.slice(0, 10));
    });
  };

  if (candidateAgendaIds) {
    for (let index = 0; index < candidateAgendaIds.length; index += visitPageSize) {
      const chunk = candidateAgendaIds.slice(index, index + visitPageSize);
      const { data, error } = await supabase
        .from("visits")
        .select("cliente_id, completed_vidas, completed_at, visit_date, visit_type")
        .in("cliente_id", chunk)
        .not("completed_at", "is", null)
        .not("visit_date", "is", null)
        .order("completed_at", { ascending: false })
        .order("visit_date", { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      collectRows((data ?? []) as VisitCompletedRow[]);
    }
  } else {
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("visits")
        .select("cliente_id, completed_vidas, completed_at, visit_date, visit_type")
        .not("cliente_id", "is", null)
        .not("completed_at", "is", null)
        .not("visit_date", "is", null)
        .order("completed_at", { ascending: false })
        .order("visit_date", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) {
        throw new Error(error.message);
      }

      const rows = (data ?? []) as VisitCompletedRow[];
      if (rows.length === 0) break;
      collectRows(rows);

      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }

  const clienteIds: string[] = [];
  latestByCliente.forEach((dateKey, clienteId) => {
    if (isDateWithinBounds(dateKey, bounds)) {
      clienteIds.push(clienteId);
    }
  });

  return clienteIds;
};

type OptionsCacheEntry = {
  options: string[];
  rawMap: Map<string, string[]>;
};

const optionsCache = new Map<string, OptionsCacheEntry>();
const CLIENTES_FILTER_COLUMN_MAP: Record<string, string> = {
  supervisor: "supervisor",
  vendedor: "vendedor",
  cod_1: "codigo",
  empresa_nome: "empresa",
  grupo: "grupo",
  perfil_visita: "perfil_visita",
  bairro: "bairro",
  cidade: "cidade",
  uf: "uf",
  endereco: "endereco",
  situacao: "situacao",
  categoria: "categoria",
};

const CLIENTES_DYNAMIC_FILTER_KEYS = Object.keys(CLIENTES_FILTER_COLUMN_MAP).filter(
  (key) => key !== "situacao" && key !== "categoria",
);
const CLIENTES_DYNAMIC_FILTER_COLUMNS = Array.from(
  new Set(
    CLIENTES_DYNAMIC_FILTER_KEYS.map((key) =>
      mapAgendaColumnToClientes(CLIENTES_FILTER_COLUMN_MAP[key] ?? key),
    ),
  ),
);
const CLIENTES_DYNAMIC_FILTER_PAIRS = CLIENTES_DYNAMIC_FILTER_KEYS.map((key) => ({
  key,
  column: mapAgendaColumnToClientes(CLIENTES_FILTER_COLUMN_MAP[key] ?? key),
}));

let clientesOptionsBuildPromise: Promise<void> | null = null;

const fetchColumnValuesPaged = async (
  sourceTable: "clientes",
  targetColumns: string[],
  filaBlocks: Pick<FilaRoutingBlockLists, "blockedEmpresaIds" | "blockedCodigos"> | null,
) => {
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 1000;
  let cursorId: string | null = null;
  let guard = 0;
  const maxBatches = 200;
  const selectColumns = Array.from(new Set(["id", ...targetColumns])).join(", ");

  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = supabase.from(sourceTable).select(selectColumns).order("id", { ascending: true }).limit(pageSize);
    query = applyFilaRoutingExclusionsToClientesQuery(query, filaBlocks);
    if (cursorId) {
      query = query.gt("id", cursorId);
    }

    const response = (await query) as unknown as {
      data: Array<Record<string, unknown>> | null;
      error: { message: string } | null;
    };

    const { data, error } = response;

    if (error) throw new Error(error.message);

    const batch = data ?? [];
    if (batch.length === 0) break;
    batch.forEach((row) => {
      const hasSomeValue = targetColumns.some((column) => {
        const value = row[column as keyof typeof row];
        return value !== null && value !== undefined && String(value).trim() !== "";
      });
      if (hasSomeValue) rows.push(row);
    });
    if (batch.length < pageSize) break;

    const lastId = batch[batch.length - 1]?.id;
    const nextCursor = lastId ? String(lastId) : null;
    if (!nextCursor || nextCursor === cursorId) break;
    cursorId = nextCursor;

    guard += 1;
    if (guard >= maxBatches) {
      console.warn(`fetchColumnValuesPaged reached max batches for ${sourceTable}.`);
      break;
    }
  }

  return rows;
};

const expandFilterValues = (key: string, values: string[]) => {
  const entry = optionsCache.get(key);
  if (!entry) {
    return values;
  }

  const expanded = values.flatMap((value) => entry.rawMap.get(value) ?? value);
  return Array.from(new Set(expanded)).filter(Boolean);
};

type AgendaPerfilRow = {
  id: string;
  perfil_visita: string | null;
  instructions?: string | null;
  cod_1?: string | null;
  empresa?: string | null;
  nome_fantasia?: string | null;
  situacao?: string | null;
};

const applyFilters = <T,>(query: T, filters: AgendaFilters): T => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let next: any = query;

  Object.entries(filters.columns).forEach(([key, values]) => {
    if (key === "supervisor_flag") return;
    if (key === "situacao") return;
    if (!values || values.length === 0) return;
    const cleaned = values.map((value) => normalizeOption(value)).filter(Boolean);
    if (cleaned.length === 0) return;
    const expanded = expandFilterValues(key, cleaned);
    if (expanded.length === 0) return;
    const sourceKey = mapAgendaColumnToClientes(key === "empresa_nome" ? "empresa" : key);

    if (key === "empresa_nome") {
      next = next.in(sourceKey, expanded);
      return;
    }

    if (key === "perfil_visita") {
      const cacheEntry = optionsCache.get(key);
      if (cacheEntry) {
        next = next.in(sourceKey, expanded);
      } else {
        const conditions = cleaned.map(buildPerfilVisitaCondition).filter(Boolean);
        if (conditions.length) {
          next = next.or(conditions.join(","));
        }
      }
      return;
    }

    if (key === "categoria") {
      const includeSemCategoria = cleaned.includes(CATEGORIA_SEM_CATEGORIA_NORMALIZED);
      const categoriaValues = expanded.filter(
        (value) => normalizeOption(value) !== CATEGORIA_SEM_CATEGORIA_NORMALIZED,
      );

      if (includeSemCategoria) {
        const conditions = ["categoria.is.null", 'categoria.eq.""'];
        if (categoriaValues.length > 0) {
          conditions.push(`categoria.in.(${formatOrValues(categoriaValues)})`);
        }
        next = next.or(conditions.join(","));
        return;
      }

      if (categoriaValues.length > 0) {
        next = next.in(sourceKey, categoriaValues);
      }
      return;
    }

    next = next.in(sourceKey, expanded);
  });

  const explicitSituacao = filters.columns.situacao ?? [];
  const situacaoValues = explicitSituacao.length > 0 ? explicitSituacao : ["Ativo"];
  const expandedSituacao = expandSituacaoValues(situacaoValues);
  if (expandedSituacao.length > 0) {
    next = next.in("situacao", expandedSituacao);
  }

  if (filters.global) {
    const term = filters.global.replace(/%/g, "").trim();
    if (term.length) {
      const conditions = GLOBAL_SEARCH_COLUMNS.map((column) =>
        `${column}.ilike.%${term}%`,
      ).join(",");
      next = next.or(conditions);
    }
  }

  const { month, year, from, to, invert } = filters.dateRanges.data_da_ultima_visita;
  const hasMonthYear = Boolean(month || year);
  const excludeRange = Boolean(invert);
  const applyOutsideRange = (startValue: string | null, endValue: string | null) => {
    const conditions: string[] = [];
    if (startValue) {
      conditions.push(`data_da_ultima_visita.lt.${startValue}`);
    }
    if (endValue) {
      conditions.push(`data_da_ultima_visita.gt.${endValue}`);
    }
    conditions.push("data_da_ultima_visita.is.null");
    if (conditions.length) {
      next = next.or(conditions.join(","));
    }
  };

  if (!hasMonthYear) {
    if (!excludeRange) {
      if (from) {
        next = next.gte("data_da_ultima_visita", from);
      }
      if (to) {
        next = next.lte("data_da_ultima_visita", `${to}T23:59:59`);
      }
    } else if (from || to) {
      const endValue = to ? `${to}T23:59:59` : null;
      applyOutsideRange(from ?? null, endValue);
    }
  } else {
    const fallbackYear = year || (month ? String(new Date().getFullYear()) : undefined);
    if (fallbackYear) {
      const numericYear = Number(fallbackYear);
      if (!Number.isNaN(numericYear)) {
        if (month) {
          const numericMonth = Number(month);
          if (!Number.isNaN(numericMonth) && numericMonth >= 1 && numericMonth <= 12) {
            const startDate = new Date(numericYear, numericMonth - 1, 1);
            const endDate = new Date(numericYear, numericMonth, 0);
            const startValue = startDate.toISOString().slice(0, 10);
            const endValue = endDate.toISOString().slice(0, 10);
            if (!excludeRange) {
              next = next.gte("data_da_ultima_visita", startValue);
              next = next.lte("data_da_ultima_visita", `${endValue}T23:59:59`);
            } else {
              applyOutsideRange(startValue, `${endValue}T23:59:59`);
            }
          }
        } else {
          const startDate = new Date(numericYear, 0, 1);
          const endDate = new Date(numericYear, 11, 31);
          const startValue = startDate.toISOString().slice(0, 10);
          const endValue = endDate.toISOString().slice(0, 10);
          if (!excludeRange) {
            next = next.gte("data_da_ultima_visita", startValue);
            next = next.lte("data_da_ultima_visita", `${endValue}T23:59:59`);
          } else {
            applyOutsideRange(startValue, `${endValue}T23:59:59`);
          }
        }
      }
    }
  }

  const vidasRange = filters.ranges?.vidas_ultima_visita;
  const vidasFrom = parseOptionalNumber(vidasRange?.from);
  const vidasTo = parseOptionalNumber(vidasRange?.to);
  if (vidasFrom !== null) {
    next = next.gte("visit_completed_vidas", vidasFrom);
  }
  if (vidasTo !== null) {
    next = next.lte("visit_completed_vidas", vidasTo);
  }

  return next as T;
};

export type AgendaFetchResult = {
  data: AgendaRow[];
  count: number | null;
};

export type AgendaSearchFilters = {
  companyName?: string;
  companyCode?: string;
};

export type AgendaScheduledVisit = {
  id: string;
  cliente_id: string | null;
  visit_date: string;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  perfil_visita: string | null;
  instructions: string | null;
  completed_at: string | null;
  route_id: string | null;
  visit_type?: string | null;
  supervisor_reason?: string | null;
};

export type AgendaVisitVendor = {
  cliente_id: string | null;
  visit_date: string;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  completed_at: string | null;
  completed_vidas: number | null;
  no_visit_reason: string | null;
  route_id: string | null;
  visit_type?: string | null;
  supervisor_reason?: string | null;
};

type AgendaQueryContext = {
  effectiveFilters: Record<string, unknown>;
  restrictedAgendaIds: string[] | null;
  companyName: string;
  companyCode: string;
  filaBlocks: FilaRoutingBlockLists | null;
};

const AGENDA_LITE_SELECT_COLUMNS =
  "id, data_da_ultima_visita, visit_completed_vidas, cod_1:codigo, empresa, pessoa, contato, perfil_visita, corte, venc, valor, endereco, complemento, bairro, cidade, uf, supervisor, vendedor, nome_fantasia, grupo, situacao, categoria, visit_generated_at, created_at";

const normalizeAgendaLiteRows = (rows: AgendaRow[]) =>
  rows.map((row) => ({
    ...row,
    instructions: row.instructions ?? null,
    obs_contrato_1: row.obs_contrato_1 ?? null,
  }));

const hasActiveLastVisitDateRange = (filters: AgendaFilters) => {
  const dateRange = filters.dateRanges.data_da_ultima_visita;
  return Boolean(
    dateRange.from?.trim() ||
      dateRange.to?.trim() ||
      dateRange.month?.trim() ||
      dateRange.year?.trim(),
  );
};

const fetchAgendaFirstPageLiteDirect = async (
  pageIndex: number,
  pageSize: number,
  filters: AgendaFilters,
  context: AgendaQueryContext,
) => {
  if (context.restrictedAgendaIds && context.restrictedAgendaIds.length === 0) {
    return [] as AgendaRow[];
  }

  const pageOffset = pageIndex * pageSize;
  const queryFilters = context.restrictedAgendaIds ? stripLastVisitDateRange(filters) : filters;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("clientes")
    .select(AGENDA_LITE_SELECT_COLUMNS)
    .order("visit_generated_at", { ascending: false, nullsFirst: false })
    .order("data_da_ultima_visita", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true });

  query = applyFilaRoutingExclusionsToClientesQuery(query, context.filaBlocks);
  query = applyFilters(query, queryFilters);
  if (context.restrictedAgendaIds) {
    query = query.in("id", context.restrictedAgendaIds);
  }

  if (context.companyName) {
    const term = context.companyName.replace(/,/g, " ").trim();
    if (term) {
      query = query.or(`empresa.ilike.%${term}%,nome_fantasia.ilike.%${term}%`);
    }
  }

  if (context.companyCode) {
    query = query.eq("codigo", context.companyCode);
  }

  const response = await query.range(pageOffset, pageOffset + pageSize - 1);
  if (response.error) throw new Error(response.error.message);
  const rows = (response.data ?? []) as AgendaRow[];
  const deduped = dedupeAgendaRows(rows);
  return normalizeAgendaLiteRows(deduped as AgendaRow[]);
};

const buildAgendaRpcFilters = (filters: AgendaFilters): Record<string, unknown> => {
  const global = filters.global.replace(/%/g, "").trim();
  const columns: Record<string, string[]> = {};

  (Object.keys(filters.columns) as Array<keyof AgendaFilters["columns"]>).forEach((key) => {
    if (key === "supervisor_flag") return;
    const values = filters.columns[key] ?? [];
    const cleaned = values.map((value) => normalizeOption(value)).filter(Boolean);
    if (cleaned.length === 0) return;
    const expanded =
      key === "situacao" ? expandSituacaoValues(cleaned) : expandFilterValues(key, cleaned);
    const finalValues = (expanded.length ? expanded : cleaned).filter(Boolean);
    if (finalValues.length) {
      columns[key] = Array.from(new Set(finalValues));
    }
  });

  const dateRange = filters.dateRanges.data_da_ultima_visita;
  const datePayload: Record<string, unknown> = {};
  if (dateRange.from?.trim()) datePayload.from = dateRange.from.trim();
  if (dateRange.to?.trim()) datePayload.to = dateRange.to.trim();
  if (dateRange.month?.trim()) datePayload.month = dateRange.month.trim();
  if (dateRange.year?.trim()) datePayload.year = dateRange.year.trim();
  const hasDateRangeBounds = Object.keys(datePayload).length > 0;
  if (hasDateRangeBounds) {
    // Backend RPC currently interprets invert=true as "inside range".
    // UI semantics: invert=true means "outside range". So we invert here.
    datePayload.invert = !Boolean(dateRange.invert);
  }

  const vidasRange = filters.ranges?.vidas_ultima_visita ?? {};
  const vidasPayload: Record<string, string> = {};
  if (vidasRange.from?.trim()) vidasPayload.from = vidasRange.from.trim();
  if (vidasRange.to?.trim()) vidasPayload.to = vidasRange.to.trim();

  const normalized: Record<string, unknown> = {};
  if (global) normalized.global = global;
  if (Object.keys(columns).length) normalized.columns = columns;
  if (hasDateRangeBounds) {
    normalized.dateRanges = { data_da_ultima_visita: datePayload };
  }
  if (Object.keys(vidasPayload).length) {
    normalized.ranges = { vidas_ultima_visita: vidasPayload };
  }

  return normalized;
};

const fetchAgendaCandidateIdsForLatestVisitFilter = async (
  filters: AgendaFilters,
  search: AgendaSearchFilters | undefined,
  filaBlocks: FilaRoutingBlockLists | null,
) => {
  const bounds = resolveLastVisitDateBounds(filters);
  if (!bounds.active) return null;

  const companyName = search?.companyName?.replace(/%/g, "").trim() ?? "";
  const companyCode = search?.companyCode?.replace(/%/g, "").trim() ?? "";
  const queryFilters = stripLastVisitDateRange(filters);
  const rows: string[] = [];
  const pageSize = 1000;
  let cursorId: string | null = null;
  let guard = 0;
  const maxBatches = 250;

  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = supabase
      .from("clientes")
      .select("id")
      .order("id", { ascending: true })
      .limit(pageSize);

    query = applyFilaRoutingExclusionsToClientesQuery(query, filaBlocks);
    query = applyFilters(query, queryFilters);

    if (companyName) {
      const term = companyName.replace(/,/g, " ").trim();
      if (term) {
        query = query.or(`empresa.ilike.%${term}%,nome_fantasia.ilike.%${term}%`);
      }
    }

    if (companyCode) {
      query = query.eq("codigo", companyCode);
    }

    if (cursorId) {
      query = query.gt("id", cursorId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as Array<{ id: string }>;
    if (batch.length === 0) break;
    batch.forEach((row) => {
      if (row.id) rows.push(row.id);
    });

    if (batch.length < pageSize) break;
    const nextCursor = batch[batch.length - 1]?.id ?? null;
    if (!nextCursor || nextCursor === cursorId) break;
    cursorId = nextCursor;

    guard += 1;
    if (guard >= maxBatches) {
      console.warn("fetchAgendaCandidateIdsForLatestVisitFilter reached max batches.");
      break;
    }
  }

  return excludeFilaBlockedIds(rows, filaBlocks) ?? [];
};

const buildAgendaQueryContext = async (
  filters: AgendaFilters,
  search?: AgendaSearchFilters,
): Promise<AgendaQueryContext> => {
  const companyName = search?.companyName?.replace(/%/g, "").trim() ?? "";
  const companyCode = search?.companyCode?.replace(/%/g, "").trim() ?? "";
  const filaBlocks = await resolveFilaRoutingBlocks();
  const candidateAgendaIds = await fetchAgendaCandidateIdsForLatestVisitFilter(filters, search, filaBlocks);
  const rawRestrictedAgendaIds = await fetchAgendaIdsByLatestRegisteredVisitDate(
    filters,
    candidateAgendaIds,
  );
  const restrictedAgendaIds = excludeFilaBlockedIds(rawRestrictedAgendaIds, filaBlocks);

  return {
    effectiveFilters: buildAgendaRpcFilters(restrictedAgendaIds ? stripLastVisitDateRange(filters) : filters),
    restrictedAgendaIds,
    companyName,
    companyCode,
    filaBlocks,
  };
};

const fetchAgendaCountExactDirect = async (
  filters: AgendaFilters,
  context: AgendaQueryContext,
) => {
  if (context.restrictedAgendaIds && context.restrictedAgendaIds.length === 0) {
    return 0;
  }

  const queryFilters = context.restrictedAgendaIds ? stripLastVisitDateRange(filters) : filters;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase.from("clientes").select("id", { count: "exact", head: true });
  query = applyFilaRoutingExclusionsToClientesQuery(query, context.filaBlocks);
  query = applyFilters(query, queryFilters);

  if (context.restrictedAgendaIds) {
    query = query.in("id", context.restrictedAgendaIds);
  }

  if (context.companyName) {
    const term = context.companyName.replace(/,/g, " ").trim();
    if (term) {
      query = query.or(`empresa.ilike.%${term}%,nome_fantasia.ilike.%${term}%`);
    }
  }

  if (context.companyCode) {
    query = query.eq("codigo", context.companyCode);
  }

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
};

export const fetchAgendaCountExact = async (
  filters: AgendaFilters,
  search?: AgendaSearchFilters,
) => {
  console.info("COUNT_EXACT_FIX_2026_05_25", { module: "agenda", active: true });
  const context = await buildAgendaQueryContext(filters, search);
  const effectiveFilterKeys = Object.keys(context.effectiveFilters);
  const filtersEffectivelyEmpty = effectiveFilterKeys.length === 0;
  const rpcFilters = filtersEffectivelyEmpty ? {} : context.effectiveFilters;
  console.info("ROTAS_RPC_FILTER_NORMALIZATION_FIX_2026_05_26", { active: true });
  console.info("ROTAS_RPC_FILTERS_WERE_EFFECTIVELY_EMPTY", filtersEffectivelyEmpty);
  console.info("ROTAS_RPC_FILTERS_SENT", filtersEffectivelyEmpty ? "{}" : rpcFilters);
  console.info("ROTAS_RPC_FILTERS_SENT_KEYS", effectiveFilterKeys);
  console.info("COUNT_QUERY_FILTERS", {
    module: "agenda",
    filters: rpcFilters,
    companyName: context.companyName,
    companyCode: context.companyCode,
  });
  const start = performance.now();

  if (context.restrictedAgendaIds) {
    const total = await fetchAgendaCountExactDirect(filters, context);
    const duration = Math.round(performance.now() - start);
    console.info("ROTAS_COUNTER_SOURCE", "clientes_direct_latest_registered_visit");
    console.info("ROTAS_COUNTER_EXACT_DURATION_MS", duration);
    console.info("ROTAS_COUNTER_VALUE", total);
    console.info("COUNT_QUERY_SOURCE", "clientes_direct_latest_registered_visit");
    console.info("COUNT_QUERY_METHOD", "direct");
    console.info("COUNT_QUERY_DURATION_MS", duration);
    console.info("COUNT_QUERY_ERROR_SAFE", null);
    console.info("COUNT_QUERY_RETURNED_VALUE", total);
    return total;
  }

  const { data, error } = await supabase.rpc("get_rotas_agenda_count_v1", {
    p_filters: rpcFilters,
    p_company_name: context.companyName || null,
    p_company_code: context.companyCode || null,
  });
  const duration = Math.round(performance.now() - start);
  if (error) {
    console.warn("COUNTER_REJECTED_ESTIMATED_TOTAL", {
      module: "agenda",
      reason: "rpc_count_failed_and_estimated_not_allowed",
    });
    console.info("COUNT_QUERY_SOURCE", "get_rotas_agenda_count_v1");
    console.info("COUNT_QUERY_METHOD", "rpc_failed");
    console.info("COUNT_QUERY_DURATION_MS", duration);
    console.info("COUNT_QUERY_ERROR_SAFE", error.message);
    console.info("COUNT_QUERY_RETURNED_VALUE", null);
    throw new Error(error.message);
  }
  const total = typeof data === "number" ? data : Number(data ?? 0);
  console.info("ROTAS_COUNTER_SOURCE", "rpc_exact");
  console.info("ROTAS_COUNTER_EXACT_DURATION_MS", duration);
  console.info("ROTAS_COUNTER_VALUE", total);
  console.info("COUNT_QUERY_SOURCE", "get_rotas_agenda_count_v1");
  console.info("COUNT_QUERY_METHOD", "rpc");
  console.info("COUNT_QUERY_DURATION_MS", duration);
  console.info("COUNT_QUERY_ERROR_SAFE", null);
  console.info("COUNT_QUERY_RETURNED_VALUE", total);
  return total;
};

export const fetchAgendaFirstPageLite = async (
  pageIndex: number,
  pageSize: number,
  _sorting: SortingState,
  filters: AgendaFilters,
  search?: AgendaSearchFilters,
): Promise<AgendaRow[]> => {
  const context = await buildAgendaQueryContext(filters, search);
  const effectiveFilterKeys = Object.keys(context.effectiveFilters);
  const filtersEffectivelyEmpty = effectiveFilterKeys.length === 0;
  const rpcFilters = filtersEffectivelyEmpty ? {} : context.effectiveFilters;
  const start = performance.now();
  const pageOffset = pageIndex * pageSize;
  const shouldUseDirectQuery =
    hasActiveLastVisitDateRange(filters) || Boolean(context.companyCode.trim());

  console.info("DB_OPT_PHASE_1_2026_05_25", { module: "agenda" });
  console.info("CURRENT_TABLE_OR_VIEW", "rpc_get_rotas_agenda_first_page_v2");
  console.info("CURRENT_SELECT_FIELDS", AGENDA_LITE_SELECT_COLUMNS);
  console.info("CURRENT_FILTERS", {
    filters: rpcFilters,
    companyName: context.companyName,
    companyCode: context.companyCode,
    hasFilaExclusions: Boolean(context.filaBlocks?.blockedEmpresaIds.length),
  });
  console.info("CURRENT_ORDER_BY", "visit_generated_at desc nullslast, data_da_ultima_visita desc nullslast, id asc");
  console.info("CURRENT_RANGE_FROM", pageOffset);
  console.info("CURRENT_RANGE_TO", pageOffset + pageSize - 1);
  console.info("CURRENT_HAS_JOINS", false);
  console.info("CURRENT_HAS_EMBEDS", false);
  const rpcGlobalFilter =
    typeof context.effectiveFilters.global === "string" ? context.effectiveFilters.global : "";
  console.info("CURRENT_HAS_ILIKE", Boolean(context.companyName || rpcGlobalFilter.trim()));
  console.info("CURRENT_HAS_OR", true);
  console.info("CURRENT_USES_COUNT", false);
  console.info("CURRENT_QUERY_START", start);
  console.info("ROTAS_REMOVED_HUGE_NOT_IN_2026_05_25", true);
  console.info("ROTAS_EXCLUSION_SOURCE", "queue_release_controls_view");
  console.info("ROTAS_EXCLUSION_COUNT", context.filaBlocks?.blockedEmpresaIds.length ?? 0);
  console.info("ROTAS_QUERY_USES_HUGE_NOT_IN=false");
  console.info("ROTAS_QUERY_SOURCE", "rpc_get_rotas_agenda_first_page_v2");
  console.info("ROTAS_RPC_FILTER_NORMALIZATION_FIX_2026_05_26", { active: true });
  console.info("ROTAS_RPC_FILTERS_WERE_EFFECTIVELY_EMPTY", filtersEffectivelyEmpty);
  console.info("ROTAS_RPC_FILTERS_SENT", filtersEffectivelyEmpty ? "{}" : rpcFilters);
  console.info("ROTAS_RPC_FILTERS_SENT_KEYS", effectiveFilterKeys);

  if (shouldUseDirectQuery) {
    console.info("ROTAS_QUERY_SOURCE", "clientes_direct_first_page_fallback");
    const fallbackRows = await fetchAgendaFirstPageLiteDirect(pageIndex, pageSize, filters, context);
    const duration = Math.round(performance.now() - start);
    console.info("CURRENT_QUERY_END", performance.now());
    console.info("CURRENT_QUERY_DURATION_MS", duration);
    console.info("ROTAS_QUERY_DURATION_MS", duration);
    console.info("CURRENT_TIMEOUT_HIT", false);
    console.info("CURRENT_ERROR_SAFE", null);
    console.info("CURRENT_ROWS_RETURNED", fallbackRows.length);
    console.info("ROTAS_ROWS_RETURNED", fallbackRows.length);
    return fallbackRows;
  }

  let response:
    | { data: AgendaRow[] | null; error: { message: string } | null }
    | { data: null; error: { message: string } };
  try {
    response = (await supabase.rpc("get_rotas_agenda_first_page_v2", {
      p_page_size: Math.max(1, pageSize),
      p_page_offset: Math.max(0, pageOffset),
      p_filters: rpcFilters,
      p_company_name: context.companyName || null,
      p_company_code: context.companyCode || null,
    })) as { data: AgendaRow[] | null; error: { message: string } | null };
  } catch (rpcError) {
    const safeMessage = rpcError instanceof Error ? rpcError.message : String(rpcError ?? "");
    if (isStatementTimeoutError(safeMessage)) {
      console.warn("ROTAS_RPC_TIMEOUT_FALLBACK_TO_DIRECT_QUERY", { safeMessage });
      return fetchAgendaFirstPageLiteDirect(pageIndex, pageSize, filters, context);
    }
    throw rpcError;
  }

  const duration = Math.round(performance.now() - start);
  console.info("CURRENT_QUERY_END", performance.now());
  console.info("CURRENT_QUERY_DURATION_MS", duration);
  console.info("ROTAS_QUERY_DURATION_MS", duration);
  console.info("CURRENT_TIMEOUT_HIT", response.error ? isStatementTimeoutError(response.error.message) : false);
  console.info("CURRENT_ERROR_SAFE", response.error?.message ?? null);
  const rows = (response.data ?? []) as AgendaRow[];
  console.info("CURRENT_ROWS_RETURNED", rows.length);
  console.info("ROTAS_ROWS_RETURNED", rows.length);

  if (response.error) {
    if (isStatementTimeoutError(response.error.message)) {
      console.warn("ROTAS_RPC_TIMEOUT_FALLBACK_TO_DIRECT_QUERY", {
        safeMessage: response.error.message,
      });
      return fetchAgendaFirstPageLiteDirect(pageIndex, pageSize, filters, context);
    }
    throw new Error(response.error.message);
  }
  const deduped = dedupeAgendaRows(rows);
  const normalized = normalizeAgendaLiteRows(deduped as AgendaRow[]);
  return normalized;
};

export const fetchAgenda = async (
  pageIndex: number,
  pageSize: number,
  sorting: SortingState,
  filters: AgendaFilters,
  search?: AgendaSearchFilters,
): Promise<AgendaFetchResult> => {
  const [data, count] = await Promise.all([
    fetchAgendaFirstPageLite(pageIndex, pageSize, sorting, filters, search),
    fetchAgendaCountExact(filters, search).catch((countError) => {
      console.warn("fetchAgenda count query failed:", countError);
      return null;
    }),
  ]);
  return { data, count };
};

export const fetchAgendaScheduledVisits = async (clienteIds: string[]) => {
  if (!clienteIds.length) return [] as AgendaScheduledVisit[];
  const chunkSize = 500;
  const results: AgendaScheduledVisit[] = [];

  for (let index = 0; index < clienteIds.length; index += chunkSize) {
    const chunk = clienteIds.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from("visits")
      .select(
        "id, cliente_id, visit_date, assigned_to_user_id, assigned_to_name, perfil_visita, instructions, completed_at, route_id, visit_type, supervisor_reason",
      )
      .in("cliente_id", chunk)
      .is("completed_at", null)
      .order("visit_date", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    results.push(...((data ?? []) as AgendaScheduledVisit[]));
  }

  return results;
};

export const fetchAgendaVisitVendors = async (clienteIds: string[]) => {
  if (!clienteIds.length) return [] as AgendaVisitVendor[];
  const { data, error } = await supabase
    .from("visits")
    .select(
      "cliente_id, visit_date, assigned_to_user_id, assigned_to_name, completed_at, completed_vidas, no_visit_reason, route_id, visit_type, supervisor_reason",
    )
    .in("cliente_id", clienteIds)
    .order("completed_at", { ascending: false })
    .order("visit_date", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as AgendaVisitVendor[];
};

export const fetchDistinctOptions = async (filterKey: string, columns: string[]) => {
  const cached = optionsCache.get(filterKey);
  if (cached) {
    return cached.options;
  }

  if (filterKey === "situacao") {
    const options = [...SITUACAO_OPTIONS];
    optionsCache.set(filterKey, { options, rawMap: buildSituacaoRawMap() });
    return options;
  }

  if (filterKey === "categoria") {
    const options = [...CATEGORIA_OPTIONS, CATEGORIA_FILTER_SEM_CATEGORIA];
    optionsCache.set(filterKey, { options, rawMap: buildCategoriaRawMap() });
    return options;
  }

  const ensureClientesOptionsCache = async () => {
    const hasMissing = CLIENTES_DYNAMIC_FILTER_KEYS.some((key) => !optionsCache.has(key));
    if (!hasMissing) return;

    if (!clientesOptionsBuildPromise) {
      clientesOptionsBuildPromise = (async () => {
        const normalizedMaps = new Map<string, Map<string, Set<string>>>();
        CLIENTES_DYNAMIC_FILTER_KEYS.forEach((key) => {
          normalizedMaps.set(key, new Map());
        });

        const filaBlocks = await resolveFilaRoutingBlocks();
        const data = await fetchColumnValuesPaged("clientes", CLIENTES_DYNAMIC_FILTER_COLUMNS, filaBlocks);

        data.forEach((row) => {
          CLIENTES_DYNAMIC_FILTER_PAIRS.forEach(({ key, column }) => {
            const rawValue = row[column as keyof typeof row];
            if (rawValue === null || rawValue === undefined) return;
            const rawText = String(rawValue).trim();
            if (!rawText) return;

            const values =
              key === "perfil_visita" ? extractPerfilVisitaOptions(rawText) : [normalizeOption(rawText)];
            const targetMap = normalizedMaps.get(key);
            if (!targetMap) return;

            values.forEach((value) => {
              if (!value) return;
              if (!targetMap.has(value)) targetMap.set(value, new Set());
              targetMap.get(value)?.add(rawText);
            });
          });
        });

        CLIENTES_DYNAMIC_FILTER_KEYS.forEach((key) => {
          const normalizedMap = normalizedMaps.get(key) ?? new Map<string, Set<string>>();
          const options = Array.from(normalizedMap.keys()).sort((a, b) => a.localeCompare(b));
          const rawMap = new Map<string, string[]>();
          normalizedMap.forEach((set, option) => {
            rawMap.set(option, Array.from(set));
          });
          optionsCache.set(key, { options, rawMap });
        });
      })().finally(() => {
        clientesOptionsBuildPromise = null;
      });
    }

    await clientesOptionsBuildPromise;
  };

  await ensureClientesOptionsCache();
  const hydrated = optionsCache.get(filterKey);
  if (hydrated) {
    return hydrated.options;
  }

  const normalizedMap = new Map<string, Set<string>>();
  const fallbackColumn = mapAgendaColumnToClientes(
    CLIENTES_FILTER_COLUMN_MAP[filterKey] ?? columns[0] ?? filterKey,
  );
  const filaBlocks = await resolveFilaRoutingBlocks();
  const fallbackRows = await fetchColumnValuesPaged("clientes", [fallbackColumn], filaBlocks);
  fallbackRows.forEach((row) => {
    const rawValue = row[fallbackColumn as keyof typeof row];
    if (rawValue === null || rawValue === undefined) return;
    const rawText = String(rawValue).trim();
    if (!rawText) return;
    const normalized = normalizeOption(rawText);
    if (!normalized) return;
    if (!normalizedMap.has(normalized)) normalizedMap.set(normalized, new Set());
    normalizedMap.get(normalized)?.add(rawText);
  });

  const options = Array.from(normalizedMap.keys()).sort((a, b) => a.localeCompare(b));
  const rawMap = new Map<string, string[]>();
  normalizedMap.forEach((set, key) => {
    rawMap.set(key, Array.from(set));
  });
  optionsCache.set(filterKey, { options, rawMap });
  return options;
};

export const fetchAgendaForGeneration = async (filters: AgendaFilters, ids?: string[]) => {
  const filaBlocks = await resolveFilaRoutingBlocks();
  const buildQuery = () =>
    applyFilaRoutingExclusionsToClientesQuery(
      supabase
      .from("clientes")
      .select("id, perfil_visita, instructions, cod_1:codigo, empresa, nome_fantasia, situacao")
      .order("id", { ascending: true }),
      filaBlocks,
    );

  if (ids && ids.length > 0) {
    const results: AgendaPerfilRow[] = [];
    const chunkSize = 500;

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data, error } = await buildQuery().in("id", chunk);
      if (error) throw new Error(error.message);
      results.push(...((data ?? []) as AgendaPerfilRow[]));
    }

    const deduped = dedupeAgendaRows(
      results as Partial<AgendaRow>[] as AgendaRow[],
    ) as unknown as AgendaPerfilRow[];
    return deduped.map((item) => ({
      id: item.id,
      perfil_visita: item.perfil_visita ?? null,
      instructions: (item as { instructions?: string | null }).instructions ?? null,
      cod_1: item.cod_1 ?? null,
      empresa: item.empresa ?? null,
      nome_fantasia: item.nome_fantasia ?? null,
      situacao: item.situacao ?? null,
    }));
  }

  const vidasRange = getVidasRange(filters);
  let agendaIdsByVidas: string[] | null = null;
  let agendaIdsByLastVisit: string[] | null = null;
  let effectiveFilters = filters;

  try {
    const candidateAgendaIds = await fetchAgendaCandidateIdsForLatestVisitFilter(
      filters,
      undefined,
      filaBlocks,
    );
    agendaIdsByLastVisit = await fetchAgendaIdsByLatestRegisteredVisitDate(filters, candidateAgendaIds);
    if (agendaIdsByLastVisit) {
      effectiveFilters = stripLastVisitDateRange(effectiveFilters);
    }
  } catch (err) {
    console.error("Falha ao filtrar ultima visita por visitas:", err);
  }

  if (vidasRange) {
    try {
      agendaIdsByVidas = await fetchAgendaIdsByLatestCompletedVidas(vidasRange);
      effectiveFilters = stripVidasRange(effectiveFilters);
    } catch (err) {
      console.error("Falha ao filtrar vidas ultima visita por visitas:", err);
    }
  }

  const restrictedAgendaIds =
    agendaIdsByLastVisit && agendaIdsByVidas
      ? agendaIdsByLastVisit.filter((id) => agendaIdsByVidas.includes(id))
      : agendaIdsByLastVisit ?? agendaIdsByVidas;
  const routeableRestrictedAgendaIds = excludeFilaBlockedIds(restrictedAgendaIds, filaBlocks);

  let query = buildQuery();
  query = applyFilters(query, effectiveFilters);
  if (routeableRestrictedAgendaIds) {
    if (routeableRestrictedAgendaIds.length === 0) {
      return [];
    }
    query = query.in("id", routeableRestrictedAgendaIds);
  }

  const results: AgendaPerfilRow[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as AgendaPerfilRow[];
    if (batch.length === 0) break;
    results.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  const deduped = dedupeAgendaRows(
    results as Partial<AgendaRow>[] as AgendaRow[],
  ) as unknown as AgendaPerfilRow[];
  return deduped.map((item) => ({
    id: item.id,
    perfil_visita: item.perfil_visita ?? null,
    instructions: (item as { instructions?: string | null }).instructions ?? null,
    cod_1: item.cod_1 ?? null,
    empresa: item.empresa ?? null,
    nome_fantasia: item.nome_fantasia ?? null,
    situacao: item.situacao ?? null,
  }));
};

export const fetchVendedores = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, role, supervisor_id, can_access_next_route_dashboard")
    .eq("role", "VENDEDOR")
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
};

export const fetchSupervisores = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, user_id, display_name, role")
    .eq("role", "SUPERVISOR")
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
};

