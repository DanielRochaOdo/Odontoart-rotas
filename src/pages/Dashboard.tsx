import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";

const formatNumber = (value: number) => new Intl.NumberFormat("pt-BR").format(value);

const startOfWeek = (date: Date) => {
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const result = new Date(date);
  result.setDate(date.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
};

const startOfMonth = (date: Date) => {
  const result = new Date(date.getFullYear(), date.getMonth(), 1);
  result.setHours(0, 0, 0, 0);
  return result;
};

const parseVisitDate = (row: { data_da_ultima_visita: string | null; dt_mar_25: string | null }) => {
  if (row.data_da_ultima_visita) return new Date(row.data_da_ultima_visita);
  if (row.dt_mar_25) return new Date(`${row.dt_mar_25}T00:00:00`);
  return null;
};

export default function Dashboard() {
  const { role } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<
    {
      data_da_ultima_visita: string | null;
      dt_mar_25: string | null;
      situacao: string | null;
      cidade: string | null;
      uf: string | null;
      vendedor: string | null;
    }[]
  >([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data, error: supabaseError } = await supabase
        .from("agenda")
        .select("data_da_ultima_visita, dt_mar_25, situacao, cidade, uf, vendedor")
        .limit(5000);

      if (supabaseError) {
        setError(supabaseError.message);
        setRows([]);
      } else {
        setRows(data ?? []);
      }
      setLoading(false);
    };

    load();
  }, []);

  const summary = useMemo(() => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);

    const totals = { today: 0, week: 0, month: 0 };
    const byStatus: Record<string, number> = {};
    const byCity: Record<string, number> = {};
    const byVendor: Record<string, number> = {};

    rows.forEach((row) => {
      const visitDate = parseVisitDate(row);
      if (visitDate) {
        const visitDay = new Date(visitDate);
        visitDay.setHours(0, 0, 0, 0);
        if (visitDay.getTime() === today.getTime()) totals.today += 1;
        if (visitDay >= weekStart) totals.week += 1;
        if (visitDay >= monthStart) totals.month += 1;
      }

      if (row.situacao) {
        byStatus[row.situacao] = (byStatus[row.situacao] ?? 0) + 1;
      }

      if (row.cidade || row.uf) {
        const label = [row.cidade, row.uf].filter(Boolean).join(" / ");
        byCity[label] = (byCity[label] ?? 0) + 1;
      }

      if (row.vendedor) {
        byVendor[row.vendedor] = (byVendor[row.vendedor] ?? 0) + 1;
      }
    });

    const topStatus = Object.entries(byStatus).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const topCities = Object.entries(byCity).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const ranking = Object.entries(byVendor).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return { totals, topStatus, topCities, ranking, byVendor };
  }, [rows]);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-ink">Dashboard</h2>
        <p className="mt-2 text-sm text-muted">
          Indicadores gerais da agenda e visitas comerciais.
        </p>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-mist/60 bg-white p-6 text-sm text-muted">
          Carregando indicadores...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-600">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-mist/60 bg-white p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Hoje</p>
              <p className="mt-2 font-display text-3xl text-ink">
                {formatNumber(summary.totals.today)}
              </p>
              <p className="text-xs text-muted">Agendamentos</p>
            </div>
            <div className="rounded-2xl border border-mist/60 bg-white p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Semana</p>
              <p className="mt-2 font-display text-3xl text-ink">
                {formatNumber(summary.totals.week)}
              </p>
              <p className="text-xs text-muted">Agendamentos</p>
            </div>
            <div className="rounded-2xl border border-mist/60 bg-white p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Mes</p>
              <p className="mt-2 font-display text-3xl text-ink">
                {formatNumber(summary.totals.month)}
              </p>
              <p className="text-xs text-muted">Agendamentos</p>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-mist/60 bg-white p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg text-ink">Visitas por situacao</h3>
                <span className="text-xs text-muted">Top 6</span>
              </div>
              <div className="mt-4 space-y-2">
                {summary.topStatus.length === 0 ? (
                  <p className="text-sm text-muted">Sem dados.</p>
                ) : (
                  summary.topStatus.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span className="text-ink">{label}</span>
                      <span className="font-semibold text-sea">{formatNumber(value)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-mist/60 bg-white p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg text-ink">Por cidade / UF</h3>
                <span className="text-xs text-muted">Top 6</span>
              </div>
              <div className="mt-4 space-y-2">
                {summary.topCities.length === 0 ? (
                  <p className="text-sm text-muted">Sem dados.</p>
                ) : (
                  summary.topCities.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span className="text-ink">{label}</span>
                      <span className="font-semibold text-sea">{formatNumber(value)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {(role === "SUPERVISOR" || role === "ASSISTENTE") && (
            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-mist/60 bg-white p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg text-ink">Visitas por vendedor</h3>
                  <span className="text-xs text-muted">Top 5</span>
                </div>
                <div className="mt-4 space-y-2">
                  {summary.ranking.length === 0 ? (
                    <p className="text-sm text-muted">Sem dados.</p>
                  ) : (
                    summary.ranking.map(([label, value], index) => (
                      <div key={label} className="flex items-center justify-between text-sm">
                        <span className="text-ink">
                          {index + 1}. {label}
                        </span>
                        <span className="font-semibold text-sea">{formatNumber(value)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-mist/60 bg-white p-5">
                <h3 className="font-display text-lg text-ink">Resumo geral</h3>
                <p className="mt-2 text-sm text-muted">
                  Total de vendedores ativos: {Object.keys(summary.byVendor).length}
                </p>
                <p className="mt-2 text-sm text-muted">
                  Total de registros analisados: {rows.length}
                </p>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
