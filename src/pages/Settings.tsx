
import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, RotateCcw, Trash } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  createManagedUser,
  deleteManagedUser,
  deleteProfileOnly,
  fetchManagedProfiles,
  fetchManagedUserEmails,
  resetAllManagedUsersAccess,
  resetManagedUserAccess,
  updateManagedProfile,
  updateManagedUserCredentials,
  type ManagedProfile,
} from "../lib/settingsApi";
import { emitProfilesUpdated } from "../lib/profileEvents";
import { normalizeSearchText } from "../lib/textNormalize";

type TabKey = "SUPERVISORES" | "VENDEDORES" | "ASSISTENTES";

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

const isValidTabKey = (value: unknown): value is TabKey =>
  value === "SUPERVISORES" || value === "VENDEDORES" || value === "ASSISTENTES";

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

export default function Settings() {
  const { role, session, loading: authLoading, signOut } = useAuth();
  const isSupervisor = role === "SUPERVISOR";

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
  const [resettingAllAccess, setResettingAllAccess] = useState(false);

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
    if (authLoading || !isSupervisor || !session?.access_token) return;
    loadProfiles();
  }, [authLoading, isSupervisor, session?.access_token]);

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

    const confirmReset = window.confirm(
      `Deseja limpar o acesso de ${profile.nome ?? profile.display_name ?? "este usuario"}?\n\nO usuario sera desconectado de todos os dispositivos e precisara entrar novamente.`,
    );
    if (!confirmReset) return;

    setResettingUserId(profile.user_id);
    setError(null);
    try {
      await resetManagedUserAccess({ user_id: profile.user_id });
      window.alert("Acesso limpo com sucesso. Oriente o usuario a tentar login novamente.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao resetar acesso do usuario.";
      if (isSessionExpiredError(message)) {
        await signOut();
        return;
      }
      setError(message);
    } finally {
      setResettingUserId(null);
    }
  };

  const handleResetAllAccess = async () => {
    const confirmReset = window.confirm(
      "Deseja limpar o acesso de TODOS os usuarios?\n\nTodos serao desconectados de todos os dispositivos, incluindo voce.",
    );
    if (!confirmReset) return;

    setResettingAllAccess(true);
    setError(null);
    try {
      await resetAllManagedUsersAccess();
      window.alert("Acesso de todos os usuarios limpo com sucesso. Voce sera desconectado agora.");
      await signOut();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao resetar acesso global.";
      if (isSessionExpiredError(message)) {
        await signOut();
        return;
      }
      setError(message);
    } finally {
      setResettingAllAccess(false);
    }
  };

  if (!isSupervisor) {
    return (
      <div className="rounded-2xl border border-sea/20 bg-white/90 p-6">
        <h2 className="font-display text-2xl text-ink">Configuracoes</h2>
        <p className="mt-2 text-sm text-ink/60">Acesso restrito a supervisores.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-ink">Configuracoes</h2>
        <p className="mt-2 text-sm text-ink/60">
          Cadastre supervisores, vendedores e assistentes.
        </p>
      </header>

      <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-red-800">Acesso global</p>
            <p className="text-xs text-red-700">
              Desconecta todos os usuarios (vendedores, assistentes e supervisores).
            </p>
          </div>
          <button
            type="button"
            onClick={handleResetAllAccess}
            disabled={resettingAllAccess}
            className={[
              "rounded-full px-4 py-2 text-xs font-semibold text-white",
              resettingAllAccess ? "bg-red-300" : "bg-red-600 hover:bg-red-700",
            ].join(" ")}
          >
            {resettingAllAccess ? "Limpando tudo" : "Resetar acesso de todos"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
        {[
          { key: "SUPERVISORES" as TabKey, label: "Supervisores" },
          { key: "VENDEDORES" as TabKey, label: "Vendedores" },
          { key: "ASSISTENTES" as TabKey, label: "Assistentes" },
        ].map((tab) => (
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
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink/60">Carregando...</p>
      ) : (
        <div className="space-y-6">
          {activeTab === "SUPERVISORES" && (
            <section className="rounded-2xl border border-sea/20 bg-sand/20 p-4">
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
                            onClick={() => handleResetAccess(supervisor)}
                            disabled={!supervisor.user_id || resettingUserId === supervisor.user_id}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                            title={supervisor.user_id ? "Limpar acesso e forcar novo login" : "Perfil sem usuario vinculado"}
                          >
                            <RotateCcw size={12} />
                            {resettingUserId === supervisor.user_id ? "Limpando" : "Resetar acesso"}
                          </button>
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
          {activeTab === "VENDEDORES" && (
            <section className="rounded-2xl border border-sea/20 bg-sand/20 p-4">
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
                <label className="flex items-center gap-2 rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs font-semibold text-ink/70 md:self-end">
                  <input
                    type="checkbox"
                    checked={vendorForm.can_access_pre_cadastro}
                    onChange={(event) =>
                      setVendorForm((prev) => ({ ...prev, can_access_pre_cadastro: event.target.checked }))
                    }
                    className="h-4 w-4 rounded border-sea/30 text-sea focus:ring-sea"
                  />
                  Permitir acesso ao modulo pre-cadastro
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
                          <label className="flex items-center gap-2 rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs font-semibold text-ink/70">
                            <input
                              type="checkbox"
                              checked={vendorEdit.can_access_pre_cadastro}
                              onChange={(event) =>
                                setVendorEdit((prev) => ({
                                  ...prev,
                                  can_access_pre_cadastro: event.target.checked,
                                }))
                              }
                              className="h-4 w-4 rounded border-sea/30 text-sea focus:ring-sea"
                            />
                            Pre-cadastro
                          </label>
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
                            Pre-cadastro: {vendor.can_access_pre_cadastro ? "Liberado" : "Bloqueado"}
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
                            onClick={() => handleResetAccess(vendor)}
                            disabled={!vendor.user_id || resettingUserId === vendor.user_id}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                            title={vendor.user_id ? "Limpar acesso e forcar novo login" : "Perfil sem usuario vinculado"}
                          >
                            <RotateCcw size={12} />
                            {resettingUserId === vendor.user_id ? "Limpando" : "Resetar acesso"}
                          </button>
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

          {activeTab === "ASSISTENTES" && (
            <section className="rounded-2xl border border-sea/20 bg-sand/20 p-4">
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
                            onClick={() => handleResetAccess(assistant)}
                            disabled={!assistant.user_id || resettingUserId === assistant.user_id}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                            title={assistant.user_id ? "Limpar acesso e forcar novo login" : "Perfil sem usuario vinculado"}
                          >
                            <RotateCcw size={12} />
                            {resettingUserId === assistant.user_id ? "Limpando" : "Resetar acesso"}
                          </button>
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
        </div>
      )}
    </div>
  );
}
