import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Plus, Trash2, PencilLine } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS, type UserRole } from "../types/roles";
import {
  createSystemNews,
  deleteSystemNews,
  fetchSystemNews,
  requestSystemNewsAdminAccess,
  type SystemNewsFilters,
  type SystemNewsModule,
  type SystemNewsRowWithRead,
  type SystemNewsType,
  updateSystemNews,
  SYSTEM_NEWS_PAGE_SIZE,
} from "../lib/systemNewsApi";
import { markSystemUpdateAsRead } from "../services/systemUpdateNotifications";

const ADMIN_EMAIL = "daniel.rocha@odontoart.com";
const TYPES: Array<SystemNewsType | "TODOS"> = ["TODOS", "MELHORIA", "ATUALIZACAO", "CORRECAO", "MANUTENCAO", "AVISO"];
const MODULES: Array<SystemNewsModule | "TODOS"> = ["TODOS", "Agenda", "Rotas", "Empresas", "Visitas", "KPI", "Dashboard", "Configuracoes", "Aplicativo", "Geral"];

const sanitizeHtml = (value: string) =>
  value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "");

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));

export default function Novidades() {
  const { role, session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManage = session?.user?.email === ADMIN_EMAIL;
  const [filters, setFilters] = useState<SystemNewsFilters>({ from: "", to: "", modulo: "TODOS", tipo: "TODOS", ativo: "TODOS", search: "" });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<SystemNewsRowWithRead[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [pendingAction, setPendingAction] = useState<"save" | "delete" | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<SystemNewsRowWithRead | null>(null);
  const [saving, setSaving] = useState(false);
  const highlightRef = useRef<HTMLElement | null>(null);
  const [form, setForm] = useState({
    titulo: "",
    descricao: "",
    tipo: "AVISO" as SystemNewsType,
    modulo: "Geral" as SystemNewsModule,
    roles_permitidos: ["SUPERVISOR", "ASSISTENTE", "VENDEDOR"] as UserRole[],
    data_publicacao: new Date().toISOString().slice(0, 10),
    ativo: true,
  });

  const totalPages = Math.max(1, Math.ceil(count / SYSTEM_NEWS_PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemNews({ filters, page, role: role as UserRole });
      setRows(result.rows);
      setCount(result.count);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar novidades.");
    } finally {
      setLoading(false);
    }
  }, [filters, page, role]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNewsId = useMemo(() => searchParams.get("id"), [searchParams]);

  useEffect(() => {
    if (!openNewsId) return;
    const node = highlightRef.current;
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [openNewsId, rows]);

  useEffect(() => {
    if (!openNewsId) return;
    const nextRow = rows.find((row) => row.id === openNewsId);
    if (!nextRow || nextRow.isRead) return;
    void markSystemUpdateAsRead(nextRow.id).then(() => void load()).catch(() => {
      // ignore read-state failures; content still renders
    });
  }, [load, openNewsId, rows]);

  const resetFilters = () => {
    setFilters({ from: "", to: "", modulo: "TODOS", tipo: "TODOS", ativo: "TODOS", search: "" });
    setPage(1);
  };

  const openCreate = () => {
    setEditingRow(null);
    setForm({
      titulo: "",
      descricao: "",
      tipo: "AVISO",
      modulo: "Geral",
      roles_permitidos: ["SUPERVISOR", "ASSISTENTE", "VENDEDOR"],
      data_publicacao: new Date().toISOString().slice(0, 10),
      ativo: true,
    });
    setFormOpen(true);
  };

  const openEdit = (row: SystemNewsRowWithRead) => {
    setEditingRow(row);
    setForm({
      titulo: row.titulo,
      descricao: row.descricao,
      tipo: row.tipo,
      modulo: row.modulo as SystemNewsModule,
      roles_permitidos: row.roles_permitidos,
      data_publicacao: row.data_publicacao.slice(0, 10),
      ativo: row.ativo,
    });
    setFormOpen(true);
  };

  const askAdmin = async (action: "save" | "delete") => {
    if (!canManage) return false;
    if (adminUnlocked) return true;
    setError(null);
    setPendingAction(action);
    setAdminModalOpen(true);
    return false;
  };

  const persistCurrentForm = async () => {
    const payload = {
      ...form,
      descricao: sanitizeHtml(form.descricao),
      data_publicacao: new Date(form.data_publicacao).toISOString(),
      created_by: null,
      updated_by: null,
    } as never;
    if (editingRow) {
      await updateSystemNews(editingRow.id, payload);
    } else {
      await createSystemNews(payload);
    }
  };

  const handleAdminPassword = async () => {
    try {
      const password = adminPassword.trim();
      if (!password) {
        setError("Informe a senha administrativa.");
        return;
      }
      await requestSystemNewsAdminAccess(password);
      setAdminUnlocked(true);
      setAdminModalOpen(false);
      setAdminPassword("");
      setShowAdminPassword(false);
      setError(null);
      const nextAction = pendingAction;
      setPendingAction(null);
      if (nextAction === "save") {
        setSaving(true);
        try {
          await persistCurrentForm();
          setFormOpen(false);
          setPage(1);
          await load();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Erro ao salvar.");
        } finally {
          setSaving(false);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Senha invalida.");
    }
  };

  const handleSave = async () => {
    if (!(await askAdmin("save"))) return;
    setSaving(true);
    try {
      await persistCurrentForm();
      setFormOpen(false);
      setPage(1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: SystemNewsRowWithRead) => {
    if (!(await askAdmin("delete"))) return;
    if (!window.confirm("Tem certeza de que deseja excluir esta publicação? Esta ação não poderá ser desfeita.")) return;
    await deleteSystemNews(row.id);
    await load();
  };

  const toggleRole = (value: UserRole) => {
    setForm((prev) => ({
      ...prev,
      roles_permitidos: prev.roles_permitidos.includes(value)
        ? prev.roles_permitidos.filter((roleItem) => roleItem !== value)
        : [...prev.roles_permitidos, value],
    }));
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">Novidades</h2>
          <p className="mt-2 text-sm text-ink/60">Confira as últimas melhorias, atualizações e avisos do Sistema de Rotas.</p>
        </div>
          {canManage ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-ink/90 dark:bg-seaLight dark:text-ink dark:hover:bg-seaLight/90"
            >
              <Plus size={14} /> Nova publicação
            </button>
          ) : null}
      </header>

      <section className="rounded-2xl border border-sea/20 bg-white/90 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <input className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs text-ink outline-none focus:border-sea dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" type="date" value={filters.from} onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))} />
            <input className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs text-ink outline-none focus:border-sea dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" type="date" value={filters.to} onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))} />
            <select className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs text-ink outline-none focus:border-sea dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" value={filters.modulo} onChange={(e) => setFilters((p) => ({ ...p, modulo: e.target.value }))}>
              {MODULES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs text-ink outline-none focus:border-sea dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" value={filters.tipo} onChange={(e) => setFilters((p) => ({ ...p, tipo: e.target.value }))}>
              {TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs text-ink outline-none placeholder:text-ink/40 focus:border-sea dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500" placeholder="Buscar por título ou descrição" value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} />
            <button type="button" className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" onClick={resetFilters}>Limpar filtros</button>
          </div>
      </section>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}

      <div className="space-y-3">
        {loading ? (
          <div className="rounded-2xl border border-sea/15 bg-white p-4 text-sm text-ink/60">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-sea/15 bg-white p-4 text-sm text-ink/60">Nenhuma novidade publicada até o momento.</div>
        ) : (
          rows.map((row) => (
            <article key={row.id} className="rounded-2xl border border-sea/15 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.12em] text-ink/60">
                    <span className="rounded-full bg-sea/10 px-2 py-1">{row.tipo}</span>
                    <span className="rounded-full bg-sand/40 px-2 py-1">{row.modulo}</span>
                    {!row.ativo ? <span className="rounded-full bg-red-100 px-2 py-1 text-red-700">Inativa</span> : null}
                    {row.isRead ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">Lida</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">Nova</span>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-ink">{row.titulo}</h3>
                  <div className="prose prose-sm max-w-none text-ink/80" dangerouslySetInnerHTML={{ __html: sanitizeHtml(row.descricao) }} />
                  <p className="text-xs text-ink/50">{formatDate(row.data_publicacao)}</p>
                </div>
                {canManage ? (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => openEdit(row)} className="rounded-lg border px-3 py-2 text-xs font-semibold"><PencilLine size={14} /></button>
                    <button type="button" onClick={() => void handleDelete(row)} className="rounded-lg border px-3 py-2 text-xs font-semibold text-red-700"><Trash2 size={14} /></button>
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                {canManage ? (
                  <div className="text-xs text-ink/60">Roles: {row.roles_permitidos.map((r) => ROLE_LABELS[r]).join(", ")}</div>
                ) : (
                  <div className="text-xs text-ink/50">{row.isRead ? "Conteúdo já visualizado." : "Conteúdo ainda não visualizado."}</div>
                )}
                {openNewsId === row.id ? (
                  <button
                    type="button"
                    onClick={() => void markSystemUpdateAsRead(row.id).then(() => void load())}
                    className="rounded-lg border border-sea/20 px-3 py-1.5 text-[11px] font-semibold text-ink/70 hover:border-sea hover:text-sea"
                  >
                    Marcar como lida
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink/70">
        <span>Exibindo {(page - 1) * SYSTEM_NEWS_PAGE_SIZE + 1}–{Math.min(page * SYSTEM_NEWS_PAGE_SIZE, count)} de {count}</span>
        <div className="flex gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-lg border px-3 py-2 disabled:opacity-50">Anterior</button>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded-lg border px-3 py-2 disabled:opacity-50">Próxima</button>
        </div>
      </div>

      {adminModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4">
            <h3 className="font-semibold">Senha administrativa</h3>
            <div className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2">
              <input
                type={showAdminPassword ? "text" : "password"}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full bg-transparent text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setShowAdminPassword((prev) => !prev)}
                className="text-ink/60 transition hover:text-ink"
                aria-label={showAdminPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showAdminPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAdminModalOpen(false)} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">Cancelar</button>
              <button
                type="button"
                onClick={() => void handleAdminPassword()}
                className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white dark:bg-seaLight dark:text-ink"
              >
                Validar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5">
            <h3 className="font-semibold">{editingRow ? "Editar publicação" : "Nova publicação"}</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
                <input value={form.titulo} onChange={(e) => setForm((p) => ({ ...p, titulo: e.target.value }))} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea md:col-span-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" placeholder="Título" />
              <select value={form.tipo} onChange={(e) => setForm((p) => ({ ...p, tipo: e.target.value as SystemNewsType }))} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                {TYPES.filter((v) => v !== "TODOS").map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select value={form.modulo} onChange={(e) => setForm((p) => ({ ...p, modulo: e.target.value as SystemNewsModule }))} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                {MODULES.filter((v) => v !== "TODOS").map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <input type="date" value={form.data_publicacao} onChange={(e) => setForm((p) => ({ ...p, data_publicacao: e.target.value }))} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
              <label className="flex items-center gap-2 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm((p) => ({ ...p, ativo: e.target.checked }))} /> Ativa</label>
              <textarea value={form.descricao} onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))} className="min-h-40 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-sea md:col-span-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500" placeholder="Descrição" />
              <div className="md:col-span-2">
                <p className="text-xs font-semibold text-ink/60">Roles permitidos</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {(["SUPERVISOR", "ASSISTENTE", "VENDEDOR"] as UserRole[]).map((item) => (
                    <label key={item} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.roles_permitidos.includes(item)} onChange={() => toggleRole(item)} /> {ROLE_LABELS[item]}</label>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">Cancelar</button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-seaLight dark:text-ink"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
