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

const applyFilters = <T,>(query: T, filters: AgendaFilters): T => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let next: any = query;

  Object.entries(filters.columns).forEach(([key, values]) => {
    if (!values || values.length === 0) return;
    const cleaned = values.map((value) => value.trim()).filter(Boolean);
    if (cleaned.length === 0) return;

    if (key === "empresa_nome") {
      const inValues = formatInValues(cleaned);
      next = next.or(`empresa.in.(${inValues}),nome_fantasia.in.(${inValues})`);
      return;
    }

    next = next.in(key, cleaned);
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

export const fetchAgenda = async (
  pageIndex: number,
  pageSize: number,
  sorting: SortingState,
  filters: AgendaFilters,
): Promise<AgendaFetchResult> => {
  let query = supabase
    .from("agenda")
    .select(
      "id, data_da_ultima_visita, cod_1, empresa, perfil_visita, corte, venc, valor, tit, endereco, bairro, cidade, uf, supervisor, vendedor, cod_2, nome_fantasia, grupo, situacao, obs_contrato_1, obs_contrato_2, created_at",
      { count: "exact" },
    )
    .is("visit_generated_at", null)
    .eq("situacao", "Ativo");

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

const optionsCache = new Map<string, string[]>();

export const fetchDistinctOptions = async (columns: string[]) => {
  const cacheKey = columns.join("|");
  if (optionsCache.has(cacheKey)) {
    return optionsCache.get(cacheKey)!;
  }

  const values = new Set<string>();

  for (const column of columns) {
    const { data, error } = await supabase
      .from("agenda")
      .select(column)
      .not(column, "is", null)
      .is("visit_generated_at", null)
      .eq("situacao", "Ativo")
      .limit(2000);

    if (error) {
      throw new Error(error.message);
    }

    data?.forEach((row) => {
      const value = row[column as keyof typeof row];
      if (value) values.add(String(value));
    });
  }

  const sorted = Array.from(values).sort((a, b) => a.localeCompare(b));
  optionsCache.set(cacheKey, sorted);
  return sorted;
};

export const fetchAgendaForGeneration = async (filters: AgendaFilters) => {
  let query = supabase
    .from("agenda")
    .select("id, perfil_visita")
    .is("visit_generated_at", null)
    .eq("situacao", "Ativo")
    .order("id", { ascending: true });

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
    .select("user_id, display_name, role")
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
