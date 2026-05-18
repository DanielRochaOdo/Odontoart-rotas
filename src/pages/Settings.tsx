
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { LoaderCircle, LogOut, Moon, Pencil, Plus, RotateCcw, Sun, Trash, UploadCloud } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  createManagedUser,
  deleteManagedUser,
  deleteProfileOnly,
  fetchManagedProfiles,
  fetchManagedUserEmails,
  resetManagedUserAccess,
  updateManagedProfile,
  updateManagedUserCredentials,
  type ManagedProfile,
} from "../lib/settingsApi";
import {
  createRouteEvent,
  deleteRouteEvent,
  fetchRouteEventsByYear,
  type RouteEventRow,
  type RouteEventType,
} from "../lib/routeEventsApi";
import { emitProfilesUpdated } from "../lib/profileEvents";
import { normalizeSearchText } from "../lib/textNormalize";
import {
  executeErpSyncWave,
  previewErpSyncCodes,
  unlockErpSyncSection,
  type ErpSyncExecuteItem,
  type ErpSyncPreviewResult,
} from "../lib/erpSyncApi";

type TabKey = "SUPERVISORES" | "VENDEDORES" | "ASSISTENTES" | "SINCRONIZACAO_ERP" | "EVENTOS";

type FormState = {
  display_name: string;
  email: string;
  password: string;
};

type VendorFormState = FormState & {
  supervisor_id: string;
  can_access_pre_cadastro: boolean;
};

type AssistantFormState = FormState;

const filterByRole = (profiles: ManagedProfile[], role: ManagedProfile["role"]) =>
  profiles.filter((profile) => profile.role === role);

const sortByName = (items: ManagedProfile[]) =>
  [...items].sort((a, b) => (a.nome ?? a.display_name ?? "").localeCompare(b.nome ?? b.display_name ?? ""));

const normalizeSearch = (value: string) => normalizeSearchText(value);
const SETTINGS_VIEW_STATE_KEY = "settingsViewStateV1";
const ERP_SYNC_UNLOCK_STATE_KEY = "erpSyncUnlockStateV1";
const EVENT_MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Marco",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const EVENT_WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];
const ERP_SYNC_DEFAULT_WAVE_LIMIT = 20;
const ERP_SYNC_MAX_WAVE_LIMIT = 50;

const isValidTabKey = (value: unknown): value is TabKey =>
  value === "SUPERVISORES" ||
  value === "VENDEDORES" ||
  value === "ASSISTENTES" ||
  value === "SINCRONIZACAO_ERP" ||
  value === "EVENTOS";

const toDateKey = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const formatEventDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;
  return `${day}/${month}/${year}`;
};

const formatEventTypeLabel = (eventType: RouteEventType) => {
  if (eventType === "REUNIAO") return "REUNIAO";
  return "TREINAMENTO";
};

const normalizeCalendarCursor = (year: number, month: number) => {
  const safeYear = Number.isInteger(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isInteger(month) ? month : new Date().getMonth();
  const cursor = new Date(safeYear, safeMonth, 1);
  return { year: cursor.getFullYear(), month: cursor.getMonth() };
};

const readSettingsViewState = () => {
  try {
    const raw = sessionStorage.getItem(SETTINGS_VIEW_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ activeTab: TabKey; searchTerm: string }>;
    return {
      activeTab: isValidTabKey(parsed.activeTab) ? parsed.activeTab : "SUPERVISORES",
      searchTerm: typeof parsed.searchTerm === "string" ? parsed.searchTerm : "",
    };
  } catch {
    return null;
  }
};

const isSessionExpiredError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("sua sessao foi encerrada") ||
    normalized.includes("sessao expirada") ||
    normalized.includes("sessao invalida") ||
    normalized.includes("unauthorized") ||
    normalized.includes("status 401") ||
    normalized.includes("jwt") ||
    normalized.includes("invalid refresh token") ||
    normalized.includes("refresh token not found")
  );
};

type ErpSyncUnlockStoredState = {
  unlock_token: string;
  expires_at: string;
  user_id: string;
};

const readErpSyncUnlockStoredState = () => {
  try {
    const raw = sessionStorage.getItem(ERP_SYNC_UNLOCK_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ErpSyncUnlockStoredState>;
    if (
      typeof parsed.unlock_token !== "string" ||
      typeof parsed.expires_at !== "string" ||
      typeof parsed.user_id !== "string"
    ) {
      return null;
    }
    return parsed as ErpSyncUnlockStoredState;
  } catch {
    return null;
  }
};

const writeErpSyncUnlockStoredState = (state: ErpSyncUnlockStoredState | null) => {
  try {
    if (!state) {
      sessionStorage.removeItem(ERP_SYNC_UNLOCK_STATE_KEY);
      return;
    }
    sessionStorage.setItem(ERP_SYNC_UNLOCK_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
};

const parseCodesFromText = (input: string) => {
  const tokens = input
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();

  tokens.forEach((token) => {
    if (seen.has(token)) return;
    seen.add(token);
    deduped.push(token);
  });

  return deduped;
};

const sanitizeWaveLimit = (value: string, maxLimit = ERP_SYNC_MAX_WAVE_LIMIT) => {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const numeric = Number(digits);
  if (!Number.isFinite(numeric)) return "";
  return String(Math.max(1, Math.min(maxLimit, Math.floor(numeric))));
};

const formatErpSyncValue = (value: string | number | null) => {
  if (value === null) return "(vazio)";
  return String(value);
};

const parseCodesFromWorkbook = (workbook: XLSX.WorkBook) => {
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [] as string[];
  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) return [] as string[];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
  if (!rows.length) return [] as string[];

  const firstRow = rows[0];
  const keys = Object.keys(firstRow ?? {});
  const normalizedKeyMap = new Map(keys.map((key) => [normalizeSearch(key), key]));
  const resolvedKey =
    normalizedKeyMap.get("codigo") ??
    normalizedKeyMap.get("cod_1") ??
    normalizedKeyMap.get("cod") ??
    keys[0];

  if (!resolvedKey) return [] as string[];

  return rows
    .map((row) => row[resolvedKey])
    .map((value) => (value === null || value === undefined ? "" : String(value).trim()))
    .filter(Boolean);
};

export default function Settings() {
  const { role, session, loading: authLoading, signOut } = useAuth();
  const canManageUsers = role === "SUPERVISOR";
  const canManageEvents = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canAccessSettings = canManageUsers || canManageEvents;
  const [themeMode, setThemeMode] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const stored = localStorage.getItem("theme");
    if (stored === "dark" || stored === "light") return stored;
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  const [activeTab, setActiveTab] = useState<TabKey>(() => readSettingsViewState()?.activeTab ?? "SUPERVISORES");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState(() => readSettingsViewState()?.searchTerm ?? "");
  const [profiles, setProfiles] = useState<ManagedProfile[]>([]);
  const [userEmailsByUserId, setUserEmailsByUserId] = useState<Record<string, string>>({});

  const [creatingSupervisor, setCreatingSupervisor] = useState(false);
  const [creatingVendor, setCreatingVendor] = useState(false);
  const [creatingAssistant, setCreatingAssistant] = useState(false);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetModalTab, setResetModalTab] = useState<TabKey>("VENDEDORES");
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsSaving, setEventsSaving] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsRows, setEventsRows] = useState<RouteEventRow[]>([]);
  const [eventsCalendarCursor, setEventsCalendarCursor] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  const [selectedEventDate, setSelectedEventDate] = useState(() => toDateKey(new Date()));
  const [eventType, setEventType] = useState<RouteEventType | "">("");
  const [eventTime, setEventTime] = useState("");
  const [eventNotes, setEventNotes] = useState("");
  const [eventFormResetKey, setEventFormResetKey] = useState(0);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [erpReleasePassword, setErpReleasePassword] = useState("");
  const [erpUnlockToken, setErpUnlockToken] = useState<string | null>(null);
  const [erpUnlockExpiresAt, setErpUnlockExpiresAt] = useState<string | null>(null);
  const [erpUnlockLoading, setErpUnlockLoading] = useState(false);
  const [erpUnlockError, setErpUnlockError] = useState<string | null>(null);
  const [erpCodesInput, setErpCodesInput] = useState("");
  const [erpCodesMessage, setErpCodesMessage] = useState<string | null>(null);
  const [erpPreview, setErpPreview] = useState<ErpSyncPreviewResult | null>(null);
  const [erpPreviewLoading, setErpPreviewLoading] = useState(false);
  const [erpWaveLimitInput, setErpWaveLimitInput] = useState(String(ERP_SYNC_DEFAULT_WAVE_LIMIT));
  const [erpExecuteOffset, setErpExecuteOffset] = useState(0);
  const [erpExecuteLoading, setErpExecuteLoading] = useState(false);
  const [erpLastWaveResults, setErpLastWaveResults] = useState<ErpSyncExecuteItem[]>([]);
  const [erpExecutionSummary, setErpExecutionSummary] = useState<{
    updated: number;
    no_changes: number;
    local_not_found: number;
    erp_not_found: number;
    no_mapped_fields: number;
    failed: number;
  } | null>(null);

  const [supervisorForm, setSupervisorForm] = useState<FormState>({
    display_name: "",
    email: "",
    password: "",
  });
  const [vendorForm, setVendorForm] = useState<VendorFormState>({
    display_name: "",
    email: "",
    password: "",
    supervisor_id: "",
    can_access_pre_cadastro: false,
  });
  const [assistantForm, setAssistantForm] = useState<AssistantFormState>({
    display_name: "",
    email: "",
    password: "",
  });

  const [editingSupervisorId, setEditingSupervisorId] = useState<string | null>(null);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [editingAssistantId, setEditingAssistantId] = useState<string | null>(null);

  const [supervisorEdit, setSupervisorEdit] = useState<FormState>({
    display_name: "",
    email: "",
    password: "",
  });
  const [vendorEdit, setVendorEdit] = useState<VendorFormState>({
    display_name: "",
    email: "",
    password: "",
    supervisor_id: "",
    can_access_pre_cadastro: false,
  });
  const [assistantEdit, setAssistantEdit] = useState<AssistantFormState>({
    display_name: "",
    email: "",
    password: "",
  });

  const applyThemeMode = (next: "light" | "dark") => {
    if (typeof window === "undefined") return;
    setThemeMode(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.body.classList.toggle("dark", next === "dark");
    localStorage.setItem("theme", next);
    window.dispatchEvent(new CustomEvent("odontoart-theme-changed", { detail: next }));
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncTheme = () => {
      const stored = localStorage.getItem("theme");
      if (stored === "dark" || stored === "light") {
        setThemeMode(stored);
      }
    };
    window.addEventListener("odontoart-theme-changed", syncTheme as EventListener);
    window.addEventListener("storage", syncTheme);
    return () => {
      window.removeEventListener("odontoart-theme-changed", syncTheme as EventListener);
      window.removeEventListener("storage", syncTheme);
    };
  }, []);

  const supervisors = useMemo(() => sortByName(filterByRole(profiles, "SUPERVISOR")), [profiles]);
  const vendors = useMemo(() => sortByName(filterByRole(profiles, "VENDEDOR")), [profiles]);
  const assistants = useMemo(() => sortByName(filterByRole(profiles, "ASSISTENTE")), [profiles]);
  const filteredSupervisors = useMemo(() => {
    const query = normalizeSearch(searchTerm);
    if (!query) return supervisors;
    return supervisors.filter((profile) =>
      normalizeSearch(
        `${profile.nome ?? profile.display_name ?? ""} ${profile.user_id ? userEmailsByUserId[profile.user_id] ?? "" : ""}`,
      ).includes(query),
    );
  }, [searchTerm, supervisors, userEmailsByUserId]);
  const filteredVendors = useMemo(() => {
    const query = normalizeSearch(searchTerm);
    if (!query) return vendors;
    return vendors.filter((profile) =>
      normalizeSearch(
        `${profile.nome ?? profile.display_name ?? ""} ${profile.user_id ? userEmailsByUserId[profile.user_id] ?? "" : ""} ${profile.supervisor?.display_name ?? ""}`,
      ).includes(query),
    );
  }, [searchTerm, vendors, userEmailsByUserId]);
  const filteredAssistants = useMemo(() => {
    const query = normalizeSearch(searchTerm);
    if (!query) return assistants;
    return assistants.filter((profile) =>
      normalizeSearch(
        `${profile.nome ?? profile.display_name ?? ""} ${profile.user_id ? userEmailsByUserId[profile.user_id] ?? "" : ""}`,
      ).includes(query),
    );
  }, [searchTerm, assistants, userEmailsByUserId]);
  const resetModalProfiles = useMemo(() => {
    if (resetModalTab === "SUPERVISORES") return supervisors;
    if (resetModalTab === "VENDEDORES") return vendors;
    return assistants;
  }, [assistants, resetModalTab, supervisors, vendors]);
  const eventsYear = eventsCalendarCursor.year;
  const eventsMonth = eventsCalendarCursor.month;
  const eventRowsByDate = useMemo(() => {
    const map = new Map<string, RouteEventRow[]>();
    eventsRows.forEach((row) => {
      if (!map.has(row.event_date)) {
        map.set(row.event_date, []);
      }
      map.get(row.event_date)!.push(row);
    });
    return map;
  }, [eventsRows]);
  const selectedDateEvents = useMemo(
    () => eventRowsByDate.get(selectedEventDate) ?? [],
    [eventRowsByDate, selectedEventDate],
  );
  const eventCalendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(eventsYear, eventsMonth, 1);
    const dayCount = new Date(eventsYear, eventsMonth + 1, 0).getDate();
    const leadingEmptyCells = (firstDayOfMonth.getDay() + 6) % 7;
    const cells: Array<Date | null> = [];

    for (let index = 0; index < leadingEmptyCells; index += 1) {
      cells.push(null);
    }
    for (let day = 1; day <= dayCount; day += 1) {
      cells.push(new Date(eventsYear, eventsMonth, day));
    }
    const trailingEmptyCells = (7 - (cells.length % 7)) % 7;
    for (let index = 0; index < trailingEmptyCells; index += 1) {
      cells.push(null);
    }
    return cells;
  }, [eventsMonth, eventsYear]);
  const erpNormalizedCodes = useMemo(() => parseCodesFromText(erpCodesInput), [erpCodesInput]);
  const erpCodesForExecution = erpPreview?.normalized_codes ?? erpNormalizedCodes;
  const erpHasUnlock = Boolean(erpUnlockToken);
  const erpRemainingCount = Math.max(0, erpCodesForExecution.length - erpExecuteOffset);

  useEffect(() => {
    setSelectedEventDate((prev) => {
      const [yearRaw, monthRaw] = prev.split("-");
      const selectedYear = Number(yearRaw);
      const selectedMonth = Number(monthRaw) - 1;
      if (selectedYear === eventsYear && selectedMonth === eventsMonth) return prev;
      return toDateKey(new Date(eventsYear, eventsMonth, 1));
    });
  }, [eventsMonth, eventsYear]);

  useEffect(() => {
    if (!isResetModalOpen) return;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsResetModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isResetModalOpen]);

  useEffect(() => {
    if (canManageUsers) return;
    if (activeTab !== "EVENTOS") {
      setActiveTab("EVENTOS");
    }
  }, [activeTab, canManageUsers]);

  const loadProfiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchManagedProfiles();
      setProfiles(data);
      const userIds = data.map((profile) => profile.user_id).filter((value): value is string => Boolean(value));
      const emails = await fetchManagedUserEmails(userIds);
      setUserEmailsByUserId((prev) => {
        const scopedPrevious: Record<string, string> = {};
        for (const userId of userIds) {
          if (prev[userId]) scopedPrevious[userId] = prev[userId];
        }
        return { ...scopedPrevious, ...emails };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar perfis.");
    } finally {
      setLoading(false);
    }
  };

  const getCurrentEmail = (profile: ManagedProfile) => {
    if (!profile.user_id) return "Sem usuario vinculado";
    if (session?.user.id === profile.user_id && session.user.email) {
      return session.user.email;
    }
    return userEmailsByUserId[profile.user_id] || "Nao disponivel";
  };

  useEffect(() => {
    if (authLoading) return;
    if (!canManageUsers || !session?.access_token) {
      setLoading(false);
      return;
    }
    loadProfiles();
  }, [authLoading, canManageUsers, session?.access_token]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        SETTINGS_VIEW_STATE_KEY,
        JSON.stringify({
          activeTab,
          searchTerm,
        }),
      );
    } catch {
      // ignore storage failures
    }
  }, [activeTab, searchTerm]);

  useEffect(() => {
    if (!canManageUsers || !session?.user.id) {
      writeErpSyncUnlockStoredState(null);
      return;
    }

    if (!erpUnlockToken || !erpUnlockExpiresAt) {
      writeErpSyncUnlockStoredState(null);
      return;
    }

    const expiresAtMs = new Date(erpUnlockExpiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      writeErpSyncUnlockStoredState(null);
      return;
    }

    writeErpSyncUnlockStoredState({
      unlock_token: erpUnlockToken,
      expires_at: erpUnlockExpiresAt,
      user_id: session.user.id,
    });
  }, [canManageUsers, erpUnlockExpiresAt, erpUnlockToken, session?.user.id]);

  useEffect(() => {
    if (!canManageUsers || !session?.user.id || erpUnlockToken) return;
    const stored = readErpSyncUnlockStoredState();
    if (!stored) return;

    if (stored.user_id !== session.user.id) {
      writeErpSyncUnlockStoredState(null);
      return;
    }

    const expiresAtMs = new Date(stored.expires_at).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      writeErpSyncUnlockStoredState(null);
      return;
    }

    setErpUnlockToken(stored.unlock_token);
    setErpUnlockExpiresAt(stored.expires_at);
    setErpUnlockError(null);
  }, [canManageUsers, erpUnlockToken, session?.user.id]);

  useEffect(() => {
    if (!erpUnlockToken || !erpUnlockExpiresAt) return;

    const expiresAtMs = new Date(erpUnlockExpiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) return;

    const remainingMs = expiresAtMs - Date.now();
    if (remainingMs <= 0) {
      setErpUnlockToken(null);
      setErpUnlockExpiresAt(null);
      setErpUnlockError("Sessao de liberacao expirada. Desbloqueie novamente.");
      setErpPreview(null);
      setErpExecuteOffset(0);
      setErpLastWaveResults([]);
      setErpExecutionSummary(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setErpUnlockToken(null);
      setErpUnlockExpiresAt(null);
      setErpUnlockError("Sessao de liberacao expirada. Desbloqueie novamente.");
      setErpPreview(null);
      setErpExecuteOffset(0);
      setErpLastWaveResults([]);
      setErpExecutionSummary(null);
    }, remainingMs + 250);

    return () => window.clearTimeout(timeoutId);
  }, [erpUnlockExpiresAt, erpUnlockToken]);

  useEffect(() => {
    if (!canManageEvents) return;
    let active = true;
    const loadEvents = async () => {
      setEventsLoading(true);
      setEventsError(null);
      try {
        const rows = await fetchRouteEventsByYear(eventsYear);
        if (!active) return;
        setEventsRows(rows);
      } catch (err) {
        if (!active) return;
        setEventsRows([]);
        setEventsError(err instanceof Error ? err.message : "Erro ao carregar eventos.");
      } finally {
        if (active) setEventsLoading(false);
      }
    };
    void loadEvents();
    return () => {
      active = false;
    };
  }, [canManageEvents, eventsYear]);

  const resetEdits = () => {
    setEditingSupervisorId(null);
    setEditingVendorId(null);
    setEditingAssistantId(null);
    setSupervisorEdit({ display_name: "", email: "", password: "" });
    setVendorEdit({
      display_name: "",
      email: "",
      password: "",
      supervisor_id: "",
      can_access_pre_cadastro: false,
    });
    setAssistantEdit({ display_name: "", email: "", password: "" });
  };

  const handleCreateSupervisor = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supervisorForm.display_name || !supervisorForm.email || !supervisorForm.password) {
      setError("Preencha nome, e-mail e senha.");
      return;
    }
    setCreatingSupervisor(true);
    setError(null);
    const createdEmail = supervisorForm.email.trim();
    try {
      const created = await createManagedUser({
        display_name: supervisorForm.display_name,
        nome: supervisorForm.display_name,
        email: supervisorForm.email,
        password: supervisorForm.password,
        role: "SUPERVISOR",
      });
      setProfiles((prev) => [created, ...prev]);
      if (created.user_id && createdEmail) {
        const createdUserId = created.user_id;
        setUserEmailsByUserId((prev) => ({ ...prev, [createdUserId]: createdEmail }));
      }
      emitProfilesUpdated();
      setSupervisorForm({ display_name: "", email: "", password: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar supervisor.");
    } finally {
      setCreatingSupervisor(false);
    }
  };

  const handleCreateVendor = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!vendorForm.display_name || !vendorForm.email || !vendorForm.password || !vendorForm.supervisor_id) {
      setError("Preencha nome, e-mail, senha e supervisor.");
      return;
    }
    setCreatingVendor(true);
    setError(null);
    const createdEmail = vendorForm.email.trim();
    try {
      const created = await createManagedUser({
        display_name: vendorForm.display_name,
        nome: vendorForm.display_name,
        email: vendorForm.email,
        password: vendorForm.password,
        role: "VENDEDOR",
        supervisor_id: vendorForm.supervisor_id,
        can_access_pre_cadastro: vendorForm.can_access_pre_cadastro,
      });
      setProfiles((prev) => [created, ...prev]);
      if (created.user_id && createdEmail) {
        const createdUserId = created.user_id;
        setUserEmailsByUserId((prev) => ({ ...prev, [createdUserId]: createdEmail }));
      }
      emitProfilesUpdated();
      setVendorForm({
        display_name: "",
        email: "",
        password: "",
        supervisor_id: "",
        can_access_pre_cadastro: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar vendedor.");
    } finally {
      setCreatingVendor(false);
    }
  };

  const handleCreateAssistant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assistantForm.display_name || !assistantForm.email || !assistantForm.password) {
      setError("Preencha nome, e-mail e senha.");
      return;
    }
    setCreatingAssistant(true);
    setError(null);
    const createdEmail = assistantForm.email.trim();
    try {
      const created = await createManagedUser({
        display_name: assistantForm.display_name,
        nome: assistantForm.display_name,
        email: assistantForm.email,
        password: assistantForm.password,
        role: "ASSISTENTE",
      });
      setProfiles((prev) => [created, ...prev]);
      if (created.user_id && createdEmail) {
        const createdUserId = created.user_id;
        setUserEmailsByUserId((prev) => ({ ...prev, [createdUserId]: createdEmail }));
      }
      emitProfilesUpdated();
      setAssistantForm({ display_name: "", email: "", password: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar assistente.");
    } finally {
      setCreatingAssistant(false);
    }
  };

  const handleEditSupervisor = (profile: ManagedProfile) => {
    resetEdits();
    setEditingSupervisorId(profile.id);
    setSupervisorEdit({
      display_name: profile.nome ?? profile.display_name ?? "",
      email: "",
      password: "",
    });
  };

  const handleEditVendor = (profile: ManagedProfile) => {
    resetEdits();
    setEditingVendorId(profile.id);
    setVendorEdit({
      display_name: profile.nome ?? profile.display_name ?? "",
      email: "",
      password: "",
      supervisor_id: profile.supervisor_id ?? "",
      can_access_pre_cadastro: profile.can_access_pre_cadastro ?? false,
    });
  };

  const handleEditAssistant = (profile: ManagedProfile) => {
    resetEdits();
    setEditingAssistantId(profile.id);
    setAssistantEdit({
      display_name: profile.nome ?? profile.display_name ?? "",
      email: "",
      password: "",
    });
  };
  const handleSaveSupervisor = async () => {
    if (!editingSupervisorId) return;
    if (!supervisorEdit.display_name) {
      setError("Nome do supervisor e obrigatorio.");
      return;
    }
    const current = profiles.find((item) => item.id === editingSupervisorId) ?? null;
    if (!current) {
      setError("Supervisor nao encontrado.");
      return;
    }

    setError(null);
    try {
      const updated = await updateManagedProfile({
        id: editingSupervisorId,
        display_name: supervisorEdit.display_name,
        nome: supervisorEdit.display_name,
        supervisor_id: null,
        vendedor_id: null,
      });
      setProfiles((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));

      if (supervisorEdit.email || supervisorEdit.password) {
        if (!current.user_id) throw new Error("Supervisor sem usuario vinculado.");
        const currentUserId = current.user_id;
        await updateManagedUserCredentials({
          user_id: currentUserId,
          email: supervisorEdit.email || null,
          password: supervisorEdit.password || null,
        });
        if (supervisorEdit.email.trim()) {
          setUserEmailsByUserId((prev) => ({ ...prev, [currentUserId]: supervisorEdit.email.trim() }));
        }
      }

      setEditingSupervisorId(null);
      setSupervisorEdit({ display_name: "", email: "", password: "" });
      emitProfilesUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar supervisor.");
    }
  };

  const handleSaveVendor = async () => {
    if (!editingVendorId) return;
    if (!vendorEdit.display_name || !vendorEdit.supervisor_id) {
      setError("Nome e supervisor sao obrigatorios.");
      return;
    }
    const current = profiles.find((item) => item.id === editingVendorId) ?? null;
    if (!current) {
      setError("Vendedor nao encontrado.");
      return;
    }

    setError(null);
    try {
      const updated = await updateManagedProfile({
        id: editingVendorId,
        display_name: vendorEdit.display_name,
        nome: vendorEdit.display_name,
        can_access_pre_cadastro: vendorEdit.can_access_pre_cadastro,
        supervisor_id: vendorEdit.supervisor_id,
        vendedor_id: null,
      });
      setProfiles((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));

      if (vendorEdit.email || vendorEdit.password) {
        if (!current.user_id) throw new Error("Vendedor sem usuario vinculado.");
        const currentUserId = current.user_id;
        await updateManagedUserCredentials({
          user_id: currentUserId,
          email: vendorEdit.email || null,
          password: vendorEdit.password || null,
        });
        if (vendorEdit.email.trim()) {
          setUserEmailsByUserId((prev) => ({ ...prev, [currentUserId]: vendorEdit.email.trim() }));
        }
      }

      setEditingVendorId(null);
      setVendorEdit({
        display_name: "",
        email: "",
        password: "",
        supervisor_id: "",
        can_access_pre_cadastro: false,
      });
      emitProfilesUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar vendedor.");
    }
  };

  const handleSaveAssistant = async () => {
    if (!editingAssistantId) return;
    if (!assistantEdit.display_name) {
      setError("Nome do assistente e obrigatorio.");
      return;
    }
    const current = profiles.find((item) => item.id === editingAssistantId) ?? null;
    if (!current) {
      setError("Assistente nao encontrado.");
      return;
    }

    setError(null);
    try {
      const updated = await updateManagedProfile({
        id: editingAssistantId,
        display_name: assistantEdit.display_name,
        nome: assistantEdit.display_name,
        vendedor_id: null,
        supervisor_id: null,
      });
      setProfiles((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));

      if (assistantEdit.email || assistantEdit.password) {
        if (!current.user_id) throw new Error("Assistente sem usuario vinculado.");
        const currentUserId = current.user_id;
        await updateManagedUserCredentials({
          user_id: currentUserId,
          email: assistantEdit.email || null,
          password: assistantEdit.password || null,
        });
        if (assistantEdit.email.trim()) {
          setUserEmailsByUserId((prev) => ({ ...prev, [currentUserId]: assistantEdit.email.trim() }));
        }
      }

      setEditingAssistantId(null);
      setAssistantEdit({ display_name: "", email: "", password: "" });
      emitProfilesUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar assistente.");
    }
  };

  const handleDelete = async (profile: ManagedProfile) => {
    const confirmDelete = window.confirm("Deseja excluir este usuario?");
    if (!confirmDelete) return;
    setError(null);
    try {
      if (profile.user_id) {
        await deleteManagedUser(profile.user_id);
      } else {
        await deleteProfileOnly(profile.id);
      }
      setProfiles((prev) => prev.filter((item) => item.id !== profile.id));
      if (profile.user_id) {
        const profileUserId = profile.user_id;
        setUserEmailsByUserId((prev) => {
          if (!prev[profileUserId]) return prev;
          const next = { ...prev };
          delete next[profileUserId];
          return next;
        });
      }
      resetEdits();
      emitProfilesUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir usuario.");
    }
  };

  const handleResetAccess = async (profile: ManagedProfile) => {
    if (!profile.user_id) {
      setError("Perfil sem usuario vinculado para reset de acesso.");
      return;
    }
    if (session?.user.id && profile.user_id === session.user.id) {
      setError("Nao e permitido resetar a propria sessao por este fluxo.");
      return;
    }

    const confirmReset = window.confirm(
      `Deseja limpar o acesso de ${profile.nome ?? profile.display_name ?? "este usuario"}?\n\nO usuario sera desconectado de todos os dispositivos e precisara entrar novamente.`,
    );
    if (!confirmReset) return;

    setResettingUserId(profile.user_id);
    setError(null);
    try {
      await resetManagedUserAccess({ user_id: profile.user_id });
      window.alert("Acesso limpo com sucesso. O usuario sera desconectado em instantes e precisara entrar novamente.");
      setIsResetModalOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao resetar acesso do usuario.";
      if (isSessionExpiredError(message)) {
        setError("Sua sessao de supervisor expirou para esta operacao. Faca login novamente e tente de novo.");
        return;
      }
      setError(message);
    } finally {
      setResettingUserId(null);
    }
  };

  const handleCreateEvent = async () => {
    if (!canManageEvents) return;
    if (!selectedEventDate) {
      setEventsError("Selecione uma data no calendario.");
      return;
    }
    if (!eventType) {
      setEventsError("Selecione o tipo do evento.");
      return;
    }
    setEventsSaving(true);
    setEventsError(null);
    try {
      const created = await createRouteEvent({
        event_date: selectedEventDate,
        event_type: eventType,
        event_time: eventTime || null,
        notes: eventNotes.trim() || null,
        created_by: session?.user.id ?? null,
      });
      setEventsRows((prev) =>
        [...prev, created].sort((left, right) => {
          if (left.event_date !== right.event_date) return left.event_date.localeCompare(right.event_date);
          const leftTime = left.event_time ?? "99:99:99";
          const rightTime = right.event_time ?? "99:99:99";
          if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
          return left.created_at.localeCompare(right.created_at);
        }),
      );
      setEventType("");
      setEventTime("");
      setEventNotes("");
      setEventFormResetKey((prev) => prev + 1);
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : "Erro ao salvar evento.");
    } finally {
      setEventsSaving(false);
    }
  };

  const handleDeleteEvent = async (eventRow: RouteEventRow) => {
    const confirmDelete = window.confirm(
      `Deseja excluir o evento ${formatEventTypeLabel(eventRow.event_type)} de ${formatEventDate(eventRow.event_date)}?`,
    );
    if (!confirmDelete) return;

    setDeletingEventId(eventRow.id);
    setEventsError(null);
    try {
      await deleteRouteEvent(eventRow.id);
      setEventsRows((prev) => prev.filter((row) => row.id !== eventRow.id));
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : "Erro ao excluir evento.");
    } finally {
      setDeletingEventId(null);
    }
  };

  const handleUnlockErpSection = async () => {
    const releasePassword = erpReleasePassword.trim();
    if (!releasePassword) {
      setErpUnlockError("Informe a senha de liberacao.");
      return;
    }

    setErpUnlockLoading(true);
    setErpUnlockError(null);
    try {
      const unlocked = await unlockErpSyncSection(releasePassword);
      setErpUnlockToken(unlocked.unlock_token);
      setErpUnlockExpiresAt(unlocked.expires_at);
      setErpReleasePassword("");
      setErpCodesMessage(null);
    } catch (err) {
      setErpUnlockError(err instanceof Error ? err.message : "Falha ao desbloquear sincronizacao ERP.");
    } finally {
      setErpUnlockLoading(false);
    }
  };

  const handleLockErpSection = () => {
    setErpUnlockToken(null);
    setErpUnlockExpiresAt(null);
    setErpUnlockError(null);
    setErpPreview(null);
    setErpExecuteOffset(0);
    setErpLastWaveResults([]);
    setErpExecutionSummary(null);
  };

  const handleUploadErpCodes = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;

    setErpCodesMessage(null);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (![ "csv", "xlsx", "xls" ].includes(extension)) {
        throw new Error("Arquivo invalido. Use CSV, XLSX ou XLS.");
      }
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const fileCodes = parseCodesFromWorkbook(workbook);
      if (!fileCodes.length) {
        throw new Error("Nenhum codigo encontrado no arquivo.");
      }

      const mergedCodes = Array.from(new Set([...erpNormalizedCodes, ...fileCodes]));
      setErpCodesInput(mergedCodes.join("\n"));
      setErpPreview(null);
      setErpExecuteOffset(0);
      setErpLastWaveResults([]);
      setErpExecutionSummary(null);
      setErpCodesMessage(`${fileCodes.length} codigo(s) lido(s) do arquivo. Total atual: ${mergedCodes.length}.`);
    } catch (err) {
      setErpCodesMessage(err instanceof Error ? err.message : "Falha ao carregar arquivo.");
    }
  };

  const handlePreviewErpSync = async () => {
    if (!erpUnlockToken) {
      setErpUnlockError("Desbloqueie a secao para continuar.");
      return;
    }
    if (!erpNormalizedCodes.length) {
      setErpCodesMessage("Informe pelo menos um codigo para gerar preview.");
      return;
    }

    setErpPreviewLoading(true);
    setErpCodesMessage(null);
    try {
      const preview = await previewErpSyncCodes({
        unlockToken: erpUnlockToken,
        codes: erpNormalizedCodes,
      });
      setErpPreview(preview);
      setErpExecuteOffset(0);
      setErpLastWaveResults([]);
      setErpExecutionSummary(null);
      const recommendedWave = String(Math.min(preview.recommended_wave_limit, preview.max_wave_limit));
      setErpWaveLimitInput(recommendedWave);
    } catch (err) {
      setErpCodesMessage(err instanceof Error ? err.message : "Falha ao gerar preview.");
    } finally {
      setErpPreviewLoading(false);
    }
  };

  const handleExecuteErpWave = async () => {
    if (!erpUnlockToken) {
      setErpUnlockError("Desbloqueie a secao para continuar.");
      return;
    }
    if (!erpCodesForExecution.length) {
      setErpCodesMessage("Nao ha codigos para processar.");
      return;
    }
    if (erpExecuteOffset >= erpCodesForExecution.length) {
      setErpCodesMessage("Todas as ondas ja foram processadas.");
      return;
    }

    const parsedLimit = Number(erpWaveLimitInput || ERP_SYNC_DEFAULT_WAVE_LIMIT);
    const safeLimit = Math.max(
      1,
      Math.min(Number.isFinite(parsedLimit) ? Math.floor(parsedLimit) : ERP_SYNC_DEFAULT_WAVE_LIMIT, ERP_SYNC_MAX_WAVE_LIMIT),
    );

    setErpExecuteLoading(true);
    setErpCodesMessage(null);
    try {
      const wave = await executeErpSyncWave({
        unlockToken: erpUnlockToken,
        codes: erpCodesForExecution,
        offset: erpExecuteOffset,
        limit: safeLimit,
      });

      setErpExecuteOffset(wave.next_offset);
      setErpLastWaveResults(wave.results);
      setErpExecutionSummary(wave.summary);
      if (!wave.has_more) {
        setErpCodesMessage("Sincronizacao concluida para todos os codigos da lista.");
      } else {
        setErpCodesMessage(
          `Onda concluida: ${wave.processed_count} codigo(s). Restante: ${wave.remaining_count}.`,
        );
      }
    } catch (err) {
      setErpCodesMessage(err instanceof Error ? err.message : "Falha ao executar onda.");
    } finally {
      setErpExecuteLoading(false);
    }
  };

  if (!canAccessSettings) {
    return (
      <div className="glass-pane rounded-2xl p-4 md:p-6">
        <h2 className="font-display text-2xl text-ink">Configuracoes</h2>
        <p className="mt-2 text-sm text-ink/60">Acesso restrito.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">Configuracoes</h2>
          <p className="mt-2 text-sm text-ink/60">
            Cadastre supervisores, vendedores e assistentes.
          </p>
        </div>
        <div className="flex items-center gap-2 hidden">
          <button
            type="button"
            onClick={() => applyThemeMode(themeMode === "dark" ? "light" : "dark")}
            className="inline-flex items-center gap-2 rounded-lg border border-sea/25 bg-white px-3 py-2 text-xs font-semibold text-ink/80 transition hover:border-sea hover:text-sea"
          >
            {themeMode === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {themeMode === "dark" ? "Modo claro" : "Modo escuro"}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-2 rounded-lg border border-sea/25 bg-white px-3 py-2 text-xs font-semibold text-ink/80 transition hover:border-sea hover:text-sea"
          >
            <LogOut size={14} />
            Sair
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
        {(canManageUsers
          ? [
              { key: "SUPERVISORES" as TabKey, label: "Supervisores" },
              { key: "VENDEDORES" as TabKey, label: "Vendedores" },
              { key: "ASSISTENTES" as TabKey, label: "Assistentes" },
              { key: "SINCRONIZACAO_ERP" as TabKey, label: "Sincronizacao ERP" },
              { key: "EVENTOS" as TabKey, label: "Eventos" },
            ]
          : [{ key: "EVENTOS" as TabKey, label: "Eventos" }]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key);
              setError(null);
            }}
            className={[
              "rounded-full px-4 py-2 text-xs font-semibold",
              activeTab === tab.key
                ? "bg-sea text-white"
                : "border border-sea/30 bg-white text-ink/70 hover:border-sea",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManageUsers &&
            (activeTab === "SUPERVISORES" ||
              activeTab === "VENDEDORES" ||
              activeTab === "ASSISTENTES") && (
            <button
              type="button"
              onClick={() => {
                setResetModalTab(activeTab);
                setIsResetModalOpen(true);
                setError(null);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 hover:border-amber-400"
            >
              <RotateCcw size={13} />
              Resetar sessao
            </button>
          )}
          {activeTab === "EVENTOS" ? (
            <button
              type="button"
              onClick={async () => {
                if (!canManageEvents) return;
                setEventsLoading(true);
                setEventsError(null);
                try {
                  const rows = await fetchRouteEventsByYear(eventsYear);
                  setEventsRows(rows);
                } catch (err) {
                  setEventsError(err instanceof Error ? err.message : "Erro ao atualizar eventos.");
                } finally {
                  setEventsLoading(false);
                }
              }}
              className="rounded-full border border-sea/30 bg-white px-4 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
            >
              Atualizar eventos
            </button>
          ) : activeTab === "SINCRONIZACAO_ERP" ? (
            <button
              type="button"
              onClick={handleLockErpSection}
              className="rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 hover:border-amber-400 disabled:opacity-50"
              disabled={!erpHasUnlock}
            >
              Bloquear secao
            </button>
          ) : (
            <>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={`Pesquisar ${
                  activeTab === "SUPERVISORES"
                    ? "supervisores"
                    : activeTab === "VENDEDORES"
                      ? "vendedores"
                      : "assistentes"
                }`}
                className="rounded-full border border-sea/20 bg-white px-4 py-2 text-xs text-ink outline-none focus:border-sea"
              />
              <button
                type="button"
                onClick={loadProfiles}
                className="rounded-full border border-sea/30 bg-white px-4 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Atualizar lista
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}
      {eventsError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {eventsError}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink/60">Carregando...</p>
      ) : (
        <div className="space-y-4 md:space-y-6">
          {canManageUsers && activeTab === "SUPERVISORES" && (
            <section className="rounded-2xl border border-sea/20 bg-sand/20 p-3 md:p-4">
              <h3 className="font-display text-lg text-ink">Supervisores</h3>
              <form onSubmit={handleCreateSupervisor} className="mt-4 grid gap-3 md:grid-cols-4">
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Nome
                  <input
                    value={supervisorForm.display_name}
                    onChange={(event) =>
                      setSupervisorForm((prev) => ({ ...prev, display_name: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    value={supervisorForm.email}
                    onChange={(event) => setSupervisorForm((prev) => ({ ...prev, email: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Senha
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={supervisorForm.password}
                    onChange={(event) =>
                      setSupervisorForm((prev) => ({ ...prev, password: event.target.value }))
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={creatingSupervisor}
                    className="inline-flex items-center gap-2 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                  >
                    <Plus size={14} />
                    {creatingSupervisor ? "Criando" : "Criar supervisor"}
                  </button>
                </div>
              </form>

              <div className="mt-4 space-y-2">
                {filteredSupervisors.length === 0 ? (
                  <p className="text-xs text-ink/60">
                    {searchTerm ? "Nenhum supervisor encontrado." : "Nenhum supervisor cadastrado."}
                  </p>
                ) : (
                  filteredSupervisors.map((supervisor) => (
                    <div
                      key={supervisor.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sea/15 bg-white/90 px-3 py-2"
                    >
                      {editingSupervisorId === supervisor.id ? (
                        <form
                          className="flex flex-1 flex-wrap items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            handleSaveSupervisor();
                          }}
                        >
                          <span className="text-xs text-ink/60">
                            Email atual: {getCurrentEmail(supervisor)}
                          </span>
                          <input
                            value={supervisorEdit.display_name}
                            onChange={(event) =>
                              setSupervisorEdit((prev) => ({ ...prev, display_name: event.target.value }))
                            }
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <input
                            type="email"
                            autoComplete="email"
                            placeholder="Novo email"
                            value={supervisorEdit.email}
                            onChange={(event) =>
                              setSupervisorEdit((prev) => ({ ...prev, email: event.target.value }))
                            }
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <input
                            type="password"
                            autoComplete="new-password"
                            placeholder="Nova senha"
                            value={supervisorEdit.password}
                            onChange={(event) =>
                              setSupervisorEdit((prev) => ({ ...prev, password: event.target.value }))
                            }
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <button
                            type="submit"
                            className="rounded-lg bg-sea px-2 py-1 text-[11px] font-semibold text-white hover:bg-seaLight"
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSupervisorId(null)}
                            className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-[11px] text-ink/70"
                          >
                            Cancelar
                          </button>
                        </form>
                      ) : (
                        <div>
                          <p className="text-sm font-semibold text-ink">
                            {supervisor.nome ?? supervisor.display_name ?? "Sem nome"}
                          </p>
                          <p className="text-xs text-ink/60">Supervisor</p>
                          <p className="text-xs text-ink/60">
                            Email: {getCurrentEmail(supervisor)}
                          </p>
                        </div>
                      )}
                      {editingSupervisorId !== supervisor.id && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditSupervisor(supervisor)}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink/70 hover:border-sea"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(supervisor)}
                            className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 hover:border-red-300"
                          >
                            <Trash size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
          {canManageUsers && activeTab === "VENDEDORES" && (
            <section className="rounded-2xl border border-sea/20 bg-sand/20 p-3 md:p-4">
              <h3 className="font-display text-lg text-ink">Vendedores</h3>
              <form onSubmit={handleCreateVendor} className="mt-4 grid gap-3 md:grid-cols-5">
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Nome
                  <input
                    value={vendorForm.display_name}
                    onChange={(event) => setVendorForm((prev) => ({ ...prev, display_name: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    value={vendorForm.email}
                    onChange={(event) => setVendorForm((prev) => ({ ...prev, email: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Senha
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={vendorForm.password}
                    onChange={(event) => setVendorForm((prev) => ({ ...prev, password: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Supervisor
                  <select
                    value={vendorForm.supervisor_id}
                    onChange={(event) => setVendorForm((prev) => ({ ...prev, supervisor_id: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  >
                    <option value="">Selecione</option>
                    {supervisors.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.nome ?? item.display_name ?? item.user_id}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={creatingVendor}
                    className="inline-flex items-center gap-2 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                  >
                    <Plus size={14} />
                    {creatingVendor ? "Criando" : "Criar vendedor"}
                  </button>
                </div>
              </form>

              <div className="mt-4 space-y-2">
                {filteredVendors.length === 0 ? (
                  <p className="text-xs text-ink/60">
                    {searchTerm ? "Nenhum vendedor encontrado." : "Nenhum vendedor cadastrado."}
                  </p>
                ) : (
                  filteredVendors.map((vendor) => (
                    <div
                      key={vendor.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sea/15 bg-white/90 px-3 py-2"
                    >
                      {editingVendorId === vendor.id ? (
                        <form
                          className="flex flex-1 flex-wrap items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            handleSaveVendor();
                          }}
                        >
                          <span className="text-xs text-ink/60">
                            Email atual: {getCurrentEmail(vendor)}
                          </span>
                          <input
                            value={vendorEdit.display_name}
                            onChange={(event) => setVendorEdit((prev) => ({ ...prev, display_name: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <select
                            value={vendorEdit.supervisor_id}
                            onChange={(event) => setVendorEdit((prev) => ({ ...prev, supervisor_id: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          >
                            <option value="">Supervisor</option>
                            {supervisors.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.nome ?? item.display_name ?? item.user_id}
                              </option>
                            ))}
                          </select>
                          <input
                            type="email"
                            autoComplete="email"
                            placeholder="Novo email"
                            value={vendorEdit.email}
                            onChange={(event) => setVendorEdit((prev) => ({ ...prev, email: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <input
                            type="password"
                            autoComplete="new-password"
                            placeholder="Nova senha"
                            value={vendorEdit.password}
                            onChange={(event) => setVendorEdit((prev) => ({ ...prev, password: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <button
                            type="submit"
                            className="rounded-lg bg-sea px-2 py-1 text-[11px] font-semibold text-white hover:bg-seaLight"
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingVendorId(null)}
                            className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-[11px] text-ink/70"
                          >
                            Cancelar
                          </button>
                        </form>
                      ) : (
                        <div>
                          <p className="text-sm font-semibold text-ink">
                            {vendor.nome ?? vendor.display_name ?? "Sem nome"}
                          </p>
                          <p className="text-xs text-ink/60">
                            Supervisor: {vendor.supervisor?.display_name ?? "Nao informado"}
                          </p>
                          <p className="text-xs text-ink/60">
                            Email: {getCurrentEmail(vendor)}
                          </p>
                        </div>
                      )}
                      {editingVendorId !== vendor.id && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditVendor(vendor)}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink/70 hover:border-sea"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(vendor)}
                            className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 hover:border-red-300"
                          >
                            <Trash size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {canManageUsers && activeTab === "ASSISTENTES" && (
            <section className="rounded-2xl border border-sea/20 bg-sand/20 p-3 md:p-4">
              <h3 className="font-display text-lg text-ink">Assistentes</h3>
              <form onSubmit={handleCreateAssistant} className="mt-4 grid gap-3 md:grid-cols-4">
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Nome
                  <input
                    value={assistantForm.display_name}
                    onChange={(event) => setAssistantForm((prev) => ({ ...prev, display_name: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    value={assistantForm.email}
                    onChange={(event) => setAssistantForm((prev) => ({ ...prev, email: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Senha
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={assistantForm.password}
                    onChange={(event) => setAssistantForm((prev) => ({ ...prev, password: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={creatingAssistant}
                    className="inline-flex items-center gap-2 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                  >
                    <Plus size={14} />
                    {creatingAssistant ? "Criando" : "Criar assistente"}
                  </button>
                </div>
              </form>

              <div className="mt-4 space-y-2">
                {filteredAssistants.length === 0 ? (
                  <p className="text-xs text-ink/60">
                    {searchTerm ? "Nenhum assistente encontrado." : "Nenhum assistente cadastrado."}
                  </p>
                ) : (
                  filteredAssistants.map((assistant) => (
                    <div
                      key={assistant.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sea/15 bg-white/90 px-3 py-2"
                    >
                      {editingAssistantId === assistant.id ? (
                        <form
                          className="flex flex-1 flex-wrap items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            handleSaveAssistant();
                          }}
                        >
                          <span className="text-xs text-ink/60">
                            Email atual: {getCurrentEmail(assistant)}
                          </span>
                          <input
                            value={assistantEdit.display_name}
                            onChange={(event) => setAssistantEdit((prev) => ({ ...prev, display_name: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <input
                            type="email"
                            autoComplete="email"
                            placeholder="Novo email"
                            value={assistantEdit.email}
                            onChange={(event) => setAssistantEdit((prev) => ({ ...prev, email: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <input
                            type="password"
                            autoComplete="new-password"
                            placeholder="Nova senha"
                            value={assistantEdit.password}
                            onChange={(event) => setAssistantEdit((prev) => ({ ...prev, password: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <button
                            type="submit"
                            className="rounded-lg bg-sea px-2 py-1 text-[11px] font-semibold text-white hover:bg-seaLight"
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingAssistantId(null)}
                            className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-[11px] text-ink/70"
                          >
                            Cancelar
                          </button>
                        </form>
                      ) : (
                        <div>
                          <p className="text-sm font-semibold text-ink">
                            {assistant.nome ?? assistant.display_name ?? "Sem nome"}
                          </p>
                          <p className="text-xs text-ink/60">Assistente</p>
                          <p className="text-xs text-ink/60">
                            Email: {getCurrentEmail(assistant)}
                          </p>
                        </div>
                      )}
                      {editingAssistantId !== assistant.id && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditAssistant(assistant)}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink/70 hover:border-sea"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(assistant)}
                            className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 hover:border-red-300"
                          >
                            <Trash size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {canManageUsers && activeTab === "SINCRONIZACAO_ERP" && (
            <section className="space-y-4 rounded-2xl border border-sea/20 bg-sand/20 p-3 md:p-4">
              <header>
                <h3 className="font-display text-lg text-ink">Sincronizacao ERP</h3>
                <p className="mt-1 text-xs text-ink/60">
                  Atualize empresas por codigo (manual) com lotes seguros e execucao em ondas.
                </p>
              </header>

              {!erpHasUnlock ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                  <p className="text-xs font-semibold text-amber-800">
                    Secao protegida. Informe a senha de liberacao para acessar.
                  </p>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs font-semibold text-ink/70">
                      Senha de liberacao
                      <input
                        type="password"
                        value={erpReleasePassword}
                        onChange={(event) => setErpReleasePassword(event.target.value)}
                        className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                        placeholder="Senha"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleUnlockErpSection()}
                      disabled={erpUnlockLoading}
                      className="inline-flex items-center gap-2 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                    >
                      {erpUnlockLoading ? <LoaderCircle size={14} className="animate-spin" /> : null}
                      {erpUnlockLoading ? "Desbloqueando" : "Desbloquear secao"}
                    </button>
                  </div>
                  {erpUnlockError && (
                    <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600">
                      {erpUnlockError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    Secao desbloqueada ate{" "}
                    {erpUnlockExpiresAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(erpUnlockExpiresAt)) : "-"}.
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2 rounded-xl border border-sea/15 bg-white/90 p-3">
                      <p className="text-xs font-semibold text-ink/70">Lista de codigos</p>
                      <textarea
                        value={erpCodesInput}
                        onChange={(event) => {
                          setErpCodesInput(event.target.value);
                          setErpPreview(null);
                          setErpExecuteOffset(0);
                          setErpLastWaveResults([]);
                          setErpExecutionSummary(null);
                        }}
                        rows={10}
                        placeholder="Um codigo por linha ou separado por virgula"
                        className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs text-ink outline-none focus:border-sea"
                      />
                      <p className="text-[11px] text-ink/60">
                        Codigos unicos prontos para sincronizacao: {erpNormalizedCodes.length}
                      </p>
                    </div>

                    <div className="space-y-3 rounded-xl border border-sea/15 bg-white/90 p-3">
                      <p className="text-xs font-semibold text-ink/70">Upload CSV/XLSX</p>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-sea/25 bg-white px-3 py-2 text-xs font-semibold text-ink/80 hover:border-sea">
                        <UploadCloud size={14} />
                        Carregar arquivo
                        <input
                          type="file"
                          accept=".csv,.xlsx,.xls"
                          className="hidden"
                          onChange={(event) => void handleUploadErpCodes(event)}
                        />
                      </label>
                      <p className="text-[11px] text-ink/60">
                        Use coluna <code>codigo</code> (ou primeira coluna do arquivo).
                      </p>
                      <div className="flex flex-wrap items-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => void handlePreviewErpSync()}
                          disabled={erpPreviewLoading || !erpNormalizedCodes.length}
                          className="inline-flex items-center gap-2 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                        >
                          {erpPreviewLoading ? <LoaderCircle size={14} className="animate-spin" /> : null}
                          {erpPreviewLoading ? "Gerando preview" : "Gerar preview"}
                        </button>
                        <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                          Tamanho da onda (max {ERP_SYNC_MAX_WAVE_LIMIT})
                          <input
                            value={erpWaveLimitInput}
                            onChange={(event) => setErpWaveLimitInput(sanitizeWaveLimit(event.target.value))}
                            className="w-24 rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void handleExecuteErpWave()}
                          disabled={erpExecuteLoading || !erpCodesForExecution.length || erpRemainingCount <= 0}
                          className="inline-flex items-center gap-2 rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/80 hover:border-sea disabled:opacity-60"
                        >
                          {erpExecuteLoading ? <LoaderCircle size={14} className="animate-spin" /> : null}
                          {erpExecuteLoading ? "Processando onda" : "Executar proxima onda"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {erpCodesMessage && (
                    <div className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink/70">
                      {erpCodesMessage}
                    </div>
                  )}

                  {erpPreview && (
                    <div className="rounded-xl border border-sea/15 bg-white/90 p-3 text-xs text-ink/80">
                      <p className="font-semibold text-ink">Preview</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <p>Total codigos: {erpPreview.total_codes}</p>
                        <p>Encontrados local: {erpPreview.found_local_count}</p>
                        <p>Nao encontrados local: {erpPreview.missing_local_count}</p>
                        <p>Restante para ondas: {erpRemainingCount}</p>
                      </div>
                      {erpPreview.missing_local_codes.length > 0 && (
                        <p className="mt-2 text-[11px] text-amber-700">
                          Codigos sem cadastro local: {erpPreview.missing_local_codes.slice(0, 20).join(", ")}
                          {erpPreview.missing_local_codes.length > 20 ? " ..." : ""}
                        </p>
                      )}
                    </div>
                  )}

                  {erpExecutionSummary && (
                    <div className="rounded-xl border border-sea/15 bg-white/90 p-3 text-xs text-ink/80">
                      <p className="font-semibold text-ink">Resumo da ultima onda</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                        <p>Atualizados: {erpExecutionSummary.updated}</p>
                        <p>Sem mudanca: {erpExecutionSummary.no_changes}</p>
                        <p>Sem local: {erpExecutionSummary.local_not_found}</p>
                        <p>Sem ERP: {erpExecutionSummary.erp_not_found}</p>
                        <p>Sem campos: {erpExecutionSummary.no_mapped_fields}</p>
                        <p>Falhas: {erpExecutionSummary.failed}</p>
                      </div>
                    </div>
                  )}

                  {erpLastWaveResults.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-sea/15 bg-white/95">
                      <table className="min-w-full divide-y divide-sea/10 text-xs">
                        <thead className="bg-sand/40 text-ink/70">
                          <tr>
                            <th className="px-3 py-2 text-left">Codigo</th>
                            <th className="px-3 py-2 text-left">Status</th>
                            <th className="px-3 py-2 text-left">Rows atualizadas</th>
                            <th className="px-3 py-2 text-left">Rows alteradas</th>
                            <th className="px-3 py-2 text-left">Campos</th>
                            <th className="px-3 py-2 text-left">Mudancas</th>
                            <th className="px-3 py-2 text-left">Mensagem</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-sea/10 text-ink/80">
                          {erpLastWaveResults.map((result) => (
                            <tr key={`${result.code}-${result.status}-${result.updated_rows}`}>
                              <td className="whitespace-nowrap px-3 py-2 font-semibold text-ink">{result.code}</td>
                              <td className="whitespace-nowrap px-3 py-2">{result.status}</td>
                              <td className="whitespace-nowrap px-3 py-2">{result.updated_rows}</td>
                              <td className="whitespace-nowrap px-3 py-2">{result.changed_rows}</td>
                              <td className="px-3 py-2">{result.fields.join(", ") || "-"}</td>
                              <td className="px-3 py-2">
                                {result.changes.length
                                  ? result.changes
                                      .map(
                                        (change) =>
                                          `${change.field}: ${change.from_values
                                            .map((value) => formatErpSyncValue(value))
                                            .join(" / ")} -> ${formatErpSyncValue(change.to_value)} (${change.changed_rows})`,
                                      )
                                      .join(" | ")
                                  : "-"}
                              </td>
                              <td className="px-3 py-2">{result.message ?? "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {canManageEvents && activeTab === "EVENTOS" && (
            <section className="rounded-2xl border border-sea/20 bg-sand/20 p-3 md:p-4">
              <h3 className="font-display text-lg text-ink">Eventos</h3>
              <p className="mt-1 text-xs text-ink/60">
                Cadastre eventos que devem gerar aviso ao criar rota na mesma data.
              </p>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                <div className="rounded-2xl border border-sea/20 bg-white/90 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={eventsMonth}
                        onChange={(event) => {
                          const nextMonth = Number(event.target.value);
                          if (!Number.isInteger(nextMonth) || nextMonth < 0 || nextMonth > 11) return;
                          setEventsCalendarCursor((prev) => normalizeCalendarCursor(prev.year, nextMonth));
                        }}
                        className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                      >
                        {EVENT_MONTH_LABELS.map((label, index) => (
                          <option key={label} value={index}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={eventsYear}
                        onChange={(event) => {
                          const nextYear = Number(event.target.value);
                          if (!Number.isInteger(nextYear) || nextYear < 2000 || nextYear > 2100) return;
                          setEventsCalendarCursor((prev) => normalizeCalendarCursor(nextYear, prev.month));
                        }}
                        min={2000}
                        max={2100}
                        className="w-24 rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-7 gap-2 text-center text-[11px] font-semibold text-ink/60">
                    {EVENT_WEEKDAY_LABELS.map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-7 gap-2">
                    {eventCalendarCells.map((date, index) => {
                      if (!date) {
                        return <div key={`event-empty-${index}`} className="h-14 rounded-xl" aria-hidden="true" />;
                      }
                      const dateKey = toDateKey(date);
                      const isSelected = selectedEventDate === dateKey;
                      const dayEvents = eventRowsByDate.get(dateKey) ?? [];
                      const hasEvents = dayEvents.length > 0;
                      return (
                        <button
                          key={dateKey}
                          type="button"
                          onClick={() => setSelectedEventDate(dateKey)}
                          className={[
                            "h-14 rounded-xl border px-1 text-xs transition",
                            isSelected
                              ? "border-sea bg-sea/10 text-sea"
                              : hasEvents
                                ? "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400"
                                : "border-sea/15 bg-white text-ink/70 hover:border-sea/40",
                          ].join(" ")}
                        >
                          <span className="font-semibold">{date.getDate()}</span>
                          {hasEvents && <span className="mt-1 block text-[10px]">{dayEvents.length} evento(s)</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div key={eventFormResetKey} className="rounded-2xl border border-sea/20 bg-white/90 p-3">
                  <h4 className="text-sm font-semibold text-ink">Novo evento</h4>
                  <p className="mt-1 text-xs text-ink/60">Data selecionada: {formatEventDate(selectedEventDate)}</p>

                  <div className="mt-3 grid gap-3">
                    <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                      Tipo (obrigatorio)
                      <select
                        value={eventType}
                        onChange={(event) => setEventType(event.target.value as RouteEventType | "")}
                        className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                      >
                        <option value="">Selecione</option>
                        <option value="TREINAMENTO">TREINAMENTO</option>
                        <option value="REUNIAO">REUNIÃO</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                      Horario (opcional)
                      <input
                        type="time"
                        value={eventTime}
                        onChange={(event) => setEventTime(event.target.value)}
                        className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                      Observacao (opcional)
                      <textarea
                        rows={3}
                        value={eventNotes}
                        onChange={(event) => setEventNotes(event.target.value)}
                        className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleCreateEvent}
                      disabled={eventsSaving || !eventType || !selectedEventDate}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                    >
                      <Plus size={13} />
                      {eventsSaving ? "Salvando..." : "Salvar evento"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-sea/20 bg-white/90 p-3">
                <h4 className="text-sm font-semibold text-ink">
                  Eventos de {formatEventDate(selectedEventDate)}
                </h4>
                {eventsLoading ? (
                  <p className="mt-2 text-xs text-ink/60">Carregando eventos...</p>
                ) : selectedDateEvents.length === 0 ? (
                  <p className="mt-2 text-xs text-ink/60">Nenhum evento para esta data.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {selectedDateEvents.map((row) => (
                      <div
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sea/15 bg-sand/30 px-3 py-2"
                      >
                        <div>
                          <p className="text-xs font-semibold text-ink">
                            {formatEventTypeLabel(row.event_type)}
                            {row.event_time ? ` - ${row.event_time.slice(0, 5)}` : ""}
                          </p>
                          {row.notes ? <p className="text-xs text-ink/60">{row.notes}</p> : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteEvent(row)}
                          disabled={deletingEventId === row.id}
                          className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 hover:border-red-300 disabled:opacity-60"
                        >
                          {deletingEventId === row.id ? "Excluindo..." : "Excluir"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {isResetModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setIsResetModalOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-sea/20 bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg text-ink">Resetar sessao de usuario</h3>
                <p className="mt-1 text-xs text-ink/60">
                  Selecione o usuario correto por perfil e limpe apenas a sessao dele.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink/70 hover:border-sea"
              >
                Fechar
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { key: "SUPERVISORES" as TabKey, label: "Supervisores" },
                { key: "VENDEDORES" as TabKey, label: "Vendedores" },
                { key: "ASSISTENTES" as TabKey, label: "Assistentes" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setResetModalTab(tab.key)}
                  className={[
                    "rounded-full px-3 py-1.5 text-xs font-semibold",
                    resetModalTab === tab.key
                      ? "bg-sea text-white"
                      : "border border-sea/30 bg-white text-ink/70 hover:border-sea",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {resetModalProfiles.length === 0 ? (
                <p className="text-xs text-ink/60">Nenhum usuario encontrado nesta aba.</p>
              ) : (
                resetModalProfiles.map((profileItem) => (
                  <div
                    key={profileItem.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sea/15 bg-sand/20 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {profileItem.nome ?? profileItem.display_name ?? "Sem nome"}
                        {profileItem.user_id && session?.user.id === profileItem.user_id ? " (voce)" : ""}
                      </p>
                      <p className="text-xs text-ink/60">
                        {profileItem.role === "SUPERVISOR"
                          ? "Supervisor"
                          : profileItem.role === "VENDEDOR"
                            ? "Vendedor"
                            : "Assistente"}
                      </p>
                      <p className="text-xs text-ink/60">Email: {getCurrentEmail(profileItem)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleResetAccess(profileItem)}
                      disabled={
                        !profileItem.user_id ||
                        resettingUserId === profileItem.user_id ||
                        profileItem.user_id === session?.user.id
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                      title={
                        !profileItem.user_id
                          ? "Perfil sem usuario vinculado"
                          : profileItem.user_id === session?.user.id
                            ? "Nao e permitido resetar sua propria sessao"
                            : "Limpar acesso e forcar novo login"
                      }
                    >
                      <RotateCcw size={12} />
                      {resettingUserId === profileItem.user_id ? "Limpando" : "Resetar acesso"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


