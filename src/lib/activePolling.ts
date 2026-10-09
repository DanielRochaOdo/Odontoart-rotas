export const canPoll = (visible: boolean, online: boolean, now: number, nextAt: number) =>
  visible && online && now >= nextAt;

/** Focus/online events may wake a poll, but cannot bypass its cooldown. */
export function startActivePolling(
  task: () => Promise<void>,
  intervalMs: number,
  onError: (error: unknown) => void,
  pollContinuously = true,
) {
  let stopped = false;
  let running = false;
  let nextAt = 0;
  let deferredWake: number | null = null;
  const tick = async () => {
    if (stopped || running || document.visibilityState !== "visible" || !navigator.onLine) return;
    if (deferredWake !== null) window.clearTimeout(deferredWake);
    deferredWake = null;
    if (Date.now() < nextAt) {
      // A focus during cooldown must eventually refresh even without a repeating
      // timer (Dashboard). Repeated focus events keep the same earliest deadline.
      deferredWake = window.setTimeout(() => { void tick(); }, nextAt - Date.now());
      return;
    }
    running = true;
    nextAt = Date.now() + intervalMs;
    try { await task(); } catch (error) { if (!stopped) onError(error); }
    finally { running = false; }
  };
  const wake = () => { void tick(); };
  const timer = pollContinuously ? window.setInterval(wake, Math.min(intervalMs, 30_000)) : null;
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
  wake();
  return () => {
    stopped = true;
    if (deferredWake !== null) window.clearTimeout(deferredWake);
    if (timer !== null) window.clearInterval(timer);
    window.removeEventListener("focus", wake);
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", wake);
  };
}
