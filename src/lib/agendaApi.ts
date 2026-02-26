import { supabase } from "./supabase";
import type { AgendaFilters, AgendaRow } from "../types/agenda";
import type { SortingState } from "@tanstack/react-table";

const GLOBAL_SEARCH_COLUMNS = [
  "empresa",
  "nome_fantasia",
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

const formatInValues = (values: string[]) =>
  values
    .map((value) => `"${value.replace(/"/g, '\\"')}"`)
    .join(",");

const normalizeOption = (value: string) =>
  value.trim().replace(/\s+/g, " ").toUpperCase();

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
      const inValues = formatInValues(expanded);
      next = next.or(`empresa.in.(${inValues}),nome_fantasia.in.(${inValues})`);
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

  const { month, year, from, to } = filters.dateRanges.data_da_ultima_visita;
  const hasMonthYear = Boolean(month || year);

  if (!hasMonthYear) {
    if (from) {
      next = next.gte("data_da_ultima_visita", from);
    }
    if (to) {
      next = next.lte("data_da_ultima_visita", `${to}T23:59:59`);
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
            next = next.gte("data_da_ultima_visita", startValue);
            next = next.lte("data_da_ultima_visita", `${endValue}T23:59:59`);
          }
        } else {
          const startDate = new Date(numericYear, 0, 1);
          const endDate = new Date(numericYear, 11, 31);
          const startValue = startDate.toISOString().slice(0, 10);
          const endValue = endDate.toISOString().slice(0, 10);
          next = next.gte("data_da_ultima_visita", startValue);
          next = next.lte("data_da_ultima_visita", `${endValue}T23:59:59`);
        }
      }
    }
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

export const fetchAgenda = async (
  pageIndex: number,
  pageSize: number,
  sorting: SortingState,
  filters: AgendaFilters,
): Promise<AgendaFetchResult> => {
  let query = supabase
    .from("agenda")
    .select(
      "id, data_da_ultima_visita, cod_1, empresa, perfil_visita, corte, venc, valor, tit, endereco, bairro, cidade, uf, supervisor, vendedor, cod_2, nome_fantasia, grupo, situacao, obs_contrato_1, obs_contrato_2, visit_generated_at, created_at",
      { count: "exact" },
    )
    .ilike("situacao", "ativo%");

  query = applyFilters(query, filters);

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

  let query = buildQuery();
  query = applyFilters(query, filters);

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
