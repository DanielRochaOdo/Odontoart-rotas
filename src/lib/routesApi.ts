import { supabase } from "./supabase";
import type { Route, RouteStop } from "../types/routes";
import type { AgendaFilters } from "../types/agenda";

export type EmpresaLookupRow = {
  id: string;
  codigo: string | null;
  empresa: string | null;
  nome_fantasia: string | null;
  vendedor: string | null;
  supervisor: string | null;
  situacao: string | null;
  categoria: string | null;
  perfil_visita: string | null;
  instructions: string | null;
  data_da_ultima_visita: string | null;
  visit_completed_vidas: number | null;
  grupo: string | null;
  obs_comercial: string | null;
  endereco: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type EmpresaScheduledVisit = {
  id: string;
  cliente_id: string;
  visit_date: string;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  perfil_visita: string | null;
  instructions: string | null;
  completed_at: string | null;
  route_id: string | null;
};

type EmpresasLookupSearch = {
  companyName?: string;
  companyCode?: string;
};

type EmpresasLookupOptions = {
  filters?: AgendaFilters;
  search?: EmpresasLookupSearch;
};

const normalizeValue = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();

const sanitizeSearchTerm = (value: string | null | undefined) => (value ?? "").replace(/%/g, "").trim();

const parseOptionalNumber = (value?: string) => {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const applyLookupFilters = <T,>(query: T, filters?: AgendaFilters, search?: EmpresasLookupSearch): T => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let next: any = query;
  const applied = filters ?? {
    global: "",
    columns: {},
    dateRanges: { data_da_ultima_visita: {} },
    ranges: { vidas_ultima_visita: {} },
  };

  Object.entries(applied.columns ?? {}).forEach(([key, values]) => {
    if (!Array.isArray(values) || values.length === 0) return;
    const cleaned = values.map((item) => item.trim()).filter(Boolean);
    if (cleaned.length === 0) return;

    const sourceKey =
      key === "cod_1"
        ? "codigo"
        : key === "empresa_nome"
          ? "empresa"
          : key;

    if (key === "categoria") {
      const includeSemCategoria = cleaned.some((value) => normalizeValue(value) === "SEM CATEGORIA");
      if (includeSemCategoria) {
        const categoriaValues = cleaned.filter((value) => normalizeValue(value) !== "SEM CATEGORIA");
        const conditions = ["categoria.is.null", 'categoria.eq.""'];
        if (categoriaValues.length > 0) {
          conditions.push(`categoria.in.(${categoriaValues.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",")})`);
        }
        next = next.or(conditions.join(","));
        return;
      }
    }

    next = next.in(sourceKey, cleaned);
  });

  const explicitSituacao = applied.columns?.situacao ?? [];
  const situacaoValues = explicitSituacao.length > 0 ? explicitSituacao : ["Ativo"];
  next = next.in("situacao", situacaoValues);

  const companyCode = sanitizeSearchTerm(search?.companyCode);
  if (companyCode) {
    next = next.eq("codigo", companyCode);
  }

  const companyName = sanitizeSearchTerm(search?.companyName);
  if (companyName) {
    next = next.ilike("empresa", `%${companyName}%`);
  }

  const dateRange = applied.dateRanges?.data_da_ultima_visita ?? {};
  const hasMonthYear = Boolean(dateRange.month || dateRange.year);
  const invertRange = Boolean(dateRange.invert);

  if (!hasMonthYear) {
    if (invertRange) {
      if (dateRange.from) next = next.gte("data_da_ultima_visita", dateRange.from);
      if (dateRange.to) next = next.lte("data_da_ultima_visita", `${dateRange.to}T23:59:59`);
    } else if (dateRange.from || dateRange.to) {
      const conditions: string[] = [];
      if (dateRange.from) conditions.push(`data_da_ultima_visita.lt.${dateRange.from}`);
      if (dateRange.to) conditions.push(`data_da_ultima_visita.gt.${dateRange.to}T23:59:59`);
      conditions.push("data_da_ultima_visita.is.null");
      next = next.or(conditions.join(","));
    }
  } else {
    const fallbackYear = dateRange.year || (dateRange.month ? String(new Date().getFullYear()) : undefined);
    const numericYear = Number(fallbackYear);
    if (fallbackYear && !Number.isNaN(numericYear)) {
      const hasMonth = Boolean(dateRange.month);
      const numericMonth = Number(dateRange.month);
      const startDate = hasMonth ? new Date(numericYear, numericMonth - 1, 1) : new Date(numericYear, 0, 1);
      const endDate = hasMonth ? new Date(numericYear, numericMonth, 0) : new Date(numericYear, 11, 31);
      const startValue = startDate.toISOString().slice(0, 10);
      const endValue = endDate.toISOString().slice(0, 10);

      if (invertRange) {
        next = next.gte("data_da_ultima_visita", startValue);
        next = next.lte("data_da_ultima_visita", `${endValue}T23:59:59`);
      } else {
        next = next.or([
          `data_da_ultima_visita.lt.${startValue}`,
          `data_da_ultima_visita.gt.${endValue}T23:59:59`,
          "data_da_ultima_visita.is.null",
        ].join(","));
      }
    }
  }

  const vidasFrom = parseOptionalNumber(applied.ranges?.vidas_ultima_visita?.from);
  const vidasTo = parseOptionalNumber(applied.ranges?.vidas_ultima_visita?.to);
  if (vidasFrom !== null) next = next.gte("visit_completed_vidas", vidasFrom);
  if (vidasTo !== null) next = next.lte("visit_completed_vidas", vidasTo);

  return next as T;
};

export const fetchRoutes = async () => {
  const { data, error } = await supabase
    .from("routes")
    .select("id, name, date, assigned_to_user_id, created_by, created_at")
    .order("date", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Route[];
};

export const createRoute = async (payload: {
  name: string;
  date?: string;
  assigned_to_user_id?: string | null;
  created_by?: string | null;
}) => {
  const { data, error } = await supabase
    .from("routes")
    .insert({
      name: payload.name,
      date: payload.date ?? null,
      assigned_to_user_id: payload.assigned_to_user_id ?? null,
      created_by: payload.created_by ?? null,
    })
    .select("id, name, date, assigned_to_user_id, created_by, created_at")
    .single();

  if (error) throw new Error(error.message);
  return data as Route;
};

export const deleteRoute = async (routeId: string) => {
  const { error } = await supabase.from("routes").delete().eq("id", routeId);
  if (error) throw new Error(error.message);
};

export const fetchRouteStops = async (routeId: string) => {
  const { data, error } = await supabase
    .from("route_stops")
    .select(
      "id, route_id, cliente_id, stop_order, notes, cliente:cliente_id (id, codigo, empresa, nome_fantasia, endereco, complemento, bairro, cidade, uf, latitude, longitude)",
    )
    .eq("route_id", routeId)
    .order("stop_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RouteStop[];
};

export const createRouteStop = async (payload: {
  route_id: string;
  cliente_id?: string | null;
  stop_order?: number | null;
  notes?: string | null;
}) => {
  const { data, error } = await supabase
    .from("route_stops")
    .insert({
      route_id: payload.route_id,
      cliente_id: payload.cliente_id ?? null,
      stop_order: payload.stop_order ?? null,
      notes: payload.notes ?? null,
    })
    .select(
      "id, route_id, cliente_id, stop_order, notes, cliente:cliente_id (id, codigo, empresa, nome_fantasia, endereco, complemento, bairro, cidade, uf, latitude, longitude)",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as RouteStop;
};

export const deleteRouteStop = async (stopId: string) => {
  const { error } = await supabase.from("route_stops").delete().eq("id", stopId);
  if (error) throw new Error(error.message);
};

export const fetchEmpresasLookup = async (options?: EmpresasLookupOptions) => {
  const selectColumns =
    "id, codigo, empresa, nome_fantasia, vendedor, supervisor, situacao, categoria, perfil_visita, instructions, data_da_ultima_visita, visit_completed_vidas, grupo, obs_comercial, endereco, complemento, bairro, cidade, uf, latitude, longitude";

  const pageSize = 1000;
  let from = 0;
  const allRows: EmpresaLookupRow[] = [];

  while (true) {
    let query = supabase
      .from("clientes")
      .select(selectColumns)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    query = applyLookupFilters(query, options?.filters, options?.search);
    const { data, error } = await query;

    if (error) throw new Error(error.message);
    const batch = (data ?? []) as EmpresaLookupRow[];
    if (batch.length === 0) break;
    allRows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
};

export const fetchEmpresaScheduledVisits = async (empresaIds: string[]) => {
  if (!empresaIds.length) return [] as EmpresaScheduledVisit[];

  const uniqueIds = Array.from(new Set(empresaIds.filter(Boolean)));
  if (!uniqueIds.length) return [] as EmpresaScheduledVisit[];

  const chunkSize = 500;
  const results: EmpresaScheduledVisit[] = [];

  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    const chunk = uniqueIds.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from("visits")
      .select(
        "id, cliente_id, visit_date, assigned_to_user_id, assigned_to_name, perfil_visita, instructions, completed_at, route_id",
      )
      .in("cliente_id", chunk)
      .is("completed_at", null)
      .order("visit_date", { ascending: true });

    if (error) throw new Error(error.message);
    results.push(...((data ?? []) as EmpresaScheduledVisit[]));
  }

  return results;
};

export const fetchProfiles = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, role")
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
};

