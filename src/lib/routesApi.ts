import { supabase } from "./supabase";
import type { Route, RouteStop } from "../types/routes";

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
      "id, route_id, agenda_id, stop_order, notes, agenda:agenda_id (id, empresa, nome_fantasia, endereco, cidade, uf)",
    )
    .eq("route_id", routeId)
    .order("stop_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as RouteStop[];
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
      "id, route_id, agenda_id, stop_order, notes, agenda:agenda_id (id, empresa, nome_fantasia, endereco, cidade, uf)",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as RouteStop;
};

export const deleteRouteStop = async (stopId: string) => {
  const { error } = await supabase.from("route_stops").delete().eq("id", stopId);
  if (error) throw new Error(error.message);
};

export const fetchAgendaLookup = async () => {
  const { data, error } = await supabase
    .from("agenda")
    .select("id, empresa, nome_fantasia, endereco, cidade, uf")
    .limit(2000);

  if (error) throw new Error(error.message);
  return data ?? [];
};

export const fetchProfiles = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, role")
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
};
