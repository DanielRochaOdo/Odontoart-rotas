import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, ExternalLink, MailOpen, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { fetchSystemUpdateNotifications, markSystemUpdateAsRead } from "../../services/systemUpdateNotifications";
import type { SystemUpdateNotification } from "../../types/systemUpdateNotifications";

const DESCRIPTION_MAX = 110;

const compactText = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DESCRIPTION_MAX);

export default function NotificationsBell() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SystemUpdateNotification[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    if (!session?.user.id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemUpdateNotifications();
      setItems(result.notifications);
      setTotalUnread(result.totalUnread);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar notificacoes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session?.user.id]);

  useEffect(() => {
    if (!open) return;
    const onFocus = () => void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => void load(), 60000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [open, session?.user.id]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const badgeLabel = useMemo(() => {
    if (totalUnread <= 0) return null;
    return totalUnread > 5 ? "5+" : String(totalUnread);
  }, [totalUnread]);

  const handleMarkRead = async (notification: SystemUpdateNotification, shouldNavigate: boolean) => {
    setBusyId(notification.id);
    try {
      await markSystemUpdateAsRead(notification.id);
      setItems((current) => current.filter((item) => item.id !== notification.id));
      setTotalUnread((current) => Math.max(0, current - 1));
      if (shouldNavigate) {
        setOpen(false);
        navigate(`/novidades?id=${notification.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao marcar como lida.");
    } finally {
      setBusyId(null);
    }
  };

  if (!session?.user.id) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-sea/20 bg-white/80 text-sea transition hover:border-sea hover:text-sea dark:border-mist/60 dark:bg-white/5 dark:text-seaLight"
        aria-label={`Notificações: ${totalUnread} não lidas`}
        aria-expanded={open}
      >
        <Bell size={18} />
        {badgeLabel ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-5 text-white">
            {badgeLabel}
          </span>
        ) : null}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed right-2 top-16 z-[80] w-[min(380px,calc(100vw-16px))] overflow-hidden rounded-2xl border border-sea/20 bg-white shadow-card dark:border-slate-700 dark:bg-slate-950"
              style={{ maxHeight: "min(520px, calc(100vh - 80px))" }}
            >
              <div className="flex items-center justify-between border-b border-sea/10 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink dark:text-slate-100">Notificações</p>
                  <p className="text-[11px] text-ink/60 dark:text-slate-400">{totalUnread} não lidas</p>
                </div>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="inline-flex items-center gap-1 rounded-lg border border-sea/20 px-2 py-1 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea dark:border-slate-700 dark:text-slate-300"
                >
                  <RefreshCw size={12} />
                  Atualizar
                </button>
              </div>

              <div className="max-h-[calc(min(520px,calc(100vh-80px))-132px)] overflow-y-auto overflow-x-hidden px-2 py-2">
                {loading ? (
                  <div className="space-y-2 p-2">
                    <div className="h-16 animate-pulse rounded-xl bg-sand/40 dark:bg-slate-800" />
                    <div className="h-16 animate-pulse rounded-xl bg-sand/40 dark:bg-slate-800" />
                  </div>
                ) : error ? (
                  <div className="p-3 text-xs text-red-600">
                    {error}
                    <button
                      type="button"
                      onClick={() => void load()}
                      className="mt-2 block rounded-lg border border-sea/20 px-2 py-1 text-[11px] font-semibold text-ink"
                    >
                      Tentar novamente
                    </button>
                  </div>
                ) : items.length === 0 ? (
                  <p className="px-3 py-6 text-sm text-ink/60">Você não possui novas notificações.</p>
                ) : (
                  <div className="space-y-2">
                    {items.slice(0, 5).map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-sea/15 bg-sand/20 p-3 dark:border-slate-700 dark:bg-slate-900/70"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => void handleMarkRead(item, true)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-ink/50">
                              <span className="rounded-full bg-sea/10 px-2 py-0.5 text-sea">{item.type}</span>
                              <span className="rounded-full bg-white px-2 py-0.5 text-ink/60 dark:bg-slate-950">
                                {item.module}
                              </span>
                            </div>
                            <p className="mt-2 truncate font-semibold text-ink dark:text-slate-100">{item.title}</p>
                            <p className="mt-1 text-[11px] text-ink/60 dark:text-slate-400">
                              {new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(item.publishedAt))}
                            </p>
                            <p className="mt-2 break-words text-xs text-ink/70 dark:text-slate-300">
                              {compactText(item.descriptionPreview)}
                            </p>
                          </button>
                          <span className="mt-1 h-2.5 w-2.5 rounded-full bg-teal-500" aria-hidden="true" />
                        </div>

                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            onClick={() => void handleMarkRead(item, true)}
                            disabled={busyId === item.id}
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            <ExternalLink size={13} />
                            Ler novidade
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleMarkRead(item, false)}
                            disabled={busyId === item.id}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs font-semibold text-ink/80 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          >
                            <MailOpen size={13} />
                            Marcar como lida
                          </button>
                        </div>
                      </div>
                    ))}
                    {totalUnread > 5 ? (
                      <div className="px-3 py-2 text-center text-xs text-ink/60">
                        Há mais novidades. Acesse a página completa.
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="border-t border-sea/10 px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate("/novidades");
                  }}
                  className="w-full rounded-lg border border-sea/20 px-3 py-2 text-xs font-semibold text-ink/80 hover:border-sea hover:text-sea"
                >
                  Ver todas as novidades
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
