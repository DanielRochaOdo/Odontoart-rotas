import { supabase } from "./supabase";

export type RouteEventType = "TREINAMENTO" | "REUNIAO";

export type RouteEventRow = {
  id: string;
  event_date: string;
  event_type: RouteEventType;
  event_time: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export const fetchRouteEventsByYear = async (year: number) => {
  const from = `${year.toString().padStart(4, "0")}-01-01`;
  const to = `${year.toString().padStart(4, "0")}-12-31`;

  const { data, error } = await supabase
    .from("route_events")
    .select("id, event_date, event_type, event_time, notes, created_by, created_at")
    .gte("event_date", from)
    .lte("event_date", to)
    .order("event_date", { ascending: true })
    .order("event_time", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as RouteEventRow[];
};

export const fetchRouteEventsByDate = async (dateKey: string) => {
  const { data, error } = await supabase
    .from("route_events")
    .select("id, event_date, event_type, event_time, notes, created_by, created_at")
    .eq("event_date", dateKey)
    .order("event_time", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as RouteEventRow[];
};

export const createRouteEvent = async (payload: {
  event_date: string;
  event_type: RouteEventType;
  event_time?: string | null;
  notes?: string | null;
  created_by?: string | null;
}) => {
  const { data, error } = await supabase
    .from("route_events")
    .insert({
      event_date: payload.event_date,
      event_type: payload.event_type,
      event_time: payload.event_time ?? null,
      notes: payload.notes ?? null,
      created_by: payload.created_by ?? null,
    })
    .select("id, event_date, event_type, event_time, notes, created_by, created_at")
    .single();

  if (error) throw new Error(error.message);
  return data as RouteEventRow;
};

export const deleteRouteEvent = async (id: string) => {
  const { error } = await supabase.from("route_events").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

