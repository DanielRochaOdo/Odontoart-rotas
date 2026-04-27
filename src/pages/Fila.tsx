import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Download, LoaderCircle, RefreshCw, Unlock } from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "../context/AuthContext";
import {
  applyFilaAction,
  fetchFilaControls,
  fetchFilaSettings,
  generateFilaCountdownEvents,
  isMissingFilaBackendError,
  syncFilaAutoRegistration,
  updateFilaSettings,
  type FilaControlRow,
  type FilaState,
} from "../lib/filaApi";

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
};

const formatMonthYear = (value: string | null | undefined) => {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[2]}/${match[1]}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${String(parsed.getMonth() + 1).padStart(2, "0")}/${parsed.getFullYear()}`;
};

const normalizeReminderDays = (value: string) => {
  const parsed = value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.floor(item));
  return Array.from(new Set(parsed)).sort((left, right) => right - left);
};

const sanitizeDaysInput = (value: string) => value.replace(/\D/g, "").slice(0, 3);

const stateLabel: Record<FilaState, string> = {
  PENDING_WAIT: "Aguardando prazo",
  READY_AUTO: "Liberada automatica",
  RELEASED_MANUAL: "Liberada manual",
  BLOCKED_MANUAL: "Bloqueada manual",
};

const stateClass: Record<FilaState, string> = {
  PENDING_WAIT: "border-amber-300 bg-amber-50 text-amber-900",
  READY_AUTO: "border-emerald-300 bg-emerald-50 text-emerald-900",
  RELEASED_MANUAL: "border-teal-300 bg-teal-50 text-teal-900",
  BLOCKED_MANUAL: "border-rose-300 bg-rose-50 text-rose-900",
};

const getFriendlyStateLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  const normalized = value as FilaState;
  return stateLabel[normalized] ?? value;
};

export default function Fila() {
  const { role } = useAuth();
  const canManage = role === "SUPERVISOR" || role === "ASSISTENTE";

  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<FilaControlRow[]>([]);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<FilaState | "">("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [defaultWaitingDaysInput, setDefaultWaitingDaysInput] = useState("30");
  const [reminderDaysInput, setReminderDaysInput] = useState("30,15,7,1");
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);

  const [waitingDraftByEmpresa, setWaitingDraftByEmpresa] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      await syncFilaAutoRegistration({ minIntervalMs: 0, maxCandidates: 300, maxRegistrations: 100 });
      await generateFilaCountdownEvents();
      const [settingsRow, controlRows] = await Promise.all([
        fetchFilaSettings(),
        fetchFilaControls({ state: stateFilter, search }),
      ]);
      if (settingsRow) {
        setDefaultWaitingDaysInput(String(settingsRow.default_waiting_days));
        setReminderDaysInput(settingsRow.reminder_days.join(","));
      }
      setRows(controlRows);
      setUnavailable(false);
    } catch (err) {
      const maybeError = err as { code?: string; message?: string };
      if (isMissingFilaBackendError(maybeError)) {
        setUnavailable(true);
        setRows([]);
        setError(null);
        return;
      }
      setError(maybeError.message ?? "Erro ao carregar modulo fila.");
    } finally {
      setLoading(false);
    }
  }, [canManage, search, stateFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const pendingCount = useMemo(
    () => rows.filter((row) => row.effective_state === "PENDING_WAIT").length,
    [rows],
  );
  const readyAutoCount = useMemo(
    () => rows.filter((row) => row.effective_state === "READY_AUTO").length,
    [rows],
  );
  const releasedManualCount = useMemo(
    () => rows.filter((row) => row.effective_state === "RELEASED_MANUAL").length,
    [rows],
  );

  const handleExportXlsx = () => {
    if (!rows.length) return;
    const data = rows.map((row) => ({
      Codigo: row.codigo ?? "",
      Empresa: row.empresa ?? "",
      CNPJ: row.cnpj ?? "",
      "1º Pagto": formatMonthYear(row.data_contrato),
      "Liberação prevista": formatDateTime(row.eligible_at),
      DiasRestantes: row.days_remaining,
      Estado: getFriendlyStateLabel(row.effective_state),
      "Estado original": getFriendlyStateLabel(row.state),
      "Prazo (dias)": row.waiting_days_snapshot,
      "Motivo manual": row.manual_reason ?? "-",
      "Bloqueio manual até": formatDateTime(row.manual_block_until),
      "Atualizado em": formatDateTime(row.updated_at),
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "FILA");
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
    ].join("");
    XLSX.writeFile(workbook, `fila_empresas_${stamp}.xlsx`);
  };

  if (!canManage) {
    return (
      <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
        Este modulo e restrito a supervisao e assistencia.
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        Modulo Fila indisponivel. Aplique a migration do banco para habilitar este recurso.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="rounded-3xl border border-sea/15 bg-white/95 p-4 shadow-card sm:p-5">
        <h2 className="mt-1 font-display text-2xl text-ink">Fila</h2>
        <p className="mt-2 max-w-3xl text-sm text-ink/70">
          Controle de carencia e liberacao de novas empresas para o modulo de rotas.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-sea/20 bg-white/90 p-4">
          <p className="text-xs uppercase tracking-wide text-ink/60">Aguardando prazo</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{pendingCount}</p>
        </article>
        <article className="rounded-2xl border border-sea/20 bg-white/90 p-4">
          <p className="text-xs uppercase tracking-wide text-ink/60">Liberada automatica</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{readyAutoCount}</p>
        </article>
        <article className="rounded-2xl border border-sea/20 bg-white/90 p-4">
          <p className="text-xs uppercase tracking-wide text-ink/60">Liberada manual</p>
          <p className="mt-2 text-2xl font-semibold text-teal-700">{releasedManualCount}</p>
        </article>
      </section>

      <section className="rounded-2xl border border-sea/20 bg-white/90 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/70">Configuracao padrao</h3>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-2 rounded-lg border border-sea/25 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-sea"
          >
            <RefreshCw size={14} />
            Atualizar
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 md:col-span-1">
            <span className="text-[11px] font-semibold text-ink/70">Prazo padrao (dias)</span>
            <input
              value={defaultWaitingDaysInput}
              onChange={(event) => setDefaultWaitingDaysInput(sanitizeDaysInput(event.target.value))}
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm outline-none focus:border-sea"
              inputMode="numeric"
              maxLength={3}
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-[11px] font-semibold text-ink/70">Alertas (dias antes, separados por virgula)</span>
            <input
              value={reminderDaysInput}
              onChange={(event) => setReminderDaysInput(event.target.value)}
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm outline-none focus:border-sea"
              placeholder="30,15,7,1"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={savingSettings}
              onClick={async () => {
                const waitingDays = Number(defaultWaitingDaysInput);
                if (!Number.isFinite(waitingDays) || waitingDays <= 0) {
                  setError("Prazo padrao invalido.");
                  return;
                }
                const reminderDays = normalizeReminderDays(reminderDaysInput);
                if (reminderDays.length === 0) {
                  setError("Informe pelo menos um marco de alerta.");
                  return;
                }
                setSavingSettings(true);
                setError(null);
                try {
                  const updated = await updateFilaSettings({
                    default_waiting_days: Math.floor(waitingDays),
                    reminder_days: reminderDays,
                  });
                  setReminderDaysInput(updated.reminder_days.join(","));
                } catch (err) {
                  const maybeError = err as { message?: string };
                  setError(maybeError.message ?? "Falha ao salvar configuracao.");
                } finally {
                  setSavingSettings(false);
                }
              }}
              className="w-full rounded-lg border border-sea/25 bg-sea px-3 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60"
            >
              {savingSettings ? "Salvando..." : "Salvar configuracao"}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-sea/20 bg-white/95 p-4 shadow-card">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-[11px] font-semibold text-ink/70">Buscar na fila</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Codigo, empresa ou cnpj"
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm outline-none focus:border-sea"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink/70">Estado</span>
            <select
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value as FilaState | "")}
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm outline-none focus:border-sea"
            >
              <option value="">Todos</option>
              <option value="PENDING_WAIT">{stateLabel.PENDING_WAIT}</option>
              <option value="READY_AUTO">{stateLabel.READY_AUTO}</option>
              <option value="RELEASED_MANUAL">{stateLabel.RELEASED_MANUAL}</option>
              <option value="BLOCKED_MANUAL">{stateLabel.BLOCKED_MANUAL}</option>
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void loadData()}
              className="w-full rounded-lg border border-sea/25 bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-sea"
            >
              Aplicar filtros
            </button>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleExportXlsx}
              disabled={loading || rows.length === 0}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-sea/25 bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-sea disabled:opacity-60"
            >
              <Download size={14} />
              Exportar XLSX
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-ink/70">
            <LoaderCircle size={16} className="animate-spin" />
            Carregando fila...
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[1280px] w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-sea/20 text-left text-[11px] uppercase tracking-wide text-ink/60">
                  <th className="px-2 py-2">Codigo</th>
                  <th className="px-2 py-2">Empresa</th>
                  <th className="px-2 py-2">1º Pagto</th>
                  <th className="px-2 py-2">Liberacao prevista</th>
                  <th className="px-2 py-2">Dias restantes</th>
                  <th className="px-2 py-2">Estado</th>
                  <th className="px-2 py-2">Prazo dias</th>
                  <th className="px-2 py-2">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const waitingDraft = waitingDraftByEmpresa[row.empresa_id] ?? String(row.waiting_days_snapshot);
                  const rowActionPrefix = `row:${row.empresa_id}:`;
                  const rowActionRunning = actionLoadingKey?.startsWith(rowActionPrefix);
                  const canReleaseNow =
                    row.effective_state !== "READY_AUTO" &&
                    row.effective_state !== "RELEASED_MANUAL";

                  return (
                    <tr key={row.empresa_id} className="border-b border-sea/15 text-ink/80">
                      <td className="px-2 py-2 font-semibold">{row.codigo ?? "-"}</td>
                      <td className="px-2 py-2">{row.empresa ?? "-"}</td>
                      <td className="px-2 py-2">{formatMonthYear(row.data_contrato)}</td>
                      <td className="px-2 py-2">{formatDateTime(row.eligible_at)}</td>
                      <td className="px-2 py-2">{row.days_remaining}</td>
                      <td className="px-2 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${stateClass[row.effective_state]}`}>
                          {stateLabel[row.effective_state]}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <input
                            value={waitingDraft}
                            onChange={(event) =>
                              setWaitingDraftByEmpresa((prev) => ({
                                ...prev,
                                [row.empresa_id]: sanitizeDaysInput(event.target.value),
                              }))
                            }
                            className="w-20 rounded-lg border border-sea/20 bg-white px-2 py-1.5 text-sm outline-none focus:border-sea"
                            inputMode="numeric"
                            maxLength={3}
                          />
                          <button
                            type="button"
                            disabled={Boolean(rowActionRunning)}
                            onClick={async () => {
                              const nextDays = Number(waitingDraft);
                              if (!Number.isFinite(nextDays) || nextDays <= 0) {
                                setError("Prazo invalido para atualizacao.");
                                return;
                              }
                              setActionLoadingKey(`${rowActionPrefix}waiting`);
                              setError(null);
                              try {
                                await applyFilaAction({
                                  empresa_id: row.empresa_id,
                                  action: "SET_WAITING_DAYS",
                                  waiting_days: Math.floor(nextDays),
                                  reason: null,
                                });
                                await loadData();
                              } catch (err) {
                                const maybeError = err as { message?: string };
                                setError(maybeError.message ?? "Falha ao atualizar prazo.");
                              } finally {
                                setActionLoadingKey(null);
                              }
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sea/25 bg-white text-ink hover:border-sea disabled:opacity-60"
                            title="Aplicar novo prazo"
                            aria-label="Aplicar novo prazo"
                          >
                            <Check size={14} />
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          disabled={Boolean(rowActionRunning) || !canReleaseNow}
                          onClick={async () => {
                            setActionLoadingKey(`${rowActionPrefix}release`);
                            setError(null);
                            try {
                              await applyFilaAction({
                                empresa_id: row.empresa_id,
                                action: "RELEASE_NOW",
                                reason: null,
                              });
                              await loadData();
                            } catch (err) {
                              const maybeError = err as { message?: string };
                              setError(maybeError.message ?? "Falha ao liberar empresa para o modulo de rotas.");
                            } finally {
                              setActionLoadingKey(null);
                            }
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sea/25 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"
                          title="Liberar para o modulo de rotas"
                          aria-label="Liberar para o modulo de rotas"
                        >
                          <Unlock size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-2 py-6 text-center text-sm text-ink/60">
                      Nenhum registro encontrado no modulo fila.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
