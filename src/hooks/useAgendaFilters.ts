import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AgendaFilters } from "../types/agenda";

const FILTER_KEYS = [
  "consultor",
  "supervisor",
  "vendedor",
  "cidade",
  "uf",
  "situacao",
  "grupo",
  "perfil_visita",
  "empresa_nome",
] as const;

const makeEmptyFilters = (): AgendaFilters => ({
  global: "",
  columns: {
    consultor: [],
    supervisor: [],
    vendedor: [],
    cidade: [],
    uf: [],
    situacao: [],
    grupo: [],
    perfil_visita: [],
    empresa_nome: [],
  },
  dateRanges: {
    data_da_ultima_visita: {},
    dt_mar_25: {},
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

export const useAgendaFilters = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<AgendaFilters>(() => makeEmptyFilters());

  const hasQueryFilters = useMemo(() => {
    if (searchParams.size === 0) return false;
    return (
      searchParams.get("q") ||
      FILTER_KEYS.some((key) => searchParams.get(`f_${key}`)) ||
      searchParams.get("duv_from") ||
      searchParams.get("duv_to") ||
      searchParams.get("dm25_from") ||
      searchParams.get("dm25_to")
    );
  }, [searchParams]);

  useEffect(() => {
    if (hasQueryFilters) {
      const next = makeEmptyFilters();
      next.global = searchParams.get("q") ?? "";
      FILTER_KEYS.forEach((key) => {
        next.columns[key] = parseList(searchParams.get(`f_${key}`));
      });
      const duvFrom = searchParams.get("duv_from");
      const duvTo = searchParams.get("duv_to");
      const dm25From = searchParams.get("dm25_from");
      const dm25To = searchParams.get("dm25_to");
      next.dateRanges.data_da_ultima_visita = {
        ...(duvFrom ? { from: duvFrom } : {}),
        ...(duvTo ? { to: duvTo } : {}),
      };
      next.dateRanges.dt_mar_25 = {
        ...(dm25From ? { from: dm25From } : {}),
        ...(dm25To ? { to: dm25To } : {}),
      };
      setFilters(next);
      return;
    }

    const stored = localStorage.getItem("agendaFilters");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AgendaFilters;
        setFilters({ ...makeEmptyFilters(), ...parsed });
        return;
      } catch {
        setFilters(makeEmptyFilters());
      }
    }
  }, [hasQueryFilters, searchParams]);

  useEffect(() => {
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
    if (filters.dateRanges.dt_mar_25.from) {
      params.set("dm25_from", filters.dateRanges.dt_mar_25.from);
    }
    if (filters.dateRanges.dt_mar_25.to) {
      params.set("dm25_to", filters.dateRanges.dt_mar_25.to);
    }

    setSearchParams(params, { replace: true });
    localStorage.setItem("agendaFilters", JSON.stringify(filters));
  }, [filters, setSearchParams]);

  const clearFilters = () => setFilters(makeEmptyFilters());

  return { filters, setFilters, clearFilters };
};
