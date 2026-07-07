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
  force_reauth_after?: string | null;
  is_inactive?: boolean;
  supervisor?: { id: string; display_name: string | null } | null;
  vendedor?: { id: string; display_name: string | null } | null;
};

export type ManagedUserHistorySnapshot = {
  visits: number;
  aceiteDigital: number;
  hasHistory: boolean;
};

const EMAIL_LOOKUP_COOLDOWN_MS = 60_000;
let emailLookupBlockedUntil = 0;
const EMAIL_RPC_LOOKUP_COOLDOWN_MS = 5 * 60_000;
let emailRpcLookupBlockedUntil = 0;

type ProfileEmailLookupRow = {
  user_id: string | null;
  email: string | null;
};

type ManageUsersInvokeResult = {
  data: unknown;
  error: { message: string } | null;
};

const SESSION_EXPIRED_FRIENDLY_MESSAGE = "Sua sessao foi encerrada. Faca login novamente.";

const parseErrorMessage = (payload: unknown, fallback: string) => {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  return fallback;
};

const invokeManageUsersViaHttp = async (
  accessToken: string,
  body: {
    action: "create" | "delete" | "update" | "list-emails" | "reset-access" | "reset-all-access" | "reactivate";
    payload: Record<string, unknown>;
  },
): Promise<ManageUsersInvokeResult> => {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";

  if (!supabaseUrl || !anonKey) {
    return {
      data: null,
      error: { message: "Configuracao do Supabase ausente no cliente." },
    };
  }

  const endpoint = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/manage-users`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify(body),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      const message = parseErrorMessage(payload, "Status 401: Sessao invalida.");
      return {
        data: payload,
        error: { message },
      };
    }
    return {
      data: payload,
      error: {
        message: parseErrorMessage(payload, `Edge Function returned status ${response.status}.`),
      },
    };
  }

  return { data: payload, error: null };
};

const invokeManageUsers = async (body: {
  action: "create" | "delete" | "update" | "list-emails" | "reset-access" | "reset-all-access" | "reactivate";
  payload: Record<string, unknown>;
}): Promise<ManageUsersInvokeResult> => {
  const {
    data: { session: currentSession },
  } = await supabase.auth.getSession();

  let session = currentSession;
  const currentExpiresAtMs = (currentSession?.expires_at ?? 0) * 1000;
  const isCurrentTokenExpired = !currentSession || currentExpiresAtMs <= Date.now() + 5_000;
  if (isCurrentTokenExpired) {
    const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError && refreshedData.session) {
      session = refreshedData.session;
    } else {
      throw new Error(SESSION_EXPIRED_FRIENDLY_MESSAGE);
    }
  }

  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error(SESSION_EXPIRED_FRIENDLY_MESSAGE);
  }

  const {
    data: { user: validatedUser },
    error: validateTokenError,
  } = await supabase.auth.getUser(accessToken);
  if (validateTokenError || !validatedUser) {
    throw new Error(SESSION_EXPIRED_FRIENDLY_MESSAGE);
  }

  let firstAttempt = await invokeManageUsersViaHttp(accessToken, body);

  if (!firstAttempt.error) return firstAttempt;

  const shouldRetryWithRefresh =
    firstAttempt.error.message.toLowerCase().includes("sessao invalida") ||
    firstAttempt.error.message.toLowerCase().includes("token ausente") ||
    firstAttempt.error.message.toLowerCase().includes("status 401");

  if (shouldRetryWithRefresh) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session?.access_token) {
      const retry = await invokeManageUsersViaHttp(data.session.access_token, body);
      if (!retry.error) return retry;
      firstAttempt = retry;
    }
  }

  return firstAttempt;
};

export const fetchManagedProfiles = async (options?: { includeInactive?: boolean }) => {
  let query = supabase
    .from("profiles")
    .select(
      "id, user_id, role, display_name, nome, can_access_pre_cadastro, can_access_next_route_dashboard, force_reauth_after, is_inactive, supervisor_id, vendedor_id, supervisor:supervisor_id (id, display_name), vendedor:vendedor_id (id, display_name)",
    )
    .order("display_name", { ascending: true });

  if (!options?.includeInactive) {
    query = query.or("is_inactive.is.null,is_inactive.eq.false");
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ManagedProfile[];
};

export const updateManagedProfile = async (payload: {
  id: string;
  display_name?: string | null;
  nome?: string | null;
  is_inactive?: boolean;
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
    is_inactive?: boolean;
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
  if (payload.is_inactive !== undefined) {
    updates.is_inactive = payload.is_inactive;
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", payload.id)
    .select(
      "id, user_id, role, display_name, nome, can_access_pre_cadastro, can_access_next_route_dashboard, force_reauth_after, is_inactive, supervisor_id, vendedor_id, supervisor:supervisor_id (id, display_name), vendedor:vendedor_id (id, display_name)",
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
  const response = (data ?? null) as { profile?: ManagedProfile } | null;
  if (!response?.profile) throw new Error("Resposta invalida ao criar usuario.");
  return response.profile;
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

export const resetManagedUserAccess = async (payload: { user_id: string }) => {
  const forceReauthAfter = new Date().toISOString();

  const { error: directUpdateError } = await supabase
    .from("profiles")
    .update({ force_reauth_after: forceReauthAfter })
    .eq("user_id", payload.user_id);

  if (!directUpdateError) {
    return {
      success: true,
      user_id: payload.user_id,
      force_reauth_after: forceReauthAfter,
      scope: "client-direct",
    };
  }

  const { data, error } = await invokeManageUsers({
    action: "reset-access",
    payload: payload as unknown as Record<string, unknown>,
  });

  if (error) throw new Error(error.message);
  return data ?? { success: true };
};

export const inactivateManagedUser = async (user_id: string) => {
  const { error } = await supabase.from("profiles").update({ is_inactive: true }).eq("user_id", user_id);
  if (error) throw new Error(error.message);
  return { success: true };
};

export const fetchManagedUserHistorySnapshot = async (userId: string) => {
  const [visitsResponse, aceiteResponse] = await Promise.all([
    supabase.from("visits").select("id", { count: "exact", head: true }).eq("assigned_to_user_id", userId),
    supabase.from("aceite_digital").select("id", { count: "exact", head: true }).eq("vendor_user_id", userId),
  ]);

  if (visitsResponse.error) throw new Error(visitsResponse.error.message);
  if (aceiteResponse.error) throw new Error(aceiteResponse.error.message);

  const visits = visitsResponse.count ?? 0;
  const aceiteDigital = aceiteResponse.count ?? 0;
  return {
    visits,
    aceiteDigital,
    hasHistory: visits > 0 || aceiteDigital > 0,
  } satisfies ManagedUserHistorySnapshot;
};

export const reactivateManagedUser = async (user_id: string) => {
  const { error } = await supabase.from("profiles").update({ is_inactive: false }).eq("user_id", user_id);
  if (error) throw new Error(error.message);
  return { success: true };
};

export const resetAllManagedUsersAccess = async () => {
  const { data, error } = await invokeManageUsers({
    action: "reset-all-access",
    payload: {},
  });

  if (error) throw new Error(error.message);
  return data ?? { success: true };
};

export const fetchManagedUserEmails = async (userIds: string[]) => {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {} as Record<string, string>;

  const fetchViaRpc = async (ids: string[]) => {
    const { data, error } = await supabase.rpc("list_profile_emails", {
      p_user_ids: ids,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ProfileEmailLookupRow[];
    const map: Record<string, string> = {};
    rows.forEach((row) => {
      if (!row.user_id || !row.email) return;
      map[row.user_id] = row.email;
    });
    return map;
  };

  const rpcResultByUserId: Record<string, string> = {};
  if (Date.now() >= emailRpcLookupBlockedUntil) {
    try {
      const fetched = await fetchViaRpc(uniqueIds);
      Object.assign(rpcResultByUserId, fetched);
      const missingAfterRpc = uniqueIds.filter((id) => !fetched[id]);
      if (missingAfterRpc.length === 0) {
        return rpcResultByUserId;
      }
    } catch (rpcError) {
      const message = rpcError instanceof Error ? rpcError.message : "unknown error";
      if (message.toLowerCase().includes("structure of query does not match function result type")) {
        emailRpcLookupBlockedUntil = Date.now() + EMAIL_RPC_LOOKUP_COOLDOWN_MS;
      }
    }
  }

  const pendingIds = uniqueIds.filter((id) => !rpcResultByUserId[id]);
  if (pendingIds.length === 0) return rpcResultByUserId;

  if (Date.now() < emailLookupBlockedUntil) {
    return rpcResultByUserId;
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let data: { emails?: Record<string, string>; missing_user_ids?: string[] } | null = null;
    let error: Error | null = null;
    try {
      const response = await invokeManageUsers({
        action: "list-emails",
        payload: { user_ids: pendingIds },
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
      }
      return {
        ...rpcResultByUserId,
        ...((data?.emails ?? {}) as Record<string, string>),
      };
    }

    lastError = new Error(error.message);
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
  }

  emailLookupBlockedUntil = Date.now() + EMAIL_LOOKUP_COOLDOWN_MS;
  return rpcResultByUserId;
};

export const deleteProfileOnly = async (id: string) => {
  const { error } = await supabase.from("profiles").delete().eq("id", id);
  if (error) throw new Error(error.message);
};
