import { useEffect, useMemo, useState } from "react";
import type { AgendaRow } from "../../types/agenda";
import { supabase } from "../../lib/supabase";
import { fetchNominatimByAddress } from "../../lib/nominatim";
import {
  PERFIL_VISITA_PRESETS,
  extractCustomTimes,
  isPresetPerfilVisita,
  normalizePerfilVisita,
} from "../../lib/perfilVisita";

const formatValue = (value: string | number | null) =>
  value === null || value === "" ? "-" : String(value);

const formatCurrency = (value: number | string | null) => {
  if (value === null || value === "") return "-";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(numeric);
};

const formatCurrencyInput = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const amount = Number(digits) / 100;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
};

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

const parseCurrency = (value: string) => {
  const cleaned = value.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? null : parsed;
};
const sanitizeDigits = (value: string) => value.replace(/\D/g, "");

const sanitizeDecimal = (value: string) => {
  const raw = value.replace(/[^\d.,]/g, "");
  const firstComma = raw.indexOf(",");
  const firstDot = raw.indexOf(".");
  const decimalIndex =
    firstComma === -1 ? firstDot : firstDot === -1 ? firstComma : Math.min(firstComma, firstDot);
  if (decimalIndex === -1) {
    return raw.replace(/[^\d]/g, "");
  }
  const integerPart = raw.slice(0, decimalIndex).replace(/[^\d]/g, "");
  const decimalPart = raw.slice(decimalIndex + 1).replace(/[^\d]/g, "");
  const separator = raw[decimalIndex] ?? ",";
  return `${integerPart}${separator}${decimalPart}`;
};

const SITUACAO_OPTIONS = ["Ativo", "Inativo"];

const NUMERIC_ONLY_FIELDS = new Set(["cod_1", "corte", "venc", "tit"]);
const DECIMAL_FIELDS = new Set(["valor"]);

const FIELDS = [
  { key: "data_da_ultima_visita", label: "Data da ultima visita", type: "date" },
  { key: "cod_1", label: "Cod.", type: "text" },
  { key: "empresa", label: "Empresa", type: "text" },
  { key: "perfil_visita", label: "Perfil Visita", type: "text" },
  { key: "corte", label: "Corte", type: "number" },
  { key: "venc", label: "Venc", type: "number" },
  { key: "valor", label: "Valor", type: "number" },
  { key: "tit", label: "TIT", type: "text" },
  { key: "endereco", label: "Endereco", type: "text", wide: true },
  { key: "complemento", label: "Complemento", type: "text", wide: true },
  { key: "bairro", label: "Bairro", type: "text" },
  { key: "cidade", label: "Cidade", type: "text" },
  { key: "uf", label: "UF", type: "text" },
  { key: "supervisor", label: "Supervisor", type: "text" },
  { key: "vendedor", label: "Vendedor", type: "text" },
  { key: "grupo", label: "Grupo", type: "text" },
  { key: "situacao", label: "Situacao", type: "text" },
  { key: "obs_contrato_1", label: "Obs. Contrato", type: "text", wide: true },
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
  valor: row.valor !== null && row.valor !== undefined ? formatCurrency(row.valor) : "",
  tit: row.tit ?? "",
  endereco: row.endereco ?? "",
  complemento: row.complemento ?? "",
  bairro: row.bairro ?? "",
  cidade: row.cidade ?? "",
  uf: row.uf ?? "",
  supervisor: row.supervisor ?? "",
  vendedor: row.vendedor ?? "",
  grupo: row.grupo ?? "",
  situacao: row.situacao ?? "",
  obs_contrato_1: row.obs_contrato_1 ?? "",
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
  const [bairroLoading, setBairroLoading] = useState(false);
  const initialPerfilValue = normalizePerfilVisita(row?.perfil_visita ?? "");
  const initialCustomTimes = extractCustomTimes(row?.perfil_visita ?? null);
  const initialPerfilIsCustom = initialPerfilValue !== "" && !isPresetPerfilVisita(initialPerfilValue);
  const [perfilCustomEnabled, setPerfilCustomEnabled] = useState(initialPerfilIsCustom);
  const [perfilCustomTimes, setPerfilCustomTimes] = useState<string[]>(
    initialPerfilIsCustom ? (initialCustomTimes.length ? initialCustomTimes : [""]) : [],
  );

  const applyCustomTimes = (times: string[]) => {
    setPerfilCustomTimes(times);
    const cleaned = times.map((time) => time.trim()).filter(Boolean);
    setFormState((prev) =>
      prev ? { ...prev, perfil_visita: cleaned.join(", ") } : prev,
    );
  };

  const syncPerfilState = (value: string | null) => {
    const normalized = normalizePerfilVisita(value);
    const times = extractCustomTimes(value);
    if (normalized && !isPresetPerfilVisita(normalized)) {
      setPerfilCustomEnabled(true);
      applyCustomTimes(times.length ? times : [""]);
      return;
    }
    setPerfilCustomEnabled(false);
    setPerfilCustomTimes([]);
  };

  const displayTitle = useMemo(() => {
    if (!row) return "Detalhe";
    return row.empresa ?? "Detalhe";
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

  useEffect(() => {
    if (!isEditing || !formState) {
      setBairroLoading(false);
      return;
    }
    const road = formState.endereco.trim();
    const city = formState.cidade.trim();
    const state = formState.uf.trim();
    if (!road || !city || !state) {
      setBairroLoading(false);
      return;
    }
    const controller = new AbortController();
    const handler = window.setTimeout(async () => {
      setBairroLoading(true);
      try {
        const mapped = await fetchNominatimByAddress(road, city, state, controller.signal);
        if (mapped?.bairro) {
          setFormState((prev) =>
            prev
              ? {
                  ...prev,
                  bairro: mapped.bairro ?? prev.bairro,
                }
              : prev,
          );
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error(err);
        }
      } finally {
        setBairroLoading(false);
      }
    }, 600);
    return () => {
      window.clearTimeout(handler);
      controller.abort();
      setBairroLoading(false);
    };
  }, [isEditing, formState?.endereco, formState?.cidade, formState?.uf]);

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
      valor: formState.valor ? parseCurrency(formState.valor) : null,
      tit: formState.tit.trim() || null,
      endereco: formState.endereco.trim() || null,
      complemento: formState.complemento.trim() || null,
      bairro: formState.bairro.trim() || null,
      cidade: formState.cidade.trim() || null,
      uf: formState.uf.trim() || null,
      supervisor: formState.supervisor.trim() || null,
      vendedor: formState.vendedor.trim() || null,
      grupo: formState.grupo.trim() || null,
      situacao: formState.situacao.trim() || null,
      obs_contrato_1: formState.obs_contrato_1.trim() || null,
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
                          if (perfilCustomTimes.length === 0) {
                            applyCustomTimes([""]);
                          }
                        } else {
                          setPerfilCustomEnabled(false);
                          setPerfilCustomTimes([]);
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
                      <div className="flex flex-col gap-2">
                        {perfilCustomTimes.map((time, index) => (
                          <div key={`${time}-${index}`} className="flex items-center gap-2">
                            <input
                              type="time"
                              value={time}
                              onChange={(event) => {
                                const next = [...perfilCustomTimes];
                                next[index] = event.target.value;
                                applyCustomTimes(next);
                              }}
                              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                            />
                            {perfilCustomTimes.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const next = perfilCustomTimes.filter((_, idx) => idx !== index);
                                  applyCustomTimes(next.length ? next : [""]);
                                }}
                                className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-[11px] text-ink/70"
                              >
                                Remover
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => applyCustomTimes([...perfilCustomTimes, ""])}
                          className="self-start rounded-lg border border-sea/30 bg-white px-2 py-1 text-[11px] text-ink/70"
                        >
                          Adicionar horario
                        </button>
                      </div>
                    )}
                  </div>
                ) : field.key === "bairro" ? (
                  <>
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
                    {bairroLoading && (
                      <span className="text-[10px] font-normal text-ink/50 animate-pulse">
                        Buscando bairro...
                      </span>
                    )}
                  </>
                ) : (
                  <input
                    type={
                      NUMERIC_ONLY_FIELDS.has(field.key) || DECIMAL_FIELDS.has(field.key)
                        ? "text"
                        : field.type
                    }
                    inputMode={
                      NUMERIC_ONLY_FIELDS.has(field.key)
                        ? "numeric"
                        : DECIMAL_FIELDS.has(field.key)
                          ? "decimal"
                          : undefined
                    }
                    pattern={
                      NUMERIC_ONLY_FIELDS.has(field.key)
                        ? "[0-9]*"
                        : DECIMAL_FIELDS.has(field.key)
                          ? "[0-9.,]*"
                          : undefined
                    }
                    value={formState[field.key]}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const nextValue = NUMERIC_ONLY_FIELDS.has(field.key)
                        ? sanitizeDigits(raw)
                        : field.key === "valor"
                          ? formatCurrencyInput(raw)
                          : DECIMAL_FIELDS.has(field.key)
                            ? sanitizeDecimal(raw)
                            : raw;
                      setFormState((prev) =>
                        prev
                          ? {
                              ...prev,
                              [field.key]: nextValue,
                            }
                          : prev,
                      );
                    }}
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
                    : field.key === "valor"
                      ? formatCurrency(row[field.key] as number | string | null)
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
