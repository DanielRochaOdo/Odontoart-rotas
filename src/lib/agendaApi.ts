import { supabase } from "./supabase";
import type { AgendaFilters, AgendaRow } from "../types/agenda";
import type { SortingState } from "@tanstack/react-table";

const GLOBAL_SEARCH_COLUMNS = [
  "empresa",
  "nome_fantasia",
  "cidade",
  "uf",
  "vendedor",
  "consultor",
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

const applyFilters = (
  query: ReturnType<typeof supabase.from>,
  filters: AgendaFilters,
) => {
  let next = query;

  Object.entries(filters.columns).forEach(([key, values]) => {
    if (!values || values.length === 0) return;

    if (key === "empresa_nome") {
      const inValues = formatInValues(values);
      next = next.or(`empresa.in.(${inValues}),nome_fantasia.in.(${inValues})`);
      return;
    }

    next = next.in(key, values);
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

  if (filters.dateRanges.data_da_ultima_visita.from) {
    next = next.gte("data_da_ultima_visita", filters.dateRanges.data_da_ultima_visita.from);
  }
  if (filters.dateRanges.data_da_ultima_visita.to) {
    next = next.lte(
      "data_da_ultima_visita",
      `${filters.dateRanges.data_da_ultima_visita.to}T23:59:59`,
    );
  }

  if (filters.dateRanges.dt_mar_25.from) {
    next = next.gte("dt_mar_25", filters.dateRanges.dt_mar_25.from);
  }
  if (filters.dateRanges.dt_mar_25.to) {
    next = next.lte("dt_mar_25", filters.dateRanges.dt_mar_25.to);
  }

  return next;
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
      "id, data_da_ultima_visita, consultor, cod_1, empresa, perfil_visita, dt_mar_25, consultor_mar_25, corte, venc, valor, tit, endereco, bairro, cidade, uf, supervisor, vendedor, cod_2, nome_fantasia, grupo, situacao, obs_contrato_1, obs_contrato_2, created_at",
      { count: "exact" },
    );

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

export const exportAgendaCsv = async (filters: AgendaFilters) => {
  let query = supabase
    .from("agenda")
    .select(
      "data_da_ultima_visita, consultor, empresa, perfil_visita, dt_mar_25, consultor_mar_25, corte, venc, valor, tit, endereco, bairro, cidade, uf, supervisor, vendedor, nome_fantasia, grupo, situacao, obs_contrato_1, obs_contrato_2",
    )
    .limit(10000);

  query = applyFilters(query, filters);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return data ?? [];
};
