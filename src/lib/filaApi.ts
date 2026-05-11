import { supabase } from "./supabase";
import { fetchEmpresaByEmpresaId } from "./odontoartEmpresaApi";
import { DATA_CORTE_FILA, evaluateDataContratoForFila } from "./filaDataContrato";

export type FilaState = "PENDING_WAIT" | "READY_AUTO" | "RELEASED_MANUAL" | "BLOCKED_MANUAL";

export type FilaEventType =
  | "NEW_COMPANY_WAITING"
  | "COUNTDOWN_30"
  | "COUNTDOWN_15"
  | "COUNTDOWN_7"
  | "COUNTDOWN_1"
  | "RULE_CHANGED"
  | "RELEASED_MANUAL"
  | "BLOCKED_MANUAL";

export type FilaSettingsRow = {
  id: boolean;
  feature_start_at: string;
  default_waiting_days: number;
  reminder_days: number[];
  created_at: string;
  updated_at: string;
};

export type FilaControlRow = {
  empresa_id: string;
  codigo: string | null;
  empresa: string | null;
  cnpj: string | null;
  data_contrato: string;
  waiting_days_snapshot: number;
  eligible_at: string;
  state: FilaState;
  effective_state: FilaState;
  manual_block_until: string | null;
  manual_reason: string | null;
  manual_override_by: string | null;
  manual_override_at: string | null;
  created_at: string;
  updated_at: string;
  days_remaining: number;
};

export type FilaPendingNotificationRow = {
  event_id: string;
  empresa_id: string;
  codigo: string | null;
  empresa: string | null;
  event_type: FilaEventType;
  payload: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export type FilaClienteCandidate = {
  id: string;
  codigo: string | null;
  empresa: string | null;
  cnpj: string | null;
  created_at: string | null;
};

export type FilaRoutingBlockLists = {
  blockedEmpresaIds: string[];
  blockedCodigos: string[];
  cachedAt: number;
};

type SupabaseLikeError = { code?: string; message?: string } | null;
const FILA_AUTO_SYNC_STORAGE_KEY = "filaAutoSyncAtMsV1";
const FILA_AUTO_SYNC_DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const FILA_ROUTING_BLOCKS_CACHE_MS = 60 * 1000;
export const FILA_ANO_MES_PRIMEIRO_PAGAMENTO_CORTE = DATA_CORTE_FILA;
let filaAutoSyncPromise: Promise<number> | null = null;
let filaAutoSyncLastRunAt = 0;
let filaRoutingBlocksCache: FilaRoutingBlockLists | null = null;
let filaRoutingBlocksPromise: Promise<FilaRoutingBlockLists> | null = null;

const readAutoSyncStorageTimestamp = () => {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(FILA_AUTO_SYNC_STORAGE_KEY);
    const parsed = Number(raw ?? "0");
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
};

const writeAutoSyncStorageTimestamp = (timestamp: number) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILA_AUTO_SYNC_STORAGE_KEY, String(timestamp));
  } catch {
    // ignore
  }
};

const ensureCurrentMonthFeatureStart = async (settings: FilaSettingsRow) => {
  const featureStart = Date.parse(settings.feature_start_at);
  if (!Number.isFinite(featureStart)) return settings;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const monthStartMs = monthStart.getTime();

  const featureDate = new Date(featureStart);
  const isSameMonthAsNow =
    featureDate.getUTCFullYear() === now.getUTCFullYear() &&
    featureDate.getUTCMonth() === now.getUTCMonth();

  if (!isSameMonthAsNow || featureStart <= monthStartMs) {
    return settings;
  }

  const monthStartIso = monthStart.toISOString();
  const { data, error } = await supabase
    .from("queue_release_settings")
    .update({ feature_start_at: monthStartIso })
    .eq("id", true)
    .select("id, feature_start_at, default_waiting_days, reminder_days, created_at, updated_at")
    .single();

  if (error) throw error;
  return data as FilaSettingsRow;
};

export const isMissingFilaBackendError = (error: SupabaseLikeError) => {
  const code = (error?.code ?? "").toUpperCase();
  const message = (error?.message ?? "").toLowerCase();
  if (code === "42P01" || code === "42883") return true;
  return (
    message.includes("queue_release") &&
    (message.includes("does not exist") || message.includes("nao existe"))
  );
};

export const fetchFilaSettings = async () => {
  const { data, error } = await supabase
    .from("queue_release_settings")
    .select("id, feature_start_at, default_waiting_days, reminder_days, created_at, updated_at")
    .eq("id", true)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as FilaSettingsRow | null;
};

export const updateFilaSettings = async (payload: {
  default_waiting_days: number;
  reminder_days: number[];
}) => {
  const { data, error } = await supabase
    .from("queue_release_settings")
    .upsert(
      {
        id: true,
        default_waiting_days: payload.default_waiting_days,
        reminder_days: payload.reminder_days,
      },
      { onConflict: "id" },
    )
    .select("id, feature_start_at, default_waiting_days, reminder_days, created_at, updated_at")
    .single();

  if (error) throw error;
  return data as FilaSettingsRow;
};

export const fetchFilaControls = async (params?: {
  state?: FilaState | "";
  search?: string;
  searchMode?: "codigo" | "empresa";
}) => {
  let query = supabase
    .from("queue_release_controls_view")
    .select(
      "empresa_id, codigo, empresa, cnpj, data_contrato, waiting_days_snapshot, eligible_at, state, effective_state, manual_block_until, manual_reason, manual_override_by, manual_override_at, created_at, updated_at, days_remaining",
    )
    .order("created_at", { ascending: false });

  if (params?.state) {
    query = query.eq("effective_state", params.state);
  }

  const search = (params?.search ?? "").replace(/%/g, "").trim();
  const searchMode = params?.searchMode ?? "codigo";
  if (search) {
    if (searchMode === "codigo") {
      query = query.eq("codigo", search);
    } else {
      query = query.ilike("empresa", search);
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FilaControlRow[];
};

export const registerFilaEmpresa = async (payload: {
  empresa_id: string;
  data_contrato: string;
  waiting_days?: number | null;
}) => {
  const evaluation = evaluateDataContratoForFila(payload.data_contrato);
  if (!evaluation.eligible) {
    throw new Error(
      `Empresa nao adicionada a fila. Motivo: ${evaluation.reason}.`,
    );
  }

  const { data, error } = await supabase.rpc("queue_release_register_company", {
    p_empresa_id: payload.empresa_id,
    p_data_contrato: evaluation.dataContratoIso,
    p_waiting_days: payload.waiting_days ?? null,
  });
  if (error) throw error;
  if (Array.isArray(data)) return (data[0] ?? null) as FilaControlRow | null;
  return (data ?? null) as FilaControlRow | null;
};

export const removeFilaEmpresa = async (payload: {
  empresa_id: string;
  reason?: string | null;
}) => {
  const { data, error } = await supabase.rpc("queue_release_remove_company", {
    p_empresa_id: payload.empresa_id,
    p_reason: payload.reason ?? null,
  });
  if (error) throw error;
  return Boolean(data);
};

export const reconcileFilaEmpresaByCodigo = async (codigo: string) => {
  const normalized = codigo.trim();
  if (!normalized) {
    return { found: false, changed: false } as const;
  }

  const { data: clienteData, error: clienteError } = await supabase
    .from("clientes")
    .select("id, codigo")
    .eq("codigo", normalized)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (clienteError) throw clienteError;
  if (!clienteData?.id) {
    return { found: false, changed: false } as const;
  }

  const { data: controlData, error: controlError } = await supabase
    .from("queue_release_controls_view")
    .select("empresa_id, data_contrato")
    .eq("empresa_id", clienteData.id)
    .maybeSingle();
  if (controlError) throw controlError;

  let empresa: Awaited<ReturnType<typeof fetchEmpresaByEmpresaId>>;
  try {
    empresa = await fetchEmpresaByEmpresaId(normalized);
  } catch {
    // Sem dado confiavel de DataContrato da API, nao altera estado atual.
    return { found: true, changed: false, reason: "API_DATA_CONTRATO_NAO_RETORNADA" } as const;
  }

  const dataContratoRaw = empresa?.DataContrato ?? empresa?.dataContrato ?? null;
  const evaluation = evaluateDataContratoForFila(dataContratoRaw);
  const hasQueueEntry = Boolean(controlData?.empresa_id);
  const currentQueueDataContrato = controlData?.data_contrato ?? null;

  if (!evaluation.eligible) {
    if (hasQueueEntry) {
      await removeFilaEmpresa({
        empresa_id: clienteData.id,
        reason: evaluation.reason,
      });
      return { found: true, changed: true, reason: evaluation.reason } as const;
    }
    return { found: true, changed: false, reason: evaluation.reason } as const;
  }

  if (!hasQueueEntry) {
    return { found: true, changed: false, reason: evaluation.reason } as const;
  }

  if (currentQueueDataContrato !== evaluation.dataContratoIso) {
    await removeFilaEmpresa({
      empresa_id: clienteData.id,
      reason: "DATA_CONTRATO_ELEGIVEL",
    });
    await registerFilaEmpresa({
      empresa_id: clienteData.id,
      data_contrato: evaluation.dataContratoIso,
    });
    return { found: true, changed: true, reason: "DATA_CONTRATO_ELEGIVEL" } as const;
  }

  return { found: true, changed: false, reason: "DATA_CONTRATO_ELEGIVEL" } as const;
};

export const applyFilaAction = async (payload: {
  empresa_id: string;
  action: "RELEASE_NOW" | "SET_WAITING_DAYS" | "BLOCK_DAYS" | "UNBLOCK";
  waiting_days?: number | null;
  block_days?: number | null;
  reason?: string | null;
}) => {
  const { data, error } = await supabase.rpc("queue_release_apply_action", {
    p_empresa_id: payload.empresa_id,
    p_action: payload.action,
    p_waiting_days: payload.waiting_days ?? null,
    p_block_days: payload.block_days ?? null,
    p_reason: payload.reason ?? null,
  });
  if (error) throw error;
  if (Array.isArray(data)) return (data[0] ?? null) as FilaControlRow | null;
  return (data ?? null) as FilaControlRow | null;
};

export const generateFilaCountdownEvents = async () => {
  const { data, error } = await supabase.rpc("queue_release_generate_countdown_events");
  if (error) throw error;
  return Number(data ?? 0);
};

export const fetchFilaPendingNotifications = async (limit = 10) => {
  const { data, error } = await supabase.rpc("queue_release_pending_notifications", {
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as FilaPendingNotificationRow[];
};

export const acknowledgeFilaNotification = async (eventId: string) => {
  const { error } = await supabase.rpc("queue_release_acknowledge_event", {
    p_event_id: eventId,
  });
  if (error) throw error;
};

export const fetchFilaControlsByEmpresaIds = async (empresaIds: string[]) => {
  const uniqueIds = Array.from(new Set(empresaIds.filter(Boolean)));
  if (!uniqueIds.length) return [] as Array<Pick<FilaControlRow, "empresa_id" | "codigo" | "effective_state" | "eligible_at" | "manual_block_until">>;

  const chunkSize = 500;
  const allRows: Array<Pick<FilaControlRow, "empresa_id" | "codigo" | "effective_state" | "eligible_at" | "manual_block_until">> = [];

  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    const chunk = uniqueIds.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from("queue_release_controls_view")
      .select("empresa_id, codigo, effective_state, eligible_at, manual_block_until")
      .in("empresa_id", chunk);
    if (error) throw error;
    allRows.push(
      ...((data ?? []) as Array<
        Pick<FilaControlRow, "empresa_id" | "codigo" | "effective_state" | "eligible_at" | "manual_block_until">
      >),
    );
  }

  return allRows;
};

const isFilaControlEligibleForRoutes = (row: {
  effective_state: FilaState;
  eligible_at: string;
}) => {
  if (row.effective_state === "RELEASED_MANUAL" || row.effective_state === "READY_AUTO") {
    return true;
  }
  const eligibleAtMs = Date.parse(row.eligible_at);
  if (Number.isFinite(eligibleAtMs)) return eligibleAtMs <= Date.now();
  return row.effective_state !== "PENDING_WAIT";
};

export const fetchFilaRoutingBlockLists = async (options?: { force?: boolean }) => {
  const force = Boolean(options?.force);
  if (!force && filaRoutingBlocksCache) {
    const age = Date.now() - filaRoutingBlocksCache.cachedAt;
    if (age <= FILA_ROUTING_BLOCKS_CACHE_MS) {
      return filaRoutingBlocksCache;
    }
  }
  if (!force && filaRoutingBlocksPromise) {
    return filaRoutingBlocksPromise;
  }

  filaRoutingBlocksPromise = (async () => {
    const { data, error } = await supabase
      .from("queue_release_controls_view")
      .select("empresa_id, codigo, effective_state, eligible_at");
    if (error) throw error;

    const blockedEmpresaIds = new Set<string>();

    ((data ?? []) as Array<{
      empresa_id: string;
      codigo: string | null;
      effective_state: FilaState;
      eligible_at: string;
    }>).forEach((row) => {
      const eligible = isFilaControlEligibleForRoutes(row);
      if (!eligible) {
        blockedEmpresaIds.add(row.empresa_id);
      }
    });

    const snapshot: FilaRoutingBlockLists = {
      blockedEmpresaIds: Array.from(blockedEmpresaIds),
      blockedCodigos: [],
      cachedAt: Date.now(),
    };
    filaRoutingBlocksCache = snapshot;
    return snapshot;
  })().finally(() => {
    filaRoutingBlocksPromise = null;
  });

  return filaRoutingBlocksPromise;
};

export const syncFilaAutoRegistration = async (options?: {
  minIntervalMs?: number;
  maxCandidates?: number;
  maxRegistrations?: number;
  reconcileExisting?: boolean;
}) => {
  const minIntervalMs = options?.minIntervalMs ?? FILA_AUTO_SYNC_DEFAULT_INTERVAL_MS;
  const maxCandidates = Math.max(1, Math.min(options?.maxCandidates ?? 120, 500));
  const maxRegistrations = Math.max(1, Math.min(options?.maxRegistrations ?? 30, 200));
  const reconcileExisting = Boolean(options?.reconcileExisting);
  const nowMs = Date.now();
  const lastStorageRunAt = readAutoSyncStorageTimestamp();
  const lastRunAt = Math.max(filaAutoSyncLastRunAt, lastStorageRunAt);

  if (nowMs - lastRunAt < minIntervalMs) return 0;
  if (filaAutoSyncPromise) return filaAutoSyncPromise;

  filaAutoSyncPromise = (async () => {
    try {
      let settings = await fetchFilaSettings();
      if (!settings) return 0;
      settings = await ensureCurrentMonthFeatureStart(settings);

      const startAt = settings.feature_start_at;
      const { data: candidatesData, error: candidatesError } = await supabase
        .from("clientes")
        .select("id, codigo, empresa, cnpj, created_at")
        .gte("created_at", startAt)
        .order("created_at", { ascending: true })
        .limit(maxCandidates);

      if (candidatesError) throw candidatesError;
      const candidates = (candidatesData ?? []) as FilaClienteCandidate[];
      if (!candidates.length) return 0;

      const controls = await fetchFilaControlsByEmpresaIds(candidates.map((row) => row.id));
      const controlledIds = new Set(controls.map((row) => row.empresa_id));
      const missing = candidates.filter((row) => !controlledIds.has(row.id));
      const targetCandidates = reconcileExisting ? candidates : missing;
      if (!targetCandidates.length) return 0;

      let registered = 0;
      let removed = 0;

      for (const candidate of targetCandidates) {
        const codigo = (candidate.codigo ?? "").trim();
        const baseLog = `[fila:auto-register] empresa_id=${candidate.id} codigo=${codigo || "-"}`;
        const alreadyInQueue = controlledIds.has(candidate.id);
        if (registered >= maxRegistrations) break;
        if (!codigo) {
          console.warn(`${baseLog} bloqueada. Motivo: API_DATA_CONTRATO_NAO_RETORNADA`);
          if (reconcileExisting && alreadyInQueue) {
            try {
              await removeFilaEmpresa({
                empresa_id: candidate.id,
                reason: "API_DATA_CONTRATO_NAO_RETORNADA",
              });
              removed += 1;
              console.info(`${baseLog} removida da fila. Motivo: API_DATA_CONTRATO_NAO_RETORNADA`);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error ?? "");
              console.warn(`${baseLog} falha ao remover da fila. Erro: ${message}`);
            }
          }
          continue;
        }

        let empresa: Awaited<ReturnType<typeof fetchEmpresaByEmpresaId>>;
        try {
          empresa = await fetchEmpresaByEmpresaId(codigo);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error ?? "");
          console.warn(
            `${baseLog} bloqueada. Motivo: API_DATA_CONTRATO_NAO_RETORNADA. Erro: ${message}`,
          );
          if (reconcileExisting && alreadyInQueue) {
            try {
              await removeFilaEmpresa({
                empresa_id: candidate.id,
                reason: "API_DATA_CONTRATO_NAO_RETORNADA",
              });
              removed += 1;
              console.info(`${baseLog} removida da fila. Motivo: API_DATA_CONTRATO_NAO_RETORNADA`);
            } catch (removeError) {
              const removeMessage =
                removeError instanceof Error ? removeError.message : String(removeError ?? "");
              console.warn(`${baseLog} falha ao remover da fila. Erro: ${removeMessage}`);
            }
          }
          continue;
        }

        const dataContratoRaw = empresa?.DataContrato ?? empresa?.dataContrato ?? null;
        const evaluation = evaluateDataContratoForFila(dataContratoRaw);
        if (!evaluation.eligible) {
          const detail =
            evaluation.detailReason === "DATA_CONTRATO_FORA_DO_CORTE"
              ? `dataContratoIso=${evaluation.dataContratoIso}`
              : `dataContratoRaw=${String(dataContratoRaw ?? "")}`;
          console.info(
            `${baseLog} bloqueada. Motivo: ${evaluation.reason}. Detalhe: ${evaluation.detailReason}. ${detail}`,
          );
          if (reconcileExisting && alreadyInQueue) {
            try {
              await removeFilaEmpresa({
                empresa_id: candidate.id,
                reason: evaluation.reason,
              });
              removed += 1;
              console.info(`${baseLog} removida da fila. Motivo: ${evaluation.reason}`);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error ?? "");
              console.warn(`${baseLog} falha ao remover da fila. Erro: ${message}`);
            }
          }
          continue;
        }

        console.info(
          `${baseLog} elegivel. Motivo: ${evaluation.reason}. dataContratoIso=${evaluation.dataContratoIso}`,
        );

        if (alreadyInQueue) {
          continue;
        }

        try {
          await registerFilaEmpresa({
            empresa_id: candidate.id,
            data_contrato: evaluation.dataContratoIso,
          });
          registered += 1;
        } catch (error) {
          const maybeError = error as { message?: string };
          const message = (maybeError.message ?? "").toLowerCase();
          const knownNonFatal =
            message.includes("ja registrada") ||
            message.includes("fora do escopo") ||
            message.includes("duplicate") ||
            message.includes("already exists");
          if (!knownNonFatal) {
            throw error;
          }
        }
      }

      if (removed > 0) {
        console.info(`[fila:auto-register] remocoes por DataContrato: ${removed}`);
      }
      return registered;
    } finally {
      const finishedAt = Date.now();
      filaAutoSyncLastRunAt = finishedAt;
      writeAutoSyncStorageTimestamp(finishedAt);
    }
  })().finally(() => {
    filaAutoSyncPromise = null;
  });

  return filaAutoSyncPromise;
};
