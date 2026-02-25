
import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  createManagedUser,
  deleteManagedUser,
  deleteProfileOnly,
  fetchManagedProfiles,
  updateManagedProfile,
  updateManagedUserCredentials,
  type ManagedProfile,
} from "../lib/settingsApi";
import { emitProfilesUpdated } from "../lib/profileEvents";

type TabKey = "SUPERVISORES" | "VENDEDORES" | "ASSISTENTES";

type FormState = {
  display_name: string;
  email: string;
  password: string;
};

type VendorFormState = FormState & {
  supervisor_id: string;
};

type AssistantFormState = FormState & {
  vendedor_id: string;
};

const filterByRole = (profiles: ManagedProfile[], role: ManagedProfile["role"]) =>
  profiles.filter((profile) => profile.role === role);

const sortByName = (items: ManagedProfile[]) =>
  [...items].sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""));

export default function Settings() {
  const { role } = useAuth();
  const isSupervisor = role === "SUPERVISOR";

  const [activeTab, setActiveTab] = useState<TabKey>("SUPERVISORES");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ManagedProfile[]>([]);

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
    vendedor_id: "",
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
    vendedor_id: "",
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar perfis.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSupervisor) return;
    loadProfiles();
  }, [isSupervisor]);

  const resetEdits = () => {
    setEditingSupervisorId(null);
    setEditingVendorId(null);
    setEditingAssistantId(null);
    setSupervisorEdit({ display_name: "", email: "", password: "" });
    setVendorEdit({ display_name: "", email: "", password: "", supervisor_id: "" });
    setAssistantEdit({ display_name: "", email: "", password: "", vendedor_id: "" });
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
    if (!assistantForm.display_name || !assistantForm.email || !assistantForm.password || !assistantForm.vendedor_id) {
      setError("Preencha nome, e-mail, senha e vendedor.");
      return;
    }
    setCreatingAssistant(true);
    setError(null);
    try {
      const created = await createManagedUser({
        display_name: assistantForm.display_name,
        email: assistantForm.email,
        password: assistantForm.password,
        role: "ASSISTENTE",
        vendedor_id: assistantForm.vendedor_id,
      });
      setProfiles((prev) => [created, ...prev]);
      emitProfilesUpdated();
      setAssistantForm({ display_name: "", email: "", password: "", vendedor_id: "" });
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
      display_name: profile.display_name ?? "",
      email: "",
      password: "",
    });
  };

  const handleEditVendor = (profile: ManagedProfile) => {
    resetEdits();
    setEditingVendorId(profile.id);
    setVendorEdit({
      display_name: profile.display_name ?? "",
      email: "",
      password: "",
      supervisor_id: profile.supervisor_id ?? "",
    });
  };

  const handleEditAssistant = (profile: ManagedProfile) => {
    resetEdits();
    setEditingAssistantId(profile.id);
    setAssistantEdit({
      display_name: profile.display_name ?? "",
      email: "",
      password: "",
      vendedor_id: profile.vendedor_id ?? "",
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
    if (!assistantEdit.display_name || !assistantEdit.vendedor_id) {
      setError("Nome e vendedor sao obrigatorios.");
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
        vendedor_id: assistantEdit.vendedor_id,
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
      setAssistantEdit({ display_name: "", email: "", password: "", vendedor_id: "" });
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
                    value={supervisorForm.email}
                    onChange={(event) => setSupervisorForm((prev) => ({ ...prev, email: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Senha
                  <input
                    type="password"
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
                        <div className="flex flex-1 flex-wrap items-center gap-2">
                          <input
                            value={supervisorEdit.display_name}
                            onChange={(event) =>
                              setSupervisorEdit((prev) => ({ ...prev, display_name: event.target.value }))
                            }
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <input
                            type="email"
                            placeholder="Novo email"
                            value={supervisorEdit.email}
                            onChange={(event) =>
                              setSupervisorEdit((prev) => ({ ...prev, email: event.target.value }))
                            }
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <input
                            type="password"
                            placeholder="Nova senha"
                            value={supervisorEdit.password}
                            onChange={(event) =>
                              setSupervisorEdit((prev) => ({ ...prev, password: event.target.value }))
                            }
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <button
                            type="button"
                            onClick={handleSaveSupervisor}
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
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-semibold text-ink">{supervisor.display_name ?? "Sem nome"}</p>
                          <p className="text-xs text-ink/60">Supervisor</p>
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
                    value={vendorForm.email}
                    onChange={(event) => setVendorForm((prev) => ({ ...prev, email: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Senha
                  <input
                    type="password"
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
                        {item.display_name ?? item.user_id}
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
                        <div className="flex flex-1 flex-wrap items-center gap-2">
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
                                {item.display_name ?? item.user_id}
                              </option>
                            ))}
                          </select>
                          <input
                            type="email"
                            placeholder="Novo email"
                            value={vendorEdit.email}
                            onChange={(event) => setVendorEdit((prev) => ({ ...prev, email: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <input
                            type="password"
                            placeholder="Nova senha"
                            value={vendorEdit.password}
                            onChange={(event) => setVendorEdit((prev) => ({ ...prev, password: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <button
                            type="button"
                            onClick={handleSaveVendor}
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
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-semibold text-ink">{vendor.display_name ?? "Sem nome"}</p>
                          <p className="text-xs text-ink/60">
                            Supervisor: {vendor.supervisor?.display_name ?? "Nao informado"}
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
                    value={assistantForm.email}
                    onChange={(event) => setAssistantForm((prev) => ({ ...prev, email: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Senha
                  <input
                    type="password"
                    value={assistantForm.password}
                    onChange={(event) => setAssistantForm((prev) => ({ ...prev, password: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Vendedor
                  <select
                    value={assistantForm.vendedor_id}
                    onChange={(event) => setAssistantForm((prev) => ({ ...prev, vendedor_id: event.target.value }))}
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  >
                    <option value="">Selecione</option>
                    {vendors.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.display_name ?? item.user_id}
                      </option>
                    ))}
                  </select>
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
                        <div className="flex flex-1 flex-wrap items-center gap-2">
                          <input
                            value={assistantEdit.display_name}
                            onChange={(event) => setAssistantEdit((prev) => ({ ...prev, display_name: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <select
                            value={assistantEdit.vendedor_id}
                            onChange={(event) => setAssistantEdit((prev) => ({ ...prev, vendedor_id: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          >
                            <option value="">Vendedor</option>
                            {vendors.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.display_name ?? item.user_id}
                              </option>
                            ))}
                          </select>
                          <input
                            type="email"
                            placeholder="Novo email"
                            value={assistantEdit.email}
                            onChange={(event) => setAssistantEdit((prev) => ({ ...prev, email: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <input
                            type="password"
                            placeholder="Nova senha"
                            value={assistantEdit.password}
                            onChange={(event) => setAssistantEdit((prev) => ({ ...prev, password: event.target.value }))}
                            className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                          />
                          <button
                            type="button"
                            onClick={handleSaveAssistant}
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
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-semibold text-ink">{assistant.display_name ?? "Sem nome"}</p>
                          <p className="text-xs text-ink/60">
                            Vendedor: {assistant.vendedor?.display_name ?? "Nao informado"}
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
