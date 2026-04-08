import { useMemo, useState } from "react";
import { DollarSign, LoaderCircle } from "lucide-react";
import type { AgendaRow } from "../../types/agenda";
import { supabase } from "../../lib/supabase";
import { syncAgendaRowAcrossModules } from "../../lib/empresaSync";
import {
  extractOdontoartPlanoValores,
  fetchEmpresaByEmpresaId,
  type OdontoartPlanoValor,
} from "../../lib/odontoartEmpresaApi";
import {
  PERFIL_VISITA_PRESETS,
  extractCustomTimes,
  getSingleTimePerfilBase,
  getSingleTimePerfilValue,
  isPresetPerfilVisita,
  normalizePerfilVisita,
} from "../../lib/perfilVisita";
import { CATEGORIA_OPTIONS } from "../../lib/categorias";

const formatValue = (value: string | number | null) =>
  value === null || value === "" ? "-" : String(value);

const formatCurrency = (value: number | string | null) => {
  if (value === null || value === "") return "-";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(numeric);
};

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isDateOnly ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR").format(date);
};

const formatPerfilDisplay = (value: string | null) => {
  if (!value) return "-";
  const parts = value
    .replace(/â€¢/g, "•")
    .split(/[,\u2022]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0) return "-";
  const formatted = parts.map((item) => {
    const base = getSingleTimePerfilBase(item);
    if (!base) return item;
    const time = getSingleTimePerfilValue(item);
    return time ? `${base} ${time}` : base;
  });
  const unique = Array.from(
    new Set(
      formatted
        .map((item) => item.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  );
  return unique.join(" • ");
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

const sanitizeDigits = (value: string) => value.replace(/\D/g, "");

const SITUACAO_OPTIONS = ["Ativo", "Suspenso/Inadimplente", "Cancelado"];

const NUMERIC_ONLY_FIELDS = new Set(["cod_1", "corte", "venc"]);

type PlanoValoresModalState = {
  loading: boolean;
  codigo: string;
  empresa: string | null;
  valores: OdontoartPlanoValor[];
  error: string | null;
};

const hasPlanoValores = (planos: OdontoartPlanoValor[]) =>
  planos.some((plano) => plano.valorTitular !== null || plano.valorDependente !== null);

const FIELDS = [
  { key: "data_da_ultima_visita", label: "Data da ultima visita", type: "date" },
  { key: "cod_1", label: "Cod.", type: "text" },
  { key: "empresa", label: "Empresa", type: "text" },
  { key: "pessoa", label: "Pessoa", type: "text" },
  { key: "contato", label: "Contato", type: "text" },
  { key: "instructions", label: "Instrucoes", type: "text", wide: true },
  { key: "perfil_visita", label: "Perfil Visita", type: "text" },
  { key: "corte", label: "Corte", type: "number" },
  { key: "venc", label: "Venc", type: "number" },
  { key: "valor", label: "Valor", type: "number" },
  { key: "endereco", label: "Endereco", type: "text", wide: true },
  { key: "complemento", label: "Complemento", type: "text", wide: true },
  { key: "bairro", label: "Bairro", type: "text" },
  { key: "cidade", label: "Cidade", type: "text" },
  { key: "uf", label: "UF", type: "text" },
  { key: "supervisor", label: "Supervisor", type: "text" },
  { key: "vendedor", label: "Vendedor", type: "text" },
  { key: "grupo", label: "Grupo", type: "text" },
  { key: "situacao", label: "Situacao", type: "text" },
  { key: "categoria", label: "Categoria", type: "text" },
  { key: "obs_contrato_1", label: "Obs. Contrato", type: "text", wide: true },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
type AgendaFormState = Record<FieldKey, string>;

type AgendaDrawerProps = {
  row: AgendaRow | null;
  onClose: () => void;
  canEdit?: boolean;
  canManageInstruction?: boolean;
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
  pessoa: row.pessoa ?? "",
  contato: row.contato ?? "",
  instructions: row.instructions ?? "",
  perfil_visita: row.perfil_visita ?? "",
  corte: row.corte?.toString() ?? "",
  venc: row.venc?.toString() ?? "",
  valor: row.valor !== null && row.valor !== undefined ? formatCurrency(row.valor) : "",
  endereco: row.endereco ?? "",
  complemento: row.complemento ?? "",
  bairro: row.bairro ?? "",
  cidade: row.cidade ?? "",
  uf: row.uf ?? "",
  supervisor: row.supervisor ?? "",
  vendedor: row.vendedor ?? "",
  grupo: row.grupo ?? "",
  situacao: row.situacao ?? "",
  categoria: row.categoria ?? "",
  obs_contrato_1: row.obs_contrato_1 ?? "",
});

export default function AgendaDrawer({
  row,
  onClose,
  canEdit = false,
  canManageInstruction = false,
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
  const [planoValoresModal, setPlanoValoresModal] = useState<PlanoValoresModalState | null>(null);
  const initialPerfilValue = normalizePerfilVisita(row?.perfil_visita ?? "");
  const initialCustomTimes = extractCustomTimes(row?.perfil_visita ?? null);
  const initialSingleTimeBase = getSingleTimePerfilBase(row?.perfil_visita ?? null);
  const initialSingleTimeValue = getSingleTimePerfilValue(row?.perfil_visita ?? null);
  const initialPerfilIsCustom =
    initialPerfilValue !== "" && !isPresetPerfilVisita(initialPerfilValue) && !initialSingleTimeBase;
  const [perfilCustomEnabled, setPerfilCustomEnabled] = useState(initialPerfilIsCustom);
  const [perfilCustomTimes, setPerfilCustomTimes] = useState<string[]>(
    initialPerfilIsCustom ? (initialCustomTimes.length ? initialCustomTimes : [""]) : [],
  );
  const [perfilSingleTimeBase, setPerfilSingleTimeBase] = useState<string>(initialSingleTimeBase ?? "");
  const [perfilSingleTimeValue, setPerfilSingleTimeValue] = useState<string>(initialSingleTimeValue);

  const applyCustomTimes = (times: string[]) => {
    setPerfilSingleTimeBase("");
    setPerfilSingleTimeValue("");
    setPerfilCustomTimes(times);
    const cleaned = times.map((time) => time.trim()).filter(Boolean);
    setFormState((prev) =>
      prev ? { ...prev, perfil_visita: cleaned.join(", ") } : prev,
    );
  };

  const syncPerfilState = (value: string | null) => {
    const singleBase = getSingleTimePerfilBase(value);
    if (singleBase) {
      setPerfilCustomEnabled(false);
      setPerfilCustomTimes([]);
      setPerfilSingleTimeBase(singleBase);
      setPerfilSingleTimeValue(getSingleTimePerfilValue(value));
      return;
    }
    const normalized = normalizePerfilVisita(value);
    const times = extractCustomTimes(value);
    if (normalized && !isPresetPerfilVisita(normalized)) {
      setPerfilCustomEnabled(true);
      setPerfilSingleTimeBase("");
      setPerfilSingleTimeValue("");
      applyCustomTimes(times.length ? times : [""]);
      return;
    }
    setPerfilCustomEnabled(false);
    setPerfilCustomTimes([]);
    setPerfilSingleTimeBase("");
    setPerfilSingleTimeValue("");
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

  if (!row || !formState) return null;

  const openPlanoValoresModal = async (
    codigoRaw: string | null | undefined,
    empresaNome: string | null | undefined,
  ) => {
    const codigo = (codigoRaw ?? "").trim();
    setPlanoValoresModal({
      loading: true,
      codigo,
      empresa: empresaNome?.trim() || null,
      valores: [],
      error: null,
    });

    if (!codigo) {
      setPlanoValoresModal({
        loading: false,
        codigo: "",
        empresa: empresaNome?.trim() || null,
        valores: [],
        error: "Codigo da empresa indisponivel para consulta.",
      });
      return;
    }

    try {
      const empresaApi = await fetchEmpresaByEmpresaId(codigo);
      if (!empresaApi) {
        setPlanoValoresModal({
          loading: false,
          codigo,
          empresa: empresaNome?.trim() || null,
          valores: [],
          error: "Empresa nao encontrada na API.",
        });
        return;
      }

      const valores = extractOdontoartPlanoValores(empresaApi);
      setPlanoValoresModal({
        loading: false,
        codigo,
        empresa:
          (empresaApi.NomeFantazia ?? empresaApi.NomeFantasia ?? empresaApi.RazaoSocial ?? empresaNome ?? "").trim() ||
          null,
        valores,
        error: null,
      });
    } catch (err) {
      setPlanoValoresModal({
        loading: false,
        codigo,
        empresa: empresaNome?.trim() || null,
        valores: [],
        error: err instanceof Error ? err.message : "Erro ao consultar valores por plano.",
      });
    }
  };

  const handleSave = async () => {
    if (!row || !formState) return;
    setSaving(true);
    setStatus(null);

    try {
      const payload = {
        data_da_ultima_visita: formState.data_da_ultima_visita
          ? new Date(`${formState.data_da_ultima_visita}T12:00:00`).toISOString()
          : null,
        codigo: formState.cod_1.trim() || null,
        empresa: formState.empresa.trim() || null,
        pessoa: formState.pessoa.trim() || null,
        contato: formState.contato.trim() || null,
        perfil_visita: formState.perfil_visita.trim() || null,
        corte: formState.corte ? parseNumber(formState.corte) : null,
        venc: formState.venc ? parseNumber(formState.venc) : null,
        valor: row.valor ?? null,
        endereco: formState.endereco.trim() || null,
        complemento: formState.complemento.trim() || null,
        bairro: formState.bairro.trim() || null,
        cidade: formState.cidade.trim() || null,
        uf: formState.uf.trim() || null,
        supervisor: formState.supervisor.trim() || null,
        vendedor: formState.vendedor.trim() || null,
        grupo: formState.grupo.trim() || null,
        situacao: formState.situacao.trim() || null,
        categoria: formState.categoria.trim() || null,
        obs_comercial: formState.obs_contrato_1.trim() || null,
        instructions: canManageInstruction ? formState.instructions.trim() || null : row.instructions ?? null,
      };

      const { data, error } = await supabase
        .from("clientes")
        .update(payload)
        .eq("id", row.id)
        .select(
          "id, data_da_ultima_visita, cod_1:codigo, empresa, pessoa, contato, instructions, perfil_visita, corte, venc, valor, endereco, complemento, bairro, cidade, uf, supervisor, vendedor, nome_fantasia, grupo, situacao, categoria, obs_contrato_1:obs_comercial, visit_generated_at, created_at",
        )
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Erro ao atualizar dados.");
      }

      const updatedRow = data as AgendaRow;
      const instructionsChanged =
        canManageInstruction && (updatedRow.instructions ?? null) !== (row.instructions ?? null);

      if (instructionsChanged) {
        void supabase
          .from("visits")
          .update({ instructions: updatedRow.instructions ?? null })
          .eq("cliente_id", row.id)
          .is("completed_at", null)
          .then(({ error: visitInstructionsError }) => {
            if (visitInstructionsError) {
              console.error(visitInstructionsError);
              setStatus("Instrucao salva. Houve atraso na sincronizacao das visitas abertas.");
            }
          });
      }

      const hasChanged = (nextValue: unknown, prevValue: unknown) => (nextValue ?? null) !== (prevValue ?? null);
      const shouldSyncModules =
        hasChanged(updatedRow.cod_1, row.cod_1) ||
        hasChanged(updatedRow.corte, row.corte) ||
        hasChanged(updatedRow.venc, row.venc) ||
        hasChanged(updatedRow.valor, row.valor) ||
        hasChanged(updatedRow.data_da_ultima_visita, row.data_da_ultima_visita) ||
        hasChanged((updatedRow as AgendaRow & { cep?: string | null }).cep, (row as AgendaRow & { cep?: string | null }).cep) ||
        hasChanged(updatedRow.empresa, row.empresa) ||
        hasChanged((updatedRow as AgendaRow & { pessoa?: string | null }).pessoa, (row as AgendaRow & { pessoa?: string | null }).pessoa) ||
        hasChanged((updatedRow as AgendaRow & { contato?: string | null }).contato, (row as AgendaRow & { contato?: string | null }).contato) ||
        hasChanged(updatedRow.grupo, row.grupo) ||
        hasChanged(updatedRow.obs_contrato_1, row.obs_contrato_1) ||
        hasChanged(updatedRow.nome_fantasia, row.nome_fantasia) ||
        hasChanged((updatedRow as AgendaRow & { complemento?: string | null }).complemento, (row as AgendaRow & { complemento?: string | null }).complemento) ||
        hasChanged(updatedRow.perfil_visita, row.perfil_visita) ||
        hasChanged(updatedRow.situacao, row.situacao) ||
        hasChanged(updatedRow.categoria, row.categoria) ||
        hasChanged(updatedRow.endereco, row.endereco) ||
        hasChanged(updatedRow.bairro, row.bairro) ||
        hasChanged(updatedRow.cidade, row.cidade) ||
        hasChanged(updatedRow.uf, row.uf);

      if (shouldSyncModules) {
        await syncAgendaRowAcrossModules({
          id: updatedRow.id,
          codigo: updatedRow.cod_1,
          corte: updatedRow.corte,
          venc: updatedRow.venc,
          valor: updatedRow.valor,
          data_da_ultima_visita: updatedRow.data_da_ultima_visita,
          cep: (updatedRow as AgendaRow & { cep?: string | null }).cep ?? null,
          empresa: updatedRow.empresa,
          pessoa: (updatedRow as AgendaRow & { pessoa?: string | null }).pessoa ?? null,
          contato: (updatedRow as AgendaRow & { contato?: string | null }).contato ?? null,
          grupo: updatedRow.grupo,
          obs_comercial: updatedRow.obs_contrato_1,
          nome_fantasia: updatedRow.nome_fantasia,
          complemento: (updatedRow as AgendaRow & { complemento?: string | null }).complemento ?? null,
          perfil_visita: updatedRow.perfil_visita,
          situacao: updatedRow.situacao,
          categoria: updatedRow.categoria,
          endereco: updatedRow.endereco,
          bairro: updatedRow.bairro,
          cidade: updatedRow.cidade,
          uf: updatedRow.uf,
        });
      }

      setFormState(buildFormState(updatedRow));
      syncPerfilState(updatedRow.perfil_visita ?? "");
      setIsEditing(false);
      setStatus(
        instructionsChanged && !shouldSyncModules ? "Instrucoes atualizadas." : "Dados atualizados.",
      );
      onUpdated?.(updatedRow);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Erro ao salvar dados.");
    } finally {
      setSaving(false);
    }
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

    const { error: deleteError } = await supabase.from("clientes").delete().eq("id", row.id);

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
              const isInstructionField = field.key === "instructions";
              const instructionDisabled = isInstructionField && !canManageInstruction;
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
                ) : field.key === "categoria" ? (
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
                    {formState[field.key] && !CATEGORIA_OPTIONS.some((option) => option === formState[field.key]) && (
                      <option value={formState[field.key]}>{formState[field.key]}</option>
                    )}
                    {CATEGORIA_OPTIONS.map((option) => (
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
                          : perfilSingleTimeBase || normalizePerfilVisita(formState.perfil_visita)
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "__custom__") {
                          setPerfilCustomEnabled(true);
                          setPerfilSingleTimeBase("");
                          setPerfilSingleTimeValue("");
                          if (perfilCustomTimes.length === 0) {
                            applyCustomTimes([""]);
                          }
                        } else if (value === "ALMOCO" || value === "JANTAR") {
                          setPerfilCustomEnabled(false);
                          setPerfilCustomTimes([]);
                          setPerfilSingleTimeBase(value);
                          setPerfilSingleTimeValue("");
                          setFormState((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  perfil_visita: value,
                                }
                              : prev,
                          );
                        } else {
                          setPerfilCustomEnabled(false);
                          setPerfilCustomTimes([]);
                          setPerfilSingleTimeBase("");
                          setPerfilSingleTimeValue("");
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
                    {(perfilSingleTimeBase === "ALMOCO" || perfilSingleTimeBase === "JANTAR") && (
                      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                        HH:MM
                        <input
                          type="time"
                          value={perfilSingleTimeValue}
                          onChange={(event) => {
                            const nextTime = event.target.value;
                            setPerfilSingleTimeValue(nextTime);
                            setFormState((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    perfil_visita: nextTime
                                      ? `${perfilSingleTimeBase} ${nextTime}`
                                      : perfilSingleTimeBase,
                                  }
                                : prev,
                            );
                          }}
                          className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                        />
                      </label>
                    )}
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
                ) : field.key === "instructions" ? (
                  <>
                    <textarea
                      value={formState[field.key]}
                      onChange={(event) => {
                        if (instructionDisabled) return;
                        setFormState((prev) =>
                          prev
                            ? {
                                ...prev,
                                [field.key]: event.target.value,
                              }
                            : prev,
                        );
                      }}
                      disabled={instructionDisabled}
                      rows={3}
                      className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea disabled:opacity-70"
                    />
                    {instructionDisabled && (
                      <span className="text-[10px] font-normal text-ink/50">
                        Somente supervisor pode alterar instrucoes.
                      </span>
                    )}
                  </>
                ) : field.key === "valor" ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void openPlanoValoresModal(formState.cod_1, formState.empresa)}
                      title="Ver valores Titular/Dependente"
                      aria-label="Ver valores Titular e Dependente"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight"
                    >
                      {planoValoresModal?.loading ? (
                        <LoaderCircle size={14} className="animate-spin" />
                      ) : (
                        <DollarSign size={14} />
                      )}
                    </button>
                    <span className="text-[11px] font-normal text-ink/60">
                      2 ODONTOART PJ INDIVIDUAL, 18 Multiprev, 19 Multiplus, 20 Multimaster
                    </span>
                  </div>
                ) : field.key === "bairro" ? (
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
                ) : (
                  <input
                    type={
                      NUMERIC_ONLY_FIELDS.has(field.key) ? "text" : field.type
                    }
                    inputMode={
                      NUMERIC_ONLY_FIELDS.has(field.key) ? "numeric" : undefined
                    }
                    pattern={
                      NUMERIC_ONLY_FIELDS.has(field.key) ? "[0-9]*" : undefined
                    }
                    value={formState[field.key]}
                    onChange={(event) => {
                      if (instructionDisabled) return;
                      const raw = event.target.value;
                      const nextValue = NUMERIC_ONLY_FIELDS.has(field.key)
                        ? sanitizeDigits(raw)
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
                    disabled={instructionDisabled}
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
                {field.key === "valor" ? (
                  <div className="flex items-center gap-2 text-sm text-ink">
                    <button
                      type="button"
                      onClick={() => void openPlanoValoresModal(row.cod_1, row.empresa)}
                      title="Ver valores Titular/Dependente"
                      aria-label="Ver valores Titular e Dependente"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight"
                    >
                      {planoValoresModal?.loading ? (
                        <LoaderCircle size={12} className="animate-spin" />
                      ) : (
                        <DollarSign size={12} />
                      )}
                    </button>
                    <span className="text-xs text-ink/70">Ver por plano</span>
                  </div>
                ) : (
                  <span className="text-sm text-ink">
                    {field.type === "date"
                      ? formatDate(row[field.key] as string | null)
                      : field.key === "perfil_visita"
                        ? formatPerfilDisplay(row[field.key] as string | null)
                        : formatValue(row[field.key] as string | number | null)}
                  </span>
                )}
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
      {planoValoresModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Fechar modal de valores por plano"
            onClick={() => setPlanoValoresModal(null)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-mist/60 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-ink">Valores por plano</h3>
              <button
                type="button"
                onClick={() => setPlanoValoresModal(null)}
                className="rounded-lg border border-sea/30 px-2 py-1 text-xs text-ink/70 hover:border-sea hover:text-sea"
              >
                Fechar
              </button>
            </div>
            <p className="mt-2 text-xs text-ink/60">
              Empresa: {planoValoresModal.empresa ?? "-"} | COD {planoValoresModal.codigo || "-"}
            </p>
            <p className="mt-2 text-[11px] text-ink/50">
              Planos permitidos: 2 ODONTOART PJ INDIVIDUAL, 18 Multiprev, 19 Multiplus, 20 Multimaster
            </p>
            {planoValoresModal.loading ? (
              <div className="mt-4 flex items-center gap-2 text-xs text-ink/60">
                <LoaderCircle size={14} className="animate-spin" />
                Carregando valores...
              </div>
            ) : planoValoresModal.error ? (
              <p className="mt-4 text-xs text-red-600">{planoValoresModal.error}</p>
            ) : (
              <div className="mt-4 space-y-2">
                {planoValoresModal.valores.map((plano) => (
                  <div key={plano.planoCodigo} className="rounded-lg border border-mist/50 bg-sand/20 px-3 py-2">
                    <p className="text-xs font-semibold text-ink">{plano.planoCodigo} - {plano.planoNome}</p>
                    <p className="text-xs text-ink/70">
                      Titular: {plano.valorTitular !== null ? formatCurrency(plano.valorTitular) : "-"}
                    </p>
                    <p className="text-xs text-ink/70">
                      Dependente: {plano.valorDependente !== null ? formatCurrency(plano.valorDependente) : "-"}
                    </p>
                  </div>
                ))}
                {!hasPlanoValores(planoValoresModal.valores) ? (
                  <p className="text-xs text-ink/60">
                    Nenhum valor encontrado para os planos 2, 18, 19 e 20 nesta empresa.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
