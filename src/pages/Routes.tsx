import { useEffect, useMemo, useState } from "react";
import { ExternalLink, LoaderCircle, Map, MapPin, Plus, Trash } from "lucide-react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
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
  type AgendaLookupRow,
  updateAgendaCoordinates,
} from "../lib/routesApi";
import { fetchNominatimCoordinatesByAddress } from "../lib/nominatim";
import { onProfilesUpdated } from "../lib/profileEvents";
import type { Route, RouteStop } from "../types/routes";
import { formatDateBr } from "../lib/dateFormat";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const FORTALEZA_CENTER: [number, number] = [-3.7319, -38.5267];

const normalize = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

const isFortaleza = (row: AgendaLookupRow) => {
  const city = normalize(row.cidade);
  const uf = normalize(row.uf);
  return city === "FORTALEZA" && uf === "CE";
};

const buildAgendaAddress = (row: AgendaLookupRow) =>
  [row.endereco, row.complemento, row.bairro, row.cidade, row.uf].filter(Boolean).join(", ");

const buildStopAddress = (stop: RouteStop) => {
  const agenda = stop.agenda;
  if (!agenda) return "";
  return [agenda.endereco, agenda.complemento, agenda.bairro, agenda.cidade, agenda.uf]
    .filter(Boolean)
    .join(", ");
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
  const [agendaOptions, setAgendaOptions] = useState<AgendaLookupRow[]>([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const [creatingRoute, setCreatingRoute] = useState(false);
  const [newRoute, setNewRoute] = useState({ name: "", date: "", assigned_to_user_id: "" });
  const [newStop, setNewStop] = useState({ agenda_id: "", stop_order: "", notes: "" });
  const [mapAddingAgendaId, setMapAddingAgendaId] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeMessage, setGeocodeMessage] = useState<string | null>(null);

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
        const [profilesData, agendaData] = await Promise.all([fetchProfiles(), fetchAgendaLookup()]);
        if (!active) return;
        setProfiles(profilesData as { user_id: string; display_name: string | null; role: string }[]);
        setAgendaOptions(agendaData);
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

  const fortalezaRows = useMemo(() => agendaOptions.filter(isFortaleza), [agendaOptions]);
  const mapRows = useMemo(
    () =>
      fortalezaRows.filter(
        (row) => typeof row.latitude === "number" && typeof row.longitude === "number",
      ),
    [fortalezaRows],
  );
  const missingCoordinatesRows = useMemo(
    () => fortalezaRows.filter((row) => !(typeof row.latitude === "number" && typeof row.longitude === "number")),
    [fortalezaRows],
  );

  const stopAgendaIds = useMemo(
    () => new Set(stops.map((stop) => stop.agenda_id).filter((value): value is string => Boolean(value))),
    [stops],
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

  const handleAddStopFromMap = async (row: AgendaLookupRow) => {
    if (!selectedRouteId) return;
    if (stopAgendaIds.has(row.id)) return;

    setMapAddingAgendaId(row.id);
    try {
      const maxOrder = stops.reduce((max, item) => Math.max(max, item.stop_order ?? 0), 0);
      const created = await createRouteStop({
        route_id: selectedRouteId,
        agenda_id: row.id,
        stop_order: maxOrder + 1,
      });
      setStops((prev) => [...prev, created].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0)));
    } finally {
      setMapAddingAgendaId(null);
    }
  };

  const handleDeleteStop = async (stopId: string) => {
    await deleteRouteStop(stopId);
    setStops((prev) => prev.filter((stop) => stop.id !== stopId));
  };

  const handleGeocodeFortaleza = async () => {
    if (geocoding || missingCoordinatesRows.length === 0) return;
    setGeocoding(true);
    setGeocodeMessage("Geocodificando empresas de Fortaleza...");

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    const nextOptions = [...agendaOptions];

    for (const row of missingCoordinatesRows) {
      const road = [row.endereco, row.bairro].filter(Boolean).join(", ").trim();
      if (!road) {
        skipped += 1;
        continue;
      }

      try {
        const result = await fetchNominatimCoordinatesByAddress(road, "Fortaleza", "CE");
        if (!result) {
          failed += 1;
          continue;
        }

        await updateAgendaCoordinates({
          id: row.id,
          latitude: result.latitude,
          longitude: result.longitude,
          geocode_source: "nominatim",
        });

        const index = nextOptions.findIndex((item) => item.id === row.id);
        if (index >= 0) {
          nextOptions[index] = {
            ...nextOptions[index],
            latitude: result.latitude,
            longitude: result.longitude,
          };
        }
        updated += 1;
      } catch {
        failed += 1;
      }
    }

    setAgendaOptions(nextOptions);
    setGeocoding(false);
    setGeocodeMessage(`Geocodificacao concluida. Atualizadas: ${updated}, sem endereco: ${skipped}, falhas: ${failed}.`);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">Rotas</h2>
          <p className="mt-2 text-sm text-ink/60">Gestao de rotas e paradas comerciais.</p>
        </div>
        <a
          href="/rotas/mapa"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-sea/30 bg-white/90 px-3 py-2 text-xs font-semibold text-ink hover:border-sea hover:text-sea"
        >
          <Map size={14} />
          Abrir mapa dedicado
        </a>
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

              <div className="rounded-2xl border border-sea/20 bg-sand/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-ink">Modo mapa (Fortaleza/CE)</h4>
                    <p className="text-xs text-ink/60">
                      Empresas em Fortaleza com coordenadas reais para montar a rota por pin.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleGeocodeFortaleza}
                    disabled={geocoding || missingCoordinatesRows.length === 0}
                    className="inline-flex items-center gap-2 rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-sea disabled:opacity-60"
                  >
                    {geocoding ? <LoaderCircle size={14} className="animate-spin" /> : <MapPin size={14} />}
                    {geocoding
                      ? "Geocodificando..."
                      : `Geocodificar faltantes (${missingCoordinatesRows.length})`}
                  </button>
                </div>

                <div className="mt-3 text-xs text-ink/70">
                  <span>Total Fortaleza: {fortalezaRows.length}</span>
                  <span className="mx-2">•</span>
                  <span>Com coordenadas: {mapRows.length}</span>
                  <span className="mx-2">•</span>
                  <span>Sem coordenadas: {missingCoordinatesRows.length}</span>
                </div>
                {geocodeMessage ? <p className="mt-2 text-xs text-ink/60">{geocodeMessage}</p> : null}

                <div className="mt-3 overflow-hidden rounded-xl border border-sea/15">
                  <MapContainer center={FORTALEZA_CENTER} zoom={11} className="h-[460px] w-full">
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {mapRows.map((row) => {
                      if (typeof row.latitude !== "number" || typeof row.longitude !== "number") return null;
                      const address = buildAgendaAddress(row);
                      const isAdded = stopAgendaIds.has(row.id);

                      return (
                        <Marker key={row.id} position={[row.latitude, row.longitude]}>
                          <Popup>
                            <div className="space-y-2 text-xs">
                              <p className="font-semibold text-ink">{row.empresa ?? row.nome_fantasia ?? "Empresa"}</p>
                              <p className="text-ink/70">{address || "Endereco nao informado"}</p>
                              <p className="text-ink/60">
                                Lat/Lng: {row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}
                              </p>
                              <button
                                type="button"
                                disabled={isAdded || mapAddingAgendaId === row.id}
                                onClick={() => {
                                  handleAddStopFromMap(row).catch(() => undefined);
                                }}
                                className="inline-flex items-center gap-1 rounded border border-sea/30 px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-50"
                              >
                                <Plus size={12} />
                                {isAdded ? "Ja na rota" : mapAddingAgendaId === row.id ? "Adicionando..." : "Adicionar parada"}
                              </button>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}
                  </MapContainer>
                </div>
              </div>

              <form
                onSubmit={handleAddStop}
                className="grid gap-3 rounded-2xl border border-sea/20 bg-sand/20 p-3 md:grid-cols-4"
              >
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
                  Agenda
                  <select
                    value={newStop.agenda_id}
                    onChange={(event) => setNewStop((prev) => ({ ...prev, agenda_id: event.target.value }))}
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
                            <p className="text-sm font-semibold text-ink">{stop.agenda?.empresa ?? "Parada"}</p>
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

