import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";

type DigitalAcceptance = {
  id: string;
  entryDate: string;
  vidas: number;
};

type DigitalSummaryRow = {
  id: string;
  vendor_user_id: string | null;
  vendor_name: string | null;
  entry_date: string;
  vidas: number;
};

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, "dd/MM/yyyy");
};

const getDateKey = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export default function AceiteDigital() {
  const { role, session, profile } = useAuth();
  const isVendor = role === "VENDEDOR";
  const canViewSummary = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canAccess = isVendor || canViewSummary;
  const todayKey = useMemo(() => getDateKey(new Date()), []);
  const yesterdayKey = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return getDateKey(date);
  }, []);

  const [digitalVidas, setDigitalVidas] = useState("");
  const [digitalAcceptanceToday, setDigitalAcceptanceToday] = useState<DigitalAcceptance | null>(null);
  const [digitalAcceptanceYesterday, setDigitalAcceptanceYesterday] = useState<DigitalAcceptance | null>(null);
  const [hasVisitsYesterday, setHasVisitsYesterday] = useState(false);
  const [digitalLoading, setDigitalLoading] = useState(false);
  const [digitalSaving, setDigitalSaving] = useState(false);
  const [digitalError, setDigitalError] = useState<string | null>(null);
  const [digitalRefreshKey, setDigitalRefreshKey] = useState(0);

  const [summaryRows, setSummaryRows] = useState<DigitalSummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (!isVendor || !session?.user.id) return;
    const loadDigital = async () => {
      setDigitalLoading(true);
      setDigitalError(null);
      try {
        const { data, error } = await supabase
          .from("aceite_digital")
          .select("id, entry_date, vidas")
          .eq("vendor_user_id", session.user.id)
          .in("entry_date", [todayKey, yesterdayKey]);

        if (error) throw new Error(error.message);

        const todayRow = (data ?? []).find((item) => item.entry_date === todayKey) ?? null;
        const yesterdayRow = (data ?? []).find((item) => item.entry_date === yesterdayKey) ?? null;

        setDigitalAcceptanceToday(
          todayRow
            ? { id: todayRow.id, entryDate: todayRow.entry_date, vidas: Number(todayRow.vidas ?? 0) }
            : null,
        );
        setDigitalAcceptanceYesterday(
          yesterdayRow
            ? { id: yesterdayRow.id, entryDate: yesterdayRow.entry_date, vidas: Number(yesterdayRow.vidas ?? 0) }
            : null,
        );

        let hasVisits = false;
        if (session?.user.id || profile?.display_name) {
          let visitsQuery = supabase
            .from("visits")
            .select("id", { count: "exact", head: true })
            .eq("visit_date", yesterdayKey);

          if (session?.user.id && profile?.display_name) {
            visitsQuery = visitsQuery.or(
              `assigned_to_user_id.eq.${session.user.id},assigned_to_name.eq.${profile.display_name}`,
            );
          } else if (session?.user.id) {
            visitsQuery = visitsQuery.eq("assigned_to_user_id", session.user.id);
          } else if (profile?.display_name) {
            visitsQuery = visitsQuery.eq("assigned_to_name", profile.display_name);
          }

          const { count, error: visitsError } = await visitsQuery;
          if (!visitsError && (count ?? 0) > 0) {
            hasVisits = true;
          }
        }

        setHasVisitsYesterday(hasVisits);
      } catch (err) {
        setDigitalError(err instanceof Error ? err.message : "Erro ao carregar aceite digital.");
        setDigitalAcceptanceToday(null);
        setDigitalAcceptanceYesterday(null);
        setHasVisitsYesterday(false);
      } finally {
        setDigitalLoading(false);
      }
    };

    loadDigital();
  }, [isVendor, session?.user.id, profile?.display_name, todayKey, yesterdayKey, digitalRefreshKey]);

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

  const shouldRequireYesterday = hasVisitsYesterday;
  const pendingDate = digitalAcceptanceYesterday || !shouldRequireYesterday ? todayKey : yesterdayKey;
  const pendingAcceptance =
    pendingDate === todayKey ? digitalAcceptanceToday : digitalAcceptanceYesterday;
  const pendingLabel = pendingDate === yesterdayKey ? "Ontem" : "Hoje";

  useEffect(() => {
    setDigitalVidas("");
  }, [pendingDate, digitalAcceptanceYesterday, digitalAcceptanceToday]);

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
    if (dateKey === todayKey && shouldRequireYesterday && !digitalAcceptanceYesterday) {
      setDigitalError("Registre o aceite digital de ontem para liberar o registro de hoje.");
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
          throw new Error("Aceite digital ja registrado hoje.");
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
                Registre a quantidade de vidas. Se ontem estiver pendente, ele sera solicitado primeiro.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-sea/20 bg-white/90 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-xs font-semibold text-ink/70">{pendingLabel}</h4>
                <p className="mt-1 text-[11px] text-ink/60">
                  Data pendente: {formatDate(pendingDate)}
                </p>
              </div>
              {shouldRequireYesterday && !digitalAcceptanceYesterday && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
                  Pendencia de ontem
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                Data
                <input
                  type="date"
                  value={pendingDate}
                  readOnly
                  className="rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none"
                />
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
                  disabled={digitalLoading || digitalSaving || Boolean(pendingAcceptance)}
                  className="w-36 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea disabled:opacity-60"
                />
              </label>
              <button
                type="button"
                onClick={() => handleDigitalSubmit(pendingDate, digitalVidas.trim())}
                disabled={
                  digitalLoading ||
                  digitalSaving ||
                  Boolean(pendingAcceptance) ||
                  !digitalVidas.trim()
                }
                className="rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {pendingAcceptance ? "Registrado" : digitalSaving ? "Salvando..." : "Registrar"}
              </button>
            </div>

            {pendingAcceptance && (
              <p className="mt-2 text-[11px] text-ink/60">
                Registrado: {formatDate(pendingAcceptance.entryDate)} • {pendingAcceptance.vidas} vidas.
              </p>
            )}
            {shouldRequireYesterday && !digitalAcceptanceYesterday && (
              <p className="mt-2 text-[11px] text-amber-600">
                Registre o aceite de ontem para liberar o registro de hoje.
              </p>
            )}
          </div>

          {digitalLoading && (
            <p className="mt-3 text-xs text-ink/60">Carregando aceite digital...</p>
          )}
          {digitalError && <p className="mt-3 text-xs text-red-500">{digitalError}</p>}
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
