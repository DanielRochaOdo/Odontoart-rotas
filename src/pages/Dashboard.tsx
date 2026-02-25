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

const parseVisitDate = (row: { data_da_ultima_visita: string | null }) => {
  if (row.data_da_ultima_visita) return new Date(row.data_da_ultima_visita);
  return null;
};

const formatOrValues = (values: string[]) =>
  values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",");

type VisitStats = {
  totalVidas: number;
  empresasVisitadas: number;
  visitasRealizadas: number;
  visitasNaoRealizadas: number;
  visitasPendentes: number;
};

const computeVisitStats = (data: Array<{ agenda_id: string | null; completed_at: string | null; completed_vidas: number | null; no_visit_reason: string | null }>): VisitStats => {
  const totalVidas = (data ?? []).reduce((sum, item) => {
    const value = Number(item.completed_vidas ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  const empresasSet = new Set<string>();
  let visitasRealizadas = 0;
  let visitasNaoRealizadas = 0;
  let visitasPendentes = 0;

  (data ?? []).forEach((item) => {
    if (item.completed_at) {
      if (item.no_visit_reason) {
        visitasNaoRealizadas += 1;
      } else {
        visitasRealizadas += 1;
        if (item.agenda_id) empresasSet.add(item.agenda_id);
      }
    } else {
      visitasPendentes += 1;
    }
  });

  return {
    totalVidas,
    empresasVisitadas: empresasSet.size,
    visitasRealizadas,
    visitasNaoRealizadas,
    visitasPendentes,
  };
};

export default function Dashboard() {
  const { role, profile, session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<
    {
      data_da_ultima_visita: string | null;
      situacao: string | null;
      cidade: string | null;
      uf: string | null;
      vendedor: string | null;
    }[]
  >([]);
  const [visitStats, setVisitStats] = useState<VisitStats | null>(null);
  const [visitStatsError, setVisitStatsError] = useState<string | null>(null);
  const [teamStats, setTeamStats] = useState<VisitStats | null>(null);
  const [teamStatsError, setTeamStatsError] = useState<string | null>(null);
  const [teamVendorsCount, setTeamVendorsCount] = useState(0);

  const isVendor = role === "VENDEDOR";
  const isSupervisor = role === "SUPERVISOR";

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data, error: supabaseError } = await supabase
        .from("agenda")
        .select("data_da_ultima_visita, situacao, cidade, uf, vendedor")
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

  useEffect(() => {
    if (!isVendor) return;

    const loadVendorStats = async () => {
      setVisitStatsError(null);
      const now = new Date();
      const monthStart = startOfMonth(now);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const startKey = monthStart.toISOString().slice(0, 10);
      const endKey = monthEnd.toISOString().slice(0, 10);

      let query = supabase
        .from("visits")
        .select("agenda_id, completed_at, completed_vidas, no_visit_reason, visit_date")
        .gte("visit_date", startKey)
        .lte("visit_date", endKey);

      if (session?.user.id && profile?.display_name) {
        query = query.or(
          `assigned_to_user_id.eq.${session.user.id},assigned_to_name.eq.${profile.display_name}`,
        );
      } else if (session?.user.id) {
        query = query.eq("assigned_to_user_id", session.user.id);
      } else if (profile?.display_name) {
        query = query.eq("assigned_to_name", profile.display_name);
      }

      const { data, error: supaError } = await query;
      if (supaError) {
        setVisitStatsError(supaError.message);
        setVisitStats(null);
        return;
      }

      setVisitStats(
        computeVisitStats(
          (data ?? []).map((item) => ({
            agenda_id: item.agenda_id ?? null,
            completed_at: item.completed_at ?? null,
            completed_vidas: item.completed_vidas ?? null,
            no_visit_reason: item.no_visit_reason ?? null,
          })),
        ),
      );
    };

    loadVendorStats();
  }, [isVendor, profile?.display_name, session?.user.id]);

  useEffect(() => {
    if (!isSupervisor || !profile?.id) return;

    const loadTeamStats = async () => {
      setTeamStatsError(null);
      const now = new Date();
      const monthStart = startOfMonth(now);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const startKey = monthStart.toISOString().slice(0, 10);
      const endKey = monthEnd.toISOString().slice(0, 10);

      const { data: vendors, error: vendorsError } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .eq("role", "VENDEDOR")
        .eq("supervisor_id", profile.id);

      if (vendorsError) {
        setTeamStatsError(vendorsError.message);
        setTeamStats(null);
        return;
      }

      const vendorIds = (vendors ?? [])
        .map((vendor) => vendor.user_id)
        .filter((value): value is string => Boolean(value));
      const vendorNames = (vendors ?? [])
        .map((vendor) => vendor.display_name)
        .filter((value): value is string => Boolean(value));

      setTeamVendorsCount(vendorIds.length);

      if (vendorIds.length === 0 && vendorNames.length === 0) {
        setTeamStats(
          computeVisitStats([]),
        );
        return;
      }

      let visitsQuery = supabase
        .from("visits")
        .select("agenda_id, completed_at, completed_vidas, no_visit_reason, visit_date")
        .gte("visit_date", startKey)
        .lte("visit_date", endKey);

      if (vendorIds.length && vendorNames.length) {
        visitsQuery = visitsQuery.or(
          `assigned_to_user_id.in.(${formatOrValues(vendorIds)}),assigned_to_name.in.(${formatOrValues(vendorNames)})`,
        );
      } else if (vendorIds.length) {
        visitsQuery = visitsQuery.in("assigned_to_user_id", vendorIds);
      } else {
        visitsQuery = visitsQuery.in("assigned_to_name", vendorNames);
      }

      const { data: visitsData, error: visitsError } = await visitsQuery;
      if (visitsError) {
        setTeamStatsError(visitsError.message);
        setTeamStats(null);
        return;
      }

      setTeamStats(
        computeVisitStats(
          (visitsData ?? []).map((item) => ({
            agenda_id: item.agenda_id ?? null,
            completed_at: item.completed_at ?? null,
            completed_vidas: item.completed_vidas ?? null,
            no_visit_reason: item.no_visit_reason ?? null,
          })),
        ),
      );
    };

    loadTeamStats();
  }, [isSupervisor, profile?.id]);

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

  const donutLabel = (value: number) => new Intl.NumberFormat("pt-BR").format(value);

  const renderDonut = (
    title: string,
    total: number,
    data: Array<{ label: string; value: number; color: string }>,
    subtitle?: string,
  ) => {
    const sum = data.reduce((acc, item) => acc + item.value, 0);
    let current = 0;
    const segments = data
      .map((item) => {
        const percent = sum ? (item.value / sum) * 100 : 0;
        const start = current;
        current += percent;
        return `${item.color} ${start}% ${current}%`;
      })
      .join(", ");
    const background = sum ? `conic-gradient(${segments})` : "conic-gradient(#e2e8f0 0% 100%)";

    return (
      <div className="rounded-2xl border border-sea/15 bg-white/95 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">{title}</h3>
          {subtitle ? <span className="text-xs text-ink/60">{subtitle}</span> : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="relative h-36 w-36">
            <div className="absolute inset-0 rounded-full" style={{ background }} />
            <div className="absolute inset-4 rounded-full bg-white" />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xs text-ink/60">Total</span>
              <span className="text-xl font-semibold text-ink">{donutLabel(total)}</span>
            </div>
          </div>
          <div className="space-y-2 text-xs text-ink/70">
            {data.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="min-w-[110px]">{item.label}</span>
                <span className="font-semibold text-ink">{donutLabel(item.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-ink">Dashboard</h2>
        <p className="mt-2 text-sm text-muted">
          Indicadores gerais da agenda e visitas comerciais.
        </p>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
          Carregando indicadores...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-600">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-sea/20 bg-sand/40 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Hoje</p>
              <p className="mt-2 font-display text-3xl text-ink">
                {formatNumber(summary.totals.today)}
              </p>
              <p className="text-xs text-ink/60">Agendamentos</p>
            </div>
            <div className="rounded-2xl border border-sea/20 bg-sand/40 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Semana</p>
              <p className="mt-2 font-display text-3xl text-ink">
                {formatNumber(summary.totals.week)}
              </p>
              <p className="text-xs text-ink/60">Agendamentos</p>
            </div>
            <div className="rounded-2xl border border-sea/20 bg-sand/40 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Mes</p>
              <p className="mt-2 font-display text-3xl text-ink">
                {formatNumber(summary.totals.month)}
              </p>
              <p className="text-xs text-ink/60">Agendamentos</p>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-sea/15 bg-white/90 p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg text-ink">Visitas por situacao</h3>
                <span className="text-xs text-ink/60">Top 6</span>
              </div>
              <div className="mt-4 space-y-2">
                {summary.topStatus.length === 0 ? (
                  <p className="text-sm text-ink/60">Sem dados.</p>
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

            <div className="rounded-2xl border border-sea/15 bg-white/90 p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg text-ink">Por cidade / UF</h3>
                <span className="text-xs text-ink/60">Top 6</span>
              </div>
              <div className="mt-4 space-y-2">
                {summary.topCities.length === 0 ? (
                  <p className="text-sm text-ink/60">Sem dados.</p>
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
              <div className="rounded-2xl border border-sea/15 bg-white/90 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg text-ink">Visitas por vendedor</h3>
                  <span className="text-xs text-ink/60">Top 5</span>
                </div>
                <div className="mt-4 space-y-2">
                  {summary.ranking.length === 0 ? (
                    <p className="text-sm text-ink/60">Sem dados.</p>
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
              <div className="rounded-2xl border border-sea/15 bg-white/90 p-5">
                <h3 className="font-display text-lg text-ink">Resumo geral</h3>
                <p className="mt-2 text-sm text-ink/60">
                  Total de vendedores ativos: {Object.keys(summary.byVendor).length}
                </p>
                <p className="mt-2 text-sm text-ink/60">
                  Total de registros analisados: {rows.length}
                </p>
              </div>
            </section>
          )}

          {isVendor && (
            <section className="grid gap-4 lg:grid-cols-2">
              {visitStatsError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-600">
                  {visitStatsError}
                </div>
              ) : visitStats ? (
                <>
                  {renderDonut(
                    "Visitas do mes",
                    visitStats.visitasRealizadas + visitStats.visitasNaoRealizadas + visitStats.visitasPendentes,
                    [
                      { label: "Realizadas", value: visitStats.visitasRealizadas, color: "#1f7a5a" },
                      { label: "Nao realizadas", value: visitStats.visitasNaoRealizadas, color: "#f97316" },
                      { label: "Pendentes", value: visitStats.visitasPendentes, color: "#94a3b8" },
                    ],
                    "Mes atual",
                  )}
                  {renderDonut(
                    "Impacto do mes",
                    visitStats.totalVidas + visitStats.empresasVisitadas,
                    [
                      { label: "Vidas registradas", value: visitStats.totalVidas, color: "#0f766e" },
                      { label: "Empresas visitadas", value: visitStats.empresasVisitadas, color: "#38bdf8" },
                    ],
                    "Mes atual",
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-sea/20 bg-sand/30 p-5 text-sm text-ink/70">
                  Carregando dados do vendedor...
                </div>
              )}
            </section>
          )}

          {isSupervisor && (
            <section className="grid gap-4 lg:grid-cols-2">
              {teamStatsError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-600">
                  {teamStatsError}
                </div>
              ) : teamStats ? (
                <>
                  {renderDonut(
                    "Visitas do mes (equipe)",
                    teamStats.visitasRealizadas + teamStats.visitasNaoRealizadas + teamStats.visitasPendentes,
                    [
                      { label: "Realizadas", value: teamStats.visitasRealizadas, color: "#1f7a5a" },
                      { label: "Nao realizadas", value: teamStats.visitasNaoRealizadas, color: "#f97316" },
                      { label: "Pendentes", value: teamStats.visitasPendentes, color: "#94a3b8" },
                    ],
                    `Mes atual • ${teamVendorsCount} vendedor(es)`,
                  )}
                  {renderDonut(
                    "Impacto do mes (equipe)",
                    teamStats.totalVidas + teamStats.empresasVisitadas,
                    [
                      { label: "Vidas registradas", value: teamStats.totalVidas, color: "#0f766e" },
                      { label: "Empresas visitadas", value: teamStats.empresasVisitadas, color: "#38bdf8" },
                    ],
                    "Mes atual",
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-sea/20 bg-sand/30 p-5 text-sm text-ink/70">
                  Carregando dados da equipe...
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
