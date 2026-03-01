import { supabase } from "./supabase";
import type { Route, RouteStop } from "../types/routes";

export type AgendaLookupRow = {
  id: string;
  empresa: string | null;
  nome_fantasia: string | null;
  cod_1: string | null;
  vendedor: string | null;
  supervisor: string | null;
  situacao: string | null;
  perfil_visita: string | null;
  data_da_ultima_visita: string | null;
  visit_completed_vidas: number | null;
  grupo: string | null;
  obs_contrato_1: string | null;
  endereco: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  latitude: number | null;
  longitude: number | null;
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
      "id, route_id, agenda_id, stop_order, notes, agenda:agenda_id (id, empresa, nome_fantasia, endereco, complemento, bairro, cidade, uf, latitude, longitude)",
    )
    .eq("route_id", routeId)
    .order("stop_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RouteStop[];
};

export const createRouteStop = async (payload: {
  route_id: string;
  agenda_id?: string | null;
  stop_order?: number | null;
  notes?: string | null;
}) => {
  const { data, error } = await supabase
    .from("route_stops")
    .insert({
      route_id: payload.route_id,
      agenda_id: payload.agenda_id ?? null,
      stop_order: payload.stop_order ?? null,
      notes: payload.notes ?? null,
    })
    .select(
      "id, route_id, agenda_id, stop_order, notes, agenda:agenda_id (id, empresa, nome_fantasia, endereco, complemento, bairro, cidade, uf, latitude, longitude)",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as RouteStop;
};

export const deleteRouteStop = async (stopId: string) => {
  const { error } = await supabase.from("route_stops").delete().eq("id", stopId);
  if (error) throw new Error(error.message);
};

export const fetchAgendaLookup = async () => {
  const selectColumns =
    "id, cod_1, empresa, nome_fantasia, vendedor, supervisor, situacao, perfil_visita, data_da_ultima_visita, visit_completed_vidas, grupo, obs_contrato_1, endereco, complemento, bairro, cidade, uf, latitude, longitude";

  const pageSize = 1000;
  let from = 0;
  const allRows: AgendaLookupRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("agenda")
      .select(selectColumns)
      .range(from, from + pageSize - 1)
      .order("id", { ascending: true });

    if (error) throw new Error(error.message);
    const batch = (data ?? []) as AgendaLookupRow[];
    if (batch.length === 0) break;
    allRows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
};

export const fetchProfiles = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, role")
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
};

export const updateAgendaCoordinates = async (payload: {
  id: string;
  latitude: number;
  longitude: number;
  geocode_source?: string;
}) => {
  const { error } = await supabase
    .from("agenda")
    .update({
      latitude: payload.latitude,
      longitude: payload.longitude,
      geocode_source: payload.geocode_source ?? "nominatim",
      geocode_updated_at: new Date().toISOString(),
    })
    .eq("id", payload.id);

  if (error) throw new Error(error.message);
};

