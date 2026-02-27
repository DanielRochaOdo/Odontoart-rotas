import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
};

const ACTION_LABELS: Record<string, string> = {
  INSERT: "Cadastro",
  UPDATE: "Alteracao",
  DELETE: "Exclusao",
};

const ACTION_STYLES: Record<string, string> = {
  INSERT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UPDATE: "bg-amber-50 text-amber-700 border-amber-200",
  DELETE: "bg-red-50 text-red-600 border-red-200",
};

const TABLE_LABELS: Record<string, string> = {
  agenda: "Agenda",
  visits: "Visitas",
  routes: "Rotas",
  route_stops: "Paradas",
  clientes: "Clientes",
  profiles: "Usuarios",
  aceite_digital: "Aceite digital",
  agenda_headers_map: "Agenda (Headers)",
};

const FIELD_LABELS: Record<string, string> = {
  id: "ID",
  cod_1: "Codigo",
  codigo: "Codigo",
  nome: "Nome",
  display_name: "Nome",
  empresa: "Empresa",
  perfil_visita: "Perfil visita",
  data_da_ultima_visita: "Data da ultima visita",
  visit_date: "Data da visita",
  assigned_to_name: "Vendedor",
  assigned_to_user_id: "Vendedor (ID)",
  supervisor: "Supervisor",
  vendedor: "Vendedor",
  situacao: "Situacao",
  endereco: "Endereco",
  bairro: "Bairro",
  cidade: "Cidade",
  uf: "UF",
  corte: "Corte",
  venc: "Venc",
  valor: "Valor",
  tit: "TIT",
  obs_contrato_1: "Obs. Contrato",
  completed_at: "Concluida em",
  completed_vidas: "Vidas",
  no_visit_reason: "Motivo",
  entry_date: "Data",
  vendor_user_id: "Vendedor (ID)",
  vendor_name: "Vendedor",
  vidas: "Vidas",
  created_at: "Criado em",
  updated_at: "Atualizado em",
};

const IGNORED_FIELDS = new Set(["id", "created_at", "updated_at", "display_name", "nome_fantasia"]);

const formatFieldLabel = (field: string) => {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const normalized = field.replace(/_/g, " ").trim();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : field;
};

const formatValue = (value: unknown, field?: string) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Sim" : "Nao";
  if (typeof value === "number") return new Intl.NumberFormat("pt-BR").format(value);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDateTime(value.toISOString());
  if (typeof value === "string") {
    const trimmed = value.trim();
    const isDateLike = /^\d{4}-\d{2}-\d{2}/.test(trimmed);
    if (isDateLike) {
      return formatDateTime(trimmed);
    }
    if (field === "valor") {
      const numeric = Number(trimmed.replace(",", "."));
      if (!Number.isNaN(numeric)) {
        return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(numeric);
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) return value.length ? `${value.length} item(s)` : "-";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidate =
      typeof record.nome === "string"
        ? record.nome
        : typeof record.name === "string"
          ? record.name
          : typeof record.label === "string"
            ? record.label
            : typeof record.value === "string"
              ? record.value
              : null;
    if (candidate && candidate.trim()) return candidate.trim();
    const keys = Object.keys(record);
    return keys.length ? `Objeto (${keys.length} campos)` : "-";
  }
  return String(value);
};

type AuditLogRow = {
  id: string;
  table_name: string;
  action: string;
  record_id: string | null;
  user_id: string | null;
  user_name: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
};

type DiffRow = {
  field: string;
  label: string;
  before: string;
  after: string;
};

type LogGroup = {
  id: string;
  action: string;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  logs: AuditLogRow[];
};

const getGroupTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const truncated = new Date(Math.floor(date.getTime() / 1000) * 1000);
  return truncated.toISOString();
};

const buildLogGroups = (logs: AuditLogRow[]): LogGroup[] => {
  const groups: LogGroup[] = [];
  const index = new Map<string, LogGroup>();

  logs.forEach((log) => {
    const timeKey = getGroupTimestamp(log.created_at);
    const userKey = log.user_id ?? log.user_name ?? "system";
    const key = `${log.action}|${userKey}|${timeKey}`;

    let group = index.get(key);
    if (!group) {
      group = {
        id: key,
        action: log.action,
        created_at: log.created_at,
        user_id: log.user_id,
        user_name: log.user_name,
        logs: [],
      };
      index.set(key, group);
      groups.push(group);
    }

    group.logs.push(log);
  });

  return groups;
};

const buildDiffRows = (log: AuditLogRow): DiffRow[] => {
  const oldData = log.old_data ?? {};
  const newData = log.new_data ?? {};
  const action = log.action;

  if (action === "INSERT") {
    return Object.keys(newData)
      .filter((key) => !IGNORED_FIELDS.has(key))
      .map((field) => ({
        field,
        label: formatFieldLabel(field),
        before: "-",
        after: formatValue(newData[field], field),
      }))
      .filter((row) => row.after !== "-")
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }

  if (action === "DELETE") {
    return Object.keys(oldData)
      .filter((key) => !IGNORED_FIELDS.has(key))
      .map((field) => ({
        field,
        label: formatFieldLabel(field),
        before: formatValue(oldData[field], field),
        after: "-",
      }))
      .filter((row) => row.before !== "-")
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }

  const keys = new Set<string>([...Object.keys(oldData), ...Object.keys(newData)]);
  const rows: DiffRow[] = [];
  keys.forEach((field) => {
    if (IGNORED_FIELDS.has(field)) return;
    const beforeValue = oldData[field];
    const afterValue = newData[field];
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) return;
    rows.push({
      field,
      label: formatFieldLabel(field),
      before: formatValue(beforeValue, field),
      after: formatValue(afterValue, field),
    });
  });
  rows.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  return rows;
};

export default function Logs() {
  const { role } = useAuth();
  const isSupervisor = role === "SUPERVISOR";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [filterAction, setFilterAction] = useState<string>("all");
  const [filterTable, setFilterTable] = useState<string>("all");

  useEffect(() => {
    if (!isSupervisor) return;
    let active = true;

    const loadLogs = async () => {
      setLoading(true);
      setError(null);
      try {
        let query = supabase
          .from("audit_logs")
          .select("id, table_name, action, record_id, user_id, user_name, old_data, new_data, created_at")
          .order("created_at", { ascending: false })
          .limit(200);

        if (filterAction !== "all") {
          query = query.eq("action", filterAction);
        }
        if (filterTable !== "all") {
          query = query.eq("table_name", filterTable);
        }

        const { data, error: supaError } = await query;
        if (!active) return;
        if (supaError) throw new Error(supaError.message);
        setLogs((data ?? []) as AuditLogRow[]);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Erro ao carregar logs.");
        setLogs([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadLogs();
    return () => {
      active = false;
    };
  }, [isSupervisor, filterAction, filterTable]);

  const availableTables = useMemo(() => {
    const set = new Set<string>(logs.map((log) => log.table_name));
    return Array.from(set).sort();
  }, [logs]);

  const groupedLogs = useMemo(() => buildLogGroups(logs), [logs]);

  if (!isSupervisor) {
    return (
      <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
        Este modulo e restrito a supervisores.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-ink">Logs</h2>
        <p className="mt-2 text-sm text-ink/60">
          Registros de cadastro, alteracao e exclusao realizados no sistema.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-sea/20 bg-sand/30 p-4">
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
          Acao
          <select
            value={filterAction}
            onChange={(event) => setFilterAction(event.target.value)}
            className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs text-ink outline-none focus:border-sea"
          >
            <option value="all">Todas</option>
            <option value="INSERT">Cadastro</option>
            <option value="UPDATE">Alteracao</option>
            <option value="DELETE">Exclusao</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
          Modulo
          <select
            value={filterTable}
            onChange={(event) => setFilterTable(event.target.value)}
            className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-xs text-ink outline-none focus:border-sea"
          >
            <option value="all">Todos</option>
            {availableTables.map((table) => (
              <option key={table} value={table}>
                {TABLE_LABELS[table] ?? table}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
          Carregando logs...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-600">
          {error}
        </div>
      ) : groupedLogs.length === 0 ? (
        <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
          Nenhum registro encontrado.
        </div>
      ) : (
        <div className="space-y-3">
          {groupedLogs.map((group) => {
            const label = ACTION_LABELS[group.action] ?? group.action;
            const actionStyle = ACTION_STYLES[group.action] ?? "bg-slate-100 text-slate-600 border-slate-200";
            const userLabel = group.user_name ?? group.user_id ?? "Sistema";
            const moduleLabels = Array.from(
              new Set(group.logs.map((log) => TABLE_LABELS[log.table_name] ?? log.table_name))
            );
            const isExpanded = expandedId === group.id;
            const sortedLogs = [...group.logs].sort((a, b) => {
              const labelA = TABLE_LABELS[a.table_name] ?? a.table_name;
              const labelB = TABLE_LABELS[b.table_name] ?? b.table_name;
              return labelA.localeCompare(labelB, "pt-BR");
            });
            const singleRecordId = group.logs.length === 1 ? group.logs[0].record_id : null;

            return (
              <div key={group.id} className="rounded-2xl border border-sea/15 bg-white/95 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${actionStyle}`}>
                        {label}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        {moduleLabels.map((module) => (
                          <span
                            key={`${group.id}-${module}`}
                            className="rounded-full border border-sea/20 bg-sand/40 px-2 py-0.5 text-[10px] font-semibold text-ink/70"
                          >
                            {module}
                          </span>
                        ))}
                      </div>
                      {singleRecordId ? (
                        <span className="text-[11px] text-ink/60">ID: {singleRecordId}</span>
                      ) : (
                        <span className="text-[11px] text-ink/60">{group.logs.length} registros</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink/60">
                      {formatDateTime(group.created_at)} • {userLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedId((prev) => (prev === group.id ? null : group.id))}
                    className="rounded-lg border border-sea/30 bg-white px-3 py-1 text-[11px] font-semibold text-ink/70 hover:border-sea hover:text-sea"
                  >
                    {isExpanded ? "Ocultar detalhes" : "Ver detalhes"}
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-4 space-y-3">
                    {sortedLogs.map((log) => {
                      const moduleLabel = TABLE_LABELS[log.table_name] ?? log.table_name;
                      const diffRows = buildDiffRows(log);

                      return (
                        <div key={log.id} className="rounded-xl border border-sea/15 bg-sand/10 p-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink">
                            <span>{moduleLabel}</span>
                            {log.record_id && (
                              <span className="text-[11px] text-ink/60">ID: {log.record_id}</span>
                            )}
                          </div>
                          {diffRows.length === 0 ? (
                            <p className="mt-2 text-xs text-ink/60">Sem alteracoes relevantes.</p>
                          ) : (
                            <div className="mt-2 rounded-lg border border-sea/10 bg-white p-3">
                              <p className="mb-2 text-[11px] font-semibold text-ink/60">
                                {log.action === "INSERT"
                                  ? "Campos cadastrados"
                                  : log.action === "DELETE"
                                    ? "Campos removidos"
                                    : "Campos alterados"}
                                : {diffRows.length}
                              </p>
                              <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-2 text-[11px] font-semibold text-ink/60">
                                <span>Campo</span>
                                <span>Antes</span>
                                <span>Depois</span>
                              </div>
                              <div className="mt-2 space-y-2">
                                {diffRows.map((row) => (
                                  <div
                                    key={`${log.id}-${row.field}`}
                                    className="grid grid-cols-[1.2fr_1fr_1fr] gap-2 text-[11px]"
                                  >
                                    <span className="font-semibold text-ink">{row.label}</span>
                                    <span className="text-ink/60">{row.before}</span>
                                    <span className="text-ink/60">{row.after}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


