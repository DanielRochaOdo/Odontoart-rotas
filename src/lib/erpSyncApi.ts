import { supabase } from "./supabase";

const SESSION_EXPIRED_FRIENDLY_MESSAGE = "Sua sessao foi encerrada. Faca login novamente.";

type ErpSyncAction = "unlock" | "preview" | "execute-wave";

type InvokeResult = {
  data: unknown;
  error: { message: string } | null;
};

const parseErrorMessage = (payload: unknown, fallback: string) => {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  return fallback;
};

const invokeErpSyncViaHttp = async (
  accessToken: string,
  body: {
    action: ErpSyncAction;
    payload: Record<string, unknown>;
  },
): Promise<InvokeResult> => {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";

  if (!supabaseUrl || !anonKey) {
    return {
      data: null,
      error: { message: "Configuracao do Supabase ausente no cliente." },
    };
  }

  const endpoint = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/erp-sync-manual`;
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
    return {
      data: payload,
      error: {
        message: parseErrorMessage(payload, `Edge Function returned status ${response.status}.`),
      },
    };
  }

  return { data: payload, error: null };
};

const invokeErpSync = async (body: {
  action: ErpSyncAction;
  payload: Record<string, unknown>;
}) => {
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

  const firstAttempt = await invokeErpSyncViaHttp(accessToken, body);
  if (!firstAttempt.error) return firstAttempt;

  const shouldRetryWithRefresh =
    firstAttempt.error.message.toLowerCase().includes("sessao invalida") ||
    firstAttempt.error.message.toLowerCase().includes("token ausente") ||
    firstAttempt.error.message.toLowerCase().includes("status 401");

  if (!shouldRetryWithRefresh) {
    return firstAttempt;
  }

  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session?.access_token) {
    return firstAttempt;
  }

  return invokeErpSyncViaHttp(data.session.access_token, body);
};

export type ErpSyncUnlockResult = {
  unlock_token: string;
  expires_at: string;
  ttl_minutes: number;
};

export type ErpSyncPreviewItem = {
  code: string;
  local_rows_count: number;
  sample_company: string | null;
  found_local: boolean;
};

export type ErpSyncPreviewResult = {
  normalized_codes: string[];
  total_codes: number;
  found_local_count: number;
  missing_local_count: number;
  found_local_codes: string[];
  missing_local_codes: string[];
  recommended_wave_limit: number;
  max_wave_limit: number;
  items: ErpSyncPreviewItem[];
};

export type ErpSyncExecuteItem = {
  code: string;
  status: "updated" | "no_changes" | "local_not_found" | "erp_not_found" | "no_mapped_fields" | "failed";
  updated_rows: number;
  changed_rows: number;
  fields: string[];
  field_details: Array<{
    field: string;
    from_values: Array<string | number | null>;
    to_value: string | number | null;
    changed: boolean;
    changed_rows: number;
  }>;
  changes: Array<{
    field: string;
    from_values: Array<string | number | null>;
    to_value: string | number | null;
    changed_rows: number;
  }>;
  message: string | null;
};

export type ErpSyncExecuteResult = {
  processed_count: number;
  next_offset: number;
  has_more: boolean;
  remaining_count: number;
  max_wave_limit: number;
  results: ErpSyncExecuteItem[];
  summary: {
    updated: number;
    no_changes: number;
    local_not_found: number;
    erp_not_found: number;
    no_mapped_fields: number;
    failed: number;
  };
};

export const unlockErpSyncSection = async (releasePassword: string) => {
  const { data, error } = await invokeErpSync({
    action: "unlock",
    payload: {
      release_password: releasePassword,
    },
  });

  if (error) throw new Error(error.message);
  return data as ErpSyncUnlockResult;
};

export const previewErpSyncCodes = async (payload: {
  unlockToken: string;
  codes: string[];
}) => {
  const { data, error } = await invokeErpSync({
    action: "preview",
    payload: {
      unlock_token: payload.unlockToken,
      codes: payload.codes,
    },
  });

  if (error) throw new Error(error.message);
  return data as ErpSyncPreviewResult;
};

export const executeErpSyncWave = async (payload: {
  unlockToken: string;
  codes: string[];
  offset: number;
  limit: number;
}) => {
  const { data, error } = await invokeErpSync({
    action: "execute-wave",
    payload: {
      unlock_token: payload.unlockToken,
      codes: payload.codes,
      offset: payload.offset,
      limit: payload.limit,
    },
  });

  if (error) throw new Error(error.message);
  return data as ErpSyncExecuteResult;
};
