
import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  createManagedUser,
  deleteManagedUser,
  deleteProfileOnly,
  fetchManagedProfiles,
  fetchManagedUserEmails,
  updateManagedProfile,
  updateManagedUserCredentials,
  type ManagedProfile,
} from "../lib/settingsApi";
import { emitProfilesUpdated } from "../lib/profileEvents";
import type { CepMapped } from "../lib/cep";
import { formatCep, sanitizeCep } from "../lib/cep";
import { fetchNominatimByCep } from "../lib/nominatim";

type TabKey = "SUPERVISORES" | "VENDEDORES" | "ASSISTENTES";

type FormState = {
  display_name: string;
  email: string;
  password: string;
};

type VendorFormState = FormState & {
  supervisor_id: string;
};

type AssistantFormState = FormState;

const filterByRole = (profiles: ManagedProfile[], role: ManagedProfile["role"]) =>
  profiles.filter((profile) => profile.role === role);

const sortByName = (items: ManagedProfile[]) =>
  [...items].sort((a, b) => (a.nome ?? a.display_name ?? "").localeCompare(b.nome ?? b.display_name ?? ""));

export default function Settings() {
  const { role } = useAuth();
  const isSupervisor = role === "SUPERVISOR";

  const [activeTab, setActiveTab] = useState<TabKey>("SUPERVISORES");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ManagedProfile[]>([]);
  const [userEmailsByUserId, setUserEmailsByUserId] = useState<Record<string, string>>({});
  const [cep, setCep] = useState("");
  const [cepResult, setCepResult] = useState<CepMapped | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);

  const [creatingSupervisor, setCreatingSupervisor] = useState(false);
  const [creatingVendor, setCreatingVendor] = useState(false);
  const [creatingAssistant, setCreatingAssistant] = useState(false);

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
  });
  const [assistantEdit, setAssistantEdit] = useState<AssistantFormState>({
    display_name: "",
    email: "",
    password: "",
  });

  const supervisors = useMemo(() => sortByName(filterByRole(profiles, "SUPERVISOR")), [profiles]);
  const vendors = useMemo(() => sortByName(filterByRole(profiles, "VENDEDOR")), [profiles]);
  const assistants = useMemo(() => sortByName(filterByRole(profiles, "ASSISTENTE")), [profiles]);

  const loadProfiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchManagedProfiles();
      setProfiles(data);
      const userIds = data.map((profile) => profile.user_id).filter((value): value is string => Boolean(value));
      const emails = await fetchManagedUserEmails(userIds);
      setUserEmailsByUserId(emails);
    } catch (err) {
      setUserEmailsByUserId({});
      setError(err instanceof Error ? err.message : "Erro ao carregar perfis.");
    } finally {
      setLoading(false);
    }
  };

  const getCurrentEmail = (profile: ManagedProfile) => {
    if (!profile.user_id) return "Sem usuario vinculado";
    return userEmailsByUserId[profile.user_id] || "Nao disponivel";
  };

  useEffect(() => {
    if (!isSupervisor) return;
    loadProfiles();
  }, [isSupervisor]);

  useEffect(() => {
    if (!isSupervisor) return;
    const sanitized = sanitizeCep(cep);
    if (sanitized.length !== 8) {
      setCepResult(null);
      setCepError(null);
      return;
    }
    const controller = new AbortController();
    const handler = window.setTimeout(async () => {
      setCepLoading(true);
      setCepError(null);
      try {
        const mapped = await fetchNominatimByCep(sanitized, controller.signal);
        if (!mapped) {
          throw new Error("CEP nao encontrado.");
        }
        setCepResult(mapped);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setCepError("CEP nao encontrado ou API indisponivel.");
          setCepResult(null);
        }
      } finally {
        setCepLoading(false);
      }
    }, 400);
    return () => {
      window.clearTimeout(handler);
      controller.abort();
    };
  }, [cep, isSupervisor]);

  const resetEdits = () => {
    setEditingSupervisorId(null);
    setEditingVendorId(null);
    setEditingAssistantId(null);
    setSupervisorEdit({ display_name: "", email: "", password: "" });
    setVendorEdit({ display_name: "", email: "", password: "", supervisor_id: "" });
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
    try {
      const created = await createManagedUser({
        display_name: supervisorForm.display_name,
        nome: supervisorForm.display_name,
        email: supervisorForm.email,
        password: supervisorForm.password,
        role: "SUPERVISOR",
      });
      setProfiles((prev) => [created, ...prev]);
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
    try {
      const created = await createManagedUser({
        display_name: vendorForm.display_name,
        nome: vendorForm.display_name,
        email: vendorForm.email,
        password: vendorForm.password,
        role: "VENDEDOR",
        supervisor_id: vendorForm.supervisor_id,
      });
      setProfiles((prev) => [created, ...prev]);
      emitProfilesUpdated();
      setVendorForm({ display_name: "", email: "", password: "", supervisor_id: "" });
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
    try {
      const created = await createManagedUser({
        display_name: assistantForm.display_name,
        nome: assistantForm.display_name,
        email: assistantForm.email,
        password: assistantForm.password,
        role: "ASSISTENTE",
      });
      setProfiles((prev) => [created, ...prev]);
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
        await updateManagedUserCredentials({
          user_id: current.user_id,
          email: supervisorEdit.email || null,
          password: supervisorEdit.password || null,
        });
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
        supervisor_id: vendorEdit.supervisor_id,
        vendedor_id: null,
      });
      setProfiles((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));

      if (vendorEdit.email || vendorEdit.password) {
        if (!current.user_id) throw new Error("Vendedor sem usuario vinculado.");
        await updateManagedUserCredentials({
          user_id: current.user_id,
          email: vendorEdit.email || null,
          password: vendorEdit.password || null,
        });
      }

      setEditingVendorId(null);
      setVendorEdit({ display_name: "", email: "", password: "", supervisor_id: "" });
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
        await updateManagedUserCredentials({
          user_id: current.user_id,
          email: assistantEdit.email || null,
          password: assistantEdit.password || null,
        });
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
      resetEdits();
      emitProfilesUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir usuario.");
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

      <section className="rounded-2xl border border-sea/20 bg-sand/20 p-4">
        <h3 className="font-display text-lg text-ink">Consulta CEP</h3>
        <p className="mt-1 text-xs text-ink/60">
          Digite o CEP para buscar endereco automaticamente.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
            CEP
            <input
              value={cep}
              onChange={(event) => setCep(formatCep(event.target.value))}
              placeholder="00000-000"
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Endereco
            <input
              value={cepResult?.endereco ?? ""}
              readOnly
              className="rounded-lg border border-sea/20 bg-white/80 px-3 py-2 text-sm text-ink outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
            Bairro
            <input
              value={cepResult?.bairro ?? ""}
              readOnly
              className="rounded-lg border border-sea/20 bg-white/80 px-3 py-2 text-sm text-ink outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
            Cidade
            <input
              value={cepResult?.cidade ?? ""}
              readOnly
              className="rounded-lg border border-sea/20 bg-white/80 px-3 py-2 text-sm text-ink outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
            UF
            <input
              value={cepResult?.uf ?? ""}
              readOnly
              className="rounded-lg border border-sea/20 bg-white/80 px-3 py-2 text-sm text-ink outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Complemento
            <input
              value={cepResult?.complemento ?? ""}
              readOnly
              className="rounded-lg border border-sea/20 bg-white/80 px-3 py-2 text-sm text-ink outline-none"
            />
          </label>
        </div>
        {cepLoading && (
          <p className="mt-3 text-xs text-ink/60">Consultando CEP...</p>
        )}
        {cepError && (
          <p className="mt-3 text-xs text-red-600">{cepError}</p>
        )}
      </section>

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
        <button
          type="button"
          onClick={loadProfiles}
          className="rounded-full border border-sea/30 bg-white px-4 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
        >
          Atualizar lista
        </button>
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
                {supervisors.length === 0 ? (
                  <p className="text-xs text-ink/60">Nenhum supervisor cadastrado.</p>
                ) : (
                  supervisors.map((supervisor) => (
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
          {activeTab === "VENDEDORES" && (
            <section className="rounded-2xl border border-sea/20 bg-sand/20 p-4">
              <h3 className="font-display text-lg text-ink">Vendedores</h3>
              <form onSubmit={handleCreateVendor} className="mt-4 grid gap-3 md:grid-cols-4">
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
                {vendors.length === 0 ? (
                  <p className="text-xs text-ink/60">Nenhum vendedor cadastrado.</p>
                ) : (
                  vendors.map((vendor) => (
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
                {assistants.length === 0 ? (
                  <p className="text-xs text-ink/60">Nenhum assistente cadastrado.</p>
                ) : (
                  assistants.map((assistant) => (
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
        </div>
      )}
    </div>
  );
}
