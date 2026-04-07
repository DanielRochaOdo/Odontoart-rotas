import { supabase } from "./supabase";
import type { UserRole } from "../types/roles";

export type ManagedProfile = {
  id: string;
  user_id: string | null;
  role: UserRole;
  display_name: string | null;
  nome?: string | null;
  can_access_pre_cadastro: boolean;
  can_access_next_route_dashboard: boolean;
  supervisor_id: string | null;
  vendedor_id: string | null;
  supervisor?: { id: string; display_name: string | null } | null;
  vendedor?: { id: string; display_name: string | null } | null;
};

const EMAIL_LOOKUP_COOLDOWN_MS = 60_000;
let emailLookupBlockedUntil = 0;

const invokeManageUsers = async (body: {
  action: "create" | "delete" | "update" | "list-emails";
  payload: Record<string, unknown>;
}) => {
  const {
    data: { session: currentSession },
  } = await supabase.auth.getSession();

  let session = currentSession;
  const expiresAtMs = (session?.expires_at ?? 0) * 1000;
  const shouldRefresh = !session || expiresAtMs - Date.now() < 30_000;

  if (shouldRefresh) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      session = data.session;
    }
  }

  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error("Sessao expirada. Faca login novamente.");
  }

  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";
  const firstAttempt = await supabase.functions.invoke("manage-users", {
    body,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(anonKey ? { apikey: anonKey } : {}),
    },
  });

  if (!firstAttempt.error) return firstAttempt;

  const secondAttempt = await supabase.functions.invoke("manage-users", {
    body,
  });
  return secondAttempt;
};

export const fetchManagedProfiles = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, user_id, role, display_name, nome, can_access_pre_cadastro, can_access_next_route_dashboard, supervisor_id, vendedor_id, supervisor:supervisor_id (id, display_name), vendedor:vendedor_id (id, display_name)",
    )
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ManagedProfile[];
};

export const updateManagedProfile = async (payload: {
  id: string;
  display_name?: string | null;
  nome?: string | null;
  can_access_pre_cadastro?: boolean;
  can_access_next_route_dashboard?: boolean;
  supervisor_id?: string | null;
  vendedor_id?: string | null;
}) => {
  const updates: {
    display_name: string | null;
    nome: string | null;
    supervisor_id: string | null;
    vendedor_id: string | null;
    can_access_pre_cadastro?: boolean;
    can_access_next_route_dashboard?: boolean;
  } = {
    display_name: payload.display_name ?? null,
    nome: payload.nome ?? payload.display_name ?? null,
    supervisor_id: payload.supervisor_id ?? null,
    vendedor_id: payload.vendedor_id ?? null,
  };

  if (payload.can_access_pre_cadastro !== undefined) {
    updates.can_access_pre_cadastro = payload.can_access_pre_cadastro;
  }
  if (payload.can_access_next_route_dashboard !== undefined) {
    updates.can_access_next_route_dashboard = payload.can_access_next_route_dashboard;
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", payload.id)
    .select(
      "id, user_id, role, display_name, nome, can_access_pre_cadastro, can_access_next_route_dashboard, supervisor_id, vendedor_id, supervisor:supervisor_id (id, display_name), vendedor:vendedor_id (id, display_name)",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as ManagedProfile;
};

export const createManagedUser = async (payload: {
  email: string;
  password: string;
  display_name: string;
  nome?: string | null;
  role: UserRole;
  can_access_pre_cadastro?: boolean;
  can_access_next_route_dashboard?: boolean;
  supervisor_id?: string | null;
  vendedor_id?: string | null;
}) => {
  const { data, error } = await invokeManageUsers({
    action: "create",
    payload: payload as unknown as Record<string, unknown>,
  });

  if (error) throw new Error(error.message);
  if (!data?.profile) throw new Error("Resposta invalida ao criar usuario.");
  return data.profile as ManagedProfile;
};

export const deleteManagedUser = async (user_id: string) => {
  const { data, error } = await invokeManageUsers({
    action: "delete",
    payload: { user_id },
  });

  if (error) throw new Error(error.message);
  return data ?? { success: true };
};

export const updateManagedUserCredentials = async (payload: {
  user_id: string;
  email?: string | null;
  password?: string | null;
}) => {
  const { data, error } = await invokeManageUsers({
    action: "update",
    payload: payload as unknown as Record<string, unknown>,
  });

  if (error) throw new Error(error.message);
  return data ?? { success: true };
};

export const fetchManagedUserEmails = async (userIds: string[]) => {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {} as Record<string, string>;
  if (Date.now() < emailLookupBlockedUntil) {
    return {} as Record<string, string>;
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let data: { emails?: Record<string, string>; missing_user_ids?: string[] } | null = null;
    let error: Error | null = null;
    try {
      const response = await invokeManageUsers({
        action: "list-emails",
        payload: { user_ids: uniqueIds },
      });
      data = (response.data ?? null) as { emails?: Record<string, string>; missing_user_ids?: string[] } | null;
      error = response.error ? new Error(response.error.message) : null;
    } catch (invokeError) {
      error = invokeError instanceof Error ? invokeError : new Error("Erro ao consultar e-mails.");
    }

    if (!error) {
      const missingUserIds = Array.isArray(data?.missing_user_ids)
        ? (data.missing_user_ids as string[])
        : [];
      if (missingUserIds.length > 0) {
        console.warn(`manage-users list-emails missing ${missingUserIds.length} user(s).`);
      }
      return (data?.emails ?? {}) as Record<string, string>;
    }

    lastError = new Error(error.message);
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
  }

  emailLookupBlockedUntil = Date.now() + EMAIL_LOOKUP_COOLDOWN_MS;
  console.warn("manage-users list-emails unavailable:", lastError?.message ?? "unknown error");
  return {} as Record<string, string>;
};

export const deleteProfileOnly = async (id: string) => {
  const { error } = await supabase.from("profiles").delete().eq("id", id);
  if (error) throw new Error(error.message);
};
