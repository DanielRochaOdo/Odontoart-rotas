import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { QueryCache, dashboardQueryCache } from "../src/lib/queryCache";
import { createDashboardLoader } from "../src/lib/dashboardData";
import { dashboardAwareFetch } from "../src/lib/dashboardCacheEvents";
import { canPoll, startActivePolling } from "../src/lib/activePolling";
import { createFilaNotificationPoller } from "../src/lib/filaNotificationPolling";

let now = 1000;
const cache = new QueryCache(3, () => now);
let calls = 0;
const fetcher = async () => ++calls;
assert.deepEqual(await Promise.all([cache.get("u1", 100, fetcher), cache.get("u1", 100, fetcher)]), [1, 1]);
assert.equal(calls, 1, "Concurrent mounts share the same request");
now += 101;
assert.equal(await cache.get("u1", 100, fetcher), 2);
assert.equal(await cache.get("u2", 100, fetcher), 3);
let release!: (value: number) => void;
const oldRequest = cache.get("old", 100, () => new Promise<number>((resolve) => { release = resolve; }));
await Promise.resolve();
cache.invalidate();
release(9);
assert.equal(await oldRequest, 9);
assert.equal(await cache.get("old", 100, fetcher), 4, "A response after logout must not repopulate cache");
await assert.rejects(cache.get("bad", 100, async () => { throw new Error("offline"); }), /offline/);
assert.equal(await cache.get("bad", 100, fetcher), 5, "Failures must be retriable");
await cache.get("new", 100, fetcher);
await cache.get("another", 100, fetcher);
assert.equal(await cache.get("old", 100, fetcher), 8, "Bounded cache evicts old entries");

const requests: URL[] = [];
let historicalMissing = false;
let historicalDenied = false;
const fakeFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  requests.push(url);
  const relation = url.pathname.split("/").pop();
  if (relation === "v_dash_visits_monthly_lives" && (historicalMissing || historicalDenied)) {
    return new Response(JSON.stringify({ code: historicalDenied ? "42501" : "PGRST205", message: "test" }), { status: historicalDenied ? 403 : 404 });
  }
  let rows: Record<string, unknown>[];
  if (relation === "v_dash_clientes_active") {
    rows = Array.from({ length: 1001 }, (_, id) => ({ id: String(id), vendedor: id === 0 ? "ANA" : "BOB", empresa: "Duplicate name" }));
  } else if (relation === "v_dash_aceite_digital_active") {
    rows = Array.from({ length: 1001 }, (_, id) => ({ id, entry_date: "2026-10-01", vendor_user_id: "u1", vidas: 1 }));
  } else if (relation === "v_dash_visits_active") {
    rows = [{ id: "v1", assigned_to_user_id: "u1", visit_date: "2026-10-01", completed_vidas: 3 }, { id: "v2", assigned_to_user_id: "u2", visit_date: "2026-10-01", completed_vidas: 4 }];
  } else {
    rows = [];
  }
  for (const column of ["assigned_to_user_id", "vendor_user_id", "vendedor"]) {
    const filter = url.searchParams.get(column);
    if (filter?.startsWith("eq.")) rows = rows.filter((row) => row[column] === filter.slice(3));
  }
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 1000);
  return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200, headers: { "Content-Type": "application/json" } });
};
const client = createClient("https://example.invalid", "test-key", { global: { fetch: fakeFetch }, auth: { persistSession: false, autoRefreshToken: false } });
const loaderCache = new QueryCache();
const loader = createDashboardLoader(client, loaderCache);
const scope = { userId: "u1", role: "SUPERVISOR" };
const [clients1, clients2] = await Promise.all([loader.clientes(scope), loader.clientes(scope)]);
assert.equal(clients1.length, 1001);
assert.equal(clients1, clients2);
assert.equal(requests.length, 2, "One paginated request shared by simultaneous callers");
assert.equal(requests[0].searchParams.get("order"), "empresa.asc,id.asc", "Stable pagination for duplicate company names");
await loader.visits(scope, "2026-10-01", "2026-11-01");
await loader.clientes(scope);
assert.equal(requests.length, 3, "Date changes do not reload the company universe");
assert.equal((await loader.aceites(scope, "2026-10-01", "2026-11-01")).length, 1001, "Digital acceptances must not be truncated at 1,000");
assert.equal((await loader.visits({ ...scope, role: "VENDEDOR" }, "2026-10-01", "2026-11-01")).length, 1);
assert.equal((await loader.coverageClients({ ...scope, role: "VENDEDOR" }, "ANA")).length, 1);
await assert.rejects(loader.coverageClients({ ...scope, role: "VENDEDOR" }, null), /sem nome/);
historicalMissing = true;
assert.equal((await loader.historicalLives(scope)).length, 2, "Missing optional view uses the active source");
assert.equal(requests.at(-1)?.searchParams.get("completed_vidas"), "gt.0");
loaderCache.invalidate();
historicalDenied = true;
await assert.rejects(loader.historicalLives(scope), (error: { code: string }) => error.code === "42501");

const nativeFetch = globalThis.fetch;
try {
  let status = 204;
  globalThis.fetch = async () => new Response(null, { status });
  await dashboardQueryCache.get("u1:SUPERVISOR|visits|range", 60_000, async () => 1);
  await dashboardQueryCache.get("u1:SUPERVISOR|profiles|", 60_000, async () => 2);
  await dashboardAwareFetch("https://example.invalid/rest/v1/visits", { method: "GET" });
  status = 403;
  await dashboardAwareFetch("https://example.invalid/rest/v1/visits", { method: "PATCH" });
  assert.equal(await dashboardQueryCache.get("u1:SUPERVISOR|visits|range", 60_000, async () => 3), 1);
  status = 204;
  await dashboardAwareFetch("https://example.invalid/rest/v1/visits", { method: "PATCH" });
  assert.equal(await dashboardQueryCache.get("u1:SUPERVISOR|visits|range", 60_000, async () => 3), 3);
  assert.equal(await dashboardQueryCache.get("u1:SUPERVISOR|profiles|", 60_000, async () => 4), 2, "Selective invalidation preserves unrelated resources");
} finally { globalThis.fetch = nativeFetch; }

assert.equal(canPoll(false, true, 100, 0), false);
assert.equal(canPoll(true, false, 100, 0), false);
assert.equal(canPoll(true, true, 100, 101), false);
assert.equal(canPoll(true, true, 101, 101), true);

const originalNow = Date.now;
const originals = new Map(["navigator", "document", "window", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const stops: Array<() => void> = [];
try {
  now = 1_000_000;
  Date.now = () => now;
  const storage = new Map<string, string>();
  let lockTail: Promise<unknown> = Promise.resolve();
  const navigatorMock = {
    onLine: true,
    locks: { request: (_key: string, task: () => Promise<void>) => {
      const next = lockTail.then(task, task);
      lockTail = next;
      return next;
    } },
  };
  const documentMock = Object.assign(new EventTarget(), { visibilityState: "visible" });
  let timeoutId = 0;
  const deferredCallbacks = new Map<number, () => void>();
  const windowMock = Object.assign(new EventTarget(), {
    setInterval, clearInterval,
    setTimeout: (callback: () => void) => { deferredCallbacks.set(++timeoutId, callback); return timeoutId; },
    clearTimeout: (id: number) => { deferredCallbacks.delete(id); },
  });
  for (const [key, value] of Object.entries({ navigator: navigatorMock, document: documentMock, window: windowMock,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
  })) Object.defineProperty(globalThis, key, { value, configurable: true });

  let reads = 0;
  let generations = 0;
  const received: number[][][] = [[], []];
  const pollers = received.map((sink) => createFilaNotificationPoller<number>({
    scope: "test-user:SUPERVISOR", isActive: () => true,
    fetchRows: async () => { reads++; return [42]; },
    generate: async () => { generations++; throw new Error("generation offline"); },
    receive: (rows) => sink.push(rows),
  }));
  stops.push(...pollers.map((poller) => poller.close));
  await Promise.all(pollers.map((poller) => poller.poll()));
  assert.equal(reads, 1, "Two tabs share one notification request");
  assert.deepEqual(received.map((sink) => sink.at(-1)), [[42], [42]]);
  await pollers[0].poll();
  assert.equal(reads, 1, "Focus cannot bypass the three-minute interval");
  now += 181_000;
  documentMock.visibilityState = "hidden";
  await pollers[0].poll();
  assert.equal(reads, 1);
  documentMock.visibilityState = "visible";
  navigatorMock.onLine = false;
  await pollers[0].poll();
  assert.equal(reads, 1);
  navigatorMock.onLine = true;
  await pollers[0].poll();
  assert.equal(reads, 2);
  assert.equal(generations, 1, "A generation error must also respect the ten-minute cooldown");
  // With no live peer, a newly opened tab must still load even if a timestamp exists.
  pollers.forEach((poller) => poller.close());
  const orphan = createFilaNotificationPoller<number>({ scope: "test-user:SUPERVISOR", isActive: () => true, fetchRows: async () => { reads++; return []; }, generate: async () => undefined, receive: () => undefined });
  stops.push(orphan.close);
  await orphan.poll();
  assert.equal(reads, 3);

  let polls = 0;
  const stop = startActivePolling(async () => { polls++; }, 30_000, () => assert.fail("Unexpected polling error"), false);
  stops.push(stop);
  await Promise.resolve();
  windowMock.dispatchEvent(new Event("focus"));
  await Promise.resolve();
  assert.equal(polls, 1);
  assert.equal(deferredCallbacks.size, 1, "Focus during cooldown schedules a deferred refresh");
  now += 30_001;
  for (const callback of Array.from(deferredCallbacks.values())) callback();
  await Promise.resolve();
  assert.equal(polls, 2);
  stop();
  now += 30_001;
  windowMock.dispatchEvent(new Event("focus"));
  assert.equal(polls, 2, "Unmount removes listeners");
} finally {
  stops.forEach((stop) => stop());
  Date.now = originalNow;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
console.log("OK: cache TTL/dedup/isolation, late responses, pagination, vendor scopes, aggregate fallback, invalidation, visibility/offline, tab coordination and retry cooldown.");
