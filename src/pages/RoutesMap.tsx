import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  MapPin,
  Plus,
  SquareCenterlineDashedHorizontal,
  X,
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
  fetchEmpresaScheduledVisits,
  fetchEmpresasLookupCountExact,
  fetchEmpresasLookupByIds,
  fetchEmpresasLookup,
  fetchSupervisorLatestVisitByEmpresa,
  type EmpresaScheduledVisit,
  type EmpresaLookupRow,
} from "../lib/routesApi";
import { onProfilesUpdated } from "../lib/profileEvents";
import { useAgendaFilters } from "../hooks/useAgendaFilters";
import {
  fetchDistinctOptions,
  fetchSupervisores,
  fetchVendedores,
} from "../lib/agendaApi";
import { supabase } from "../lib/supabase";
import { formatDateBr } from "../lib/dateFormat";
import { fetchRouteEventsByDate, type RouteEventRow } from "../lib/routeEventsApi";
import {
  clearRoutesModuleDraft,
  readRoutesModuleDraft,
  writeRoutesModuleDraft,
} from "../lib/routesModuleDraft";
import { normalizeSearchText, normalizeText } from "../lib/textNormalize";
import MultiSelectFilter from "../components/agenda/MultiSelectFilter";
import CategoriaLegendPopover from "../components/agenda/CategoriaLegendPopover";
import cearaCitiesRaw from "../data/ceara_municipios.geojson?raw";
import fortalezaBairrosRaw from "../data/fortaleza_bairros.geojson?raw";
import { CATEGORIA_OPTIONS } from "../lib/categorias";
import type { AgendaFilters } from "../types/agenda";
import {
  SUPERVISOR_VISIT_REASON_OPTIONS,
  VISIT_TYPE,
  getSupervisorEmpresaFlagMeta,
  type SupervisorVisitReason,
} from "../lib/supervisorVisits";

const RMF_CENTER: [number, number] = [-3.86, -38.62];
const CEARA_BOUNDS: [[number, number], [number, number]] = [
  [-8.1, -41.5],
  [-2.7, -37.2],
];

const CEARA_CITIES_GEOJSON = JSON.parse(cearaCitiesRaw) as GeoJsonObject;
const FORTALEZA_BAIRROS_GEOJSON = JSON.parse(fortalezaBairrosRaw) as GeoJsonObject;
const LIGHT_MODE_POINT_LIMIT = 3000;
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
  cod_1: ["codigo"],
  empresa_nome: ["empresa"],
  bairro: ["bairro"],
  cidade: ["cidade"],
  vendedor: ["vendedor"],
  grupo: ["grupo"],
  perfil_visita: ["perfil_visita"],
  categoria: ["categoria"],
};

const FILTER_LABELS: Record<string, string> = {
  cod_1: "Codigo",
  empresa_nome: "Empresa",
  bairro: "Bairro",
  cidade: "Cidade",
  vendedor: "Vendedor",
  grupo: "Grupo",
  perfil_visita: "Perfil visita",
  categoria: "Categoria",
};

const SUPERVISOR_FLAG_FILTER_OPTIONS = [
  { value: "VERDE", label: "🟢 0-90 dias" },
  { value: "AMARELO", label: "🟡 91-180 dias" },
  { value: "VERMELHO", label: "🔴 >180 dias" },
  { value: "CINZA", label: "⚪ Sem historico" },
] as const;
type SupervisorFlagFilterValue = (typeof SUPERVISOR_FLAG_FILTER_OPTIONS)[number]["value"];
const getSupervisorFlagOptionLabel = (value: string) =>
  SUPERVISOR_FLAG_FILTER_OPTIONS.find((option) => option.value === value)?.label ?? value;
const getSupervisorFlagOptionValue = (label: string) =>
  (SUPERVISOR_FLAG_FILTER_OPTIONS.find((option) => option.label === label)?.value ??
    null) as SupervisorFlagFilterValue | null;

const formatRouteEventType = (eventType: RouteEventRow["event_type"]) =>
  eventType === "REUNIAO" ? "REUNIÃO" : "TREINAMENTO";

const normalize = (v: string | null | undefined) =>
  normalizeText(v, { letterCase: "upper" });
const isInactiveCompanyStatus = (v: string | null | undefined) =>
  Boolean(normalizeText(v, { letterCase: "upper" })) &&
  normalizeText(v, { letterCase: "upper" }) !== "ATIVO";

const normalizeNumberInput = (v: string) => v.replace(/\D/g, "");
const compact = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

const fmtDate = (v: string | null) => formatDateBr(v);
const getSupervisorFlagDotStyles = (color: "CINZA" | "VERDE" | "AMARELO" | "VERMELHO") => {
  if (color === "VERDE") return "border-emerald-300 bg-emerald-500";
  if (color === "AMARELO") return "border-amber-300 bg-amber-500";
  if (color === "VERMELHO") return "border-red-300 bg-red-500";
  return "border-slate-300 bg-slate-400";
};

const parseDateValue = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00`);
  }
  return new Date(value);
};

const formatVisitBadge = (value: string | null) => {
  if (!value) return "-";
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return value;
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  }).format(date);
  return formatted.replace(".", "").toUpperCase();
};

const addr = (r: EmpresaLookupRow) =>
  [r.endereco, r.complemento, r.bairro, r.cidade, r.uf].filter(Boolean).join(", ");

type RenderableMapRow = EmpresaLookupRow & {
  latitude: number;
  longitude: number;
  isApproximatePoint: boolean;
};

type MapViewport = {
  bounds: L.LatLngBounds;
  zoom: number;
};

type SelectionMode = "RAIO" | "BAIRRO";

type InactiveCompanyWarningItem = {
  id: string;
  code: string;
  name: string;
  status: string;
};
type SupervisorEmpresaFlagInfo = {
  color: "CINZA" | "VERDE" | "AMARELO" | "VERMELHO";
  lastVisitDate: string | null;
  daysSince: number | null;
};

const getSupervisorFlagColor = (flag: SupervisorEmpresaFlagInfo | undefined) => flag?.color ?? "CINZA";

const getSupervisorFlagTooltip = (flag: SupervisorEmpresaFlagInfo | undefined) => {
  if (!flag?.lastVisitDate) return "Sem historico";
  return `ultima visita ${fmtDate(flag.lastVisitDate)}`;
};

type GenerationTab = "VENDEDOR" | "SUPERVISOR";

const clampCompanyListHeight = (height: number) =>
  Math.max(COMPANY_LIST_MIN_HEIGHT, Math.min(height, COMPANY_LIST_MAX_HEIGHT));

const hasRealCoordinates = (row: Pick<EmpresaLookupRow, "latitude" | "longitude">) =>
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

const dedupeEmpresaLookupRows = (rows: EmpresaLookupRow[]) => {
  const byId = new Map<string, EmpresaLookupRow>();
  rows.forEach((row) => {
    if (!byId.has(row.id)) {
      byId.set(row.id, row);
    }
  });
  return Array.from(byId.values());
};

type VendedorLookup = {
  user_id: string;
  display_name: string | null;
  role: string;
  supervisor_id?: string | null;
};

type SupervisorLookup = {
  id?: string;
  user_id: string;
  display_name: string | null;
  role: string;
};

type RoutesMapLookupCache = {
  empresaRows: EmpresaLookupRow[];
  vendedores: VendedorLookup[];
  supervisores: SupervisorLookup[];
  cachedAt: number;
};

const ROUTES_MAP_LOOKUP_CACHE_STORAGE_KEY = "routesMapLookupCacheV2";
const ROUTES_MAP_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
let routesMapLookupMemoryCache: RoutesMapLookupCache | null = null;

const readRoutesMapLookupCache = () => {
  if (routesMapLookupMemoryCache) return routesMapLookupMemoryCache;
  try {
    const raw = sessionStorage.getItem(ROUTES_MAP_LOOKUP_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoutesMapLookupCache>;
    if (!Array.isArray(parsed.empresaRows) || !Array.isArray(parsed.vendedores) || !Array.isArray(parsed.supervisores)) {
      return null;
    }
    const entry: RoutesMapLookupCache = {
      empresaRows: parsed.empresaRows as EmpresaLookupRow[],
      vendedores: parsed.vendedores as VendedorLookup[],
      supervisores: parsed.supervisores as SupervisorLookup[],
      cachedAt: typeof parsed.cachedAt === "number" ? parsed.cachedAt : Date.now(),
    };
    routesMapLookupMemoryCache = entry;
    return entry;
  } catch {
    return null;
  }
};

const writeRoutesMapLookupCache = (entry: RoutesMapLookupCache) => {
  routesMapLookupMemoryCache = entry;
  try {
    sessionStorage.setItem(ROUTES_MAP_LOOKUP_CACHE_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // ignore storage failures
  }
};

const buildEmptyAgendaFilters = (): AgendaFilters => ({
  global: "",
  columns: {
    supervisor: [],
    vendedor: [],
    cod_1: [],
    supervisor_flag: [],
    bairro: [],
    cidade: [],
    uf: [],
    grupo: [],
    perfil_visita: [],
    empresa_nome: [],
    situacao: [],
    categoria: [],
  },
  dateRanges: {
    data_da_ultima_visita: {},
  },
  ranges: {
    vidas_ultima_visita: {},
  },
});

export default function RoutesMap() {
  const { role, session } = useAuth();
  const canGenerate = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canGenerateSupervisorRoutes = role === "SUPERVISOR";

  const {
    filters: appliedFilters,
    setFilters: setAppliedFilters,
  } = useAgendaFilters("routesMapFilters");
  const [filters, setDraftFilters] = useState<AgendaFilters>(() => appliedFilters);
  const setFilters = setDraftFilters;
  const [companyNameQuery, setCompanyNameQuery] = useState("");
  const [companyCodeQuery, setCompanyCodeQuery] = useState("");
  const [appliedCompanyNameQuery, setAppliedCompanyNameQuery] = useState("");
  const [appliedCompanyCodeQuery, setAppliedCompanyCodeQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(true);
  const [loadingEmpresas, setLoadingEmpresas] = useState(false);
  const restoredDraftRef = useRef(false);

  const [empresaRows, setEmpresaRows] = useState<EmpresaLookupRow[]>([]);
  const [totalEmpresasReal, setTotalEmpresasReal] = useState<number | null>(null);
  const [scheduledVisitsByEmpresa, setScheduledVisitsByEmpresa] = useState<
    Record<string, EmpresaScheduledVisit[]>
  >({});
  const [supervisorFlagByEmpresa, setSupervisorFlagByEmpresa] = useState<
    Record<string, SupervisorEmpresaFlagInfo>
  >({});
  const [vendedores, setVendedores] = useState<VendedorLookup[]>([]);
  const [supervisores, setSupervisores] = useState<SupervisorLookup[]>([]);
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});

  const [selectionMode, setSelectionMode] = useState<SelectionMode>("RAIO");
  const [selectedEmpresaIds, setSelectedEmpresaIds] = useState<string[]>([]);
  const [selectedBairroKeys, setSelectedBairroKeys] = useState<string[]>([]);
  const [excludedBairroEmpresaIds, setExcludedBairroEmpresaIds] = useState<string[]>([]);
  const [generationTab, setGenerationTab] = useState<GenerationTab>("VENDEDOR");
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [selectedSupervisorIds, setSelectedSupervisorIds] = useState<string[]>([]);
  const [vendorQuery, setVendorQuery] = useState("");
  const [supervisorQuery, setSupervisorQuery] = useState("");
  const [supervisorReasonByEmpresaId, setSupervisorReasonByEmpresaId] = useState<
    Record<string, SupervisorVisitReason>
  >({});

  const [visitDate, setVisitDate] = useState("");
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [eventWarning, setEventWarning] = useState<{ date: string; events: RouteEventRow[] } | null>(null);
  const [eventWarningsPreview, setEventWarningsPreview] = useState<RouteEventRow[]>([]);
  const [eventWarningsLoading, setEventWarningsLoading] = useState(false);
  const [inactiveWarningChecked, setInactiveWarningChecked] = useState(false);
  const [eventWarningChecked, setEventWarningChecked] = useState(false);
  const [inactiveWarningViewed, setInactiveWarningViewed] = useState(false);
  const [eventWarningViewed, setEventWarningViewed] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [inactiveCompaniesWarning, setInactiveCompaniesWarning] = useState<InactiveCompanyWarningItem[] | null>(null);

  // ====== SELECAO POR RAIO (AGORA COM 1KM) ======
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
    if (!canGenerateSupervisorRoutes && generationTab === "SUPERVISOR") {
      setGenerationTab("VENDEDOR");
    }
  }, [canGenerateSupervisorRoutes, generationTab]);

  useEffect(() => {
    if (!showGenerateModal) {
      setEventWarningsPreview([]);
      setEventWarningsLoading(false);
      return;
    }
    if (!visitDate) {
      setEventWarningsPreview([]);
      return;
    }

    let active = true;
    setEventWarningsLoading(true);
    setEventWarningsPreview([]);
    void fetchRouteEventsByDate(visitDate)
      .then((rows) => {
        if (!active) return;
        setEventWarningsPreview(rows);
      })
      .catch(() => {
        if (!active) return;
        setEventWarningsPreview([]);
      })
      .finally(() => {
        if (active) setEventWarningsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [showGenerateModal, visitDate]);

  useEffect(() => {
    setDraftFilters(appliedFilters);
  }, [appliedFilters]);

  useEffect(() => {
    if (!showGenerateModal) return;
    setEventWarningChecked(false);
    setEventWarningViewed(false);
  }, [showGenerateModal, visitDate]);

  useEffect(() => {
    if (restoredDraftRef.current) return;
    restoredDraftRef.current = true;
    const parsed = readRoutesModuleDraft();
    setCompanyNameQuery(parsed.companyNameQuery ?? "");
    setCompanyCodeQuery(parsed.companyCodeQuery ?? "");
    setAppliedCompanyNameQuery(parsed.companyNameQuery ?? "");
    setAppliedCompanyCodeQuery(parsed.companyCodeQuery ?? "");
    if (Array.isArray(parsed.selectedEmpresaIds)) {
      setSelectedEmpresaIds(Array.from(new Set(parsed.selectedEmpresaIds.filter(Boolean))));
    }
    if (Array.isArray(parsed.selectedVendorIds)) {
      setSelectedVendorIds(Array.from(new Set(parsed.selectedVendorIds.filter(Boolean))));
    }
    if (Array.isArray(parsed.selectedSupervisorIds)) {
      setSelectedSupervisorIds(Array.from(new Set(parsed.selectedSupervisorIds.filter(Boolean))));
    }
    setGenerationTab(parsed.generationTab === "SUPERVISOR" ? "SUPERVISOR" : "VENDEDOR");
    setSupervisorQuery(parsed.supervisorQuery ?? "");
    setSupervisorReasonByEmpresaId((parsed.supervisorReasonByEmpresaId ?? {}) as Record<string, SupervisorVisitReason>);
    setVendorQuery(parsed.vendorQuery ?? "");
    setVisitDate(parsed.visitDate ?? "");
    setSelectionMode(parsed.selectionMode ?? "RAIO");
    if (Array.isArray(parsed.selectedBairroKeys)) {
      setSelectedBairroKeys(Array.from(new Set(parsed.selectedBairroKeys.filter(Boolean))));
    }
    if (Array.isArray(parsed.excludedBairroEmpresaIds)) {
      setExcludedBairroEmpresaIds(Array.from(new Set(parsed.excludedBairroEmpresaIds.filter(Boolean))));
    }
    if (parsed.radiusKm) {
      setRadiusKm(parsed.radiusKm);
    }
    if (typeof parsed.radiusMode === "boolean") {
      setRadiusMode(parsed.radiusMode);
    }
    if (typeof parsed.radiusReplaceSelection === "boolean") {
      setRadiusReplaceSelection(parsed.radiusReplaceSelection);
    }
    if (parsed.radiusCenter) {
      setRadiusCenter(L.latLng(parsed.radiusCenter.lat, parsed.radiusCenter.lng));
    }
    if (Array.isArray(parsed.radiusResultIds)) {
      setRadiusResultIds(Array.from(new Set(parsed.radiusResultIds.filter(Boolean))));
    }
  }, []);

  useEffect(() => {
    if (!canGenerate) return;
    let active = true;

    const cached = readRoutesMapLookupCache();
    if (cached) {
      setVendedores(cached.vendedores);
      setSupervisores(cached.supervisores);
    }

    const load = async () => {
      try {
        const [vends, sups] = await Promise.all([fetchVendedores(), fetchSupervisores()]);
        if (!active) return;
        const nextCache: RoutesMapLookupCache = {
          empresaRows: cached?.empresaRows ?? [],
          vendedores: vends as VendedorLookup[],
          supervisores: sups as SupervisorLookup[],
          cachedAt: Date.now(),
        };
        writeRoutesMapLookupCache(nextCache);
        setEmpresaRows(nextCache.empresaRows);
        setVendedores(nextCache.vendedores);
        setSupervisores(nextCache.supervisores);
      } catch (e) {
        if (active) setMessage(e instanceof Error ? e.message : "Erro ao carregar dados.");
      }
    };

    const cacheIsFresh =
      Boolean(cached) && Date.now() - (cached?.cachedAt ?? 0) <= ROUTES_MAP_LOOKUP_CACHE_TTL_MS;

    if (!cacheIsFresh) {
      load();
    }
    const unsub = onProfilesUpdated(load);
    return () => {
      active = false;
      unsub();
    };
  }, [canGenerate]);

  useEffect(() => {
    if (!canGenerate) return;
    let active = true;

    const loadOptions = async () => {
      const entries: Array<readonly [string, string[]]> = [];
      for (const [key, sources] of Object.entries(FILTER_SOURCES)) {
        if (!active) return;
        try {
          const options = await fetchDistinctOptions(key, sources);
          entries.push([key, options] as const);
        } catch (error) {
          entries.push([key, []] as const);
        }
      }
      if (!active) return;
      setFilterOptions(Object.fromEntries(entries));
    };

    void loadOptions();
    return () => {
      active = false;
    };
  }, [canGenerate]);

  useEffect(() => {
    if (!canGenerate || !hasSearched) {
      setEmpresaRows([]);
      setTotalEmpresasReal(0);
      setScheduledVisitsByEmpresa({});
      setLoadingEmpresas(false);
      return;
    }

    let active = true;
    setLoadingEmpresas(true);
    setMessage(null);

    const loadCompanies = async () => {
      try {
        const queryFilters = {
          filters: appliedFilters,
          search: {
            companyName: appliedCompanyNameQuery,
            companyCode: appliedCompanyCodeQuery,
          },
        };
        const [empresas, totalReal] = await Promise.all([
          fetchEmpresasLookup(queryFilters),
          fetchEmpresasLookupCountExact(queryFilters),
        ]);
        if (!active) return;
        setEmpresaRows(empresas);
        setTotalEmpresasReal(totalReal);
        if (Number.isFinite(totalReal) && empresas.length > 0 && totalReal === empresas.length) {
          void totalReal;
        }
      } catch (error) {
        if (!active) return;
        setEmpresaRows([]);
        setTotalEmpresasReal(null);
        setMessage(error instanceof Error ? error.message : "Erro ao buscar empresas.");
      } finally {
        if (active) setLoadingEmpresas(false);
      }
    };

    void loadCompanies();
    return () => {
      active = false;
    };
  }, [
    appliedCompanyCodeQuery,
    appliedCompanyNameQuery,
    appliedFilters,
    canGenerate,
    hasSearched,
  ]);

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
    const t = normalizeSearchText(vendorQuery);
    return vendedores.filter((v) => normalizeSearchText(v.display_name ?? v.user_id).includes(t));
  }, [vendorQuery, vendedores]);
  const filteredSupervisores = useMemo(() => {
    if (!supervisorQuery.trim()) return supervisores;
    const t = normalizeSearchText(supervisorQuery);
    return supervisores.filter((s) => normalizeSearchText(s.display_name ?? s.user_id).includes(t));
  }, [supervisorQuery, supervisores]);
  const selectedSupervisorDisplayNames = useMemo(
    () =>
      selectedSupervisorIds
        .map((id) => supervisores.find((item) => item.user_id === id)?.display_name ?? id)
        .filter(Boolean),
    [selectedSupervisorIds, supervisores],
  );

  const dedupedEmpresaRows = useMemo(() => dedupeEmpresaLookupRows(empresaRows), [empresaRows]);

  useEffect(() => {
    let active = true;
    const empresaIds = dedupedEmpresaRows.map((row) => row.id);

    if (empresaIds.length === 0) {
      setScheduledVisitsByEmpresa({});
      return () => {
        active = false;
      };
    }

    fetchEmpresaScheduledVisits(empresaIds)
      .then((visits) => {
        if (!active) return;
        const grouped: Record<string, EmpresaScheduledVisit[]> = {};
        visits.forEach((visit) => {
          if (!visit.cliente_id) return;
          if (!grouped[visit.cliente_id]) grouped[visit.cliente_id] = [];
          grouped[visit.cliente_id].push(visit);
        });
        setScheduledVisitsByEmpresa(grouped);
      })
      .catch((error) => {
        if (!active) return;
        setScheduledVisitsByEmpresa({});
      });

    return () => {
      active = false;
    };
  }, [dedupedEmpresaRows]);

  useEffect(() => {
    let active = true;
    const empresaIds = dedupedEmpresaRows.map((row) => row.id);
    if (role !== "SUPERVISOR" || !session?.user.id || empresaIds.length === 0) {
      setSupervisorFlagByEmpresa({});
      return () => {
        active = false;
      };
    }

    fetchSupervisorLatestVisitByEmpresa(empresaIds, { supervisorUserId: session.user.id })
      .then((latestByEmpresa) => {
        if (!active) return;
        const next: Record<string, SupervisorEmpresaFlagInfo> = {};
        empresaIds.forEach((empresaId) => {
          const meta = getSupervisorEmpresaFlagMeta(latestByEmpresa[empresaId]?.visitDate ?? null);
          next[empresaId] = meta;
        });
        setSupervisorFlagByEmpresa(next);
      })
      .catch((error) => {
        if (active) setSupervisorFlagByEmpresa({});
      });

    return () => {
      active = false;
    };
  }, [dedupedEmpresaRows, role, session?.user.id]);

  const appliedSupervisorFlagFilters = appliedFilters.columns.supervisor_flag ?? [];

  const rowsMatchingFilters = useMemo(() => {
    if (role !== "SUPERVISOR" || appliedSupervisorFlagFilters.length === 0) return dedupedEmpresaRows;
    return dedupedEmpresaRows.filter((row) =>
      appliedSupervisorFlagFilters.includes(supervisorFlagByEmpresa[row.id]?.color ?? "CINZA"),
    );
  }, [appliedSupervisorFlagFilters, dedupedEmpresaRows, role, supervisorFlagByEmpresa]);

  const hasActiveRowsFilter = useMemo(() => {
    if (normalizeSearchText(appliedCompanyNameQuery) || normalizeSearchText(appliedCompanyCodeQuery)) return true;
    if (Object.keys(FILTER_SOURCES).some((key) => (appliedFilters.columns[key] ?? []).length > 0)) return true;
    if ((appliedFilters.columns.supervisor_flag ?? []).length > 0) return true;
    const dateRange = appliedFilters.dateRanges.data_da_ultima_visita;
    if (dateRange.from || dateRange.to || dateRange.month || dateRange.year || dateRange.invert) return true;
    const vidasRange = appliedFilters.ranges.vidas_ultima_visita;
    if (vidasRange.from || vidasRange.to) return true;
    return false;
  }, [
    appliedCompanyCodeQuery,
    appliedCompanyNameQuery,
    appliedFilters.columns,
    appliedFilters.dateRanges.data_da_ultima_visita,
    appliedFilters.ranges.vidas_ultima_visita,
  ]);

  const resolveMapObs = useCallback((empresaId: string) => {
    const visits = scheduledVisitsByEmpresa[empresaId] ?? [];
    if (visits.length === 0) return "-";

    const latestVisit = visits.reduce<EmpresaScheduledVisit | null>((latest, visit) => {
      if (!latest) return visit;
      const latestTime = parseDateValue(latest.visit_date).getTime();
      const visitTime = parseDateValue(visit.visit_date).getTime();
      if (Number.isNaN(visitTime)) return latest;
      if (Number.isNaN(latestTime) || visitTime > latestTime) return visit;
      return latest;
    }, null);

    return formatVisitBadge(latestVisit?.visit_date ?? null);
  }, [scheduledVisitsByEmpresa]);

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

  const missingFromFiltersCount = useMemo(
    () => rowsMatchingFilters.filter((r) => !hasRealCoordinates(r)).length,
    [rowsMatchingFilters],
  );
  const bairroRowsByKey = useMemo(() => {
    const grouped = new Map<string, { name: string; rows: EmpresaLookupRow[] }>();

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
    () => dedupeEmpresaLookupRows(selectedBairroRows),
    [selectedBairroRows],
  );
  const selectedBairroEmpresaIds = useMemo(
    () => Array.from(new Set(selectedBairroCompanyRows.map((row) => row.id))),
    [selectedBairroCompanyRows],
  );
  const excludedBairroEmpresaSet = useMemo(() => new Set(excludedBairroEmpresaIds), [excludedBairroEmpresaIds]);
  const effectiveSelectedEmpresaIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...selectedEmpresaIds,
          ...selectedBairroEmpresaIds.filter((id) => !excludedBairroEmpresaSet.has(id)),
        ]),
      ),
    [excludedBairroEmpresaSet, selectedEmpresaIds, selectedBairroEmpresaIds],
  );
  const effectiveSelSet = useMemo(() => new Set(effectiveSelectedEmpresaIds), [effectiveSelectedEmpresaIds]);
  const selectedGenerateRows = useMemo(() => {
    const byId = new Map(dedupedEmpresaRows.map((row) => [row.id, row] as const));
    return effectiveSelectedEmpresaIds
      .map((empresaId) => byId.get(empresaId))
      .filter((row): row is EmpresaLookupRow => Boolean(row));
  }, [dedupedEmpresaRows, effectiveSelectedEmpresaIds]);
  const inactiveCompaniesPreview = useMemo(
    () =>
      Array.from(
        selectedGenerateRows
          .filter((row) => isInactiveCompanyStatus(row.situacao))
          .reduce<Map<string, InactiveCompanyWarningItem>>((acc, row) => {
            acc.set(row.id, {
              id: row.id,
              code: row.codigo ?? "-",
              name: row.empresa ?? row.nome_fantasia ?? "Sem nome",
              status: row.situacao?.trim() || "Sem situacao",
            });
            return acc;
          }, new Map())
          .values(),
      ),
    [selectedGenerateRows],
  );
  const hasInactiveWarning = inactiveCompaniesPreview.length > 0;
  const hasEventWarning = eventWarningsPreview.length > 0;
  const shouldShowWarningBlock = hasInactiveWarning || hasEventWarning;

  useEffect(() => {
    const modalOpen = showGenerateModal || Boolean(eventWarning) || Boolean(inactiveCompaniesWarning?.length);
    if (!modalOpen || typeof document === "undefined") return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const scrollY = window.scrollY;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, [eventWarning, inactiveCompaniesWarning, showGenerateModal]);

  useEffect(() => {
    if (!showGenerateModal) return;
    setInactiveWarningChecked(false);
    setInactiveWarningViewed(false);
  }, [showGenerateModal, effectiveSelectedEmpresaIds, selectionMode]);

  useEffect(() => {
    if (effectiveSelectedEmpresaIds.length === 0) {
      setSupervisorReasonByEmpresaId({});
      return;
    }
    setSupervisorReasonByEmpresaId((prev) => {
      const next: Record<string, SupervisorVisitReason> = {};
      effectiveSelectedEmpresaIds.forEach((empresaId) => {
        const current = prev[empresaId];
        next[empresaId] =
          current && SUPERVISOR_VISIT_REASON_OPTIONS.some((option) => option.value === current)
            ? current
            : "RETENCAO";
      });
      return next;
    });
  }, [effectiveSelectedEmpresaIds]);

  useEffect(() => {
    if (!restoredDraftRef.current) return;
    writeRoutesModuleDraft({
      companyNameQuery,
      companyCodeQuery,
      selectedEmpresaIds: effectiveSelectedEmpresaIds,
      generationTab,
      selectedVendorIds,
      selectedSupervisorIds,
      supervisorReasonByEmpresaId,
      vendorQuery,
      supervisorQuery,
      visitDate,
      selectionMode,
      selectedBairroKeys,
      excludedBairroEmpresaIds,
      radiusKm,
      radiusMode,
      radiusReplaceSelection,
      radiusCenter: radiusCenter ? { lat: radiusCenter.lat, lng: radiusCenter.lng } : null,
      radiusResultIds,
    });
  }, [
    companyCodeQuery,
    companyNameQuery,
    effectiveSelectedEmpresaIds,
    excludedBairroEmpresaIds,
    generationTab,
    radiusCenter,
    radiusKm,
    radiusMode,
    radiusReplaceSelection,
    radiusResultIds,
    selectedBairroKeys,
    selectedSupervisorIds,
    selectedVendorIds,
    selectionMode,
    supervisorQuery,
    supervisorReasonByEmpresaId,
    vendorQuery,
    visitDate,
  ]);

  useEffect(() => {
    setExcludedBairroEmpresaIds((prev) => prev.filter((id) => selectedBairroEmpresaIds.includes(id)));
  }, [selectedBairroEmpresaIds]);

  const computeIdsWithinRadius = (rows: EmpresaLookupRow[], center: L.LatLng, km: number) => {
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

    const selectedOrRadiusIds = new Set([...selectedEmpresaIds, ...radiusResultIds]);
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
  }, [isLightMapMode, mapRows, mapViewport, radiusResultIds, selectedEmpresaIds, selectionMode]);

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

        setSelectedEmpresaIds((prev) => {
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
    }, [map]);

    return null;
  }

  if (!canGenerate) {
    return (
      <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
        Este modulo e restrito a supervisao e assistencia.
      </div>
    );
  }

  const toggleEmpresaSelection = (id: string) => {
    if (selectionMode === "BAIRRO") {
      if (!selectedBairroEmpresaIds.includes(id)) return;
      setExcludedBairroEmpresaIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
      return;
    }

    setSelectedEmpresaIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleVendor = (id: string) =>
    setSelectedVendorIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleSupervisor = (id: string) =>
    setSelectedSupervisorIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const handleSupervisorReasonChange = (empresaId: string, reason: SupervisorVisitReason) => {
    setSupervisorReasonByEmpresaId((prev) => ({
      ...prev,
      [empresaId]: reason,
    }));
  };

  const clearAllSelectedCompanies = () => {
    setSelectedEmpresaIds([]);
    setSelectedBairroKeys([]);
    setExcludedBairroEmpresaIds([]);
    setRadiusResultIds([]);
  };

  const resetCompanyListHeight = () => {
    setCompanyListHeight(256);
  };

  const startCompanyListResize = (startClientY: number) => {
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
  };

  const executeGenerate = async () => {
    const selVendors = vendedores.filter((v) => selectedVendorIds.includes(v.user_id));
    const selSupervisores = supervisores.filter((s) => selectedSupervisorIds.includes(s.user_id));
    if (generationTab === "VENDEDOR" && selVendors.length === 0) {
      return setMessage("Selecione pelo menos um vendedor para gerar visitas.");
    }
    if (generationTab === "SUPERVISOR" && selSupervisores.length === 0) {
      return setMessage("Selecione pelo menos um supervisor destino.");
    }
    if (effectiveSelectedEmpresaIds.length === 0) return setMessage("Selecione pelo menos uma empresa para gerar visitas.");
    if (!visitDate) return setMessage("Selecione a data da visita.");

    setGenerating(true);
    setMessage(null);
    setInactiveCompaniesWarning(null);

    try {
      const selectedEmpresas = await fetchEmpresasLookupByIds(effectiveSelectedEmpresaIds);

      if (selectedEmpresas.length === 0) {
        return setMessage("Nenhum registro encontrado para gerar visitas.");
      }

      const chunkSize = 500;
      const empresaIds = selectedEmpresas.map((row) => row.id);
      const base = new Date(`${visitDate}T12:00:00`);
      const display = new Intl.DateTimeFormat("pt-BR").format(base);

      const vendorNames = Array.from(
        new Set(selVendors.map((v) => (v.display_name ?? v.user_id).trim()).filter(Boolean)),
      ).join(", ");

      const supNames = Array.from(
        new Set(selVendors.map((v) => (supByVendor.get(v.user_id) ?? "").trim()).filter(Boolean)),
      ).join(", ");

      if (generationTab === "VENDEDOR") {
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

          const stops = selectedEmpresas.map((item, i) => ({
            route_id: route.id,
            cliente_id: item.id,
            stop_order: i + 1,
          }));
          for (let i = 0; i < stops.length; i += chunkSize) {
            const { error } = await supabase.from("route_stops").insert(stops.slice(i, i + chunkSize));
            if (error) throw new Error(error.message);
          }

          const visits = selectedEmpresas.map((item) => ({
            cliente_id: item.id,
            assigned_to_user_id: v.user_id,
            assigned_to_name: v.display_name ?? v.user_id,
            visit_date: visitDate,
            perfil_visita: item.perfil_visita ?? null,
            instructions: null,
            route_id: route.id,
            visit_type: VISIT_TYPE.VENDEDOR,
            created_by: session?.user.id ?? null,
          }));

          for (let i = 0; i < visits.length; i += chunkSize) {
            const { error } = await supabase
              .from("visits")
              .upsert(visits.slice(i, i + chunkSize), {
                onConflict: "cliente_id,assigned_to_user_id,visit_date",
                ignoreDuplicates: true,
              });
            if (error) throw new Error(error.message);
          }
        }

        for (let i = 0; i < empresaIds.length; i += chunkSize) {
          const ids = empresaIds.slice(i, i + chunkSize);

          const { error } = await supabase
            .from("clientes")
            .update({
              visit_generated_at: base.toISOString(),
              vendedor: vendorNames || null,
              supervisor: supNames || null,
            })
            .in("id", ids);

          if (error) throw new Error(error.message);
        }

        setMessage(
          `Geradas ${selectedEmpresas.length * selVendors.length} visitas (${selectedEmpresas.length} empresa(s)) para ${selVendors.length} vendedor(es).`,
        );
      } else {
        const reasonByEmpresaId: Record<string, SupervisorVisitReason> = {};
        for (const empresa of selectedEmpresas) {
          const reason = supervisorReasonByEmpresaId[empresa.id];
          if (!reason) {
            return setMessage(`Defina o motivo da empresa ${empresa.empresa ?? empresa.nome_fantasia ?? empresa.id}.`);
          }
          reasonByEmpresaId[empresa.id] = reason;
        }

        const creatorSupervisorName =
          supervisores.find((item) => item.user_id === session?.user.id)?.display_name ??
          "Supervisor";

        const { data: route, error: routeError } = await supabase
          .from("routes")
          .insert({
            name: `Visitas Supervisor ${display}`,
            date: visitDate,
            assigned_to_user_id: session?.user.id ?? null,
            created_by: session?.user.id ?? null,
          })
          .select("id")
          .single();
        if (routeError || !route) {
          throw new Error(routeError?.message ?? "Erro ao criar rota de supervisao.");
        }

        const stops = selectedEmpresas.map((item, i) => ({
          route_id: route.id,
          cliente_id: item.id,
          stop_order: i + 1,
        }));
        for (let i = 0; i < stops.length; i += chunkSize) {
          const { error } = await supabase.from("route_stops").insert(stops.slice(i, i + chunkSize));
          if (error) throw new Error(error.message);
        }

        const visitIds: string[] = [];
        for (let i = 0; i < selectedEmpresas.length; i += chunkSize) {
          const chunk = selectedEmpresas.slice(i, i + chunkSize);
          const visits = chunk.map((item) => ({
            cliente_id: item.id,
            assigned_to_user_id: session?.user.id ?? null,
            assigned_to_name: creatorSupervisorName,
            visit_date: visitDate,
            perfil_visita: item.perfil_visita ?? null,
            instructions: null,
            route_id: route.id,
            visit_type: VISIT_TYPE.SUPERVISOR_RELACIONAMENTO,
            supervisor_reason: reasonByEmpresaId[item.id],
            created_by: session?.user.id ?? null,
          }));

          const { data: upserted, error } = await supabase
            .from("visits")
            .upsert(visits, {
              onConflict: "cliente_id,assigned_to_user_id,visit_date",
              ignoreDuplicates: false,
            })
            .select("id");
          if (error) throw new Error(error.message);
          (upserted ?? []).forEach((row) => {
            const id = (row as { id?: string }).id;
            if (id) visitIds.push(id);
          });
        }

        if (visitIds.length === 0) {
          const { data: fetched, error } = await supabase
            .from("visits")
            .select("id")
            .in("cliente_id", empresaIds)
            .eq("visit_date", visitDate)
            .eq("visit_type", VISIT_TYPE.SUPERVISOR_RELACIONAMENTO)
            .eq("assigned_to_user_id", session?.user.id ?? "");
          if (error) throw new Error(error.message);
          (fetched ?? []).forEach((row) => {
            const id = (row as { id?: string }).id;
            if (id) visitIds.push(id);
          });
        }

        const uniqueVisitIds = Array.from(new Set(visitIds));
        const supervisorUserIds = selSupervisores.map((item) => item.user_id);
        const linkRows = uniqueVisitIds.flatMap((visitId) =>
          supervisorUserIds.map((supervisorUserId) => ({
            visit_id: visitId,
            supervisor_user_id: supervisorUserId,
            created_by: session?.user.id ?? null,
          })),
        );

        for (let i = 0; i < linkRows.length; i += chunkSize) {
          const { error } = await supabase
            .from("visit_supervisors")
            .upsert(linkRows.slice(i, i + chunkSize), {
              onConflict: "visit_id,supervisor_user_id",
              ignoreDuplicates: true,
            });
          if (error) throw new Error(error.message);
        }

        const supervisorNames = selectedSupervisorDisplayNames.join(", ");
        for (let i = 0; i < empresaIds.length; i += chunkSize) {
          const ids = empresaIds.slice(i, i + chunkSize);
          const { error } = await supabase
            .from("clientes")
            .update({
              visit_generated_at: base.toISOString(),
              supervisor: supervisorNames || null,
            })
            .in("id", ids);
          if (error) throw new Error(error.message);
        }

        setMessage(
          `Geradas ${selectedEmpresas.length} visitas de supervisor para ${selSupervisores.length} supervisor(es).`,
        );
      }

      setSelectedEmpresaIds([]);
      setSelectedBairroKeys([]);
      setSelectedVendorIds([]);
      setSelectedSupervisorIds([]);
      setVendorQuery("");
      setSupervisorQuery("");
      setSupervisorReasonByEmpresaId({});
      setVisitDate("");
      setShowGenerateModal(false);
      clearRoutesModuleDraft();

      setRadiusResultIds([]);
      setRadiusCenter(null);
      setRadiusMode(false);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao gerar visitas.");
    } finally {
      setGenerating(false);
    }
  };

  const handleApplySearch = () => {
    setAppliedFilters(filters);
    setAppliedCompanyNameQuery(companyNameQuery.trim());
    setAppliedCompanyCodeQuery(companyCodeQuery.trim());
    setSelectedEmpresaIds([]);
    setSelectedBairroKeys([]);
    setExcludedBairroEmpresaIds([]);
    setRadiusResultIds([]);
    setHasSearched(true);
  };

  const handleClearFilters = () => {
    const emptyFilters = buildEmptyAgendaFilters();
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setCompanyNameQuery("");
    setCompanyCodeQuery("");
    setAppliedCompanyNameQuery("");
    setAppliedCompanyCodeQuery("");
    setSelectedEmpresaIds([]);
    setSelectedBairroKeys([]);
    setExcludedBairroEmpresaIds([]);
    setRadiusResultIds([]);
    setRadiusCenter(null);
    setHasSearched(true);
    setMessage(null);
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
            {/* Busca por nome e codigo */}
            <div
              className={`grid gap-3 md:items-end ${
                role === "SUPERVISOR"
                  ? "md:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_minmax(180px,220px)_minmax(180px,220px)]"
                  : "md:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_minmax(180px,220px)]"
              }`}
            >
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-ink/70">Termo por nome (palavra exata)</span>
                <input
                  value={companyNameQuery}
                  onChange={(e) => setCompanyNameQuery(e.target.value)}
                  placeholder="Ex.: rio"
                  className="w-full rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-sm outline-none focus:border-sea"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-ink/70">Busca exata por codigo</span>
                <input
                  value={companyCodeQuery}
                  onChange={(e) => setCompanyCodeQuery(e.target.value)}
                  placeholder="Busca exata por codigo"
                  className="w-full rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-sm outline-none focus:border-sea"
                />
              </label>
              {role === "SUPERVISOR" ? (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-ink/70">Flag supervisor</span>
                  <div className="flex h-10 items-center justify-between rounded-lg border border-sea/20 bg-white/90 px-3">
                    <span className="text-xs text-ink/60">
                      {(filters.columns.supervisor_flag ?? []).length
                        ? `${(filters.columns.supervisor_flag ?? []).length} selecionada(s)`
                        : "Todas"}
                    </span>
                    <MultiSelectFilter
                      label={
                        (filters.columns.supervisor_flag ?? []).length
                          ? `Flag (${filters.columns.supervisor_flag.length})`
                          : "Flag"
                      }
                      options={SUPERVISOR_FLAG_FILTER_OPTIONS.map((option) => option.label)}
                      value={(filters.columns.supervisor_flag ?? []).map(getSupervisorFlagOptionLabel)}
                      onApply={(nextLabels) =>
                        setFilters((prev) => ({
                          ...prev,
                          columns: {
                            ...prev.columns,
                            supervisor_flag: nextLabels
                              .map(getSupervisorFlagOptionValue)
                              .filter(
                                (value): value is SupervisorFlagFilterValue => value !== null,
                              ),
                          },
                        }))
                      }
                    />
                  </div>
                </label>
              ) : null}
              <label className="flex flex-col gap-1">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink/70">
                  Categoria
                  <CategoriaLegendPopover />
                </span>
                <div className="flex h-10 items-center justify-between rounded-lg border border-sea/20 bg-white/90 px-3">
                  <span className="text-xs text-ink/60">
                    {(filters.columns.categoria ?? []).length
                      ? `${(filters.columns.categoria ?? []).length} selecionada(s)`
                      : "Selecione"}
                  </span>
                  <MultiSelectFilter
                    label={
                      (filters.columns.categoria ?? []).length
                        ? `Categoria (${filters.columns.categoria.length})`
                        : "Categoria"
                    }
                    options={filterOptions.categoria ?? [...CATEGORIA_OPTIONS]}
                    value={filters.columns.categoria ?? []}
                    onApply={(next) =>
                      setFilters((prev) => ({
                        ...prev,
                        columns: { ...prev.columns, categoria: next },
                      }))
                    }
                  />
                </div>
              </label>
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

            {/* Selecao por raio */}
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
                  Substituir selecao
                </label>
              </div>
              )}

              {selectionMode === "RAIO" && <p className="mt-2 text-[11px] text-ink/60">
                {radiusMode ? "Clique no mapa para selecionar." : "Ative o modo raio para clicar no mapa."}
              </p>}

              {selectionMode === "RAIO" && radiusCenter && (
                <p className="mt-2 text-[11px] text-ink/60">
                  Centro: {radiusCenter.lat.toFixed(5)}, {radiusCenter.lng.toFixed(5)} - Encontrados:{" "}
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
                      Bairros selecionados: {selectedBairroKeys.length} - Empresas: {effectiveSelectedEmpresaIds.length}
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

            {/* Botoes */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleApplySearch}
                className="rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight"
              >
                Buscar
              </button>

              <button
                type="button"
                onClick={() => {
                  setMessage(null);
                  setInactiveCompaniesWarning(null);
                  if (selectedSupervisorIds.length === 0 && role === "SUPERVISOR" && session?.user.id) {
                    setSelectedSupervisorIds([session.user.id]);
                  }
                  setSupervisorReasonByEmpresaId((prev) => {
                    const next = { ...prev };
                    effectiveSelectedEmpresaIds.forEach((empresaId) => {
                      if (!next[empresaId]) next[empresaId] = "RETENCAO";
                    });
                    return next;
                  });
                  setShowGenerateModal(true);
                }}
                disabled={effectiveSelectedEmpresaIds.length === 0}
                className="inline-flex items-center gap-1 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                <MapPin size={14} />
                Gerar rota
              </button>

              <button
                type="button"
                onClick={handleClearFilters}
                className="rounded-lg border border-sea/30 bg-white/80 px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Limpar filtros
              </button>

              <div className="ml-auto text-right text-xs text-ink/60">
                <div>Empresas: {totalEmpresasReal ?? "..."}</div>
                {missingFromFiltersCount > 0 && <div>Sem coordenada real: {missingFromFiltersCount}</div>}
                <div className="flex items-center justify-end gap-1">
                  <span>Selecionadas: {effectiveSelectedEmpresaIds.length}</span>
                  <button
                    type="button"
                    onClick={clearAllSelectedCompanies}
                    disabled={effectiveSelectedEmpresaIds.length === 0}
                    title="Limpar empresas selecionadas"
                    aria-label="Limpar empresas selecionadas"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink/50 transition hover:bg-sea/10 hover:text-sea disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            </div>
            {!hasSearched ? (
              <div className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink/70">
                Ajuste os filtros e clique em Buscar.
              </div>
            ) : loadingEmpresas ? (
              <div className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink/70">
                Buscando empresas...
              </div>
            ) : rowsMatchingFilters.length === 0 && (
              <div className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink/70">
                {hasActiveRowsFilter ? "Termo nao encontrado." : "Nenhum registro encontrado."}
              </div>
            )}
          </div>
        </div>

        {/* MAPA */}
        <div className="rounded-2xl border border-sea/15 bg-white/92 p-3 sm:p-4">
          <div className="mb-3">
            <h3 className="text-base font-semibold text-ink">Mapa de empresas</h3>
            <p className="text-xs text-ink/60">Passe o mouse para ver informacoes das empresas.</p>
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
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>'
                    className="routes-map-toner-base"
                    url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
                    subdomains={["a", "b", "c", "d"]}
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
                const hasSupervisorAssigned = Boolean(compact(r.supervisor));
                const markerColor = hasSupervisorAssigned ? "#9333ea" : r.isApproximatePoint ? "#f59e0b" : "#0f766e";
                const markerBorderColor = hasSupervisorAssigned
                  ? "#6b21a8"
                  : r.isApproximatePoint
                    ? "#b45309"
                    : "#0b5b4f";
                const selectedFillColor = hasSupervisorAssigned ? "#a855f7" : "#14b8a6";
                const selectedBorderColor = hasSupervisorAssigned ? "#6b21a8" : "#0f766e";
                return (
                  <CircleMarker
                    key={r.id}
                    center={[r.latitude, r.longitude]}
                    radius={sel ? 8 : 6}
                    pathOptions={{
                      color: sel ? selectedBorderColor : markerBorderColor,
                      fillColor: sel ? selectedFillColor : markerColor,
                      fillOpacity: sel ? 0.6 : 0.45,
                      weight: sel ? 2.2 : 1.4,
                    }}
                    eventHandlers={{
                      click: () => toggleEmpresaSelection(r.id),
                      mouseover: (event) => event.target.openTooltip(),
                      mouseout: (event) => event.target.closeTooltip(),
                    }}
                  >
                    <Tooltip direction="right" offset={[12, -4]} opacity={0.98} sticky className="routes-map-tooltip">
                      {isLightMapMode ? (
                        <div className="w-[260px] max-w-[260px] space-y-1 text-xs [overflow-wrap:anywhere]">
                          <p className="font-semibold text-ink">{r.empresa ?? r.nome_fantasia ?? "-"}</p>
                          <div className="flex items-center gap-1.5 text-ink/70">
                            <p>COD: {r.codigo ?? "-"}</p>
                            {role === "SUPERVISOR" ? (
                              <span
                                title={getSupervisorFlagTooltip(supervisorFlagByEmpresa[r.id])}
                                aria-label={getSupervisorFlagTooltip(supervisorFlagByEmpresa[r.id])}
                                className="inline-flex items-center"
                              >
                                <span
                                  className={`h-2.5 w-2.5 rounded-full border ${getSupervisorFlagDotStyles(
                                    getSupervisorFlagColor(supervisorFlagByEmpresa[r.id]),
                                  )}`}
                                />
                              </span>
                            ) : null}
                          </div>
                          <p className="text-ink/70">
                            {r.bairro ?? "-"} - {r.cidade ?? "-"}
                          </p>
                          <p className="text-ink/60">
                            ULTIMA VISITA: {fmtDate(r.data_da_ultima_visita)}
                            {` | OBS: ${resolveMapObs(r.id)}`}
                          </p>
                          <p className="text-ink/60">VIDAS ULTIMA VISITA: {r.visit_completed_vidas ?? "-"}</p>
                          {r.isApproximatePoint && <p className="text-amber-700">PONTO APROXIMADO</p>}
                        </div>
                      ) : (
                        <div className="w-[320px] max-w-[320px] space-y-1 text-xs [overflow-wrap:anywhere]">
                          <p className="font-semibold text-ink">OBS: {resolveMapObs(r.id)}</p>
                          <p className="text-ink/70">ULTIMA VISITA: {fmtDate(r.data_da_ultima_visita)}</p>
                          <p className="text-ink/70">VIDAS ULTIMA VISITA: {r.visit_completed_vidas ?? "-"}</p>
                          <div className="flex items-center gap-1.5 text-ink/70">
                            <p>CODIGO: {r.codigo ?? "-"}</p>
                            {role === "SUPERVISOR" ? (
                              <span
                                title={getSupervisorFlagTooltip(supervisorFlagByEmpresa[r.id])}
                                aria-label={getSupervisorFlagTooltip(supervisorFlagByEmpresa[r.id])}
                                className="inline-flex items-center"
                              >
                                <span
                                  className={`h-2.5 w-2.5 rounded-full border ${getSupervisorFlagDotStyles(
                                    getSupervisorFlagColor(supervisorFlagByEmpresa[r.id]),
                                  )}`}
                                />
                              </span>
                            ) : null}
                          </div>
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
                            onClick={() => toggleEmpresaSelection(r.id)}
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
                className="mt-3 grid grid-cols-1 gap-2 overflow-hidden rounded-lg border border-sea/15 bg-white/90 p-2 xl:grid-cols-2"
                style={{ height: `${companyListHeight}px` }}
              >
                {radiusRows.map((r) => {
                  const checked = effectiveSelSet.has(r.id);
                  return (
                    <label
                      key={r.id}
                      className="grid h-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md border border-sea/10 bg-white px-2 py-2 hover:bg-sea/10"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="min-w-0 truncate text-[11px] font-semibold leading-tight text-ink">
                            {r.empresa ?? r.nome_fantasia ?? "Empresa"}
                          </p>
                          {role === "SUPERVISOR" ? (
                            <span
                              title={getSupervisorFlagTooltip(supervisorFlagByEmpresa[r.id])}
                              aria-label={getSupervisorFlagTooltip(supervisorFlagByEmpresa[r.id])}
                              className="inline-flex items-center"
                            >
                              <span
                                className={`h-2.5 w-2.5 rounded-full border ${getSupervisorFlagDotStyles(
                                  getSupervisorFlagColor(supervisorFlagByEmpresa[r.id]),
                                )}`}
                              />
                            </span>
                          ) : null}
                        </div>
                        <p className="break-words text-[10px] leading-tight text-ink/60">{addr(r) || "-"}</p>
                        <p className="break-words text-[10px] leading-tight text-ink/60">
                          COD: {r.codigo ?? "-"} - Bairro: {r.bairro ?? "-"}
                        </p>
                        <p className="break-words text-[10px] leading-tight text-ink/60">
                          ULTIMA VISITA: {fmtDate(r.data_da_ultima_visita)}
                          {` | OBS: ${resolveMapObs(r.id)}`}
                        </p>
                        <p className="break-words text-[10px] leading-tight text-ink/60">
                          VIDAS ULTIMA VISITA: {r.visit_completed_vidas ?? "-"}
                        </p>
                      </div>

                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleEmpresaSelection(r.id)}
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
                  className="mt-3 grid grid-cols-1 gap-2 overflow-hidden rounded-lg border border-sea/15 bg-white/90 p-2 xl:grid-cols-2"
                  style={{ height: `${companyListHeight}px` }}
                >
                  {selectedBairroCompanyRows.map((r) => {
                    const checked = effectiveSelSet.has(r.id);
                    return (
                      <label
                        key={r.id}
                        className="grid h-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md border border-sea/10 bg-white px-2 py-2 hover:bg-sea/10"
                      >
                      <div className="min-w-0 space-y-0.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="min-w-0 truncate text-[11px] font-semibold leading-tight text-ink">
                              {r.empresa ?? r.nome_fantasia ?? "Empresa"}
                            </p>
                            {role === "SUPERVISOR" ? (
                              <span
                                title={getSupervisorFlagTooltip(supervisorFlagByEmpresa[r.id])}
                                aria-label={getSupervisorFlagTooltip(supervisorFlagByEmpresa[r.id])}
                                className="inline-flex items-center"
                              >
                                <span
                                  className={`h-2.5 w-2.5 rounded-full border ${getSupervisorFlagDotStyles(
                                    getSupervisorFlagColor(supervisorFlagByEmpresa[r.id]),
                                  )}`}
                                />
                              </span>
                            ) : null}
                          </div>
                          <p className="break-words text-[10px] leading-tight text-ink/60">{addr(r) || "-"}</p>
                          <p className="break-words text-[10px] leading-tight text-ink/60">
                            COD: {r.codigo ?? "-"} - Bairro: {r.bairro ?? "-"}
                          </p>
                          <p className="break-words text-[10px] leading-tight text-ink/60">
                            ULTIMA VISITA: {fmtDate(r.data_da_ultima_visita)}
                            {` | OBS: ${resolveMapObs(r.id)}`}
                          </p>
                          <p className="break-words text-[10px] leading-tight text-ink/60">
                            VIDAS ULTIMA VISITA: {r.visit_completed_vidas ?? "-"}
                          </p>
                        </div>

                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleEmpresaSelection(r.id)}
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
        <div className="fixed inset-0 z-[3000] flex items-start justify-center px-4 pt-6">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => (generating ? null : setShowGenerateModal(false))}
          />
          <div className="relative w-[min(94vw,1100px)] max-h-[88vh] overflow-y-auto rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Gerar visitas</h3>
            <p className="mt-1 text-xs text-ink/60">
              Selecione o tipo de geracao, a data e as empresas marcadas no mapa para gerar as visitas.
            </p>
            <p className="mt-2 text-xs text-ink/60">Empresas selecionadas: {effectiveSelectedEmpresaIds.length}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setGenerationTab("VENDEDOR")}
                className={[
                  "rounded-full border px-3 py-1 text-[11px] font-semibold transition",
                  generationTab === "VENDEDOR"
                    ? "border-sea bg-sea/10 text-sea"
                    : "border-sea/30 bg-white text-ink/70 hover:border-sea",
                ].join(" ")}
              >
                Vendedor
              </button>
              {canGenerateSupervisorRoutes && (
                <button
                  type="button"
                  onClick={() => setGenerationTab("SUPERVISOR")}
                  className={[
                    "rounded-full border px-3 py-1 text-[11px] font-semibold transition",
                    generationTab === "SUPERVISOR"
                      ? "border-sea bg-sea/10 text-sea"
                      : "border-sea/30 bg-white text-ink/70 hover:border-sea",
                  ].join(" ")}
                >
                  Supervisor
                </button>
              )}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {generationTab === "VENDEDOR" ? (
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
              ) : (
                <div className="flex flex-col gap-2 text-xs font-semibold text-ink/70">
                  Supervisor destino
                  <div className="rounded-xl border border-sea/20 bg-white/90 p-3">
                    <input
                      value={supervisorQuery}
                      onChange={(event) => setSupervisorQuery(event.target.value)}
                      placeholder="Buscar supervisor..."
                      className="w-full rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                    />

                    <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                      {filteredSupervisores.length === 0 ? (
                        <p className="text-xs text-ink/60">Nenhum supervisor encontrado.</p>
                      ) : (
                        filteredSupervisores.map((supervisor) => {
                          const checked = selectedSupervisorIds.includes(supervisor.user_id);
                          return (
                            <label
                              key={supervisor.user_id}
                              className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1 text-xs text-ink hover:bg-sea/10"
                            >
                              <span>{supervisor.display_name ?? supervisor.user_id}</span>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSupervisor(supervisor.user_id)}
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
                        onClick={() => setSelectedSupervisorIds(supervisores.map((s) => s.user_id))}
                      >
                        Selecionar todos
                      </button>
                      <button type="button" onClick={() => setSelectedSupervisorIds([])}>
                        Limpar
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-ink/60">Selecionados: {selectedSupervisorIds.length}</p>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Data da visita
                  <input
                    type="date"
                    value={visitDate}
                    onChange={(e) => setVisitDate(e.target.value)}
                    className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                  />
                </label>

                {shouldShowWarningBlock && (
                  <div className="rounded-xl border border-sea/20 bg-sand/30 p-3">
                    <p className="text-xs font-semibold text-ink/80">Avisos obrigatorios para confirmar</p>
                    <p className="mt-1 text-[11px] text-ink/60">
                      Para marcar o checkbox, clique primeiro em Ver detalhes de cada aviso.
                    </p>

                    <div className="mt-3 space-y-2">
                      {hasInactiveWarning && (
                        <div className="flex items-start justify-between gap-2 rounded-lg border border-sea/20 bg-white/90 px-2 py-2">
                          <label className="flex cursor-pointer items-start gap-2 text-xs text-ink">
                            <input
                              type="checkbox"
                              checked={inactiveWarningChecked}
                              onChange={(event) => setInactiveWarningChecked(event.target.checked)}
                              disabled={!inactiveWarningViewed}
                              className="mt-0.5 h-4 w-4 accent-sea disabled:opacity-50"
                            />
                            <span>
                              <span className="block">{`Li o aviso de empresa inativa (${inactiveCompaniesPreview.length} empresa(s)).`}</span>
                              {!inactiveWarningViewed && (
                                <span className="mt-0.5 block text-[10px] font-semibold text-sea">
                                  Clique em Ver detalhes para habilitar o checkbox.
                                </span>
                              )}
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              setInactiveWarningViewed(true);
                              setInactiveCompaniesWarning(inactiveCompaniesPreview);
                            }}
                            className="rounded-lg border border-sea/30 bg-white/90 px-2 py-1 text-[11px] font-semibold text-ink/80 hover:border-sea"
                          >
                            Ver detalhes
                          </button>
                        </div>
                      )}

                      {hasEventWarning && (
                        <div className="flex items-start justify-between gap-2 rounded-lg border border-sea/20 bg-white/90 px-2 py-2">
                          <label className="flex cursor-pointer items-start gap-2 text-xs text-ink">
                            <input
                              type="checkbox"
                              checked={eventWarningChecked}
                              onChange={(event) => setEventWarningChecked(event.target.checked)}
                              disabled={eventWarningsLoading || !eventWarningViewed}
                              className="mt-0.5 h-4 w-4 accent-sea disabled:opacity-50"
                            />
                            <span>
                              <span className="block">{`Li o aviso de evento para a data (${eventWarningsPreview.length} evento(s)).`}</span>
                              {!eventWarningViewed && (
                                <span className="mt-0.5 block text-[10px] font-semibold text-sea">
                                  Clique em Ver detalhes para habilitar o checkbox.
                                </span>
                              )}
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              setEventWarningViewed(true);
                              setEventWarning({ date: visitDate, events: eventWarningsPreview });
                            }}
                            disabled={eventWarningsLoading}
                            className="rounded-lg border border-sea/30 bg-white/90 px-2 py-1 text-[11px] font-semibold text-ink/80 hover:border-sea disabled:opacity-50"
                          >
                            Ver detalhes
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {generationTab === "SUPERVISOR" && (
              <div className="mt-3 rounded-xl border border-sea/20 bg-sand/30 p-3">
                <p className="text-xs font-semibold text-ink/70">Motivo por empresa</p>
                <div className="mt-2 max-h-52 space-y-2 overflow-auto">
                  {selectedGenerateRows.length === 0 ? (
                    <p className="text-xs text-ink/60">Nenhuma empresa selecionada.</p>
                  ) : (
                    selectedGenerateRows.map((row) => (
                      <div
                        key={row.id}
                        className="grid gap-2 rounded-lg border border-sea/15 bg-white/90 px-2 py-2 md:grid-cols-[1fr_210px] md:items-center"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-ink">
                            {row.empresa ?? row.nome_fantasia ?? "Sem nome"}
                          </p>
                          <p className="truncate text-[11px] text-ink/60">COD: {row.codigo ?? "-"}</p>
                        </div>
                        <select
                          value={supervisorReasonByEmpresaId[row.id] ?? "RETENCAO"}
                          onChange={(event) =>
                            handleSupervisorReasonChange(row.id, event.target.value as SupervisorVisitReason)
                          }
                          className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                        >
                          {SUPERVISOR_VISIT_REASON_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

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
                onClick={() => {
                  void executeGenerate();
                }}
                disabled={
                  (generationTab === "VENDEDOR" && selectedVendorIds.length === 0) ||
                  (generationTab === "SUPERVISOR" && selectedSupervisorIds.length === 0) ||
                  effectiveSelectedEmpresaIds.length === 0 ||
                  !visitDate ||
                  eventWarningsLoading ||
                  (hasInactiveWarning && !inactiveWarningChecked) ||
                  (hasEventWarning && !eventWarningChecked) ||
                  generating
                }
                className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {generating ? "Gerando..." : `Confirmar (${effectiveSelectedEmpresaIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {eventWarning && (
        <div className="fixed inset-0 z-[3300] flex items-start justify-center px-4 pt-6">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => {
              if (generating) return;
              setEventWarning(null);
            }}
            aria-label="Fechar aviso de evento"
          />
          <div className="relative w-full max-w-xl rounded-3xl border border-amber-300 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Aviso de evento na data selecionada</h3>
            <p className="mt-1 text-xs text-ink/70">
              Ha evento(s) cadastrado(s) para {formatDateBr(eventWarning.date)}. A geracao da rota pode continuar apos a confirmacao.
            </p>

            <div className="mt-4 max-h-64 space-y-2 overflow-auto rounded-xl border border-amber-200 bg-amber-50/70 p-2">
              {eventWarning.events.map((eventRow) => (
                <div key={eventRow.id} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-ink">
                  <p className="font-semibold">
                    {formatRouteEventType(eventRow.event_type)}
                    {eventRow.event_time ? ` - ${eventRow.event_time.slice(0, 5)}` : ""}
                  </p>
                  {eventRow.notes ? <p className="mt-1 text-[11px] text-ink/70">{eventRow.notes}</p> : null}
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (generating) return;
                  setEventWarning(null);
                }}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {inactiveCompaniesWarning && inactiveCompaniesWarning.length > 0 && (
        <div className="fixed inset-0 z-[3100] flex items-start justify-center px-4 pt-6">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setInactiveCompaniesWarning(null)}
            aria-label="Fechar aviso de empresa inativa"
          />
          <div className="relative w-full max-w-xl rounded-3xl border border-amber-300 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Aviso de empresa inativa</h3>
            <p className="mt-1 text-xs text-ink/70">
              A(s) empresa(s) abaixo nao esta ativa.
            </p>

            <div className="mt-4 max-h-64 space-y-2 overflow-auto rounded-xl border border-amber-200 bg-amber-50/70 p-2">
              {inactiveCompaniesWarning.map((company) => (
                <div
                  key={company.id}
                  className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-ink"
                >
                  <p className="font-semibold">{company.name}</p>
                  <p className="mt-1 text-[11px] text-ink/70">
                    COD: {company.code} | Situacao: {company.status}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInactiveCompaniesWarning(null)}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea"
              >
                Fechar
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
