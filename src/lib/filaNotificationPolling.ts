import { canPoll } from "./activePolling";

type SharedResult<T> = { at: number; rows: T[] };

/** Web Locks serialize tabs; only a timestamp (never notification data) is persisted. */
export function createFilaNotificationPoller<T>(options: {
  scope: string;
  fetchRows: () => Promise<T[]>;
  generate: () => Promise<unknown>;
  receive: (rows: T[]) => void;
  isActive: () => boolean;
}) {
  const key = `fila-notifications-v2:${options.scope}`;
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(key) : null;
  let result: SharedResult<T> | null = null;
  let nextFetchAt = 0;
  let nextGenerateAt = 0;
  const readTime = (suffix: string) => {
    try { return Number(localStorage.getItem(`${key}:${suffix}`)) || 0; } catch { return 0; }
  };
  const writeTime = (suffix: string, time: number) => {
    try { localStorage.setItem(`${key}:${suffix}`, String(time)); } catch { /* in-memory fallback */ }
  };
  if (channel) channel.onmessage = ({ data }) => {
    if (!options.isActive()) return;
    if (data?.type === "request") {
      if (result && Date.now() - result.at < 180_000) channel.postMessage({ type: "result", ...result });
    } else if (data?.type === "result" && Array.isArray(data.rows) && Number.isFinite(data.at)) {
      result = { at: data.at, rows: data.rows };
      nextFetchAt = Math.max(nextFetchAt, data.at + 180_000);
      options.receive(data.rows);
    }
  };

  const poll = async () => {
    if (!options.isActive() || !canPoll(document.visibilityState === "visible", navigator.onLine, Date.now(), nextFetchAt)) return;
    const run = async () => {
      const now = Date.now();
      if (!options.isActive() || !canPoll(document.visibilityState === "visible", navigator.onLine, now, nextFetchAt)) return;
      // A tab without a result must fetch if no peer answers; a timestamp alone
      // must never prevent it from showing notifications after another tab closes.
      if (channel && now < readTime("nextFetch")) {
        channel.postMessage({ type: "request" });
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (!options.isActive() || Date.now() < nextFetchAt) return;
      }
      nextFetchAt = Date.now() + 180_000;
      writeTime("nextFetch", nextFetchAt);
      if (now >= Math.max(nextGenerateAt, readTime("nextGenerate"))) {
        nextGenerateAt = now + 600_000;
        writeTime("nextGenerate", nextGenerateAt);
        try { await options.generate(); } catch { /* Retry only after cooldown, including failures. */ }
      }
      if (!options.isActive()) return;
      const rows = await options.fetchRows();
      if (!options.isActive()) return;
      result = { at: Date.now(), rows };
      options.receive(rows);
      channel?.postMessage({ type: "result", ...result });
    };
    if (navigator.locks) await navigator.locks.request(key, run);
    else await run(); // Older browsers retain visibility, in-tab deduplication and cooldown.
  };
  return { poll, close: () => channel?.close() };
}
