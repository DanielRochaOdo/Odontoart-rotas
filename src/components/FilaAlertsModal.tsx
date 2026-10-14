import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../pages/fila-glass-v2.css";
import { BellRing } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  acknowledgeFilaNotification,
  fetchFilaPendingNotifications,
  generateFilaCountdownEvents,
  isMissingFilaBackendError,
  type FilaPendingNotificationRow,
} from "../lib/filaApi";
import { formatDateTimeBr } from "../lib/dateFormat";
import { startActivePolling } from "../lib/activePolling";
import { createFilaNotificationPoller } from "../lib/filaNotificationPolling";

const buildAlertText = (row: FilaPendingNotificationRow) => {
  const payload = row.payload ?? {};
  const daysLeft =
    typeof payload.days_left === "number"
      ? payload.days_left
      : Number(payload.days_left ?? NaN);
  const eligibleAtRaw =
    typeof payload.eligible_at === "string"
      ? payload.eligible_at
      : typeof payload.new_eligible_at === "string"
        ? payload.new_eligible_at
        : null;
  const eligibleAt = formatDateTimeBr(eligibleAtRaw);
  const actorName =
    typeof payload.actor_name === "string" && payload.actor_name.trim()
      ? payload.actor_name.trim()
      : "Usuario nao identificado";

  if (row.event_type === "NEW_COMPANY_WAITING") {
    return `Nova empresa adicionada a fila. Fim do prazo previsto para ${eligibleAt}.`;
  }
  if (
    row.event_type === "COUNTDOWN_30" ||
    row.event_type === "COUNTDOWN_15" ||
    row.event_type === "COUNTDOWN_7" ||
    row.event_type === "COUNTDOWN_1"
  ) {
    const safeDays = Number.isFinite(daysLeft) ? daysLeft : row.event_type.replace("COUNTDOWN_", "");
    return `Faltam ${safeDays} dia(s) para a empresa ficar com liberacao pendente no modulo de rotas.`;
  }
  if (row.event_type === "RELEASED_MANUAL") {
    return `Empresa liberada manualmente por ${actorName}.`;
  }
  if (row.event_type === "BLOCKED_MANUAL") {
    return `Prazo da empresa bloqueado manualmente por ${actorName}.`;
  }
  if (row.event_type === "RULE_CHANGED") {
    const oldDays =
      typeof payload.old_waiting_days === "number"
        ? payload.old_waiting_days
        : payload.old_waiting_days;
    const newDays =
      typeof payload.new_waiting_days === "number"
        ? payload.new_waiting_days
        : payload.new_waiting_days;
    if (oldDays !== undefined && newDays !== undefined) {
      return `Prazo alterado por ${actorName}: ${oldDays} -> ${newDays} dia(s).`;
    }
    return `Regra de liberacao alterada por ${actorName}.`;
  }
  return "Aviso do modulo fila.";
};

const buildDismissedStorageKey = (userId: string) => `filaAlertsDismissed:${userId}`;

const readDismissedIds = (userId: string | null) => {
  if (!userId || typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(buildDismissedStorageKey(userId));
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0));
  } catch {
    return new Set<string>();
  }
};

const persistDismissedIds = (userId: string | null, ids: Set<string>) => {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(buildDismissedStorageKey(userId), JSON.stringify(Array.from(ids)));
  } catch {
    // ignore
  }
};

const getDisplayCodigo = (row: FilaPendingNotificationRow) => {
  if (row.codigo && row.codigo.trim()) return row.codigo.trim();
  const payloadCode = row.payload?.codigo;
  return typeof payloadCode === "string" && payloadCode.trim() ? payloadCode.trim() : "-";
};

const getDisplayEmpresa = (row: FilaPendingNotificationRow) => {
  if (row.empresa && row.empresa.trim()) return row.empresa.trim();
  const payloadEmpresa = row.payload?.empresa;
  return typeof payloadEmpresa === "string" && payloadEmpresa.trim() ? payloadEmpresa.trim() : "Empresa sem nome";
};

export default function FilaAlertsModal() {
  const { role, session } = useAuth();
  if (!session || (role !== "SUPERVISOR" && role !== "ASSISTENTE")) return null;
  return <FilaAlertsForUser key={`${session.user.id}:${role}`} />;
}

function FilaAlertsForUser() {
  const { role, session } = useAuth();
  const canView = role === "SUPERVISOR" || role === "ASSISTENTE";
  const currentUserId = session?.user.id ?? null;
  const [rows, setRows] = useState<FilaPendingNotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => readDismissedIds(currentUserId));
  const dismissedIdsRef = useRef<Set<string>>(dismissedIds);

  const setDismissedIdsSync = useCallback(
    (next: Set<string>) => {
      dismissedIdsRef.current = next;
      setDismissedIds(next);
      persistDismissedIds(currentUserId, next);
    },
    [currentUserId],
  );

  useEffect(() => {
    const next = readDismissedIds(currentUserId);
    dismissedIdsRef.current = next;
    setDismissedIds(next);
  }, [currentUserId]);

  useEffect(() => {
    if (!canView || unavailable || !currentUserId) return;
    let active = true;
    const poller = createFilaNotificationPoller({
      scope: `${currentUserId}:${role}`,
      fetchRows: () => fetchFilaPendingNotifications(50),
      generate: generateFilaCountdownEvents,
      receive: (data) => setRows(data.filter((item) => !dismissedIdsRef.current.has(item.event_id))),
      isActive: () => active,
    });
    const stop = startActivePolling(async () => {
      setLoading(true);
      try { await poller.poll(); } finally { if (active) setLoading(false); }
    }, 30_000, (error) => {
      if (isMissingFilaBackendError(error as { code?: string; message?: string })) {
        setUnavailable(true);
        setRows([]);
      }
    });
    const onDismissed = (event: StorageEvent) => {
      if (event.key !== buildDismissedStorageKey(currentUserId)) return;
      const next = readDismissedIds(currentUserId);
      dismissedIdsRef.current = next;
      setDismissedIds(next);
      setRows((previous) => previous.filter((item) => !next.has(item.event_id)));
    };
    window.addEventListener("storage", onDismissed);
    return () => {
      active = false;
      stop();
      poller.close();
      window.removeEventListener("storage", onDismissed);
    };
  }, [canView, currentUserId, role, unavailable]);

  const notifications = useMemo(
    () =>
      rows.map((row) => ({
        eventId: row.event_id,
        message: buildAlertText(row),
        codigo: getDisplayCodigo(row),
        empresa: getDisplayEmpresa(row),
        createdAt: formatDateTimeBr(row.created_at),
      })),
    [rows],
  );

  if (!canView || notifications.length === 0) return null;

  return (
    <div className="rotas-fila-v2-alerts fixed inset-0 z-[120] flex items-start justify-center bg-ink/55 px-4 pt-6" role="dialog" aria-modal="true" aria-labelledby="fila-alerts-dialog-title">
      <div className="rotas-fila-v2-dialog w-full max-w-4xl rounded-2xl border border-sea/25 bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-sea/15 p-2 text-sea">
            <BellRing size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="fila-alerts-dialog-title" className="text-base font-semibold text-ink">Modulo Fila - avisos</h3>
            <p className="mt-1 text-sm text-ink/80">
              {notifications.length} aviso(s) pendente(s). Confirme para remover da sua tela.
            </p>
            <div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {notifications.map((item) => (
                <article key={item.eventId} className="rotas-fila-v2-alert-item rounded-xl border border-sea/20 bg-white/90 p-3">
                  <p className="text-sm text-ink/80">{item.message}</p>
                  <div className="mt-1 text-xs text-ink/60">
                    <p>
                      Empresa: <span className="font-semibold text-ink/70">{item.codigo} - {item.empresa}</span>
                    </p>
                    <p>Criado em: {item.createdAt}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={async () => {
              if (notifications.length === 0 || acknowledging) return;
              setAcknowledging(true);
              const eventIds = notifications.map((item) => item.eventId);
              const nextDismissedIds = new Set(dismissedIdsRef.current);
              for (const eventId of eventIds) {
                nextDismissedIds.add(eventId);
              }
              setDismissedIdsSync(nextDismissedIds);
              setRows([]);

              try {
                await Promise.allSettled(eventIds.map((eventId) => acknowledgeFilaNotification(eventId)));
              } finally {
                setAcknowledging(false);
              }
            }}
            className="rounded-xl border border-sea/30 bg-sea px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={acknowledging || loading}
          >
            {acknowledging ? "Confirmando..." : `OK (${notifications.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
