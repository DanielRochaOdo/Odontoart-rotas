import { supabase } from "./supabase";
import type { AgendaFilters, AgendaRow } from "../types/agenda";
import type { SortingState } from "@tanstack/react-table";
import { normalizeText } from "./textNormalize";
import {
  buildCategoriaRawMap,
  CATEGORIA_FILTER_SEM_CATEGORIA,
  CATEGORIA_OPTIONS,
} from "./categorias";

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

const AGENDA_SORTABLE_COLUMNS = new Set<string>([
  "obs",
  "visit_generated_at",
  "data_da_ultima_visita",
  "visit_completed_vidas",
  "cod_1",
  "empresa",
  "bairro",
  "cidade",
  "vendedor",
  "grupo",
  "perfil_visita",
]);

const mapAgendaColumnToClientes = (column: string) => {
  if (column === "cod_1") return "codigo";
  if (column === "obs_contrato_1") return "obs_comercial";
  return column;
};

const applyAgendaSorting = <T,>(query: T, sorting: SortingState): T => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let next: any = query;
  if (!sorting.length) {
    next = next.order("visit_generated_at", { ascending: false, nullsFirst: false });
    next = next.order("data_da_ultima_visita", { ascending: false, nullsFirst: false });
    return next as T;
  }

  const { id, desc } = sorting[0];
  const sortColumnRaw =
    id === "obs"
      ? "visit_generated_at"
      : AGENDA_SORTABLE_COLUMNS.has(id)
        ? id
        : "visit_generated_at";
  const sortColumn = mapAgendaColumnToClientes(sortColumnRaw);
  next = next.order(sortColumn, { ascending: !desc, nullsFirst: false });
  return next as T;
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

export const clearAgendaOptionsCache = () => {
  optionsCache.clear();
  clientesOptionsBuildPromise = null;
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
  const invertRange = Boolean(invert);
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
    if (invertRange) {
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
            if (invertRange) {
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
          if (invertRange) {
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
  count: number;
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
  visit_type?: string | null;
  supervisor_reason?: string | null;
};

export const fetchAgenda = async (
  pageIndex: number,
  pageSize: number,
  sorting: SortingState,
  filters: AgendaFilters,
  search?: AgendaSearchFilters,
): Promise<AgendaFetchResult> => {
  const vidasRange = getVidasRange(filters);
  let agendaIdsByVidas: string[] | null = null;
  let effectiveFilters = filters;

  if (vidasRange) {
    try {
      agendaIdsByVidas = await fetchAgendaIdsByLatestCompletedVidas(vidasRange);
      effectiveFilters = stripVidasRange(filters);
    } catch (err) {
      console.error("Falha ao filtrar vidas ultima visita por visitas:", err);
    }
  }

  const companyName = search?.companyName?.replace(/%/g, "").trim();
  const companyCode = search?.companyCode?.replace(/%/g, "").trim();
  const restrictedAgendaIds = agendaIdsByVidas;

  if (restrictedAgendaIds && restrictedAgendaIds.length === 0) {
    return { data: [], count: 0 };
  }

  const selectColumns =
    "id, data_da_ultima_visita, visit_completed_vidas, cod_1:codigo, empresa, pessoa, contato, instructions, perfil_visita, corte, venc, valor, endereco, complemento, bairro, cidade, uf, supervisor, vendedor, nome_fantasia, grupo, situacao, categoria, obs_contrato_1:obs_comercial, visit_generated_at, created_at";

  const baseQuery = () => supabase.from("clientes").select(selectColumns);

  const baseQueryNoCount = () => supabase.from("clientes").select(selectColumns);

  const applySearchAndIds = <T,>(inputQuery: T): T => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let next: any = inputQuery;
    if (restrictedAgendaIds) {
      next = next.in("id", restrictedAgendaIds);
    }
    if (companyCode) {
      next = next.eq("codigo", companyCode);
    }
    if (companyName) {
      next = next.ilike("empresa", `%${companyName}%`);
    }
    return next as T;
  };

  let query = applySearchAndIds(applyFilters(baseQuery(), effectiveFilters));

  const pageFrom = pageIndex * pageSize;
  const pageTo = pageFrom + pageSize - 1;
  const estimateCountFromPage = (rowsLength: number) =>
    rowsLength < pageSize ? pageFrom + rowsLength : pageTo + 2;
  const hasColumnFilters = Object.values(effectiveFilters.columns).some((values) => values.length > 0);
  const hasDateFilters = Boolean(
    effectiveFilters.dateRanges.data_da_ultima_visita.from ||
      effectiveFilters.dateRanges.data_da_ultima_visita.to ||
      effectiveFilters.dateRanges.data_da_ultima_visita.month ||
      effectiveFilters.dateRanges.data_da_ultima_visita.year ||
      effectiveFilters.dateRanges.data_da_ultima_visita.invert,
  );
  const hasGlobalFilter = Boolean(effectiveFilters.global?.trim());
  const hasSearchFilters = Boolean(companyName || companyCode || hasGlobalFilter);
  const shouldUseExactCount = !hasColumnFilters && !hasDateFilters && !hasSearchFilters && !restrictedAgendaIds;
  const shouldSkipCountQuery = !shouldUseExactCount;

  const runCountQuery = async (mode: "exact" | "planned") => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let countQuery: any = applySearchAndIds(
      applyFilters(
        supabase.from("clientes").select("id", { count: mode, head: true }),
        effectiveFilters,
      ),
    );
    const { count, error } = await countQuery;
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  query = applyAgendaSorting(query, sorting);
  let { data, error } = await query.range(pageFrom, pageTo);

  if (error && isStatementTimeoutError(error.message)) {
    console.warn("fetchAgenda timed out; retrying with simplified query");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let retryQuery: any = applySearchAndIds(applyFilters(baseQueryNoCount(), effectiveFilters));
    retryQuery = applyAgendaSorting(retryQuery, sorting);
    let retry = await retryQuery.range(pageFrom, pageTo);

    if (retry.error && isStatementTimeoutError(retry.error.message)) {
      console.warn("fetchAgenda timed out again; retrying with id sort");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let emergencyQuery: any = applySearchAndIds(applyFilters(baseQueryNoCount(), effectiveFilters));
      emergencyQuery = emergencyQuery.order("id", { ascending: false });
      retry = await emergencyQuery.range(pageFrom, pageTo);
    }

    if (retry.error) {
      throw new Error(retry.error.message);
    }

    data = retry.data;
    error = null;
  }

  if (error) throw new Error(error.message);
  let count: number | null = null;
  if (!shouldSkipCountQuery) {
    try {
      count = await runCountQuery("exact");
    } catch (countError) {
      const message = countError instanceof Error ? countError.message : String(countError ?? "");
      if (isStatementTimeoutError(message)) {
        try {
          count = await runCountQuery("planned");
        } catch (plannedError) {
          console.warn("fetchAgenda count fallback failed:", plannedError);
        }
      } else {
        console.warn("fetchAgenda count query failed:", countError);
      }
    }
  }
  if (count === null) {
    count = estimateCountFromPage(data?.length ?? 0);
  }

  const pageRows = (data ?? []) as AgendaRow[];
  const deduped = dedupeAgendaRows(pageRows);

  return { data: deduped, count: count ?? deduped.length };
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
      "cliente_id, visit_date, assigned_to_user_id, assigned_to_name, completed_at, completed_vidas, no_visit_reason, visit_type, supervisor_reason",
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

        const data = await fetchColumnValuesPaged("clientes", CLIENTES_DYNAMIC_FILTER_COLUMNS);

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
  const fallbackRows = await fetchColumnValuesPaged("clientes", [fallbackColumn]);
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
  const buildQuery = () =>
    supabase
      .from("clientes")
      .select("id, perfil_visita, instructions, cod_1:codigo, empresa, nome_fantasia, situacao")
      .order("id", { ascending: true });

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
  let effectiveFilters = filters;

  if (vidasRange) {
    try {
      agendaIdsByVidas = await fetchAgendaIdsByLatestCompletedVidas(vidasRange);
      effectiveFilters = stripVidasRange(filters);
    } catch (err) {
      console.error("Falha ao filtrar vidas ultima visita por visitas:", err);
    }
  }

  let query = buildQuery();
  query = applyFilters(query, effectiveFilters);
  if (agendaIdsByVidas) {
    if (agendaIdsByVidas.length === 0) {
      return [];
    }
    query = query.in("id", agendaIdsByVidas);
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

