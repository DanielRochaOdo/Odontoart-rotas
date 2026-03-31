export type RoutesModuleDraftState = {
  companyNameQuery?: string;
  companyCodeQuery?: string;
  selectedEmpresaIds?: string[];
  selectedAgendaIds?: string[];
};

const ROUTES_MODULE_DRAFT_STORAGE_KEY = "routesModuleDraft";

const normalizeDraft = (value: RoutesModuleDraftState | null | undefined): RoutesModuleDraftState => ({
  companyNameQuery: value?.companyNameQuery ?? "",
  companyCodeQuery: value?.companyCodeQuery ?? "",
  selectedEmpresaIds: Array.from(
    new Set((value?.selectedEmpresaIds ?? value?.selectedAgendaIds ?? []).filter(Boolean)),
  ),
  selectedAgendaIds: Array.from(
    new Set((value?.selectedEmpresaIds ?? value?.selectedAgendaIds ?? []).filter(Boolean)),
  ),
});

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
    localStorage.setItem(
      ROUTES_MODULE_DRAFT_STORAGE_KEY,
      JSON.stringify(normalizeDraft(draft)),
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
