export type RoutesModuleDraftState = {
  companyNameQuery?: string;
  companyCodeQuery?: string;
  selectedEmpresaIds?: string[];
  selectedAgendaIds?: string[];
  selectedVendorIds?: string[];
  selectedSupervisorIds?: string[];
  generationTab?: "VENDEDOR" | "SUPERVISOR";
  supervisorReasonByEmpresaId?: Record<string, string>;
  vendorQuery?: string;
  supervisorQuery?: string;
  visitDate?: string;
  selectionMode?: "RAIO" | "BAIRRO";
  selectedBairroKeys?: string[];
  excludedBairroEmpresaIds?: string[];
  radiusKm?: 0.5 | 1 | 3 | 5 | 10;
  radiusMode?: boolean;
  radiusReplaceSelection?: boolean;
  radiusCenter?: { lat: number; lng: number } | null;
  radiusResultIds?: string[];
};

const ROUTES_MODULE_DRAFT_STORAGE_KEY = "routesModuleDraftV2";

const normalizeString = (value: unknown) => (typeof value === "string" ? value : "");

const normalizeStringArray = (value: unknown) =>
  Array.from(
    new Set(
      Array.isArray(value)
        ? value
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : [],
    ),
  );

const normalizeReasonMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => [String(key).trim(), typeof raw === "string" ? raw.trim() : ""])
      .filter(([key, reason]) => Boolean(key) && Boolean(reason)),
  );
};

const normalizeSelectionMode = (value: unknown): "RAIO" | "BAIRRO" =>
  value === "BAIRRO" ? "BAIRRO" : "RAIO";

const normalizeRadiusKm = (value: unknown): 0.5 | 1 | 3 | 5 | 10 => {
  const parsed = Number(value);
  if (parsed === 0.5 || parsed === 1 || parsed === 3 || parsed === 5 || parsed === 10) return parsed;
  return 1;
};

const normalizeRadiusCenter = (value: unknown): { lat: number; lng: number } | null => {
  if (!value || typeof value !== "object") return null;
  const maybe = value as { lat?: unknown; lng?: unknown };
  const lat = Number(maybe.lat);
  const lng = Number(maybe.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const normalizeDraft = (value: RoutesModuleDraftState | null | undefined): RoutesModuleDraftState => {
  const selectedEmpresaIds = normalizeStringArray(value?.selectedEmpresaIds ?? value?.selectedAgendaIds);
  const selectedAgendaIds = normalizeStringArray(value?.selectedAgendaIds ?? value?.selectedEmpresaIds);
  return {
    companyNameQuery: normalizeString(value?.companyNameQuery),
    companyCodeQuery: normalizeString(value?.companyCodeQuery),
    selectedEmpresaIds,
    selectedAgendaIds,
    selectedVendorIds: normalizeStringArray(value?.selectedVendorIds),
    selectedSupervisorIds: normalizeStringArray(value?.selectedSupervisorIds),
    generationTab: value?.generationTab === "SUPERVISOR" ? "SUPERVISOR" : "VENDEDOR",
    supervisorReasonByEmpresaId: normalizeReasonMap(value?.supervisorReasonByEmpresaId),
    vendorQuery: normalizeString(value?.vendorQuery),
    supervisorQuery: normalizeString(value?.supervisorQuery),
    visitDate: normalizeString(value?.visitDate),
    selectionMode: normalizeSelectionMode(value?.selectionMode),
    selectedBairroKeys: normalizeStringArray(value?.selectedBairroKeys),
    excludedBairroEmpresaIds: normalizeStringArray(value?.excludedBairroEmpresaIds),
    radiusKm: normalizeRadiusKm(value?.radiusKm),
    radiusMode: value?.radiusMode === undefined ? true : Boolean(value.radiusMode),
    radiusReplaceSelection:
      value?.radiusReplaceSelection === undefined ? true : Boolean(value.radiusReplaceSelection),
    radiusCenter: normalizeRadiusCenter(value?.radiusCenter),
    radiusResultIds: normalizeStringArray(value?.radiusResultIds),
  };
};

export const readRoutesModuleDraft = (): RoutesModuleDraftState => {
  try {
    const raw = localStorage.getItem(ROUTES_MODULE_DRAFT_STORAGE_KEY);
    if (!raw) return normalizeDraft(null);
    return normalizeDraft(JSON.parse(raw) as RoutesModuleDraftState);
  } catch {
    return normalizeDraft(null);
  }
};

export const writeRoutesModuleDraft = (draft: RoutesModuleDraftState) => {
  try {
    const current = readRoutesModuleDraft();
    const merged: RoutesModuleDraftState = {
      ...current,
      ...draft,
      selectedEmpresaIds:
        draft.selectedEmpresaIds ?? draft.selectedAgendaIds ?? current.selectedEmpresaIds ?? [],
      selectedAgendaIds:
        draft.selectedAgendaIds ?? draft.selectedEmpresaIds ?? current.selectedAgendaIds ?? [],
      selectedVendorIds: draft.selectedVendorIds ?? current.selectedVendorIds ?? [],
      selectedSupervisorIds: draft.selectedSupervisorIds ?? current.selectedSupervisorIds ?? [],
      generationTab: draft.generationTab ?? current.generationTab ?? "VENDEDOR",
      supervisorReasonByEmpresaId:
        draft.supervisorReasonByEmpresaId ?? current.supervisorReasonByEmpresaId ?? {},
      selectedBairroKeys: draft.selectedBairroKeys ?? current.selectedBairroKeys ?? [],
      excludedBairroEmpresaIds:
        draft.excludedBairroEmpresaIds ?? current.excludedBairroEmpresaIds ?? [],
      radiusResultIds: draft.radiusResultIds ?? current.radiusResultIds ?? [],
    };
    localStorage.setItem(
      ROUTES_MODULE_DRAFT_STORAGE_KEY,
      JSON.stringify(normalizeDraft(merged)),
    );
  } catch {
    // ignore storage failures
  }
};

export const clearRoutesModuleDraft = () => {
  try {
    localStorage.removeItem(ROUTES_MODULE_DRAFT_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
};
