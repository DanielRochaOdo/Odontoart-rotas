import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, LoaderCircle, RefreshCw, Unlock } from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "../context/AuthContext";
import {
  applyFilaAction,
  fetchFilaControls,
  fetchFilaSettings,
  generateFilaCountdownEvents,
  isMissingFilaBackendError,
  reconcileFilaEmpresaByCodigo,
  syncFilaAutoRegistration,
  updateFilaSettings,
  type FilaControlRow,
  type FilaState,
} from "../lib/filaApi";
import { formatDateTimeBr } from "../lib/dateFormat";

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
const PAGE_SIZE = 10;
const FILA_MANUAL_RELEASE_CUTOFF_MS = Date.parse("2026-06-02T00:00:00-03:00");

const stateLabel: Record<FilaState, string> = {
  PENDING_WAIT: "Aguardando prazo",
  RELEASE_PENDING: "Liberacao pendente",
  READY_AUTO: "Liberada automatica",
  RELEASED_MANUAL: "Liberada manual",
  BLOCKED_MANUAL: "Bloqueada manual",
};

const stateClass: Record<FilaState, string> = {
  PENDING_WAIT: "border-amber-300 bg-amber-50 text-amber-900",
  RELEASE_PENDING: "border-sky-300 bg-sky-50 text-sky-900",
  READY_AUTO: "border-emerald-300 bg-emerald-50 text-emerald-900",
  RELEASED_MANUAL: "border-teal-300 bg-teal-50 text-teal-900",
  BLOCKED_MANUAL: "border-rose-300 bg-rose-50 text-rose-900",
};

const isLegacyAutoReleased = (row: Pick<FilaControlRow, "effective_state" | "eligible_at">) => {
  if (row.effective_state !== "READY_AUTO") return false;
  const eligibleAtMs = Date.parse(row.eligible_at);
  return Number.isFinite(eligibleAtMs) && eligibleAtMs < FILA_MANUAL_RELEASE_CUTOFF_MS;
};

const isReleasePendingRow = (row: Pick<FilaControlRow, "effective_state" | "eligible_at">) => {
  if (row.effective_state === "RELEASE_PENDING") return true;
  if (row.effective_state !== "READY_AUTO") return false;
  const eligibleAtMs = Date.parse(row.eligible_at);
  return Number.isFinite(eligibleAtMs) && eligibleAtMs >= FILA_MANUAL_RELEASE_CUTOFF_MS;
};

const getFriendlyStateLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  const normalized = value as FilaState;
  return stateLabel[normalized] ?? value;
};

const getRowStateLabel = (row: FilaControlRow) => {
  if (isReleasePendingRow(row)) return stateLabel.RELEASE_PENDING;
  return stateLabel[row.effective_state] ?? row.effective_state;
};

const getRowStateClass = (row: FilaControlRow) => {
  if (isReleasePendingRow(row)) return stateClass.RELEASE_PENDING;
  return stateClass[row.effective_state] ?? stateClass.PENDING_WAIT;
};

const formatReleaseAuditDate = (value: string | null | undefined) =>
  formatDateTimeBr(value).replace(",", " |");

export default function Fila() {
  const { role } = useAuth();
  const canManage = role === "SUPERVISOR" || role === "ASSISTENTE";

  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<FilaControlRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<FilaControlRow[]>([]);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"codigo" | "empresa">("codigo");
  const [stateFilter, setStateFilter] = useState<FilaState | "">("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedSearchMode, setAppliedSearchMode] = useState<"codigo" | "empresa">("codigo");
  const [appliedStateFilter, setAppliedStateFilter] = useState<FilaState | "">("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [defaultWaitingDaysInput, setDefaultWaitingDaysInput] = useState("30");
  const [reminderDaysInput, setReminderDaysInput] = useState("30,15,7,1");
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [isApplyingFilters, setIsApplyingFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [modalState, setModalState] = useState<FilaState | null>(null);
  const [modalPage, setModalPage] = useState(1);

  const [waitingDraftByEmpresa, setWaitingDraftByEmpresa] = useState<Record<string, string>>({});
  const loadRequestSeqRef = useRef(0);
  const initialMaintenanceRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!canManage) return;
    const requestSeq = ++loadRequestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const [settingsRow, filteredControlRows, summaryControlRows] = await Promise.all([
        fetchFilaSettings(),
        fetchFilaControls({ state: appliedStateFilter, search: appliedSearch, searchMode: appliedSearchMode }),
        fetchFilaControls(),
      ]);
      if (requestSeq !== loadRequestSeqRef.current) return;
      if (settingsRow) {
        setDefaultWaitingDaysInput(String(settingsRow.default_waiting_days));
        setReminderDaysInput(settingsRow.reminder_days.join(","));
      }
      setRows(filteredControlRows);
      setSummaryRows(summaryControlRows);
      setUnavailable(false);
    } catch (err) {
      if (requestSeq !== loadRequestSeqRef.current) return;
      const maybeError = err as { code?: string; message?: string };
      if (isMissingFilaBackendError(maybeError)) {
        setUnavailable(true);
        setRows([]);
        setSummaryRows([]);
        setError(null);
        return;
      }
      setError(maybeError.message ?? "Erro ao carregar modulo fila.");
    } finally {
      if (requestSeq === loadRequestSeqRef.current) {
        setLoading(false);
        setIsApplyingFilters(false);
      }
    }
  }, [appliedSearch, appliedSearchMode, appliedStateFilter, canManage]);

  const hasPendingFilterChanges =
    search !== appliedSearch ||
    searchMode !== appliedSearchMode ||
    stateFilter !== appliedStateFilter;

  const runMaintenance = useCallback(
    async (options?: { force?: boolean; reconcileByCode?: string | null }) => {
      if (!canManage) return;
      const shouldForce = Boolean(options?.force);
      const reconcileByCode = (options?.reconcileByCode ?? "").trim();

      await syncFilaAutoRegistration({
        minIntervalMs: shouldForce ? 0 : undefined,
        maxCandidates: shouldForce ? 120 : undefined,
        maxRegistrations: shouldForce ? 30 : undefined,
        reconcileExisting: shouldForce,
      });

      if (reconcileByCode) {
        await reconcileFilaEmpresaByCodigo(reconcileByCode);
      }

      await generateFilaCountdownEvents();
    },
    [canManage],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!canManage) {
      initialMaintenanceRef.current = false;
      return;
    }
    if (initialMaintenanceRef.current) return;
    initialMaintenanceRef.current = true;

    void (async () => {
      try {
        await runMaintenance();
      } catch (err) {
        const maybeError = err as { message?: string };
      }
    })();
  }, [canManage, loadData, runMaintenance]);

  const pendingCount = useMemo(
    () => summaryRows.filter((row) => row.effective_state === "PENDING_WAIT").length,
    [summaryRows],
  );
  const releasePendingCount = useMemo(
    () => summaryRows.filter((row) => isReleasePendingRow(row)).length,
    [summaryRows],
  );
  const releasedManualCount = useMemo(
    () => summaryRows.filter((row) => row.effective_state === "RELEASED_MANUAL").length,
    [summaryRows],
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [currentPage, rows]);

  const modalRows = useMemo(() => {
    if (!modalState) return [];
    if (modalState === "RELEASE_PENDING") return summaryRows.filter((row) => isReleasePendingRow(row));
    return summaryRows.filter((row) => row.effective_state === modalState);
  }, [modalState, summaryRows]);
  const modalTotalPages = Math.max(1, Math.ceil(modalRows.length / PAGE_SIZE));
  const modalPaginatedRows = useMemo(() => {
    const start = (modalPage - 1) * PAGE_SIZE;
    return modalRows.slice(start, start + PAGE_SIZE);
  }, [modalPage, modalRows]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setModalPage((page) => Math.min(page, modalTotalPages));
  }, [modalTotalPages]);

  const handleExportXlsx = () => {
    if (!rows.length) return;
    const data = rows.map((row) => ({
      Codigo: row.codigo ?? "",
      Empresa: row.empresa ?? "",
      CNPJ: row.cnpj ?? "",
      "1º Pagto": formatMonthYear(row.data_contrato),
      "Liberação prevista": formatDateTimeBr(row.eligible_at),
      DiasRestantes: row.days_remaining,
      Estado: getFriendlyStateLabel(row.effective_state),
      "Estado original": getFriendlyStateLabel(row.state),
      "Prazo (dias)": row.waiting_days_snapshot,
      "Motivo manual": row.manual_reason ?? "-",
      "Bloqueio manual até": formatDateTimeBr(row.manual_block_until),
      "Atualizado em": formatDateTimeBr(row.updated_at),
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
      <div className="glass-pane rounded-2xl p-4 text-sm text-ink/70 md:p-6">
        Este modulo e restrito a supervisao e assistencia.
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 md:p-6">
        Modulo Fila indisponivel. Aplique a migration do banco para habilitar este recurso.
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <header className="rounded-3xl border border-sea/15 bg-white/95 p-3 shadow-card sm:p-4 md:p-5">
        <h2 className="mt-1 font-display text-2xl text-ink">Fila</h2>
        <p className="mt-2 max-w-3xl text-sm text-ink/70">
          Controle de carencia e liberacao de novas empresas para o modulo de rotas.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-3 md:gap-4">
        <button
          type="button"
          onClick={() => {
            setModalState("PENDING_WAIT");
            setModalPage(1);
          }}
          className={`rounded-2xl border bg-white/90 p-3 text-left transition hover:border-sea md:p-4 ${
            modalState === "PENDING_WAIT" ? "border-sea shadow-card" : "border-sea/20"
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-ink/60">Aguardando prazo</p>
          <p className="mt-1 text-xs text-ink/60">Empresas que ainda nao tiveram o prazo encerrado.</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{pendingCount}</p>
        </button>
        <button
          type="button"
          onClick={() => {
            setModalState("RELEASE_PENDING");
            setModalPage(1);
          }}
          className={`rounded-2xl border bg-white/90 p-3 text-left transition hover:border-sea md:p-4 ${
            modalState === "RELEASE_PENDING" ? "border-sea shadow-card" : "border-sea/20"
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-ink/60">Liberacao pendente</p>
          <p className="mt-1 text-xs text-ink/60">Empresas que tiveram o prazo encerrado.</p>
          <p className="mt-2 text-2xl font-semibold text-sky-700">{releasePendingCount}</p>
        </button>
        <button
          type="button"
          onClick={() => {
            setModalState("RELEASED_MANUAL");
            setModalPage(1);
          }}
          className={`rounded-2xl border bg-white/90 p-3 text-left transition hover:border-sea md:p-4 ${
            modalState === "RELEASED_MANUAL" ? "border-sea shadow-card" : "border-sea/20"
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-ink/60">Liberada manual</p>
          <p className="mt-1 text-xs text-ink/60">Empresas liberadas manualmente.</p>
          <p className="mt-2 text-2xl font-semibold text-teal-700">{releasedManualCount}</p>
        </button>
      </section>

      <section className="rounded-2xl border border-sea/20 bg-white/90 p-3 md:p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/70">Configuracao padrao</h3>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                await loadData();
                await runMaintenance({
                  force: true,
                  reconcileByCode: appliedSearchMode === "codigo" ? appliedSearch : null,
                });
                await loadData();
              })();
            }}
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

      <section className="rounded-2xl border border-sea/20 bg-white/95 p-3 shadow-card md:p-4">
        <div className="grid gap-3 md:grid-cols-6">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink/70">Buscar por</span>
            <select
              value={searchMode}
              onChange={(event) => setSearchMode(event.target.value as "codigo" | "empresa")}
              className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm outline-none focus:border-sea"
            >
              <option value="codigo">Codigo (exato)</option>
              <option value="empresa">Nome (exato)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-[11px] font-semibold text-ink/70">Buscar na fila</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchMode === "codigo" ? "Digite o codigo exato" : "Digite o nome exato"}
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
              <option value="RELEASE_PENDING">{stateLabel.RELEASE_PENDING}</option>
              <option value="RELEASED_MANUAL">{stateLabel.RELEASED_MANUAL}</option>
              <option value="BLOCKED_MANUAL">{stateLabel.BLOCKED_MANUAL}</option>
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={isApplyingFilters || loading || !hasPendingFilterChanges}
              onClick={() => {
                if (isApplyingFilters || loading || !hasPendingFilterChanges) return;
                setIsApplyingFilters(true);
                setCurrentPage(1);
                setAppliedSearch(search);
                setAppliedSearchMode(searchMode);
                setAppliedStateFilter(stateFilter);
              }}
              className="w-full rounded-lg border border-sea/25 bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-sea disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isApplyingFilters ? "Aplicando..." : "Aplicar filtros"}
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
                {paginatedRows.map((row) => {
                  const waitingDraft = waitingDraftByEmpresa[row.empresa_id] ?? String(row.waiting_days_snapshot);
                  const rowActionPrefix = `row:${row.empresa_id}:`;
                  const rowActionRunning = actionLoadingKey?.startsWith(rowActionPrefix);
                  const canReleaseNow = row.effective_state !== "RELEASED_MANUAL" && !isLegacyAutoReleased(row);

                  return (
                    <tr key={row.empresa_id} className="border-b border-sea/15 text-ink/80">
                      <td className="px-2 py-2 font-semibold">{row.codigo ?? "-"}</td>
                      <td className="px-2 py-2">{row.empresa ?? "-"}</td>
                      <td className="px-2 py-2">{formatMonthYear(row.data_contrato)}</td>
                      <td className="px-2 py-2">{formatDateTimeBr(row.eligible_at)}</td>
                      <td className="px-2 py-2">{row.days_remaining}</td>
                      <td className="px-2 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${getRowStateClass(row)}`}>
                          {getRowStateLabel(row)}
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
                        {row.effective_state === "RELEASED_MANUAL" ? (
                          <div className="min-w-[190px] text-xs text-ink/70">
                            <p>
                              <span className="font-semibold text-ink">Liberado por:</span>{" "}
                              {row.manual_override_name ?? "Usuario nao identificado"}
                            </p>
                            <p>
                              <span className="font-semibold text-ink">Em:</span>{" "}
                              {formatReleaseAuditDate(row.manual_override_at)}
                            </p>
                          </div>
                        ) : isLegacyAutoReleased(row) ? (
                          <div className="min-w-[190px] text-xs text-ink/70">
                            <p className="font-semibold text-ink">Liberada automaticamente</p>
                            <p>Antes de 02/06/2026</p>
                          </div>
                        ) : (
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
                        )}
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
            <div className="mt-3 flex flex-col gap-2 text-sm text-ink/70 sm:flex-row sm:items-center sm:justify-between">
              <p>
                Exibindo {rows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}-
                {Math.min(currentPage * PAGE_SIZE, rows.length)} de {rows.length} registro(s).
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  className="rounded-lg border border-sea/25 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-sea disabled:opacity-50"
                >
                  Anterior
                </button>
                <span className="text-xs font-semibold text-ink/70">
                  Pagina {currentPage} de {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  className="rounded-lg border border-sea/25 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-sea disabled:opacity-50"
                >
                  Proxima
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {modalState ? (
        <div className="fixed inset-0 z-[120] flex items-start justify-center bg-ink/55 px-4 pt-6">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-hidden rounded-2xl border border-sea/25 bg-white p-4 shadow-2xl md:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-ink">{stateLabel[modalState]}</h3>
                <p className="mt-1 text-sm text-ink/70">
                  {modalRows.length} empresa(s). Esta lista nao altera os filtros da tela principal.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalState(null)}
                className="rounded-lg border border-sea/25 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-sea"
              >
                Fechar
              </button>
            </div>

            <div className="mt-4 max-h-[calc(100vh-12rem)] overflow-auto">
              <table className="min-w-[920px] w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-sea/20 text-left text-[11px] uppercase tracking-wide text-ink/60">
                    <th className="px-2 py-2">Codigo</th>
                    <th className="px-2 py-2">Empresa</th>
                    <th className="px-2 py-2">Fim do prazo</th>
                    <th className="px-2 py-2">Estado</th>
                    <th className="px-2 py-2">Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {modalPaginatedRows.map((row) => {
                    const rowActionPrefix = `modal:${row.empresa_id}:`;
                    const rowActionRunning = actionLoadingKey?.startsWith(rowActionPrefix);
                    const canReleaseNow = row.effective_state !== "RELEASED_MANUAL" && !isLegacyAutoReleased(row);

                    return (
                      <tr key={row.empresa_id} className="border-b border-sea/15 text-ink/80">
                        <td className="px-2 py-2 font-semibold">{row.codigo ?? "-"}</td>
                        <td className="px-2 py-2">{row.empresa ?? "-"}</td>
                        <td className="px-2 py-2">{formatDateTimeBr(row.eligible_at)}</td>
                        <td className="px-2 py-2">
                          <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${getRowStateClass(row)}`}>
                            {getRowStateLabel(row)}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          {row.effective_state === "RELEASED_MANUAL" ? (
                            <div className="min-w-[190px] text-xs text-ink/70">
                              <p>
                                <span className="font-semibold text-ink">Liberado por:</span>{" "}
                                {row.manual_override_name ?? "Usuario nao identificado"}
                              </p>
                              <p>
                                <span className="font-semibold text-ink">Em:</span>{" "}
                                {formatReleaseAuditDate(row.manual_override_at)}
                              </p>
                            </div>
                          ) : isLegacyAutoReleased(row) ? (
                            <div className="min-w-[190px] text-xs text-ink/70">
                              <p className="font-semibold text-ink">Liberada automaticamente</p>
                              <p>Antes de 02/06/2026</p>
                            </div>
                          ) : (
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
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {modalRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-2 py-6 text-center text-sm text-ink/60">
                        Nenhum registro nesta categoria.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-col gap-2 text-sm text-ink/70 sm:flex-row sm:items-center sm:justify-between">
              <p>
                Exibindo {modalRows.length === 0 ? 0 : (modalPage - 1) * PAGE_SIZE + 1}-
                {Math.min(modalPage * PAGE_SIZE, modalRows.length)} de {modalRows.length} registro(s).
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={modalPage <= 1}
                  onClick={() => setModalPage((page) => Math.max(1, page - 1))}
                  className="rounded-lg border border-sea/25 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-sea disabled:opacity-50"
                >
                  Anterior
                </button>
                <span className="text-xs font-semibold text-ink/70">
                  Pagina {modalPage} de {modalTotalPages}
                </span>
                <button
                  type="button"
                  disabled={modalPage >= modalTotalPages}
                  onClick={() => setModalPage((page) => Math.min(modalTotalPages, page + 1))}
                  className="rounded-lg border border-sea/25 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-sea disabled:opacity-50"
                >
                  Proxima
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
