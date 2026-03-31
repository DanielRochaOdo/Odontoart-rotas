import { supabase } from "./supabase";
import type { Route, RouteStop } from "../types/routes";

export type EmpresaLookupRow = {
  id: string;
  codigo: string | null;
  empresa: string | null;
  nome_fantasia: string | null;
  vendedor: string | null;
  supervisor: string | null;
  situacao: string | null;
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
      "id, route_id, cliente_id, agenda_id, stop_order, notes, cliente:cliente_id (id, codigo, empresa, nome_fantasia, endereco, complemento, bairro, cidade, uf, latitude, longitude)",
    )
    .eq("route_id", routeId)
    .order("stop_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RouteStop[];
};

export const createRouteStop = async (payload: {
  route_id: string;
  cliente_id?: string | null;
  agenda_id?: string | null;
  stop_order?: number | null;
  notes?: string | null;
}) => {
  const { data, error } = await supabase
    .from("route_stops")
    .insert({
      route_id: payload.route_id,
      cliente_id: payload.cliente_id ?? null,
      agenda_id: payload.agenda_id ?? null,
      stop_order: payload.stop_order ?? null,
      notes: payload.notes ?? null,
    })
    .select(
      "id, route_id, cliente_id, agenda_id, stop_order, notes, cliente:cliente_id (id, codigo, empresa, nome_fantasia, endereco, complemento, bairro, cidade, uf, latitude, longitude)",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as RouteStop;
};

export const deleteRouteStop = async (stopId: string) => {
  const { error } = await supabase.from("route_stops").delete().eq("id", stopId);
  if (error) throw new Error(error.message);
};

export const fetchEmpresasLookup = async () => {
  const selectColumns =
    "id, codigo, empresa, nome_fantasia, vendedor, supervisor, situacao, perfil_visita, instructions, data_da_ultima_visita, visit_completed_vidas, grupo, obs_comercial, endereco, complemento, bairro, cidade, uf, latitude, longitude";

  const pageSize = 1000;
  let from = 0;
  const allRows: EmpresaLookupRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("clientes")
      .select(selectColumns)
      .range(from, from + pageSize - 1)
      .order("id", { ascending: true });

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

export const updateEmpresaCoordinates = async (payload: {
  id: string;
  latitude: number;
  longitude: number;
  geocode_source?: string;
}) => {
  const { error } = await supabase
    .from("clientes")
    .update({
      latitude: payload.latitude,
      longitude: payload.longitude,
      geocode_source: payload.geocode_source ?? "nominatim",
      geocode_updated_at: new Date().toISOString(),
    })
    .eq("id", payload.id);

  if (error) throw new Error(error.message);
};

export const updateEmpresaCoordinatesBatch = async (payload: {
  ids: string[];
  latitude: number;
  longitude: number;
  geocode_source?: string;
}) => {
  if (!payload.ids.length) return;

  const { error } = await supabase
    .from("clientes")
    .update({
      latitude: payload.latitude,
      longitude: payload.longitude,
      geocode_source: payload.geocode_source ?? "nominatim",
      geocode_updated_at: new Date().toISOString(),
    })
    .in("id", payload.ids);

  if (error) throw new Error(error.message);
};

