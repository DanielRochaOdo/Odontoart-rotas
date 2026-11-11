import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { formatDateBr } from "../lib/dateFormat";

type PendingAcceptanceDate = {
  entry_date: string;
  total_visits: number;
  unfinished_visits: number;
};

type DigitalSummaryRow = {
  id: string;
  vendor_user_id: string | null;
  vendor_name: string | null;
  entry_date: string;
  vidas: number;
};

const formatDate = (value: string | null) => {
  return formatDateBr(value);
};

const getDateKey = (date: Date) => {
  // Alinhado ao relogio usado pela regra de liberacao no Supabase.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const formatDateKey = (value: string) => {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
};

export default function AceiteDigital() {
  const { role, session, profile } = useAuth();
  const isVendor = role === "VENDEDOR";
  const canViewSummary = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canAccess = isVendor || canViewSummary;
  const [todayKey, setTodayKey] = useState(() => getDateKey(new Date()));
  const [digitalVidas, setDigitalVidas] = useState("");
  const [pendingAcceptanceDates, setPendingAcceptanceDates] = useState<PendingAcceptanceDate[]>([]);
  const [selectedPendingDate, setSelectedPendingDate] = useState("");
  const [digitalLoading, setDigitalLoading] = useState(true);
  const [digitalSaving, setDigitalSaving] = useState(false);
  const [digitalLoadError, setDigitalLoadError] = useState<string | null>(null);
  const [digitalError, setDigitalError] = useState<string | null>(null);
  const [digitalRefreshKey, setDigitalRefreshKey] = useState(0);

  const [summaryRows, setSummaryRows] = useState<DigitalSummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Revalidar ao voltar para o aplicativo: inclui virada do dia em Fortaleza
  // e aceites registrados por outro dispositivo ou pelo SQL administrativo.
  useEffect(() => {
    if (!canAccess) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      setTodayKey(getDateKey(new Date()));
      setDigitalRefreshKey((prev) => prev + 1);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [canAccess]);

  useEffect(() => {
    if (!isVendor || !session?.user.id) {
      setPendingAcceptanceDates([]);
      setDigitalLoading(false);
      setDigitalLoadError(null);
      return;
    }

    let active = true;
    const loadDigital = async () => {
      setDigitalLoading(true);
      setDigitalLoadError(null);
      setDigitalError(null);
      try {
        // Fonte única de datas exigidas: a mesma regra do gate SQL da Agenda,
        // sem RLS de visitas e sem truncamento de 1000 linhas no PostgREST.
        const { data, error } = await supabase.rpc("vendor_acceptance_pending_dates_v1");
        if (error) throw new Error(error.message);
        if (!Array.isArray(data)) {
          throw new Error("Resposta invalida da verificacao de pendencias.");
        }

        const rows: PendingAcceptanceDate[] = data.map((item: unknown) => {
          if (!item || typeof item !== "object") {
            throw new Error("Data de aceite invalida na resposta.");
          }
          const value = item as Record<string, unknown>;
          const entryDate = String(value.entry_date ?? "");
          const totalVisits = Number(value.total_visits);
          const unfinishedVisits = Number(value.unfinished_visits);
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(entryDate) ||
            !Number.isSafeInteger(totalVisits) || totalVisits < 1 ||
            !Number.isSafeInteger(unfinishedVisits) ||
            unfinishedVisits < 0 || unfinishedVisits > totalVisits
          ) {
            throw new Error("Dados de pendencias inconsistentes na resposta.");
          }
          return { entry_date: entryDate, total_visits: totalVisits, unfinished_visits: unfinishedVisits };
        });

        if (!active) return;
        setPendingAcceptanceDates(rows.sort((left, right) => left.entry_date.localeCompare(right.entry_date)));
      } catch (err) {
        if (!active) return;
        setPendingAcceptanceDates([]);
        setDigitalLoadError(err instanceof Error ? err.message : "Erro ao carregar aceite digital.");
      } finally {
        if (active) setDigitalLoading(false);
      }
    };

    void loadDigital();
    return () => {
      active = false;
    };
  }, [isVendor, session?.user.id, todayKey, digitalRefreshKey]);

  useEffect(() => {
    if (!canViewSummary) return;
    const loadSummary = async () => {
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const { data, error } = await supabase
          .from("aceite_digital")
          .select("id, vendor_user_id, vendor_name, entry_date, vidas")
          .eq("entry_date", todayKey)
          .order("vendor_name", { ascending: true });

        if (error) throw new Error(error.message);
        setSummaryRows((data ?? []) as DigitalSummaryRow[]);
      } catch (err) {
        setSummaryError(err instanceof Error ? err.message : "Erro ao carregar resumo.");
        setSummaryRows([]);
      } finally {
        setSummaryLoading(false);
      }
    };

    loadSummary();
  }, [canViewSummary, todayKey, digitalRefreshKey]);

  const totalVidas = useMemo(
    () => summaryRows.reduce((acc, row) => acc + Number(row.vidas ?? 0), 0),
    [summaryRows],
  );

  const pendingDates = useMemo(
    () => pendingAcceptanceDates.map((item) => item.entry_date),
    [pendingAcceptanceDates],
  );

  const activePendingDate = pendingDates.includes(selectedPendingDate)
    ? selectedPendingDate
    : pendingDates[0] ?? "";
  const activePendingInfo = pendingAcceptanceDates.find((item) => item.entry_date === activePendingDate);

  useEffect(() => {
    setDigitalVidas("");
  }, [activePendingDate]);

  useEffect(() => {
    if (pendingDates.length === 0) {
      setSelectedPendingDate("");
      return;
    }
    if (!pendingDates.includes(selectedPendingDate)) {
      setSelectedPendingDate(pendingDates[0]);
    }
  }, [pendingDates, selectedPendingDate]);

  const handleDigitalSubmit = async (dateKey: string, vidasValue: string) => {
    if (!session?.user.id) {
      setDigitalError("Usuario nao autenticado.");
      return;
    }
    if (!vidasValue) {
      setDigitalError("Informe a quantidade de vidas.");
      return;
    }
    if (!/^\d+$/.test(vidasValue)) {
      setDigitalError("Quantidade de vidas deve conter apenas numeros.");
      return;
    }
    const vidas = Number(vidasValue);
    if (!Number.isInteger(vidas) || vidas < 0) {
      setDigitalError("Quantidade de vidas deve ser um numero inteiro valido.");
      return;
    }
    if (!dateKey) {
      setDigitalError("Selecione uma data pendente para registrar.");
      return;
    }
    if (!pendingDates.includes(dateKey)) {
      setDigitalError("A data selecionada nao esta pendente.");
      return;
    }

    setDigitalSaving(true);
    setDigitalError(null);
    try {
      const { error } = await supabase.from("aceite_digital").insert({
        vendor_user_id: session.user.id,
        vendor_name: profile?.display_name ?? null,
        entry_date: dateKey,
        vidas,
        created_by: session.user.id,
      });

      if (error) {
        if (error.code === "23505") {
          throw new Error("Aceite digital ja registrado para esta data.");
        }
        throw new Error(error.message);
      }

      setDigitalVidas("");
      setDigitalRefreshKey((prev) => prev + 1);
    } catch (err) {
      setDigitalError(err instanceof Error ? err.message : "Erro ao registrar aceite digital.");
    } finally {
      setDigitalSaving(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
        Este modulo e restrito a usuarios autorizados.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-ink">Aceite digital</h2>
        <p className="mt-2 text-sm text-ink/60">
          Registro diario de vidas aceitas.
        </p>
      </header>

      {isVendor && (
        <section className="rounded-2xl border border-sea/20 bg-sand/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-lg text-ink">Registro do vendedor</h3>
              <p className="mt-1 text-xs text-ink/60">
                O aceite digital e exigido para cada data com visitas atribuidas. As datas pendentes continuam visiveis mesmo quando o acesso as proximas rotas estiver bloqueado.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-sea/20 bg-white/90 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-xs font-semibold text-ink/70">Pendencias de aceite digital</h4>
                <p className="mt-1 text-[11px] text-ink/60">
                  {digitalLoading
                    ? "Verificando pendencias..."
                    : digitalLoadError
                      ? "Nao foi possivel verificar as pendencias."
                      : pendingDates.length > 0
                        ? `${pendingDates.length} data(s) pendente(s).`
                        : "Sem pendencias no momento."}
                </p>
              </div>
              {!digitalLoading && !digitalLoadError && pendingDates.length > 0 && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
                  Registro obrigatorio
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                Data
                <select
                  value={activePendingDate}
                  onChange={(event) => setSelectedPendingDate(event.target.value)}
                  disabled={digitalLoading || Boolean(digitalLoadError) || digitalSaving || pendingDates.length === 0}
                  className="rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea disabled:opacity-60"
                >
                  {pendingDates.length === 0 && (
                    <option value="">
                      {digitalLoading
                        ? "Verificando..."
                        : digitalLoadError
                          ? "Verificacao indisponivel"
                          : "Sem pendencias"}
                    </option>
                  )}
                  {pendingDates.map((dateKey) => (
                    <option key={dateKey} value={dateKey}>
                      {formatDateKey(dateKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                Quantidade de vidas
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={0}
                  step={1}
                  value={digitalVidas}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next === "" || /^\d+$/.test(next)) {
                      setDigitalVidas(next);
                    }
                  }}
                  disabled={digitalLoading || Boolean(digitalLoadError) || digitalSaving || pendingDates.length === 0}
                  className="w-36 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea disabled:opacity-60"
                />
              </label>
              <button
                type="button"
                onClick={() => handleDigitalSubmit(activePendingDate, digitalVidas.trim())}
                disabled={
                  digitalLoading ||
                  Boolean(digitalLoadError) ||
                  digitalSaving ||
                  pendingDates.length === 0 ||
                  !digitalVidas.trim()
                }
                className="rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {digitalSaving ? "Salvando..." : "Registrar"}
              </button>
            </div>

            {!digitalLoading && !digitalLoadError && pendingDates.length > 0 && (
              <div className="mt-2 space-y-1 text-[11px] text-amber-700 dark:text-amber-200">
                <p>Registre todas as datas pendentes para liberar o fluxo normal das rotas.</p>
                {activePendingInfo && activePendingInfo.unfinished_visits > 0 && (
                  <p role="status">
                    A rota de {formatDateKey(activePendingInfo.entry_date)} tambem possui
                    {" "}{activePendingInfo.unfinished_visits} visita(s) nao concluida(s).
                    O aceite nao substitui o registro dessas visitas.
                  </p>
                )}
              </div>
            )}
          </div>

          {digitalLoading && (
            <p className="mt-3 text-xs text-ink/60">Carregando aceite digital...</p>
          )}
          {digitalLoadError && (
            <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-500/50 dark:bg-red-950/50 dark:text-red-200">
              <p>Nao foi possivel consultar as pendencias: {digitalLoadError}</p>
              <button
                type="button"
                className="rounded-lg border border-red-400 px-3 py-1.5 font-semibold hover:bg-red-100 dark:hover:bg-red-900/60"
                onClick={() => setDigitalRefreshKey((prev) => prev + 1)}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {digitalError && <p role="alert" className="mt-3 text-xs text-red-500">{digitalError}</p>}
        </section>
      )}

      {canViewSummary && (
        <section className="rounded-2xl border border-sea/20 bg-white/90 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-lg text-ink">Resumo do dia</h3>
              <p className="mt-1 text-xs text-ink/60">Data: {formatDate(todayKey)}</p>
            </div>
            <div className="rounded-xl border border-sea/20 bg-sand/40 px-3 py-2 text-xs text-ink/70">
              Total de vidas: <span className="font-semibold text-ink">{totalVidas}</span>
            </div>
          </div>

          {summaryLoading && (
            <p className="mt-3 text-xs text-ink/60">Carregando resumo...</p>
          )}
          {summaryError && (
            <p className="mt-3 text-xs text-red-500">{summaryError}</p>
          )}
          {!summaryLoading && !summaryError && summaryRows.length === 0 && (
            <p className="mt-3 text-xs text-ink/60">Nenhum aceite registrado para hoje.</p>
          )}
          {summaryRows.length > 0 && (
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {summaryRows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between rounded-xl border border-sea/15 bg-white/95 px-3 py-2 text-xs text-ink/70"
                >
                  <span className="font-semibold text-ink">
                    {row.vendor_name ?? row.vendor_user_id ?? "Vendedor"}
                  </span>
                  <span>{row.vidas} vidas</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
