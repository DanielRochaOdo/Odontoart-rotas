import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  SquareCenterlineDashedHorizontal,
} from "lucide-react";
import L from "leaflet";
import {
  Circle,
  CircleMarker,
  GeoJSON,
  MapContainer,
  Pane,
  Popup,
  TileLayer,
  Tooltip,
  useMapEvents,
} from "react-leaflet";
import type { Feature, GeoJsonObject } from "geojson";
import { useAuth } from "../context/AuthContext";
import {
  fetchAgendaLookup,
  type AgendaLookupRow,
  updateAgendaCoordinatesBatch,
} from "../lib/routesApi";
import {
  fetchNominatimCoordinatesByAddress,
  fetchNominatimCoordinatesByQuery,
} from "../lib/nominatim";
import { onProfilesUpdated } from "../lib/profileEvents";
import { useAgendaFilters } from "../hooks/useAgendaFilters";
import {
  fetchAgendaForGeneration,
  fetchSupervisores,
  fetchVendedores,
} from "../lib/agendaApi";
import { supabase } from "../lib/supabase";
import { formatDateBr } from "../lib/dateFormat";
import MultiSelectFilter from "../components/agenda/MultiSelectFilter";
import cearaCitiesRaw from "../data/ceara_municipios.geojson?raw";
import fortalezaBairrosRaw from "../data/fortaleza_bairros.geojson?raw";

const RMF_CENTER: [number, number] = [-3.86, -38.62];
const CEARA_BOUNDS: [[number, number], [number, number]] = [
  [-8.1, -41.5],
  [-2.7, -37.2],
];

const CEARA_CITIES_GEOJSON = JSON.parse(cearaCitiesRaw) as GeoJsonObject;
const FORTALEZA_BAIRROS_GEOJSON = JSON.parse(fortalezaBairrosRaw) as GeoJsonObject;
const LIGHT_MODE_POINT_LIMIT = 3000;
const MAX_GEOCODE_UNIQUE_ADDRESSES_PER_RUN = 40;
const COMPANY_LIST_MIN_HEIGHT = 200;
const COMPANY_LIST_MAX_HEIGHT = 680;

const MONTH_OPTIONS = [
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Marco" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

const FILTER_SOURCES: Record<string, string[]> = {
  cod_1: ["cod_1"],
  empresa_nome: ["empresa"],
  bairro: ["bairro"],
  cidade: ["cidade"],
  vendedor: ["vendedor"],
  grupo: ["grupo"],
  perfil_visita: ["perfil_visita"],
  situacao: ["situacao"],
};

const FILTER_LABELS: Record<string, string> = {
  cod_1: "Codigo",
  empresa_nome: "Empresa",
  bairro: "Bairro",
  cidade: "Cidade",
  vendedor: "Vendedor",
  grupo: "Grupo",
  perfil_visita: "Perfil visita",
  situacao: "Situacao",
};

const normalize = (v: string | null | undefined) =>
  (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

const normalizeNumberInput = (v: string) => v.replace(/\D/g, "");
const toDateKey = (v: string | null | undefined) => (v ?? "").slice(0, 10);
const compact = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

const fmtDate = (v: string | null) => formatDateBr(v);

const addr = (r: AgendaLookupRow) =>
  [r.endereco, r.complemento, r.bairro, r.cidade, r.uf].filter(Boolean).join(", ");

type RenderableMapRow = AgendaLookupRow & {
  latitude: number;
  longitude: number;
  isApproximatePoint: boolean;
};

type MapViewport = {
  bounds: L.LatLngBounds;
  zoom: number;
};

type SelectionMode = "RAIO" | "BAIRRO";

const clampCompanyListHeight = (height: number) =>
  Math.max(COMPANY_LIST_MIN_HEIGHT, Math.min(height, COMPANY_LIST_MAX_HEIGHT));

const hasRealCoordinates = (row: Pick<AgendaLookupRow, "latitude" | "longitude">) =>
  Number.isFinite(row.latitude) && Number.isFinite(row.longitude);

const collectCoordinatePairs = (value: unknown, target: Array<[number, number]>) => {
  if (!Array.isArray(value)) return;

  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    target.push([value[0], value[1]]);
    return;
  }

  value.forEach((item) => collectCoordinatePairs(item, target));
};

const getGeometryCenter = (geometry: unknown): [number, number] | null => {
  if (!geometry || typeof geometry !== "object") return null;
  const coords = (geometry as { coordinates?: unknown }).coordinates;
  if (!coords) return null;

  const pairs: Array<[number, number]> = [];
  collectCoordinatePairs(coords, pairs);
  if (pairs.length === 0) return null;

  const [sumLng, sumLat] = pairs.reduce<[number, number]>(
    (acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat],
    [0, 0],
  );
  return [sumLat / pairs.length, sumLng / pairs.length];
};

const addCentroidKeys = (map: Map<string, [number, number]>, rawName: string, center: [number, number]) => {
  const key = normalize(rawName);
  if (key && !map.has(key)) {
    map.set(key, center);
  }

  const alternate = normalize(rawName.replace(/[\\/|]/g, " "));
  if (alternate && !map.has(alternate)) {
    map.set(alternate, center);
  }
};

const buildCentroidMap = (geojson: GeoJsonObject, nameKeys: string[]) => {
  const map = new Map<string, [number, number]>();
  const features = (geojson as { features?: Array<{ geometry?: unknown; properties?: Record<string, unknown> }> })
    .features;
  if (!Array.isArray(features)) return map;

  features.forEach((feature) => {
    const center = getGeometryCenter(feature.geometry);
    if (!center) return;
    const props = feature.properties ?? {};
    nameKeys.forEach((key) => {
      const rawName = props[key];
      if (typeof rawName !== "string" || !rawName.trim()) return;
      addCentroidKeys(map, rawName, center);
    });
  });

  return map;
};

const getFeatureName = (feature: Feature | undefined, key: string) => {
  const rawName = feature?.properties?.[key];
  return typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;
};

const bindBairroLabel = (feature: Feature | undefined, layer: L.Layer) => {
  const bairroName = getFeatureName(feature, "Nome");
  if (!bairroName || !("bindTooltip" in layer)) return;

  layer.bindTooltip(bairroName, {
    permanent: true,
    direction: "center",
    className: "routes-map-bairro-label",
    opacity: 0.96,
  });
};

const CITY_CENTER_MAP = buildCentroidMap(CEARA_CITIES_GEOJSON, ["name", "description"]);
const BAIRRO_CENTER_MAP = buildCentroidMap(FORTALEZA_BAIRROS_GEOJSON, ["Nome"]);

const getIdFallbackPoint = (id: string): [number, number] => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const latOffset = ((hash % 200) - 100) * 0.0002;
  const lngOffset = (((Math.floor(hash / 200) % 200) - 100) * 0.0002);
  return [RMF_CENTER[0] + latOffset, RMF_CENTER[1] + lngOffset];
};

const dedupeAgendaLookupRows = (rows: AgendaLookupRow[]) => {
  const byId = new Map<string, AgendaLookupRow>();
  rows.forEach((row) => {
    if (!byId.has(row.id)) {
      byId.set(row.id, row);
    }
  });
  return Array.from(byId.values());
};

export default function RoutesMap() {
  const { role, session } = useAuth();
  const canGenerate = role === "SUPERVISOR" || role === "ASSISTENTE";

  const { filters, setFilters, clearFilters } = useAgendaFilters();
  const [globalQuery, setGlobalQuery] = useState(filters.global);
  const typingGlobalRef = useRef(false);

  const [agendaRows, setAgendaRows] = useState<AgendaLookupRow[]>([]);
  const [vendedores, setVendedores] = useState<
    { user_id: string; display_name: string | null; role: string; supervisor_id?: string | null }[]
  >([]);
  const [supervisores, setSupervisores] = useState<
    { id?: string; user_id: string; display_name: string | null; role: string }[]
  >([]);

  const [selectionMode, setSelectionMode] = useState<SelectionMode>("RAIO");
  const [selectedAgendaIds, setSelectedAgendaIds] = useState<string[]>([]);
  const [selectedBairroKeys, setSelectedBairroKeys] = useState<string[]>([]);
  const [excludedBairroAgendaIds, setExcludedBairroAgendaIds] = useState<string[]>([]);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [vendorQuery, setVendorQuery] = useState("");

  const [visitDate, setVisitDate] = useState("");
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showGeocodeConfirm, setShowGeocodeConfirm] = useState(false);

  // ====== SELEÇÃO POR RAIO (AGORA COM 1KM) ======
  const [radiusKm, setRadiusKm] = useState<0.5 | 1 | 3 | 5 | 10>(1);
  const [radiusMode, setRadiusMode] = useState(true);
  const [radiusCenter, setRadiusCenter] = useState<L.LatLng | null>(null);
  const [radiusReplaceSelection, setRadiusReplaceSelection] = useState(true);
  const [radiusResultIds, setRadiusResultIds] = useState<string[]>([]);
  const [isLightMapMode] = useState(true);
  const [showBaseMap] = useState(true);
  const [mapViewport, setMapViewport] = useState<MapViewport | null>(null);
  const [companyListHeight, setCompanyListHeight] = useState(256);
  // ==============================================

  useEffect(() => {
    if (typingGlobalRef.current) {
      if (filters.global === globalQuery) typingGlobalRef.current = false;
      return;
    }
    if (filters.global !== globalQuery) setGlobalQuery(filters.global);
  }, [filters.global, globalQuery]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setFilters((p) => (p.global === globalQuery ? p : { ...p, global: globalQuery }));
      typingGlobalRef.current = false;
    }, 250);
    return () => window.clearTimeout(t);
  }, [globalQuery, setFilters]);

  useEffect(() => {
    if (!canGenerate) return;
    let active = true;

    const load = async () => {
      try {
        const [agenda, vends, sups] = await Promise.all([
          fetchAgendaLookup(),
          fetchVendedores(),
          fetchSupervisores(),
        ]);
        if (!active) return;
        setAgendaRows(agenda);
        setVendedores(vends);
        setSupervisores(sups);
      } catch (e) {
        if (active) setMessage(e instanceof Error ? e.message : "Erro ao carregar dados.");
      }
    };

    load();
    const unsub = onProfilesUpdated(load);
    return () => {
      active = false;
      unsub();
    };
  }, [canGenerate]);

  const supById = useMemo(
    () => new Map(supervisores.map((s) => [s.user_id, s.display_name ?? s.user_id])),
    [supervisores],
  );

  const supByVendor = useMemo(() => {
    const m = new Map<string, string>();
    vendedores.forEach((v) => {
      if (!v.supervisor_id) return;
      const n = supById.get(v.supervisor_id);
      if (n) m.set(v.user_id, n);
    });
    return m;
  }, [supById, vendedores]);

  const filteredVendedores = useMemo(() => {
    if (!vendorQuery.trim()) return vendedores;
    const t = vendorQuery.trim().toLowerCase();
    return vendedores.filter((v) => (v.display_name ?? v.user_id).toLowerCase().includes(t));
  }, [vendorQuery, vendedores]);

  const dedupedAgendaRows = useMemo(() => dedupeAgendaLookupRows(agendaRows), [agendaRows]);

  const filterOptions = useMemo<Record<string, string[]>>(() => {
    const options = Object.fromEntries(
      Object.keys(FILTER_SOURCES).map((key) => [key, new Set<string>()]),
    ) as Record<string, Set<string>>;

    dedupedAgendaRows.forEach((row) => {
      const valuesByKey: Record<string, string | null | undefined> = {
        cod_1: row.cod_1,
        empresa_nome: row.empresa ?? row.nome_fantasia,
        bairro: row.bairro,
        cidade: row.cidade,
        vendedor: row.vendedor,
        grupo: row.grupo,
        perfil_visita: row.perfil_visita,
        situacao: row.situacao,
      };

      Object.entries(valuesByKey).forEach(([key, value]) => {
        const normalized = (value ?? "").trim();
        if (!normalized) return;
        options[key]?.add(normalized);
      });
    });

    return Object.fromEntries(
      Object.entries(options).map(([key, set]) => [key, Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"))]),
    );
  }, [dedupedAgendaRows]);

  const rowsMatchingFilters = useMemo(() => {
    const term = normalize(filters.global);
    const d = filters.dateRanges.data_da_ultima_visita;
    const vr = filters.ranges.vidas_ultima_visita;

    return dedupedAgendaRows.filter((r) => {
      if (term) {
        const hay = normalize(
          [
            r.empresa,
            r.nome_fantasia,
            r.cidade,
            r.uf,
            r.vendedor,
            r.supervisor,
            r.situacao,
            r.grupo,
            r.perfil_visita,
            r.endereco,
            r.bairro,
          ]
            .filter(Boolean)
            .join(" "),
        );
        if (!hay.includes(term)) return false;
      }

      const ck: Record<string, string> = {
        supervisor: r.supervisor ?? "",
        vendedor: r.vendedor ?? "",
        cod_1: r.cod_1 ?? "",
        bairro: r.bairro ?? "",
        cidade: r.cidade ?? "",
        uf: r.uf ?? "",
        grupo: r.grupo ?? "",
        perfil_visita: r.perfil_visita ?? "",
        empresa_nome: r.empresa ?? r.nome_fantasia ?? "",
        situacao: r.situacao ?? "",
      };

      for (const [k, vals] of Object.entries(filters.columns)) {
        if (!vals?.length) continue;
        if (!vals.map((v) => normalize(v)).includes(normalize(ck[k]))) return false;
      }

      const date = toDateKey(r.data_da_ultima_visita);
      const hasMonthYear = Boolean(d.month || d.year);

      if (!hasMonthYear) {
        if (d.from || d.to) {
          if (d.invert) {
            if (!date) return false;
            if (d.from && date < d.from) return false;
            if (d.to && date > d.to) return false;
          } else {
            const inside = Boolean(date && (!d.from || date >= d.from) && (!d.to || date <= d.to));
            if (inside) return false;
          }
        }
      } else {
        const yy = Number(d.year || (d.month ? String(new Date().getFullYear()) : ""));
        if (!Number.isNaN(yy) && yy > 0) {
          const st = d.month ? new Date(yy, Number(d.month) - 1, 1) : new Date(yy, 0, 1);
          const en = d.month ? new Date(yy, Number(d.month), 0) : new Date(yy, 11, 31);
          const s = st.toISOString().slice(0, 10);
          const e = en.toISOString().slice(0, 10);
          const inside = Boolean(date && date >= s && date <= e);
          if (d.invert ? !inside : inside) return false;
        }
      }

      const from = vr.from ? Number(vr.from) : null;
      const to = vr.to ? Number(vr.to) : null;

      if (from !== null || to !== null) {
        if (r.visit_completed_vidas === null || r.visit_completed_vidas === undefined) return false;
        if (from !== null && r.visit_completed_vidas < from) return false;
        if (to !== null && r.visit_completed_vidas > to) return false;
      }

      return true;
    });
  }, [dedupedAgendaRows, filters]);

  const mapRows = useMemo<RenderableMapRow[]>(() => {
    return rowsMatchingFilters.map((row) => {
      if (hasRealCoordinates(row)) {
        return {
          ...row,
          latitude: row.latitude as number,
          longitude: row.longitude as number,
          isApproximatePoint: false,
        };
      }

      const cityKey = normalize(row.cidade);
      const useBairroFallback = cityKey === "FORTALEZA";
      const bairroKey = useBairroFallback ? normalize(row.bairro) : "";

      const center =
        (bairroKey ? BAIRRO_CENTER_MAP.get(bairroKey) : null) ??
        (cityKey ? CITY_CENTER_MAP.get(cityKey) : null) ??
        getIdFallbackPoint(row.id);

      return {
        ...row,
        latitude: center[0],
        longitude: center[1],
        isApproximatePoint: true,
      };
    });
  }, [rowsMatchingFilters]);

  const missingAll = useMemo(() => dedupedAgendaRows.filter((r) => !hasRealCoordinates(r)), [dedupedAgendaRows]);
  const missingFromFiltersCount = useMemo(
    () => rowsMatchingFilters.filter((r) => !hasRealCoordinates(r)).length,
    [rowsMatchingFilters],
  );
  const bairroRowsByKey = useMemo(() => {
    const grouped = new Map<string, { name: string; rows: AgendaLookupRow[] }>();

    rowsMatchingFilters.forEach((row) => {
      if (normalize(row.cidade) !== "FORTALEZA") return;
      const bairroName = compact(row.bairro);
      if (!bairroName) return;

      const bairroKey = normalize(bairroName);
      const existing = grouped.get(bairroKey);
      if (existing) {
        existing.rows.push(row);
        return;
      }

      grouped.set(bairroKey, { name: bairroName, rows: [row] });
    });

    return grouped;
  }, [rowsMatchingFilters]);
  const selectedBairroRows = useMemo(
    () => selectedBairroKeys.flatMap((bairroKey) => bairroRowsByKey.get(bairroKey)?.rows ?? []),
    [bairroRowsByKey, selectedBairroKeys],
  );
  const selectedBairroCompanyRows = useMemo(
    () => dedupeAgendaLookupRows(selectedBairroRows),
    [selectedBairroRows],
  );
  const selectedBairroAgendaIds = useMemo(
    () => Array.from(new Set(selectedBairroCompanyRows.map((row) => row.id))),
    [selectedBairroCompanyRows],
  );
  const excludedBairroAgendaSet = useMemo(() => new Set(excludedBairroAgendaIds), [excludedBairroAgendaIds]);
  const effectiveSelectedAgendaIds = useMemo(
    () =>
      selectionMode === "BAIRRO"
        ? selectedBairroAgendaIds.filter((id) => !excludedBairroAgendaSet.has(id))
        : selectedAgendaIds,
    [excludedBairroAgendaSet, selectedAgendaIds, selectedBairroAgendaIds, selectionMode],
  );
  const effectiveSelSet = useMemo(() => new Set(effectiveSelectedAgendaIds), [effectiveSelectedAgendaIds]);

  useEffect(() => {
    setExcludedBairroAgendaIds((prev) => prev.filter((id) => selectedBairroAgendaIds.includes(id)));
  }, [selectedBairroAgendaIds]);

  const computeIdsWithinRadius = (rows: AgendaLookupRow[], center: L.LatLng, km: number) => {
    const radiusMeters = km * 1000;
    const ids: string[] = [];
    for (const r of rows) {
      if (typeof r.latitude !== "number" || typeof r.longitude !== "number") continue;
      const d = center.distanceTo(L.latLng(r.latitude, r.longitude));
      if (d <= radiusMeters) ids.push(r.id);
    }
    return ids;
  };

  const radiusRows = useMemo(() => {
    const set = new Set(radiusResultIds);
    return mapRows.filter((r) => set.has(r.id));
  }, [mapRows, radiusResultIds]);
  const showBairroLabels = (mapViewport?.zoom ?? 10) >= 13;

  const updateMapViewport = useCallback((bounds: L.LatLngBounds, zoom: number) => {
    setMapViewport((prev) => {
      if (prev && prev.zoom === zoom && prev.bounds.equals(bounds)) return prev;
      return { bounds, zoom };
    });
  }, []);

  const rowsToRender = useMemo(() => {
    if (selectionMode === "BAIRRO") return [] as RenderableMapRow[];
    if (!isLightMapMode) return mapRows;
    if (mapRows.length <= LIGHT_MODE_POINT_LIMIT) return mapRows;

    const selectedOrRadiusIds = new Set([...selectedAgendaIds, ...radiusResultIds]);
    const selectedOrRadiusRows: RenderableMapRow[] = [];
    const regularRows: RenderableMapRow[] = [];
    const bounds = mapViewport?.bounds ?? null;
    const south = bounds?.getSouth() ?? -90;
    const north = bounds?.getNorth() ?? 90;
    const west = bounds?.getWest() ?? -180;
    const east = bounds?.getEast() ?? 180;

    for (const row of mapRows) {
      const insideViewport =
        row.latitude >= south && row.latitude <= north && row.longitude >= west && row.longitude <= east;
      if (bounds && !insideViewport && !selectedOrRadiusIds.has(row.id)) {
        continue;
      }

      if (selectedOrRadiusIds.has(row.id)) {
        selectedOrRadiusRows.push(row);
      } else {
        regularRows.push(row);
      }

      if (selectedOrRadiusRows.length + regularRows.length >= LIGHT_MODE_POINT_LIMIT) break;
    }

    return [...selectedOrRadiusRows, ...regularRows];
  }, [isLightMapMode, mapRows, mapViewport, radiusResultIds, selectedAgendaIds, selectionMode]);

  const toggleBairroSelection = useCallback(
    (bairroKey: string) => {
      if (!bairroRowsByKey.has(bairroKey)) return;
      setSelectedBairroKeys((prev) =>
        prev.includes(bairroKey) ? prev.filter((item) => item !== bairroKey) : [...prev, bairroKey],
      );
    },
    [bairroRowsByKey],
  );

  const bairroGeoJsonStyle = useCallback(
    (feature?: Feature) => {
      const bairroKey = normalize(getFeatureName(feature, "Nome"));
      const group = bairroRowsByKey.get(bairroKey);
      const hasCompanies = Boolean(group?.rows.length);
      const isSelected = selectedBairroKeys.includes(bairroKey);

      if (selectionMode === "RAIO") {
        return {
          color: hasCompanies ? "#dc2626" : "#ef4444",
          weight: hasCompanies ? 1.2 : 1.05,
          opacity: hasCompanies ? 0.82 : 0.62,
          fillOpacity: 0,
        };
      }

      if (isSelected) {
        return {
          color: "#b91c1c",
          weight: 1.8,
          opacity: 0.95,
          fillColor: "#0f766e",
          fillOpacity: 0.62,
        };
      }

      if (hasCompanies) {
        return {
          color: "#dc2626",
          weight: 1.2,
          opacity: 0.82,
          fillColor: "#99f6e4",
          fillOpacity: 0.52,
        };
      }

      return {
        color: "#ef4444",
        weight: 1.05,
        opacity: 0.62,
        fillColor: "#ffffff",
        fillOpacity: 0.02,
      };
    },
    [bairroRowsByKey, selectedBairroKeys, selectionMode],
  );

  const cityGeoJsonStyle = useMemo(
    () => ({
      color: "#dc2626",
      weight: 1.15,
      opacity: 0.78,
      fillOpacity: 0,
    }),
    [],
  );

  const handleBairroFeature = useCallback(
    (feature: Feature | undefined, layer: L.Layer) => {
      if (showBairroLabels) {
        bindBairroLabel(feature, layer);
      }

      const bairroKey = normalize(getFeatureName(feature, "Nome"));
      if (!bairroRowsByKey.has(bairroKey) || !("on" in layer)) return;

      layer.on({
        click: () => {
          if (selectionMode !== "BAIRRO") return;
          toggleBairroSelection(bairroKey);
        },
      });
    },
    [bairroRowsByKey, selectionMode, showBairroLabels, toggleBairroSelection],
  );

  function RadiusClickHandler() {
    useMapEvents({
      click(e) {
        if (selectionMode !== "RAIO" || !radiusMode) return;
        const center = e.latlng;
        setRadiusCenter(center);

        const ids = computeIdsWithinRadius(mapRows, center, radiusKm);
        setRadiusResultIds(ids);

        setSelectedAgendaIds((prev) => {
          if (radiusReplaceSelection) return ids;
          const s = new Set(prev);
          ids.forEach((id) => s.add(id));
          return Array.from(s);
        });
      },
    });

    return null;
  }

  function MapViewportHandler() {
    const map = useMapEvents({
      moveend() {
        updateMapViewport(map.getBounds(), map.getZoom());
      },
      zoomend() {
        updateMapViewport(map.getBounds(), map.getZoom());
      },
    });

    useEffect(() => {
      updateMapViewport(map.getBounds(), map.getZoom());
    }, [map, updateMapViewport]);

    return null;
  }

  if (!canGenerate) {
    return (
      <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
        Este modulo e restrito a supervisao e assistencia.
      </div>
    );
  }

  const toggleAgenda = (id: string) => {
    if (selectionMode === "BAIRRO") {
      if (!selectedBairroAgendaIds.includes(id)) return;
      setExcludedBairroAgendaIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
      return;
    }

    setSelectedAgendaIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleVendor = (id: string) =>
    setSelectedVendorIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const resetCompanyListHeight = useCallback(() => {
    setCompanyListHeight(256);
  }, []);

  const startCompanyListResize = useCallback((startClientY: number) => {
    const startHeight = companyListHeight;

    const handlePointerMove = (event: MouseEvent) => {
      const deltaY = event.clientY - startClientY;
      setCompanyListHeight(clampCompanyListHeight(startHeight + deltaY));
    };

    const stopResize = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", stopResize);
    };

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", stopResize);
  }, [companyListHeight]);

  const handleGeocode = async () => {
    if (geocoding || missingAll.length === 0) return;

    setGeocoding(true);
    setMessage("Geocodificando empresas sem coordenadas...");

    const next = [...agendaRows];
    const nextById = new Map(next.map((row, index) => [row.id, index] as const));
    let ok = 0,
      skip = 0,
      fail = 0;
    const failReasons: string[] = [];
    const grouped = new Map<
      string,
      {
        rows: AgendaLookupRow[];
        city: string;
        uf: string;
        bairro: string;
        roads: string[];
      }
    >();

    for (const r of missingAll) {
      const city = compact(r.cidade);
      const uf = compact(r.uf);
      const bairro = compact(r.bairro);
      const roadPrimary = compact([r.endereco, r.complemento].filter(Boolean).join(", "));
      const roadSecondary = compact(r.endereco);
      const roads = Array.from(new Set([roadPrimary, roadSecondary].filter(Boolean)));

      if (!city || !uf || roads.length === 0) {
        skip += 1;
        continue;
      }

      const key = `${normalize(roads[0])}|${normalize(city)}|${normalize(uf)}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.rows.push(r);
        roads.forEach((road) => {
          if (!existing.roads.includes(road)) existing.roads.push(road);
        });
      } else {
        grouped.set(key, { rows: [r], city, uf, bairro, roads });
      }
    }

    const uniqueGroups = Array.from(grouped.values());
    const processGroups = uniqueGroups.slice(0, MAX_GEOCODE_UNIQUE_ADDRESSES_PER_RUN);
    const postponed = uniqueGroups.length - processGroups.length;

    for (const group of processGroups) {
      try {
        let g = null as Awaited<ReturnType<typeof fetchNominatimCoordinatesByAddress>>;
        for (const road of group.roads) {
          g = await fetchNominatimCoordinatesByAddress(road, group.city, group.uf);
          if (g) break;
        }

        if (!g && group.bairro) {
          g = await fetchNominatimCoordinatesByQuery(`${group.bairro}, ${group.city}, ${group.uf}, Brasil`);
        }

        if (!g) {
          fail += group.rows.length;
          if (failReasons.length < 4) {
            const sample = group.rows[0];
            const label = (sample?.empresa ?? sample?.nome_fantasia ?? sample?.id ?? "endereco").slice(0, 45);
            failReasons.push(`${label}: sem retorno do geocodificador`);
          }
          continue;
        }

        const ids = group.rows.map((row) => row.id);
        await updateAgendaCoordinatesBatch({
          ids,
          latitude: g.latitude,
          longitude: g.longitude,
          geocode_source: "nominatim",
        });

        ids.forEach((id) => {
          const idx = nextById.get(id);
          if (idx === undefined) return;
          next[idx] = { ...next[idx], latitude: g.latitude, longitude: g.longitude };
        });
        ok += ids.length;
      } catch (e) {
        fail += group.rows.length;
        if (failReasons.length < 4) {
          const sample = group.rows[0];
          const label = (sample?.empresa ?? sample?.nome_fantasia ?? sample?.id ?? "endereco").slice(0, 45);
          failReasons.push(`${label}: ${e instanceof Error ? e.message : "falha desconhecida"}`);
        }
      }
    }

    setAgendaRows(next);
    setGeocoding(false);

    const postponedText =
      postponed > 0
        ? ` Restam ${postponed} endereco(s) unico(s) para o proximo lote.`
        : "";
    const reasonText = failReasons.length ? ` Erros: ${failReasons.join(" | ")}` : "";
    setMessage(
      `Geocodificacao concluida. Atualizadas: ${ok}, sem endereco: ${skip}, falhas: ${fail}.${postponedText}${reasonText}`,
    );
  };

  const handleGenerate = async () => {
    const selVendors = vendedores.filter((v) => selectedVendorIds.includes(v.user_id));
    if (selVendors.length === 0) return setMessage("Selecione pelo menos um vendedor para gerar visitas.");
    if (effectiveSelectedAgendaIds.length === 0) return setMessage("Selecione pelo menos uma empresa para gerar visitas.");
    if (!visitDate) return setMessage("Selecione a data da visita.");

    setGenerating(true);
    setMessage(null);

    try {
      const rows = await fetchAgendaForGeneration(filters, effectiveSelectedAgendaIds);
      if (rows.length === 0) return setMessage("Nenhum registro encontrado para gerar visitas.");

      const chunkSize = 500;
      const agendaIds = rows.map((r) => r.id);
      const base = new Date(`${visitDate}T12:00:00`);
      const display = new Intl.DateTimeFormat("pt-BR").format(base);

      const vendorNames = Array.from(
        new Set(selVendors.map((v) => (v.display_name ?? v.user_id).trim()).filter(Boolean)),
      ).join(", ");

      const supNames = Array.from(
        new Set(selVendors.map((v) => (supByVendor.get(v.user_id) ?? "").trim()).filter(Boolean)),
      ).join(", ");

      for (const v of selVendors) {
        const { data: route, error: re } = await supabase
          .from("routes")
          .insert({
            name: `Visitas ${display} - ${v.display_name ?? "Vendedor"}`,
            date: visitDate,
            assigned_to_user_id: v.user_id,
            created_by: session?.user.id ?? null,
          })
          .select("id")
          .single();

        if (re || !route) throw new Error(re?.message ?? "Erro ao criar rota de visitas.");

        const stops = rows.map((r, i) => ({ route_id: route.id, agenda_id: r.id, stop_order: i + 1 }));
        for (let i = 0; i < stops.length; i += chunkSize) {
          const { error } = await supabase.from("route_stops").insert(stops.slice(i, i + chunkSize));
          if (error) throw new Error(error.message);
        }

        const visits = rows.map((r) => ({
          agenda_id: r.id,
          assigned_to_user_id: v.user_id,
          assigned_to_name: v.display_name ?? v.user_id,
          visit_date: visitDate,
          perfil_visita: r.perfil_visita ?? null,
          instructions: r.instructions?.trim() || null,
          route_id: route.id,
          created_by: session?.user.id ?? null,
        }));

        for (let i = 0; i < visits.length; i += chunkSize) {
          const { error } = await supabase
            .from("visits")
            .upsert(visits.slice(i, i + chunkSize), {
              onConflict: "agenda_id,assigned_to_user_id,visit_date",
              ignoreDuplicates: true,
            });
          if (error) throw new Error(error.message);
        }
      }

      for (let i = 0; i < agendaIds.length; i += chunkSize) {
        const ids = agendaIds.slice(i, i + chunkSize);

        const { error: e1 } = await supabase
          .from("agenda")
          .update({ visit_generated_at: base.toISOString() })
          .in("id", ids)
          .is("visit_generated_at", null);
        if (e1) throw new Error(e1.message);

        const { error: e2 } = await supabase
          .from("agenda")
          .update({ vendedor: vendorNames || null, supervisor: supNames || null })
          .in("id", ids);
        if (e2) throw new Error(e2.message);
      }

      setMessage(
        `Geradas ${rows.length * selVendors.length} visitas (${rows.length} empresa(s)) para ${selVendors.length} vendedor(es).`,
      );

      setSelectedAgendaIds([]);
      setSelectedBairroKeys([]);
      setSelectedVendorIds([]);
      setVendorQuery("");
      setVisitDate("");
      setShowGenerateModal(false);

      setRadiusResultIds([]);
      setRadiusCenter(null);
      setRadiusMode(false);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao gerar visitas.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="rounded-3xl border border-sea/15 bg-white/95 p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="mt-1 font-display text-2xl text-ink">Rotas</h2>
            <p className="mt-2 max-w-2xl text-sm text-ink/65">Modo mapa</p>
          </div>
          <a
            href="/agenda"
            className="inline-flex items-center gap-2 rounded-lg border border-sea/25 bg-sand/30 px-3 py-2 text-xs font-semibold text-ink hover:border-sea"
          >
            <ExternalLink size={14} />
            Voltar ao modulo rotas
          </a>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[30%_70%] lg:items-stretch">
        <div className="rounded-2xl border border-sea/20 bg-sand/30 p-4">
          <div className="flex flex-col gap-4">
            {/* Busca global */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-ink/70">Busca global</label>
              <input
                value={globalQuery}
                onChange={(e) => {
                  typingGlobalRef.current = true;
                  setGlobalQuery(e.target.value);
                }}
                placeholder="Empresa, cidade, vendedor..."
                className="w-full rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-sm outline-none focus:border-sea"
              />
            </div>

            {/* Ultima visita */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-ink/70">Ultima visita</label>

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={filters.dateRanges.data_da_ultima_visita.from ?? ""}
                  onChange={(e) =>
                    setFilters((p) => ({
                      ...p,
                      dateRanges: {
                        ...p.dateRanges,
                        data_da_ultima_visita: {
                          ...p.dateRanges.data_da_ultima_visita,
                          from: e.target.value || undefined,
                          month: undefined,
                          year: undefined,
                        },
                      },
                    }))
                  }
                  className="min-w-0 flex-1 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                />
                <span className="text-xs text-ink/50">ate</span>
                <input
                  type="date"
                  value={filters.dateRanges.data_da_ultima_visita.to ?? ""}
                  onChange={(e) =>
                    setFilters((p) => ({
                      ...p,
                      dateRanges: {
                        ...p.dateRanges,
                        data_da_ultima_visita: {
                          ...p.dateRanges.data_da_ultima_visita,
                          to: e.target.value || undefined,
                          month: undefined,
                          year: undefined,
                        },
                      },
                    }))
                  }
                  className="min-w-0 flex-1 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-ink/50">ou</span>
                <select
                  value={filters.dateRanges.data_da_ultima_visita.month ?? ""}
                  onChange={(e) =>
                    setFilters((p) => ({
                      ...p,
                      dateRanges: {
                        ...p.dateRanges,
                        data_da_ultima_visita: {
                          ...p.dateRanges.data_da_ultima_visita,
                          month: e.target.value || undefined,
                          year:
                            e.target.value && !p.dateRanges.data_da_ultima_visita.year
                              ? String(new Date().getFullYear())
                              : p.dateRanges.data_da_ultima_visita.year,
                          from: undefined,
                          to: undefined,
                        },
                      },
                    }))
                  }
                  className="min-w-[110px] rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                >
                  <option value="">Mes</option>
                  {MONTH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="Ano"
                  value={filters.dateRanges.data_da_ultima_visita.year ?? ""}
                  onChange={(e) =>
                    setFilters((p) => ({
                      ...p,
                      dateRanges: {
                        ...p.dateRanges,
                        data_da_ultima_visita: {
                          ...p.dateRanges.data_da_ultima_visita,
                          year: e.target.value || undefined,
                          from: undefined,
                          to: undefined,
                        },
                      },
                    }))
                  }
                  className="w-24 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                />

                <label className="flex items-center gap-2 text-[11px] font-semibold text-ink/60">
                  <button
                    type="button"
                    onClick={() =>
                      setFilters((p) => ({
                        ...p,
                        dateRanges: {
                          ...p.dateRanges,
                          data_da_ultima_visita: {
                            ...p.dateRanges.data_da_ultima_visita,
                            invert: !p.dateRanges.data_da_ultima_visita.invert,
                          },
                        },
                      }))
                    }
                    className={[
                      "inline-flex h-6 w-6 items-center justify-center rounded-md border transition",
                      filters.dateRanges.data_da_ultima_visita.invert
                        ? "border-sea bg-sea/10 text-sea"
                        : "border-sea/30 bg-white text-ink/50 hover:border-sea hover:text-sea",
                    ].join(" ")}
                  >
                    <SquareCenterlineDashedHorizontal size={14} />
                  </button>
                  Inverter
                </label>
              </div>
            </div>

            {/* Vidas ultima visita */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-ink/70">Vidas ultima visita</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={filters.ranges.vidas_ultima_visita.from ?? ""}
                  onChange={(e) => {
                    const v = normalizeNumberInput(e.target.value);
                    setFilters((p) => ({
                      ...p,
                      ranges: {
                        ...p.ranges,
                        vidas_ultima_visita: { ...p.ranges.vidas_ultima_visita, from: v || undefined },
                      },
                    }));
                  }}
                  placeholder="De"
                  className="w-24 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                />
                <span className="text-xs text-ink/50">ate</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={filters.ranges.vidas_ultima_visita.to ?? ""}
                  onChange={(e) => {
                    const v = normalizeNumberInput(e.target.value);
                    setFilters((p) => ({
                      ...p,
                      ranges: {
                        ...p.ranges,
                        vidas_ultima_visita: { ...p.ranges.vidas_ultima_visita, to: v || undefined },
                      },
                    }));
                  }}
                  placeholder="Ate"
                  className="w-24 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                />
              </div>
            </div>

            {/* Seleção por raio */}
            <div className="rounded-xl border border-sea/20 bg-white/75 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-ink/70">Selecao espacial</h3>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectionMode("RAIO")}
                  className={[
                    "rounded-lg border px-3 py-2 text-xs font-semibold transition",
                    selectionMode === "RAIO"
                      ? "border-sea bg-sea/10 text-sea"
                      : "border-sea/30 bg-white/80 text-ink/70 hover:border-sea hover:text-sea",
                  ].join(" ")}
                >
                  Selecao por raio
                </button>
                <button
                  type="button"
                  onClick={() => setSelectionMode("BAIRRO")}
                  className={[
                    "rounded-lg border px-3 py-2 text-xs font-semibold transition",
                    selectionMode === "BAIRRO"
                      ? "border-sea bg-sea/10 text-sea"
                      : "border-sea/30 bg-white/80 text-ink/70 hover:border-sea hover:text-sea",
                  ].join(" ")}
                >
                  Selecao por bairro
                </button>
              </div>

              {selectionMode === "RAIO" && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value) as 0.5 | 1 | 3 | 5 | 10)}
                  className="min-w-[120px] rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                >
                  <option value={0.5}>500 m</option>
                  <option value={1}>1 km</option>
                  <option value={3}>3 km</option>
                  <option value={5}>5 km</option>
                  <option value={10}>10 km</option>
                </select>

                <button
                  type="button"
                  onClick={() => setRadiusMode((p) => !p)}
                  className={[
                    "rounded-lg border px-3 py-2 text-xs font-semibold transition",
                    radiusMode
                      ? "border-sea bg-sea/10 text-sea"
                      : "border-sea/30 bg-white/80 text-ink/70 hover:border-sea hover:text-sea",
                  ].join(" ")}
                  title="Ative e clique no mapa para selecionar clientes no raio"
                >
                  {radiusMode ? "Modo raio: ON" : "Modo raio: OFF"}
                </button>

                <label className="ml-auto flex items-center gap-2 text-[11px] font-semibold text-ink/60 hidden">
                  <input
                    type="checkbox"
                    checked={radiusReplaceSelection}
                    onChange={(e) => setRadiusReplaceSelection(e.target.checked)}
                    className="h-4 w-4 accent-sea"
                  />
                  Substituir seleção
                </label>
              </div>
              )}

              {selectionMode === "RAIO" && <p className="mt-2 text-[11px] text-ink/60">
                {radiusMode ? "Clique no mapa para selecionar." : "Ative o modo raio para clicar no mapa."}
              </p>}

              {selectionMode === "RAIO" && radiusCenter && (
                <p className="mt-2 text-[11px] text-ink/60">
                  Centro: {radiusCenter.lat.toFixed(5)}, {radiusCenter.lng.toFixed(5)} • Encontrados:{" "}
                  {radiusRows.length}
                </p>
              )}


              {selectionMode === "BAIRRO" && (
                <>
                  <p className="mt-3 text-[11px] text-ink/60">
                    Clique nos bairros do mapa. Onde houver empresa o bairro fica pintado; ao selecionar, todas as
                    empresas daquele bairro entram na geracao.
                  </p>
                  <div className="mt-3 flex items-center justify-between rounded-lg border border-sea/15 bg-white/90 px-3 py-2 text-[11px] text-ink/60">
                    <span>Bairros com empresas: {bairroRowsByKey.size}</span>
                    <span>
                      Bairros selecionados: {selectedBairroKeys.length} • Empresas: {effectiveSelectedAgendaIds.length}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Filtros de colunas */}
            <div className="rounded-xl border border-sea/20 bg-white/75 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-ink/70">Filtros de colunas</h3>
              <div className="mt-3 grid gap-2">
                {Object.keys(FILTER_SOURCES).map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-lg border border-sea/15 bg-white/90 px-2 py-2"
                  >
                    <span className="text-xs font-semibold text-ink/70">{FILTER_LABELS[key] ?? key}</span>
                    <MultiSelectFilter
                      label={FILTER_LABELS[key] ?? key}
                      options={filterOptions[key] ?? []}
                      value={filters.columns[key] ?? []}
                      onApply={(next) =>
                        setFilters((prev) => ({
                          ...prev,
                          columns: { ...prev.columns, [key]: next },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Botões */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setMessage(null);
                  setShowGenerateModal(true);
                }}
                disabled={rowsMatchingFilters.length === 0}
                className="inline-flex items-center gap-1 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                <MapPin size={14} />
                Gerar rota
              </button>

              <button
                type="button"
                onClick={() => setShowGeocodeConfirm(true)}
                disabled={geocoding || missingAll.length === 0}
                title={geocoding ? "Geocodificando..." : `Geocodificar sem ponto (${missingAll.length})`}
                aria-label={geocoding ? "Geocodificando sem ponto" : `Geocodificar sem ponto (${missingAll.length})`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-sea/30 bg-white/80 text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
              >
                {geocoding ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              </button>

              <button
                type="button"
                onClick={clearFilters}
                className="rounded-lg border border-sea/30 bg-white/80 px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Limpar filtros
              </button>

              <div className="ml-auto text-right text-xs text-ink/60">
                <div>Empresas: {rowsMatchingFilters.length}</div>
                {missingFromFiltersCount > 0 && <div>Sem coordenada real: {missingFromFiltersCount}</div>}
                <div>Selecionadas: {effectiveSelectedAgendaIds.length}</div>
              </div>
            </div>
          </div>
        </div>

        {/* MAPA */}
        <div className="rounded-2xl border border-sea/15 bg-white/92 p-3 sm:p-4">
          <div className="mb-3">
            <h3 className="text-base font-semibold text-ink">Mapa de empresas</h3>
            <p className="text-xs text-ink/60">Passe o mouse para ver informações da empresas.</p>
          </div>

          <div className="overflow-hidden rounded-xl border border-sea/15">
            <MapContainer
              center={RMF_CENTER}
              zoom={10}
              minZoom={6}
              maxZoom={16}
              maxBounds={CEARA_BOUNDS}
              maxBoundsViscosity={0.8}
              preferCanvas
              zoomAnimation={!isLightMapMode}
              fadeAnimation={!isLightMapMode}
              markerZoomAnimation={!isLightMapMode}
              className="routes-map h-[58vh] min-h-[380px] w-full lg:h-[72vh]"
            >
              {showBaseMap && (
                <>
                  <TileLayer
                    attribution='&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noreferrer">Stadia Maps</a> &copy; <a href="https://stamen.com/" target="_blank" rel="noreferrer">Stamen Design</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
                    className="routes-map-toner-base"
                    url="https://tiles.stadiamaps.com/tiles/stamen_toner_background/{z}/{x}/{y}{r}.png"
                  />
                  <TileLayer
                    attribution=""
                    className="routes-map-toner-lines"
                    url="https://tiles.stadiamaps.com/tiles/stamen_toner_lines/{z}/{x}/{y}{r}.png"
                    opacity={0.9}
                  />
                </>
              )}

              <RadiusClickHandler />
              <MapViewportHandler />

              {selectionMode === "RAIO" && radiusCenter && (
                <Circle
                  center={radiusCenter}
                  radius={radiusKm * 1000}
                  pathOptions={{ color: "#0f766e", weight: 2, fillOpacity: 0.08 }}
                />
              )}

              {!isLightMapMode && (
                <Pane name="admin-boundaries" style={{ zIndex: 470 }}>
                  {CEARA_CITIES_GEOJSON && (
                    <GeoJSON
                      data={CEARA_CITIES_GEOJSON}
                      style={cityGeoJsonStyle}
                      interactive={false}
                    />
                  )}
                </Pane>
              )}

              <Pane name="bairro-boundaries" style={{ zIndex: 475 }}>
                {FORTALEZA_BAIRROS_GEOJSON && (
                  <GeoJSON
                    key={`bairro-layer-${selectionMode}-${showBairroLabels ? "labels" : "nolabels"}`}
                    data={FORTALEZA_BAIRROS_GEOJSON}
                    onEachFeature={handleBairroFeature}
                    style={bairroGeoJsonStyle}
                    interactive
                  />
                )}
              </Pane>

              {rowsToRender.map((r) => {
                const sel = effectiveSelSet.has(r.id);
                const markerColor = r.isApproximatePoint ? "#f59e0b" : "#0f766e";
                const markerBorderColor = r.isApproximatePoint ? "#b45309" : "#0b5b4f";
                return (
                  <CircleMarker
                    key={r.id}
                    center={[r.latitude, r.longitude]}
                    radius={sel ? 8 : 6}
                    pathOptions={{
                      color: sel ? "#0f766e" : markerBorderColor,
                      fillColor: sel ? "#14b8a6" : markerColor,
                      fillOpacity: sel ? 0.6 : 0.45,
                      weight: sel ? 2.2 : 1.4,
                    }}
                    eventHandlers={{ click: () => toggleAgenda(r.id) }}
                  >
                    <Tooltip direction="right" offset={[12, -4]} opacity={0.98} sticky className="routes-map-tooltip">
                      {isLightMapMode ? (
                        <div className="w-[260px] max-w-[260px] space-y-1 text-xs [overflow-wrap:anywhere]">
                          <p className="font-semibold text-ink">{r.empresa ?? r.nome_fantasia ?? "-"}</p>
                          <p className="text-ink/70">COD: {r.cod_1 ?? "-"}</p>
                          <p className="text-ink/70">
                            {r.bairro ?? "-"} • {r.cidade ?? "-"}
                          </p>
                          <p className="text-ink/60">ULTIMA VISITA: {fmtDate(r.data_da_ultima_visita)}</p>
                          {r.isApproximatePoint && <p className="text-amber-700">PONTO APROXIMADO</p>}
                        </div>
                      ) : (
                        <div className="w-[320px] max-w-[320px] space-y-1 text-xs [overflow-wrap:anywhere]">
                          <p className="font-semibold text-ink">
                            OBS:{" "}
                            {r.data_da_ultima_visita ? fmtDate(r.data_da_ultima_visita) : r.obs_contrato_1 ?? "-"}
                          </p>
                          <p className="text-ink/70">ULTIMA VISITA: {fmtDate(r.data_da_ultima_visita)}</p>
                          <p className="text-ink/70">VIDAS ULTIMA VISITA: {r.visit_completed_vidas ?? "-"}</p>
                          <p className="text-ink/70">CODIGO: {r.cod_1 ?? "-"}</p>
                          <p className="text-ink/70">EMPRESA: {r.empresa ?? r.nome_fantasia ?? "-"}</p>
                          <p className="text-ink/70">BAIRRO: {r.bairro ?? "-"}</p>
                          <p className="text-ink/70">CIDADE: {r.cidade ?? "-"}</p>
                          <p className="text-ink/70">VENDEDOR: {r.vendedor ?? "-"}</p>
                          <p className="text-ink/70">GRUPO: {r.grupo ?? "-"}</p>
                          <p className="text-ink/70">PERFIL VISITA: {r.perfil_visita ?? "-"}</p>
                          {r.isApproximatePoint && <p className="text-amber-700">PONTO APROXIMADO (bairro/cidade)</p>}
                          <p className="break-words whitespace-normal text-ink/60">ENDERECO: {addr(r) || "-"}</p>
                          <p className="break-words whitespace-normal text-ink/60">
                            LAT/LNG: {r.latitude.toFixed(6)}, {r.longitude.toFixed(6)}
                            {r.isApproximatePoint ? " (aprox.)" : ""}
                          </p>
                        </div>
                      )}
                    </Tooltip>

                    {!isLightMapMode && (
                      <Popup>
                        <div className="space-y-2 text-xs">
                          <p className="font-semibold text-ink">{r.empresa ?? r.nome_fantasia ?? "Empresa"}</p>
                          <p className="text-ink/70">{addr(r) || "Endereco nao informado"}</p>
                          <button
                            type="button"
                            onClick={() => toggleAgenda(r.id)}
                            className="inline-flex items-center gap-1 rounded border border-sea/30 px-2 py-1 text-[11px] font-semibold text-ink"
                          >
                            {sel ? <Check size={12} /> : <Plus size={12} />}
                            {sel ? "Remover selecao" : "Selecionar"}
                          </button>
                        </div>
                      </Popup>
                    )}
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>

          <div className="mt-4 rounded-xl border border-sea/15 bg-white/90 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-ink/70">
                  {selectionMode === "RAIO" ? "Empresas no raio" : "Empresas por bairro"}
                </h3>
                <p className="mt-1 text-[11px] text-ink/60">
                  {selectionMode === "RAIO"
                    ? radiusCenter
                      ? "Revise as empresas encontradas no raio selecionado."
                      : "A lista aparece aqui depois que voce clicar no mapa."
                    : selectedBairroKeys.length > 0
                      ? "Revise as empresas dos bairros selecionados."
                      : "A lista aparece aqui depois que voce selecionar um ou mais bairros."}
                </p>
              </div>

              {selectionMode === "RAIO" && radiusCenter && (
                <button
                  type="button"
                  onClick={() => {
                    setRadiusCenter(null);
                    setRadiusResultIds([]);
                  }}
                  className="rounded-lg border border-sea/30 bg-white/80 px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
                >
                  Limpar raio
                </button>
              )}

              {selectionMode === "BAIRRO" && (
                <button
                  type="button"
                  onClick={() => setSelectedBairroKeys([])}
                  disabled={selectedBairroKeys.length === 0}
                  className="rounded-lg border border-sea/30 bg-white/80 px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-50"
                >
                  Limpar bairros
                </button>
              )}
            </div>

            {selectionMode === "RAIO" && radiusRows.length > 0 && (
              <div
                className="mt-3 grid grid-cols-1 gap-2 overflow-auto rounded-lg border border-sea/15 bg-white/90 p-2 lg:grid-cols-2"
                style={{ height: `${companyListHeight}px` }}
              >
                {radiusRows.map((r) => {
                  const checked = effectiveSelSet.has(r.id);
                  return (
                    <label
                      key={r.id}
                      className="flex h-full cursor-pointer items-start justify-between gap-2 rounded-md border border-sea/10 bg-white px-2 py-2 hover:bg-sea/10"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-ink">
                          {r.empresa ?? r.nome_fantasia ?? "Empresa"}
                        </p>
                        <p className="truncate text-[11px] text-ink/60">{addr(r) || "-"}</p>
                        <p className="truncate text-[11px] text-ink/60">
                          COD: {r.cod_1 ?? "-"} • Bairro: {r.bairro ?? "-"}
                        </p>
                      </div>

                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAgenda(r.id)}
                        className="mt-1 h-4 w-4 shrink-0 accent-sea"
                      />
                    </label>
                  );
                })}
              </div>
            )}

            {selectionMode === "BAIRRO" && selectedBairroKeys.length > 0 && (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedBairroKeys.map((bairroKey) => {
                    const group = bairroRowsByKey.get(bairroKey);
                    if (!group) return null;
                    return (
                      <button
                        key={bairroKey}
                        type="button"
                        onClick={() => toggleBairroSelection(bairroKey)}
                        className="rounded-full border border-sea/25 bg-sea/10 px-3 py-1 text-[11px] font-semibold text-sea hover:border-sea"
                      >
                        {group.name} ({group.rows.length})
                      </button>
                    );
                  })}
                </div>

                <div
                  className="mt-3 grid grid-cols-1 gap-2 overflow-auto rounded-lg border border-sea/15 bg-white/90 p-2 lg:grid-cols-2"
                  style={{ height: `${companyListHeight}px` }}
                >
                  {selectedBairroCompanyRows.map((r) => {
                    const checked = effectiveSelSet.has(r.id);
                    return (
                      <label
                        key={r.id}
                        className="flex h-full cursor-pointer items-start justify-between gap-2 rounded-md border border-sea/10 bg-white px-2 py-2 hover:bg-sea/10"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-ink">
                            {r.empresa ?? r.nome_fantasia ?? "Empresa"}
                          </p>
                          <p className="truncate text-[11px] text-ink/60">{addr(r) || "-"}</p>
                          <p className="truncate text-[11px] text-ink/60">
                            COD: {r.cod_1 ?? "-"} • Bairro: {r.bairro ?? "-"}
                          </p>
                        </div>

                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAgenda(r.id)}
                          className="mt-1 h-4 w-4 shrink-0 accent-sea"
                        />
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            {((selectionMode === "RAIO" && radiusRows.length > 0) ||
              (selectionMode === "BAIRRO" && selectedBairroKeys.length > 0)) && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    startCompanyListResize(event.clientY);
                  }}
                  onDoubleClick={resetCompanyListHeight}
                  className="hidden cursor-row-resize rounded-full px-6 py-2 lg:flex"
                  aria-label="Redimensionar lista de empresas"
                  title="Clique e arraste para aumentar ou diminuir a lista"
                >
                  <span className="h-1.5 w-24 rounded-full bg-sea/25 transition hover:bg-sea" />
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* MODAL GERAR VISITAS */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => (generating ? null : setShowGenerateModal(false))}
          />
          <div className="relative w-full max-w-lg rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Gerar visitas</h3>
            <p className="mt-1 text-xs text-ink/60">
              Selecione os vendedores, a data e as empresas marcadas no mapa para gerar as visitas.
            </p>
            <p className="mt-2 text-xs text-ink/60">Empresas selecionadas: {effectiveSelectedAgendaIds.length}</p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-2 text-xs font-semibold text-ink/70">
                Vendedores destino
                <div className="rounded-xl border border-sea/20 bg-white/90 p-3">
                  <input
                    value={vendorQuery}
                    onChange={(e) => setVendorQuery(e.target.value)}
                    placeholder="Buscar vendedor..."
                    className="w-full rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                  />

                  <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                    {filteredVendedores.length === 0 ? (
                      <p className="text-xs text-ink/60">Nenhum vendedor encontrado.</p>
                    ) : (
                      filteredVendedores.map((v) => {
                        const ck = selectedVendorIds.includes(v.user_id);
                        return (
                          <label
                            key={v.user_id}
                            className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1 text-xs text-ink hover:bg-sea/10"
                          >
                            <span>{v.display_name ?? v.user_id}</span>
                            <input
                              type="checkbox"
                              checked={ck}
                              onChange={() => toggleVendor(v.user_id)}
                              className="h-4 w-4 accent-sea"
                            />
                          </label>
                        );
                      })
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-ink/60">
                    <button
                      type="button"
                      className="text-sea"
                      onClick={() => setSelectedVendorIds(vendedores.map((v) => v.user_id))}
                    >
                      Selecionar todos
                    </button>
                    <button type="button" onClick={() => setSelectedVendorIds([])}>
                      Limpar
                    </button>
                  </div>

                  <p className="mt-2 text-[11px] text-ink/60">Selecionados: {selectedVendorIds.length}</p>
                </div>
              </div>

              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                Data da visita
                <input
                  type="date"
                  value={visitDate}
                  onChange={(e) => setVisitDate(e.target.value)}
                  className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                />
              </label>
            </div>

            {message && <p className="mt-3 text-xs text-ink/70">{message}</p>}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowGenerateModal(false)}
                disabled={generating}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleGenerate}
                disabled={
                  selectedVendorIds.length === 0 ||
                  effectiveSelectedAgendaIds.length === 0 ||
                  !visitDate ||
                  generating ||
                  rowsMatchingFilters.length === 0
                }
                className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {generating ? "Gerando..." : `Confirmar (${effectiveSelectedAgendaIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMAR GEOCODE */}
      {showGeocodeConfirm && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => (geocoding ? null : setShowGeocodeConfirm(false))}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-sea/20 bg-white p-5 shadow-card">
            <h3 className="font-display text-lg text-ink">Sincronizar coordenadas</h3>
            <p className="mt-2 text-xs text-ink/70">Esta sincronizacao deve ser feita apenas se houver necessidade.</p>
            <p className="mt-2 text-xs text-ink/60">Empresas sem ponto atualmente: {missingAll.length}</p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowGeocodeConfirm(false)}
                disabled={geocoding}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={async () => {
                  setShowGeocodeConfirm(false);
                  await handleGeocode();
                }}
                disabled={geocoding || missingAll.length === 0}
                className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {message && !showGenerateModal && (
        <footer className="rounded-2xl border border-sea/15 bg-white/92 p-4 text-xs text-ink/70">{message}</footer>
      )}
    </div>
  );
}
