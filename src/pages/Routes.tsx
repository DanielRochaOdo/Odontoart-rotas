import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, Trash } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  createRoute,
  createRouteStop,
  deleteRoute,
  deleteRouteStop,
  fetchEmpresasLookup,
  fetchProfiles,
  fetchRouteStops,
  fetchRoutes,
  type EmpresaLookupRow,
} from "../lib/routesApi";
import { onProfilesUpdated } from "../lib/profileEvents";
import type { Route, RouteStop } from "../types/routes";
import { formatDateBr } from "../lib/dateFormat";

const buildStopAddress = (stop: RouteStop) => {
  const cliente = stop.cliente;
  if (!cliente) return "";
  return [cliente.endereco, cliente.complemento, cliente.bairro, cliente.cidade, cliente.uf]
    .filter(Boolean)
    .join(", ");
};

const googleMapsUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

const wazeUrl = (address: string) =>
  `https://waze.com/ul?q=${encodeURIComponent(address)}`;

type RoutesPageLookupsCache = {
  profiles: { user_id: string; display_name: string | null; role: string }[];
  empresaOptions: EmpresaLookupRow[];
  cachedAt: number;
};

const ROUTES_PAGE_ROUTES_CACHE_KEY = "routesPageRoutesCacheV2";
const ROUTES_PAGE_LOOKUPS_CACHE_KEY = "routesPageLookupsCacheV2";
let routesPageRoutesMemoryCache: { routes: Route[]; cachedAt: number } | null = null;
let routesPageLookupsMemoryCache: RoutesPageLookupsCache | null = null;

const readRoutesPageRoutesCache = () => {
  if (routesPageRoutesMemoryCache) return routesPageRoutesMemoryCache;
  try {
    const raw = sessionStorage.getItem(ROUTES_PAGE_ROUTES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ routes: Route[]; cachedAt: number }>;
    if (!Array.isArray(parsed.routes)) return null;
    const entry = {
      routes: parsed.routes as Route[],
      cachedAt: typeof parsed.cachedAt === "number" ? parsed.cachedAt : Date.now(),
    };
    routesPageRoutesMemoryCache = entry;
    return entry;
  } catch {
    return null;
  }
};

const writeRoutesPageRoutesCache = (routes: Route[]) => {
  const entry = { routes, cachedAt: Date.now() };
  routesPageRoutesMemoryCache = entry;
  try {
    sessionStorage.setItem(ROUTES_PAGE_ROUTES_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore storage failures
  }
};

const readRoutesPageLookupsCache = () => {
  if (routesPageLookupsMemoryCache) return routesPageLookupsMemoryCache;
  try {
    const raw = sessionStorage.getItem(ROUTES_PAGE_LOOKUPS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoutesPageLookupsCache>;
    if (!Array.isArray(parsed.profiles) || !Array.isArray(parsed.empresaOptions)) return null;
    const entry: RoutesPageLookupsCache = {
      profiles: parsed.profiles as RoutesPageLookupsCache["profiles"],
      empresaOptions: parsed.empresaOptions as EmpresaLookupRow[],
      cachedAt: typeof parsed.cachedAt === "number" ? parsed.cachedAt : Date.now(),
    };
    routesPageLookupsMemoryCache = entry;
    return entry;
  } catch {
    return null;
  }
};

const writeRoutesPageLookupsCache = (entry: RoutesPageLookupsCache) => {
  routesPageLookupsMemoryCache = entry;
  try {
    sessionStorage.setItem(ROUTES_PAGE_LOOKUPS_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore storage failures
  }
};

export default function Routes() {
  const { role, session } = useAuth();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [profiles, setProfiles] = useState<
    { user_id: string; display_name: string | null; role: string }[]
  >([]);
  const [empresaOptions, setEmpresaOptions] = useState<EmpresaLookupRow[]>([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const [creatingRoute, setCreatingRoute] = useState(false);
  const [newRoute, setNewRoute] = useState({ name: "", date: "", assigned_to_user_id: "" });
  const [newStop, setNewStop] = useState({ cliente_id: "", stop_order: "", notes: "" });

  const canEdit = role === "SUPERVISOR" || role === "ASSISTENTE";

  useEffect(() => {
    if (!canEdit) {
      setRoutes([]);
      return;
    }
    const cached = readRoutesPageRoutesCache();
    if (cached?.routes.length) {
      setRoutes(cached.routes);
      setSelectedRouteId((prev) =>
        prev && cached.routes.some((route) => route.id === prev)
          ? prev
          : cached.routes[0]?.id ?? null,
      );
    }

    const loadRoutes = async () => {
      const data = await fetchRoutes();
      setRoutes(data);
      writeRoutesPageRoutesCache(data);
      setSelectedRouteId((prev) =>
        prev && data.some((route) => route.id === prev) ? prev : data[0]?.id ?? null,
      );
    };

    loadRoutes().catch(() => {
      if (!cached?.routes.length) {
        setRoutes([]);
      }
    });
  }, [canEdit]);

  useEffect(() => {
    if (!canEdit) return;
    let active = true;
    const cached = readRoutesPageLookupsCache();
    if (cached) {
      setProfiles(cached.profiles);
      setEmpresaOptions(cached.empresaOptions);
    }

    const loadLookups = async () => {
      try {
        const [profilesData, empresaData] = await Promise.all([fetchProfiles(), fetchEmpresasLookup()]);
        if (!active) return;
        const nextCache: RoutesPageLookupsCache = {
          profiles: profilesData as { user_id: string; display_name: string | null; role: string }[],
          empresaOptions: empresaData,
          cachedAt: Date.now(),
        };
        writeRoutesPageLookupsCache(nextCache);
        setProfiles(nextCache.profiles);
        setEmpresaOptions(nextCache.empresaOptions);
      } catch {
        if (!active) return;
        if (!cached) {
          setProfiles([]);
          setEmpresaOptions([]);
        }
      }
    };

    void loadLookups();
    const unsubscribe = onProfilesUpdated(loadLookups);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [canEdit]);

  useEffect(() => {
    if (!selectedRouteId || !canEdit) {
      setStops([]);
      return;
    }
    setLoadingStops(true);
    fetchRouteStops(selectedRouteId)
      .then((data) => setStops(data))
      .catch(() => setStops([]))
      .finally(() => setLoadingStops(false));
  }, [selectedRouteId, canEdit]);

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  );

  if (!canEdit) {
    return (
      <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
        Este modulo e restrito a supervisao e assistencia.
      </div>
    );
  }

  const handleCreateRoute = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newRoute.name.trim()) return;
    setCreatingRoute(true);
    try {
      const created = await createRoute({
        name: newRoute.name.trim(),
        date: newRoute.date || undefined,
        assigned_to_user_id: newRoute.assigned_to_user_id || undefined,
        created_by: session?.user.id,
      });
      setRoutes((prev) => [created, ...prev]);
      setSelectedRouteId(created.id);
      setNewRoute({ name: "", date: "", assigned_to_user_id: "" });
    } finally {
      setCreatingRoute(false);
    }
  };

  const handleDeleteRoute = async (routeId: string) => {
    await deleteRoute(routeId);
    setRoutes((prev) => prev.filter((route) => route.id !== routeId));
    if (selectedRouteId === routeId) {
      setSelectedRouteId(null);
    }
  };

  const handleAddStop = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRouteId) return;
    const stopOrderValue = newStop.stop_order ? Number(newStop.stop_order) : stops.length + 1;
    const created = await createRouteStop({
      route_id: selectedRouteId,
      cliente_id: newStop.cliente_id || undefined,
      stop_order: stopOrderValue,
      notes: newStop.notes || undefined,
    });
    setStops((prev) => [...prev, created].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0)));
    setNewStop({ cliente_id: "", stop_order: "", notes: "" });
  };

  const handleDeleteStop = async (stopId: string) => {
    await deleteRouteStop(stopId);
    setStops((prev) => prev.filter((stop) => stop.id !== stopId));
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">Rotas</h2>
          <p className="mt-2 text-sm text-ink/60">Gestao de rotas e paradas comerciais.</p>
        </div>
      </header>

      <form
        onSubmit={handleCreateRoute}
        className="grid gap-4 rounded-2xl border border-sea/20 bg-sand/30 p-4 md:grid-cols-4"
      >
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
          Nome da rota
          <input
            value={newRoute.name}
            onChange={(event) => setNewRoute((prev) => ({ ...prev, name: event.target.value }))}
            className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            placeholder="Rota Centro"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
          Data
          <input
            type="date"
            value={newRoute.date}
            onChange={(event) => setNewRoute((prev) => ({ ...prev, date: event.target.value }))}
            className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-sm text-ink outline-none focus:border-sea"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
          Atribuir para
          <select
            value={newRoute.assigned_to_user_id}
            onChange={(event) =>
              setNewRoute((prev) => ({ ...prev, assigned_to_user_id: event.target.value }))
            }
            className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-sm text-ink outline-none focus:border-sea"
          >
            <option value="">Sem atribuicao</option>
            {profiles.map((profile) => (
              <option key={profile.user_id} value={profile.user_id}>
                {profile.display_name ?? profile.user_id}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={creatingRoute}
            className="inline-flex items-center gap-2 rounded-lg bg-sea px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-seaLight disabled:opacity-70"
          >
            <Plus size={16} />
            {creatingRoute ? "Criando" : "Criar rota"}
          </button>
        </div>
      </form>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-3">
          {routes.map((route) => (
            <button
              key={route.id}
              type="button"
              onClick={() => setSelectedRouteId(route.id)}
              className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                selectedRouteId === route.id
                  ? "border-sea bg-sea/10"
                  : "border-sea/20 bg-white/90 hover:border-sea/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">{route.name}</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDeleteRoute(route.id);
                  }}
                  className="text-xs text-red-500"
                >
                  <Trash size={14} />
                </button>
              </div>
              <p className="text-xs text-ink/60">{formatDateBr(route.date, "Sem data")}</p>
            </button>
          ))}
        </aside>

        <section className="space-y-4 rounded-2xl border border-sea/15 bg-white/90 p-4">
          {!selectedRoute ? (
            <p className="text-sm text-ink/60">Selecione uma rota para ver os detalhes.</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-xl text-ink">{selectedRoute.name}</h3>
                  <p className="text-sm text-ink/60">{formatDateBr(selectedRoute.date, "Sem data")}</p>
                </div>
              </div>

              <form
                onSubmit={handleAddStop}
                className="grid gap-3 rounded-2xl border border-sea/20 bg-sand/20 p-3 md:grid-cols-4"
              >
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                  Empresa
                  <select
                    value={newStop.cliente_id}
                    onChange={(event) => setNewStop((prev) => ({ ...prev, cliente_id: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-sm text-ink outline-none focus:border-sea"
                  >
                    <option value="">Selecione</option>
                    {empresaOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.empresa ?? "Sem nome"} - {option.cidade ?? ""} {option.uf ?? ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Ordem
                  <input
                    value={newStop.stop_order}
                    onChange={(event) => setNewStop((prev) => ({ ...prev, stop_order: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-sm text-ink outline-none focus:border-sea"
                    placeholder={(stops.length + 1).toString()}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Observacao
                  <input
                    value={newStop.notes}
                    onChange={(event) => setNewStop((prev) => ({ ...prev, notes: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight"
                  >
                    <Plus size={14} />
                    Adicionar parada
                  </button>
                </div>
              </form>

              {loadingStops ? (
                <p className="text-sm text-ink/60">Carregando paradas...</p>
              ) : stops.length === 0 ? (
                <p className="text-sm text-ink/60">Nenhuma parada cadastrada.</p>
              ) : (
                <div className="space-y-3">
                  {stops.map((stop) => {
                    const address = buildStopAddress(stop);
                    return (
                      <div key={stop.id} className="rounded-2xl border border-sea/15 bg-white/90 p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-ink">{stop.cliente?.empresa ?? "Parada"}</p>
                            <p className="text-xs text-ink/60">{address || "Endereco nao informado"}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteStop(stop.id)}
                            className="text-xs text-red-500"
                          >
                            <Trash size={14} />
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink/60">
                          <span>Ordem: {stop.stop_order ?? "-"}</span>
                          {stop.notes ? <span>Obs: {stop.notes}</span> : null}
                        </div>
                        {address && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <a
                              href={googleMapsUrl(address)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-sea/30 bg-white/80 px-2 py-1 text-xs text-ink hover:border-sea hover:text-sea"
                            >
                              <ExternalLink size={12} />
                              Google Maps
                            </a>
                            <a
                              href={wazeUrl(address)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-sea/30 bg-white/80 px-2 py-1 text-xs text-ink hover:border-sea hover:text-sea"
                            >
                              <ExternalLink size={12} />
                              Waze
                            </a>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

