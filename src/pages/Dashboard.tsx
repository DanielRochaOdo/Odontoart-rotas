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

const normalizeKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();

type VisitStats = {
  totalVidas: number;
  empresasVisitadas: number;
  visitasRealizadas: number;
  visitasNaoRealizadas: number;
  visitasPendentes: number;
};

type DonutSeries = { label: string; value: number; color: string };

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

const buildDailyVidasSeries = (
  data: Array<{
    visit_date: string | null;
    completed_at: string | null;
    completed_vidas: number | null;
    no_visit_reason: string | null;
  }>,
  days = 7,
): DonutSeries[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const labels: { key: string; label: string }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
    labels.push({ key, label });
  }

  const totals = new Map<string, number>();
  labels.forEach(({ key }) => totals.set(key, 0));

  (data ?? []).forEach((item) => {
    if (!item.completed_at || item.no_visit_reason) return;
    const key = item.visit_date ?? item.completed_at?.slice(0, 10);
    if (!key || !totals.has(key)) return;
    const value = Number(item.completed_vidas ?? 0);
    if (!Number.isFinite(value)) return;
    totals.set(key, (totals.get(key) ?? 0) + value);
  });

  const palette = ["#0f766e", "#1f7a5a", "#22c55e", "#38bdf8", "#7dd3fc", "#94a3b8", "#e2e8f0"];

  return labels.map(({ key, label }, index) => ({
    label,
    value: totals.get(key) ?? 0,
    color: palette[index % palette.length],
  }));
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
  const [visitDailyVidas, setVisitDailyVidas] = useState<DonutSeries[]>([]);
  const [teamStats, setTeamStats] = useState<VisitStats | null>(null);
  const [teamStatsError, setTeamStatsError] = useState<string | null>(null);
  const [teamDailyVidas, setTeamDailyVidas] = useState<DonutSeries[]>([]);
  const [teamVendorsCount, setTeamVendorsCount] = useState(0);
  const [supervisores, setSupervisores] = useState<
    { id: string; display_name: string | null }[]
  >([]);
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>("all");
  const [teamVendorNames, setTeamVendorNames] = useState<string[]>([]);

  const isVendor = role === "VENDEDOR";
  const canSelectSupervisor = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canViewTeamStats = role === "SUPERVISOR" || role === "ASSISTENTE";
  const activeSupervisorId = selectedSupervisorId === "all" ? null : selectedSupervisorId;

  useEffect(() => {
    if (!canSelectSupervisor) return;
    let active = true;
    const loadSupervisores = async () => {
      const { data, error: supaError } = await supabase
        .from("profiles")
        .select("id, display_name")
        .eq("role", "SUPERVISOR")
        .order("display_name", { ascending: true });

      if (!active) return;

      if (supaError) {
        console.error(supaError);
        setSupervisores([]);
        return;
      }

      const list = data ?? [];
      setSupervisores(list);
      setSelectedSupervisorId((prev) => {
        if (prev && prev !== "") return prev;
        if (role === "SUPERVISOR" && profile?.id) return profile.id;
        return "all";
      });
    };

    loadSupervisores();
    return () => {
      active = false;
    };
  }, [canSelectSupervisor, profile?.id, role]);

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
        setVisitDailyVidas([]);
        return;
      }

      setVisitDailyVidas(buildDailyVidasSeries(data ?? []));
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
    if (!canViewTeamStats) return;

    const loadTeamStats = async () => {
      setTeamStatsError(null);
      const now = new Date();
      const monthStart = startOfMonth(now);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const startKey = monthStart.toISOString().slice(0, 10);
      const endKey = monthEnd.toISOString().slice(0, 10);

      const vendorsQuery = supabase
        .from("profiles")
        .select("user_id, display_name")
        .eq("role", "VENDEDOR");

      const { data: vendors, error: vendorsError } = activeSupervisorId
        ? await vendorsQuery.eq("supervisor_id", activeSupervisorId)
        : await vendorsQuery;

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
      setTeamVendorNames(vendorNames);

      let visitsQuery = supabase
        .from("visits")
        .select("agenda_id, completed_at, completed_vidas, no_visit_reason, visit_date")
        .gte("visit_date", startKey)
        .lte("visit_date", endKey);

      if (activeSupervisorId) {
        if (vendorIds.length === 0 && vendorNames.length === 0) {
          setTeamStats(computeVisitStats([]));
          return;
        }

        if (vendorIds.length && vendorNames.length) {
          visitsQuery = visitsQuery.or(
            `assigned_to_user_id.in.(${formatOrValues(vendorIds)}),assigned_to_name.in.(${formatOrValues(vendorNames)})`,
          );
        } else if (vendorIds.length) {
          visitsQuery = visitsQuery.in("assigned_to_user_id", vendorIds);
        } else {
          visitsQuery = visitsQuery.in("assigned_to_name", vendorNames);
        }
      }

      const { data: visitsData, error: visitsError } = await visitsQuery;
      if (visitsError) {
        setTeamStatsError(visitsError.message);
        setTeamStats(null);
        setTeamDailyVidas([]);
        return;
      }

      setTeamDailyVidas(buildDailyVidasSeries(visitsData ?? []));
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
  }, [activeSupervisorId, canViewTeamStats]);

  const normalizedVendorNames = useMemo(() => {
    if (!teamVendorNames.length) return new Set<string>();
    return new Set(teamVendorNames.map((name) => normalizeKey(name)));
  }, [teamVendorNames]);

  const summaryRows = useMemo(() => {
    if (!canSelectSupervisor || !activeSupervisorId) return rows;
    if (normalizedVendorNames.size === 0) return [];
    return rows.filter((row) => {
      if (!row.vendedor) return false;
      return normalizedVendorNames.has(normalizeKey(row.vendedor));
    });
  }, [activeSupervisorId, canSelectSupervisor, normalizedVendorNames, rows]);

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

    summaryRows.forEach((row) => {
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
  }, [summaryRows]);

  const donutLabel = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
  const dailyVidasTotal = useMemo(
    () => visitDailyVidas.reduce((sum, item) => sum + item.value, 0),
    [visitDailyVidas],
  );
  const teamDailyVidasTotal = useMemo(
    () => teamDailyVidas.reduce((sum, item) => sum + item.value, 0),
    [teamDailyVidas],
  );

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
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-ink">Dashboard</h2>
            <p className="mt-2 text-sm text-muted">
              Indicadores gerais da agenda e visitas comerciais.
            </p>
          </div>
          {canSelectSupervisor && (
            <label className="flex min-w-[220px] flex-col gap-1 text-xs font-semibold text-ink/70">
              Supervisor
              <select
                id="dashboard-supervisor-select"
                name="dashboardSupervisorSelect"
                value={selectedSupervisorId}
                onChange={(event) => setSelectedSupervisorId(event.target.value || "all")}
                className="rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-xs text-ink outline-none focus:border-sea"
              >
                <option value="all">Todos</option>
                {supervisores.length === 0 ? (
                  <option value="all">Nenhum supervisor</option>
                ) : (
                  supervisores.map((supervisor) => (
                    <option key={supervisor.id} value={supervisor.id}>
                      {supervisor.display_name ?? "Supervisor"}
                    </option>
                  ))
                )}
              </select>
            </label>
          )}
        </div>
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
                  Total de vendedores ativos: {teamVendorsCount || Object.keys(summary.byVendor).length}
                </p>
                <p className="mt-2 text-sm text-ink/60">
                  Total de registros analisados: {summaryRows.length}
                </p>
              </div>
            </section>
          )}

          {isVendor && (
            <section className="grid gap-4 lg:grid-cols-3">
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
                  {renderDonut(
                    "Vidas por dia",
                    dailyVidasTotal,
                    visitDailyVidas,
                    "Ultimos 7 dias",
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-sea/20 bg-sand/30 p-5 text-sm text-ink/70">
                  Carregando dados do vendedor...
                </div>
              )}
            </section>
          )}

          {canViewTeamStats && (
            <section className="grid gap-4 lg:grid-cols-3">
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
                  {renderDonut(
                    "Vidas por dia (equipe)",
                    teamDailyVidasTotal,
                    teamDailyVidas,
                    "Ultimos 7 dias",
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
