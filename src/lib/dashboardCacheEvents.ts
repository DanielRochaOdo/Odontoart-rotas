import { dashboardQueryCache } from "./queryCache";

export const DASHBOARD_DATA_CHANGED = "dashboard-data-changed";
const STORAGE_KEY = "dashboard-data-changed-v1";
const resources = new Set(["visits", "clientes", "profiles", "aceite_digital"]);

export function invalidateDashboardResource(resource: string) {
  if (!resources.has(resource)) return;
  dashboardQueryCache.invalidate((key) => key.includes(`|${resource}|`));
}

/** Observe successful writes only; reads (including POST RPCs) are never cached here. */
export const dashboardAwareFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const match = url.pathname.match(/^\/rest\/v1\/(?:dash_)?(visits|clientes|profiles|aceite_digital)$/);
  if (response.ok && match && ["POST", "PATCH", "DELETE", "PUT"].includes(method)) {
    const resource = match[1];
    invalidateDashboardResource(resource);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(DASHBOARD_DATA_CHANGED));
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ resource, at: Date.now(), nonce: Math.random() })); } catch { /* optional cross-tab signal */ }
    }
  }
  return response;
};

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const { resource } = JSON.parse(event.newValue);
      if (!resources.has(resource)) return;
      invalidateDashboardResource(resource);
      window.dispatchEvent(new Event(DASHBOARD_DATA_CHANGED));
    } catch { /* ignore malformed browser storage */ }
  });
}
