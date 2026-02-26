import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { AgendaFilters } from "../types/agenda";

const FILTER_KEYS = [
  "supervisor",
  "vendedor",
  "cod_1",
  "bairro",
  "cidade",
  "uf",
  "grupo",
  "perfil_visita",
  "empresa_nome",
] as const;

const makeEmptyFilters = (): AgendaFilters => ({
  global: "",
  columns: {
    supervisor: [],
    vendedor: [],
    cod_1: [],
    bairro: [],
    cidade: [],
    uf: [],
    grupo: [],
    perfil_visita: [],
    empresa_nome: [],
  },
  dateRanges: {
    data_da_ultima_visita: {},
  },
});

const serializeList = (values: string[]) =>
  values.map((value) => encodeURIComponent(value)).join("|");

const parseList = (value: string | null) =>
  value
    ? value
        .split("|")
        .map((item) => decodeURIComponent(item))
        .filter(Boolean)
    : [];

const parseFromSearchParams = (searchParams: URLSearchParams) => {
  if (searchParams.size === 0) return null;
  const hasAny =
    searchParams.get("q") ||
    FILTER_KEYS.some((key) => searchParams.get(`f_${key}`)) ||
    searchParams.get("duv_from") ||
    searchParams.get("duv_to") ||
    searchParams.get("duv_month") ||
    searchParams.get("duv_year");
  if (!hasAny) return null;

  const next = makeEmptyFilters();
  next.global = searchParams.get("q") ?? "";
  FILTER_KEYS.forEach((key) => {
    next.columns[key] = parseList(searchParams.get(`f_${key}`));
  });

  const duvFrom = searchParams.get("duv_from");
  const duvTo = searchParams.get("duv_to");
  const duvMonth = searchParams.get("duv_month");
  const duvYear = searchParams.get("duv_year");
  next.dateRanges.data_da_ultima_visita = {
    ...(duvFrom ? { from: duvFrom } : {}),
    ...(duvTo ? { to: duvTo } : {}),
    ...(duvMonth ? { month: duvMonth } : {}),
    ...(duvYear ? { year: duvYear } : {}),
  };

  return next;
};

const parseFromStorage = () => {
  const stored = localStorage.getItem("agendaFilters");
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<AgendaFilters>;
    const base = makeEmptyFilters();
    if (parsed.global) base.global = parsed.global;
    if (parsed.columns) {
      FILTER_KEYS.forEach((key) => {
        const values = parsed.columns?.[key];
        base.columns[key] = Array.isArray(values) ? values.filter(Boolean) : [];
      });
    }
    if (parsed.dateRanges?.data_da_ultima_visita) {
      const { from, to, month, year } = parsed.dateRanges.data_da_ultima_visita;
      base.dateRanges.data_da_ultima_visita = {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(month ? { month } : {}),
        ...(year ? { year } : {}),
      };
    }
    return base;
  } catch {
    return null;
  }
};

const buildParams = (filters: AgendaFilters) => {
  const params = new URLSearchParams();
  if (filters.global) params.set("q", filters.global);

  FILTER_KEYS.forEach((key) => {
    if (filters.columns[key]?.length) {
      params.set(`f_${key}`, serializeList(filters.columns[key]));
    }
  });

  if (filters.dateRanges.data_da_ultima_visita.from) {
    params.set("duv_from", filters.dateRanges.data_da_ultima_visita.from);
  }
  if (filters.dateRanges.data_da_ultima_visita.to) {
    params.set("duv_to", filters.dateRanges.data_da_ultima_visita.to);
  }
  if (filters.dateRanges.data_da_ultima_visita.month) {
    params.set("duv_month", filters.dateRanges.data_da_ultima_visita.month);
  }
  if (filters.dateRanges.data_da_ultima_visita.year) {
    params.set("duv_year", filters.dateRanges.data_da_ultima_visita.year);
  }
  return params;
};

export const useAgendaFilters = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const searchParamsSnapshot = useMemo(() => new URLSearchParams(searchKey), [searchKey]);

  const filters = useMemo(() => {
    const fromQuery = parseFromSearchParams(searchParamsSnapshot);
    if (fromQuery) return fromQuery;
    const fromStorage = parseFromStorage();
    return fromStorage ?? makeEmptyFilters();
  }, [searchParamsSnapshot]);

  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const syncFilters = useCallback(
    (next: AgendaFilters) => {
      const params = buildParams(next);
      const nextKey = params.toString();
      if (nextKey !== searchKey) {
        setSearchParams(params, { replace: true });
      }
      localStorage.setItem("agendaFilters", JSON.stringify(next));
    },
    [searchKey, setSearchParams],
  );

  useEffect(() => {
    if (searchKey.length !== 0) return;
    const stored = parseFromStorage();
    if (stored) {
      syncFilters(stored);
    }
  }, [searchKey, syncFilters]);

  const setFilters = useCallback(
    (next: AgendaFilters | ((prev: AgendaFilters) => AgendaFilters)) => {
      const current = filtersRef.current;
      const resolved = typeof next === "function" ? next(current) : next;
      syncFilters(resolved);
    },
    [syncFilters],
  );

  const clearFilters = () => setFilters(makeEmptyFilters());

  return { filters, setFilters, clearFilters };
};
