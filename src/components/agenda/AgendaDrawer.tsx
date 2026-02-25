import { useMemo, useState } from "react";
import type { AgendaRow } from "../../types/agenda";
import { supabase } from "../../lib/supabase";
import {
  PERFIL_VISITA_PRESETS,
  isCustomTimeValue,
  isPresetPerfilVisita,
  normalizePerfilVisita,
} from "../../lib/perfilVisita";

const formatValue = (value: string | number | null) =>
  value === null || value === "" ? "-" : String(value);

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isDateOnly ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR").format(date);
};

const toDateInput = (value: string | null) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const parseNumber = (value: string) => {
  const normalized = value.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? null : parsed;
};

const SITUACAO_OPTIONS = ["Ativo", "Inativo"];

const FIELDS = [
  { key: "data_da_ultima_visita", label: "Data da ultima visita", type: "date" },
  { key: "cod_1", label: "Cod.", type: "text" },
  { key: "empresa", label: "Empresa", type: "text" },
  { key: "perfil_visita", label: "Perfil Visita", type: "text" },
  { key: "corte", label: "Corte", type: "number" },
  { key: "venc", label: "VenC", type: "number" },
  { key: "valor", label: "Valor", type: "number" },
  { key: "tit", label: "TIT", type: "text" },
  { key: "endereco", label: "Endereco", type: "text", wide: true },
  { key: "bairro", label: "Bairro", type: "text" },
  { key: "cidade", label: "Cidade", type: "text" },
  { key: "uf", label: "UF", type: "text" },
  { key: "supervisor", label: "Supervisor", type: "text" },
  { key: "vendedor", label: "Vendedor", type: "text" },
  { key: "cod_2", label: "Cod. (2)", type: "text" },
  { key: "nome_fantasia", label: "Nome Fantasia", type: "text" },
  { key: "grupo", label: "Grupo", type: "text" },
  { key: "situacao", label: "Situacao", type: "text" },
  { key: "obs_contrato_1", label: "Obs. Contrato", type: "text", wide: true },
  { key: "obs_contrato_2", label: "Obs. Contrato (2)", type: "text", wide: true },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
type AgendaFormState = Record<FieldKey, string>;

type AgendaDrawerProps = {
  row: AgendaRow | null;
  onClose: () => void;
  canEdit?: boolean;
  userEmail?: string | null;
  vendorOptions?: { value: string; label: string }[];
  supervisorOptions?: string[];
  onUpdated?: (row: AgendaRow) => void;
  onDeleted?: () => void;
};

const buildFormState = (row: AgendaRow): AgendaFormState => ({
  data_da_ultima_visita: toDateInput(row.data_da_ultima_visita),
  cod_1: row.cod_1 ?? "",
  empresa: row.empresa ?? "",
  perfil_visita: row.perfil_visita ?? "",
  corte: row.corte?.toString() ?? "",
  venc: row.venc?.toString() ?? "",
  valor: row.valor?.toString() ?? "",
  tit: row.tit ?? "",
  endereco: row.endereco ?? "",
  bairro: row.bairro ?? "",
  cidade: row.cidade ?? "",
  uf: row.uf ?? "",
  supervisor: row.supervisor ?? "",
  vendedor: row.vendedor ?? "",
  cod_2: row.cod_2 ?? "",
  nome_fantasia: row.nome_fantasia ?? "",
  grupo: row.grupo ?? "",
  situacao: row.situacao ?? "",
  obs_contrato_1: row.obs_contrato_1 ?? "",
  obs_contrato_2: row.obs_contrato_2 ?? "",
});

export default function AgendaDrawer({
  row,
  onClose,
  canEdit = false,
  userEmail,
  vendorOptions,
  supervisorOptions,
  onUpdated,
  onDeleted,
}: AgendaDrawerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const initialFormState = useMemo(() => (row ? buildFormState(row) : null), [row]);
  const [formState, setFormState] = useState<AgendaFormState | null>(initialFormState);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const initialPerfilValue = normalizePerfilVisita(row?.perfil_visita ?? "");
  const initialPerfilIsCustom = initialPerfilValue !== "" && !isPresetPerfilVisita(initialPerfilValue);
  const [perfilCustomEnabled, setPerfilCustomEnabled] = useState(initialPerfilIsCustom);
  const [perfilCustomTime, setPerfilCustomTime] = useState(
    initialPerfilIsCustom && isCustomTimeValue(initialPerfilValue) ? initialPerfilValue : "",
  );

  const syncPerfilState = (value: string | null) => {
    const normalized = normalizePerfilVisita(value);
    if (normalized && !isPresetPerfilVisita(normalized)) {
      setPerfilCustomEnabled(true);
      setPerfilCustomTime(isCustomTimeValue(normalized) ? normalized : "");
    } else {
      setPerfilCustomEnabled(false);
      setPerfilCustomTime("");
    }
  };

  const displayTitle = useMemo(() => {
    if (!row) return "Detalhe";
    return row.empresa ?? row.nome_fantasia ?? "Detalhe";
  }, [row]);

  const mergedVendorOptions = useMemo(() => {
    const options = (vendorOptions ?? []).filter((option) => option.value);
    const current = formState?.vendedor?.trim();
    if (current && !options.some((option) => option.value === current)) {
      return [{ value: current, label: `${current} (atual)` }, ...options];
    }
    return options;
  }, [vendorOptions, formState?.vendedor]);

  const mergedSupervisorOptions = useMemo(() => {
    const values = (supervisorOptions ?? []).filter(Boolean);
    const current = formState?.supervisor?.trim();
    if (current && !values.includes(current)) {
      return [current, ...values];
    }
    return values;
  }, [supervisorOptions, formState?.supervisor]);

  if (!row || !formState) return null;

  const handleSave = async () => {
    if (!row || !formState) return;
    setSaving(true);
    setStatus(null);

    const payload: Partial<AgendaRow> = {
      data_da_ultima_visita: formState.data_da_ultima_visita
        ? new Date(`${formState.data_da_ultima_visita}T12:00:00`).toISOString()
        : null,
      cod_1: formState.cod_1.trim() || null,
      empresa: formState.empresa.trim() || null,
      perfil_visita: formState.perfil_visita.trim() || null,
      corte: formState.corte ? parseNumber(formState.corte) : null,
      venc: formState.venc ? parseNumber(formState.venc) : null,
      valor: formState.valor ? parseNumber(formState.valor) : null,
      tit: formState.tit.trim() || null,
      endereco: formState.endereco.trim() || null,
      bairro: formState.bairro.trim() || null,
      cidade: formState.cidade.trim() || null,
      uf: formState.uf.trim() || null,
      supervisor: formState.supervisor.trim() || null,
      vendedor: formState.vendedor.trim() || null,
      cod_2: formState.cod_2.trim() || null,
      nome_fantasia: formState.nome_fantasia.trim() || null,
      grupo: formState.grupo.trim() || null,
      situacao: formState.situacao.trim() || null,
      obs_contrato_1: formState.obs_contrato_1.trim() || null,
      obs_contrato_2: formState.obs_contrato_2.trim() || null,
    };

    const { data, error } = await supabase
      .from("agenda")
      .update(payload)
      .eq("id", row.id)
      .select("*")
      .single();

    if (error) {
      setStatus(error.message);
      setSaving(false);
      return;
    }

    const updatedRow = data as AgendaRow;
    setFormState(buildFormState(updatedRow));
    syncPerfilState(updatedRow.perfil_visita ?? "");
    setIsEditing(false);
    setStatus("Dados atualizados.");
    onUpdated?.(updatedRow);
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!row) return;
    if (!deletePassword.trim()) {
      setStatus("Informe sua senha para excluir.");
      return;
    }
    if (!userEmail) {
      setStatus("Email do usuario nao encontrado para confirmacao.");
      return;
    }

    setDeleting(true);
    setStatus(null);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: deletePassword,
    });

    if (authError) {
      setStatus("Senha invalida.");
      setDeleting(false);
      return;
    }

    const { error: deleteError } = await supabase.from("agenda").delete().eq("id", row.id);

    if (deleteError) {
      setStatus(deleteError.message);
      setDeleting(false);
      return;
    }

    setStatus("Registro excluido.");
    setDeletePassword("");
    onDeleted?.();
    setDeleting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Agenda</p>
            <h3 className="mt-2 font-display text-xl text-ink">{displayTitle}</h3>
            <p className="text-sm text-muted">{row.cidade ? `${row.cidade} / ${row.uf ?? ""}` : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setStatus(null);
                  setIsEditing((prev) => !prev);
                }}
                className="rounded-full border border-mist px-3 py-1 text-xs text-muted hover:border-sea hover:text-sea"
              >
                {isEditing ? "Cancelar edicao" : "Editar"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-mist px-3 py-1 text-xs text-muted"
            >
              Fechar
            </button>
          </div>
        </div>

        {status && <p className="mt-4 rounded-lg bg-sand/40 px-3 py-2 text-xs text-ink/70">{status}</p>}

        {isEditing ? (
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {FIELDS.map((field) => {
              const isWide = "wide" in field && field.wide;
              return (
                <label
                  key={field.key}
                  className={`flex flex-col gap-1 text-xs font-semibold text-ink/70 ${
                    isWide ? "md:col-span-2" : ""
                  }`}
                >
                {field.label}
                {field.key === "vendedor" ? (
                  <select
                    value={formState[field.key]}
                    onChange={(event) =>
                      setFormState((prev) =>
                        prev
                          ? {
                              ...prev,
                              [field.key]: event.target.value,
                            }
                          : prev,
                      )
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  >
                    <option value="">Selecione</option>
                    {mergedVendorOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.key === "supervisor" ? (
                  <select
                    value={formState[field.key]}
                    onChange={(event) =>
                      setFormState((prev) =>
                        prev
                          ? {
                              ...prev,
                              [field.key]: event.target.value,
                            }
                          : prev,
                      )
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  >
                    <option value="">Selecione</option>
                    {mergedSupervisorOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.key === "situacao" ? (
                  <select
                    value={formState[field.key]}
                    onChange={(event) =>
                      setFormState((prev) =>
                        prev
                          ? {
                              ...prev,
                              [field.key]: event.target.value,
                            }
                          : prev,
                      )
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  >
                    <option value="">Selecione</option>
                    {SITUACAO_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.key === "perfil_visita" ? (
                  <div className="flex flex-col gap-2">
                    <select
                      value={
                        perfilCustomEnabled
                          ? "__custom__"
                          : normalizePerfilVisita(formState.perfil_visita)
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "__custom__") {
                          setPerfilCustomEnabled(true);
                          setFormState((prev) =>
                            prev ? { ...prev, perfil_visita: perfilCustomTime } : prev,
                          );
                        } else {
                          setPerfilCustomEnabled(false);
                          setPerfilCustomTime("");
                          setFormState((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  perfil_visita: value,
                                }
                              : prev,
                          );
                        }
                      }}
                      className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                    >
                      <option value="">Selecione</option>
                      {PERFIL_VISITA_PRESETS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      <option value="__custom__">Horario customizado</option>
                    </select>
                    {perfilCustomEnabled && (
                      <input
                        type="time"
                        value={perfilCustomTime}
                        onChange={(event) => {
                          setPerfilCustomTime(event.target.value);
                          setFormState((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  perfil_visita: event.target.value,
                                }
                              : prev,
                          );
                        }}
                        className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                      />
                    )}
                  </div>
                ) : (
                  <input
                    type={field.type}
                    value={formState[field.key]}
                    onChange={(event) =>
                      setFormState((prev) =>
                        prev
                          ? {
                              ...prev,
                              [field.key]: event.target.value,
                            }
                          : prev,
                      )
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                )}
                </label>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {FIELDS.map((field) => (
              <div
                key={field.key}
                className="flex items-center justify-between border-b border-mist/50 pb-2"
              >
                <span className="text-xs font-semibold text-muted">{field.label}</span>
                <span className="text-sm text-ink">
                  {field.type === "date"
                    ? formatDate(row[field.key] as string | null)
                    : formatValue(row[field.key] as string | number | null)}
                </span>
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <div className="mt-8 space-y-4 border-t border-mist/40 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={!isEditing || saving}
                className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Salvar alteracoes"}
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setFormState(buildFormState(row));
                    syncPerfilState(row.perfil_visita ?? "");
                    setIsEditing(false);
                    setStatus(null);
                  }}
                  className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
                >
                  Descartar
                </button>
              )}
            </div>

            <div className="rounded-xl border border-red-200 bg-red-50/40 p-3">
              <p className="text-xs font-semibold text-red-600">Excluir registro</p>
              <p className="mt-1 text-[11px] text-red-500">
                Para excluir, informe sua senha de usuario.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                  placeholder="Senha"
                  className="w-48 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-ink outline-none focus:border-red-300"
                />
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-lg border border-red-300 bg-red-500 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                >
                  {deleting ? "Excluindo..." : "Excluir"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
