import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, Trash } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  createRoute,
  createRouteStop,
  deleteRoute,
  deleteRouteStop,
  fetchAgendaLookup,
  fetchProfiles,
  fetchRouteStops,
  fetchRoutes,
} from "../lib/routesApi";
import { onProfilesUpdated } from "../lib/profileEvents";
import type { Route, RouteStop } from "../types/routes";

const buildAddress = (stop: RouteStop) => {
  const agenda = stop.agenda;
  if (!agenda) return "";
  return [agenda.endereco, agenda.cidade, agenda.uf].filter(Boolean).join(", ");
};

const googleMapsUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

const wazeUrl = (address: string) =>
  `https://waze.com/ul?q=${encodeURIComponent(address)}`;

export default function Routes() {
  const { role, session } = useAuth();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [profiles, setProfiles] = useState<
    { user_id: string; display_name: string | null; role: string }[]
  >([]);
  const [agendaOptions, setAgendaOptions] = useState<
    { id: string; empresa: string | null; nome_fantasia: string | null; cidade: string | null; uf: string | null }[]
  >([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const [creatingRoute, setCreatingRoute] = useState(false);
  const [newRoute, setNewRoute] = useState({ name: "", date: "", assigned_to_user_id: "" });
  const [newStop, setNewStop] = useState({ agenda_id: "", stop_order: "", notes: "" });

  const canEdit = role === "SUPERVISOR" || role === "ASSISTENTE";

  useEffect(() => {
    if (!canEdit) {
      setRoutes([]);
      return;
    }
    const loadRoutes = async () => {
      const data = await fetchRoutes();
      setRoutes(data);
      if (!selectedRouteId && data.length) {
        setSelectedRouteId(data[0].id);
      }
    };

    loadRoutes().catch(() => {
      setRoutes([]);
    });
  }, [canEdit, selectedRouteId]);

  useEffect(() => {
    if (!canEdit) return;
    let active = true;
    const loadLookups = async () => {
      try {
        const [profilesData, agendaData] = await Promise.all([
          fetchProfiles(),
          fetchAgendaLookup(),
        ]);
        if (!active) return;
        setProfiles(
          profilesData as { user_id: string; display_name: string | null; role: string }[],
        );
        setAgendaOptions(
          agendaData as {
            id: string;
            empresa: string | null;
            nome_fantasia: string | null;
            cidade: string | null;
            uf: string | null;
          }[],
        );
      } catch {
        if (!active) return;
        setProfiles([]);
        setAgendaOptions([]);
      }
    };

    loadLookups();
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
      agenda_id: newStop.agenda_id || undefined,
      stop_order: stopOrderValue,
      notes: newStop.notes || undefined,
    });
    setStops((prev) => [...prev, created].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0)));
    setNewStop({ agenda_id: "", stop_order: "", notes: "" });
  };

  const handleDeleteStop = async (stopId: string) => {
    await deleteRouteStop(stopId);
    setStops((prev) => prev.filter((stop) => stop.id !== stopId));
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-ink">Rotas</h2>
        <p className="mt-2 text-sm text-ink/60">
          Gestao de rotas e paradas comerciais.
        </p>
      </header>

      {canEdit && (
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
      )}

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
                {canEdit && (
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
                )}
              </div>
              <p className="text-xs text-ink/60">{route.date ?? "Sem data"}</p>
            </button>
          ))}
        </aside>

        <section className="rounded-2xl border border-sea/15 bg-white/90 p-4">
          {!selectedRoute ? (
            <p className="text-sm text-ink/60">Selecione uma rota para ver os detalhes.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-xl text-ink">{selectedRoute.name}</h3>
                  <p className="text-sm text-ink/60">{selectedRoute.date ?? "Sem data"}</p>
                </div>
              </div>

              {canEdit && (
                <form onSubmit={handleAddStop} className="grid gap-3 rounded-2xl border border-sea/20 bg-sand/20 p-3 md:grid-cols-4">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                    Agenda
                    <select
                      value={newStop.agenda_id}
                      onChange={(event) =>
                        setNewStop((prev) => ({ ...prev, agenda_id: event.target.value }))
                      }
                      className="rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-sm text-ink outline-none focus:border-sea"
                    >
                      <option value="">Selecione</option>
                      {agendaOptions.map((option) => (
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
                      onChange={(event) =>
                        setNewStop((prev) => ({ ...prev, stop_order: event.target.value }))
                      }
                      className="rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-sm text-ink outline-none focus:border-sea"
                      placeholder={(stops.length + 1).toString()}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                    Observacao
                    <input
                      value={newStop.notes}
                      onChange={(event) =>
                        setNewStop((prev) => ({ ...prev, notes: event.target.value }))
                      }
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
              )}

              {loadingStops ? (
                <p className="text-sm text-ink/60">Carregando paradas...</p>
              ) : stops.length === 0 ? (
                <p className="text-sm text-ink/60">Nenhuma parada cadastrada.</p>
              ) : (
                <div className="space-y-3">
                  {stops.map((stop) => {
                    const address = buildAddress(stop);
                    return (
                      <div key={stop.id} className="rounded-2xl border border-sea/15 bg-white/90 p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-ink">
                              {stop.agenda?.empresa ?? "Parada"}
                            </p>
                            <p className="text-xs text-ink/60">{address || "Endereco nao informado"}</p>
                          </div>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleDeleteStop(stop.id)}
                              className="text-xs text-red-500"
                            >
                              <Trash size={14} />
                            </button>
                          )}
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
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
