import { supabase } from "./supabase";
import type { AgendaFilters, AgendaRow } from "../types/agenda";
import type { SortingState } from "@tanstack/react-table";

const GLOBAL_SEARCH_COLUMNS = [
  "empresa",
  "cidade",
  "uf",
  "vendedor",
  "supervisor",
  "situacao",
  "grupo",
  "perfil_visita",
  "endereco",
  "bairro",
];

const normalizeOption = (value: string) =>
  value.trim().replace(/\s+/g, " ").toUpperCase();

const parseOptionalNumber = (value?: string) => {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
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
  agenda_id: string | null;
  completed_vidas: number | null;
  completed_at: string | null;
  visit_date: string | null;
};

const fetchAgendaIdsByLatestCompletedVidas = async (range: { from: number | null; to: number | null }) => {
  const latestByAgenda = new Map<string, number>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("visits")
      .select("agenda_id, completed_vidas, completed_at, visit_date")
      .not("agenda_id", "is", null)
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
      if (!row.agenda_id) return;
      if (latestByAgenda.has(row.agenda_id)) return;
      if (row.completed_vidas === null || row.completed_vidas === undefined) return;
      latestByAgenda.set(row.agenda_id, row.completed_vidas);
    });

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const agendaIds: string[] = [];
  latestByAgenda.forEach((vidas, agendaId) => {
    if (range.from !== null && vidas < range.from) return;
    if (range.to !== null && vidas > range.to) return;
    agendaIds.push(agendaId);
  });

  return agendaIds;
};

type OptionsCacheEntry = {
  options: string[];
  rawMap: Map<string, string[]>;
};

const optionsCache = new Map<string, OptionsCacheEntry>();

export const clearAgendaOptionsCache = () => {
  optionsCache.clear();
};

const expandFilterValues = (key: string, values: string[]) => {
  const entry = optionsCache.get(key);
  if (!entry) {
    return values;
  }

  const expanded = values.flatMap((value) => entry.rawMap.get(value) ?? value);
  return Array.from(new Set(expanded)).filter(Boolean);
};

const applyFilters = <T,>(query: T, filters: AgendaFilters): T => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let next: any = query;

  Object.entries(filters.columns).forEach(([key, values]) => {
    if (!values || values.length === 0) return;
    const cleaned = values.map((value) => normalizeOption(value)).filter(Boolean);
    if (cleaned.length === 0) return;
    const expanded = expandFilterValues(key, cleaned);
    if (expanded.length === 0) return;

    if (key === "empresa_nome") {
      next = next.in("empresa", expanded);
      return;
    }

    next = next.in(key, expanded);
  });

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

export type AgendaScheduledVisit = {
  id: string;
  agenda_id: string;
  visit_date: string;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  perfil_visita: string | null;
  completed_at: string | null;
  route_id: string | null;
};

export type AgendaVisitVendor = {
  agenda_id: string;
  visit_date: string;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  completed_at: string | null;
  completed_vidas: number | null;
};

export const fetchAgenda = async (
  pageIndex: number,
  pageSize: number,
  sorting: SortingState,
  filters: AgendaFilters,
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

  let query = supabase
    .from("agenda")
    .select(
      "id, data_da_ultima_visita, visit_completed_vidas, cod_1, empresa, perfil_visita, corte, venc, valor, tit, endereco, complemento, bairro, cidade, uf, supervisor, vendedor, nome_fantasia, grupo, situacao, obs_contrato_1, visit_generated_at, created_at",
      { count: "exact" },
    )
    .ilike("situacao", "ativo%");

  query = applyFilters(query, effectiveFilters);
  if (agendaIdsByVidas) {
    if (agendaIdsByVidas.length === 0) {
      return { data: [], count: 0 };
    }
    query = query.in("id", agendaIdsByVidas);
  }

  if (sorting.length) {
    const { id, desc } = sorting[0];
    query = query.order(id, { ascending: !desc });
  } else {
    query = query.order("data_da_ultima_visita", { ascending: false });
  }

  const from = pageIndex * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.range(from, to);

  if (error) {
    throw new Error(error.message);
  }

  return { data: (data ?? []) as AgendaRow[], count: count ?? 0 };
};

export const fetchAgendaScheduledVisits = async (agendaIds: string[]) => {
  if (!agendaIds.length) return [] as AgendaScheduledVisit[];
  const { data, error } = await supabase
    .from("visits")
    .select(
      "id, agenda_id, visit_date, assigned_to_user_id, assigned_to_name, perfil_visita, completed_at, route_id",
    )
    .in("agenda_id", agendaIds)
    .is("completed_at", null)
    .order("visit_date", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as AgendaScheduledVisit[];
};

export const fetchAgendaVisitVendors = async (agendaIds: string[]) => {
  if (!agendaIds.length) return [] as AgendaVisitVendor[];
  const { data, error } = await supabase
    .from("visits")
    .select("agenda_id, visit_date, assigned_to_user_id, assigned_to_name, completed_at, completed_vidas")
    .in("agenda_id", agendaIds)
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

  const normalizedMap = new Map<string, Set<string>>();

  for (const column of columns) {
    const { data, error } = await supabase
      .from("agenda")
      .select(column)
      .not(column, "is", null)
      .ilike("situacao", "ativo%")
      .limit(2000);

    if (error) {
      throw new Error(error.message);
    }

    data?.forEach((row) => {
      const rawValue = row[column as keyof typeof row];
      if (!rawValue) return;
      const rawText = String(rawValue);
      const normalized = normalizeOption(rawText);
      if (!normalized) return;
      if (!normalizedMap.has(normalized)) {
        normalizedMap.set(normalized, new Set());
      }
      normalizedMap.get(normalized)?.add(rawText);
    });
  }

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
      .from("agenda")
      .select("id, perfil_visita")
      .is("visit_generated_at", null)
      .ilike("situacao", "ativo%")
      .order("id", { ascending: true });

  if (ids && ids.length > 0) {
    const results: { id: string; perfil_visita: string | null }[] = [];
    const chunkSize = 500;

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data, error } = await buildQuery().in("id", chunk);
      if (error) throw new Error(error.message);
      results.push(...((data ?? []) as { id: string; perfil_visita: string | null }[]));
    }

    return results;
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

  const results: { id: string; perfil_visita: string | null }[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as { id: string; perfil_visita: string | null }[];
    if (batch.length === 0) break;
    results.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return results;
};

export const fetchVendedores = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, role, supervisor_id")
    .eq("role", "VENDEDOR")
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
};

export const fetchSupervisores = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, role")
    .eq("role", "SUPERVISOR")
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
};
