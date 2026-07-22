import { supabase } from "./supabase";

export type LocalAction = {
  id: string;
  startDate: string;
  endDate: string;
  notes: string;
  active: boolean;
  createdAt: string;
};

export type LocalActionCompletion = {
  id: string;
  actionId: string;
  routeDate: string;
  vendorUserId: string;
  vendorName: string;
  companyName?: string | null;
  completed: boolean;
  reason: string | null;
  completedAt: string;
};

let actionsCache: LocalAction[] = [];
let completionsCache: LocalActionCompletion[] = [];
const ACTIONS_CHANGED_EVENT = "odontoart-route-actions-changed";

const notify = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ACTIONS_CHANGED_EVENT));
};

const mapAction = (row: Record<string, unknown>): LocalAction => ({
  id: String(row.id),
  startDate: String(row.start_date),
  endDate: String(row.end_date),
  notes: String(row.notes ?? ""),
  active: Boolean(row.active),
  createdAt: String(row.created_at),
});

const mapCompletion = (row: Record<string, unknown>): LocalActionCompletion => ({
  id: String(row.id),
  actionId: String(row.action_id),
  routeDate: String(row.route_date),
  vendorUserId: String(row.vendor_user_id),
  vendorName: String(row.vendor_name ?? ""),
  companyName: row.company_name ? String(row.company_name) : null,
  completed: Boolean(row.completed),
  reason: row.reason ? String(row.reason) : null,
  completedAt: String(row.completed_at),
});

export const getLocalActions = () => actionsCache;
export const getLocalActionCompletions = () => completionsCache;

export const refreshLocalActions = async () => {
  const { data, error } = await supabase
    .from("route_actions")
    .select("id, start_date, end_date, notes, active, created_at")
    .order("start_date", { ascending: true });
  if (error) throw error;
  actionsCache = ((data ?? []) as Record<string, unknown>[]).map(mapAction);
  notify();
  return actionsCache;
};

export const refreshLocalActionCompletions = async () => {
  const { data, error } = await supabase
    .from("route_action_completions")
    .select("id, action_id, route_date, vendor_user_id, vendor_name, company_name, completed, reason, completed_at")
    .order("route_date", { ascending: true });
  if (error) throw error;
  completionsCache = ((data ?? []) as Record<string, unknown>[]).map(mapCompletion);
  notify();
  return completionsCache;
};

export const saveLocalAction = async (payload: Pick<LocalAction, "startDate" | "endDate" | "notes">) => {
  const { data, error } = await supabase
    .from("route_actions")
    .insert({ start_date: payload.startDate, end_date: payload.endDate, notes: payload.notes })
    .select("id, start_date, end_date, notes, active, created_at")
    .single();
  if (error) throw error;
  const action = mapAction(data as Record<string, unknown>);
  actionsCache = [...actionsCache, action];
  notify();
  return action;
};

export const deleteLocalAction = async (id: string) => {
  const { error } = await supabase.from("route_actions").delete().eq("id", id);
  if (error) throw error;
  actionsCache = actionsCache.filter((action) => action.id !== id);
  completionsCache = completionsCache.filter((completion) => completion.actionId !== id);
  notify();
};

export const getActiveLocalActionsForDate = (date: string) =>
  actionsCache.filter((action) => action.active && action.startDate <= date && action.endDate >= date);

export const getLocalActionCompletion = (actionId: string, routeDate: string, vendorUserId: string) =>
  completionsCache.find(
    (completion) => completion.actionId === actionId && completion.routeDate === routeDate && completion.vendorUserId === vendorUserId,
  ) ?? null;

export const saveLocalActionCompletion = async (payload: Omit<LocalActionCompletion, "id" | "completedAt">) => {
  const { data, error } = await supabase
    .from("route_action_completions")
    .upsert({
      action_id: payload.actionId,
      route_date: payload.routeDate,
      vendor_user_id: payload.vendorUserId,
      vendor_name: payload.vendorName || null,
      company_name: payload.companyName || null,
      completed: payload.completed,
      reason: payload.reason || null,
    }, { onConflict: "action_id,route_date,vendor_user_id" })
    .select("id, action_id, route_date, vendor_user_id, vendor_name, company_name, completed, reason, completed_at")
    .single();
  if (error) throw error;
  const completion = mapCompletion(data as Record<string, unknown>);
  completionsCache = [
    ...completionsCache.filter((item) => !(item.actionId === completion.actionId && item.routeDate === completion.routeDate && item.vendorUserId === completion.vendorUserId)),
    completion,
  ];
  notify();
  return completion;
};

export const subscribeLocalActions = (listener: () => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(ACTIONS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ACTIONS_CHANGED_EVENT, listener);
};
