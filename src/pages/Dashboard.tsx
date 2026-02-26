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

const toLocalDateInput = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
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
type VendorVidasSeries = { label: string; value: number };
type VendorVidasSummary = {
  total: number;
  totalVendors: number;
  hiddenCount: number;
};
type DigitalSummary = {
  todayTotalVidas: number;
  todayRegistered: number;
  yesterdayTotalVidas: number;
  yesterdayRegistered: number;
  pendingToday: string[];
  pendingYesterday: string[];
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
  const [vendorVidasSeries, setVendorVidasSeries] = useState<VendorVidasSeries[]>([]);
  const [vendorVidasLoading, setVendorVidasLoading] = useState(false);
  const [vendorVidasError, setVendorVidasError] = useState<string | null>(null);
  const [vendorVidasSummary, setVendorVidasSummary] = useState<VendorVidasSummary>({
    total: 0,
    totalVendors: 0,
    hiddenCount: 0,
  });
  const [vendorVidasFrom, setVendorVidasFrom] = useState(() => toLocalDateInput(startOfMonth(new Date())));
  const [vendorVidasTo, setVendorVidasTo] = useState(() => toLocalDateInput(new Date()));
  const [digitalSummary, setDigitalSummary] = useState<DigitalSummary | null>(null);
  const [digitalLoading, setDigitalLoading] = useState(false);
  const [digitalError, setDigitalError] = useState<string | null>(null);

  const isVendor = role === "VENDEDOR";
  const canSelectSupervisor = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canViewTeamStats = role === "SUPERVISOR" || role === "ASSISTENTE";
  const activeSupervisorId = selectedSupervisorId === "all" ? null : selectedSupervisorId;
  const todayKey = useMemo(() => toLocalDateInput(new Date()), []);
  const yesterdayKey = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return toLocalDateInput(date);
  }, []);

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

  useEffect(() => {
    if (!canViewTeamStats) return;
    if (!vendorVidasFrom || !vendorVidasTo) {
      setVendorVidasSeries([]);
      setVendorVidasSummary({ total: 0, totalVendors: 0, hiddenCount: 0 });
      return;
    }
    if (vendorVidasFrom > vendorVidasTo) {
      setVendorVidasError("Periodo invalido.");
      setVendorVidasSeries([]);
      setVendorVidasSummary({ total: 0, totalVendors: 0, hiddenCount: 0 });
      return;
    }

    const loadVendorVidas = async () => {
      setVendorVidasLoading(true);
      setVendorVidasError(null);
      try {
        const vendorsQuery = supabase
          .from("profiles")
          .select("user_id, display_name")
          .eq("role", "VENDEDOR");

        const { data: vendors, error: vendorsError } = activeSupervisorId
          ? await vendorsQuery.eq("supervisor_id", activeSupervisorId)
          : await vendorsQuery;

        if (vendorsError) {
          throw new Error(vendorsError.message);
        }

        const vendorIds = (vendors ?? [])
          .map((vendor) => vendor.user_id)
          .filter((value): value is string => Boolean(value));
        const vendorNames = (vendors ?? [])
          .map((vendor) => vendor.display_name)
          .filter((value): value is string => Boolean(value));

        const vendorNameById = new Map(
          (vendors ?? [])
            .filter((vendor) => vendor.user_id)
            .map((vendor) => [vendor.user_id as string, vendor.display_name ?? vendor.user_id]),
        );

        let visitsQuery = supabase
          .from("visits")
          .select("assigned_to_user_id, assigned_to_name, completed_vidas, completed_at, no_visit_reason, visit_date")
          .gte("visit_date", vendorVidasFrom)
          .lte("visit_date", vendorVidasTo)
          .not("completed_at", "is", null)
          .is("no_visit_reason", null);

        if (activeSupervisorId) {
          if (vendorIds.length === 0 && vendorNames.length === 0) {
            setVendorVidasSeries([]);
            setVendorVidasLoading(false);
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
        if (visitsError) throw new Error(visitsError.message);

        const totals = new Map<string, number>();
        (visitsData ?? []).forEach((item) => {
          const value = Number(item.completed_vidas ?? 0);
          if (!Number.isFinite(value) || value <= 0) return;
          const label =
            item.assigned_to_name ??
            (item.assigned_to_user_id ? vendorNameById.get(item.assigned_to_user_id) : null) ??
            "Sem vendedor";
          totals.set(label, (totals.get(label) ?? 0) + value);
        });

        const series = Array.from(totals.entries())
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value);
        const topSeries = series.slice(0, 10);
        const total = series.reduce((acc, item) => acc + item.value, 0);
        setVendorVidasSeries(topSeries);
        setVendorVidasSummary({
          total,
          totalVendors: series.length,
          hiddenCount: Math.max(0, series.length - topSeries.length),
        });
      } catch (err) {
        setVendorVidasError(err instanceof Error ? err.message : "Erro ao carregar grafico.");
        setVendorVidasSeries([]);
        setVendorVidasSummary({ total: 0, totalVendors: 0, hiddenCount: 0 });
      } finally {
        setVendorVidasLoading(false);
      }
    };

    loadVendorVidas();
  }, [activeSupervisorId, canViewTeamStats, vendorVidasFrom, vendorVidasTo]);

  useEffect(() => {
    if (!canViewTeamStats) return;
    let active = true;

    const loadDigitalSummary = async () => {
      setDigitalLoading(true);
      setDigitalError(null);
      try {
        const vendorsQuery = supabase
          .from("profiles")
          .select("user_id, display_name")
          .eq("role", "VENDEDOR");

        const { data: vendors, error: vendorsError } = activeSupervisorId
          ? await vendorsQuery.eq("supervisor_id", activeSupervisorId)
          : await vendorsQuery;

        if (!active) return;
        if (vendorsError) throw new Error(vendorsError.message);

        const vendorIds = (vendors ?? [])
          .map((vendor) => vendor.user_id)
          .filter((value): value is string => Boolean(value));
        const vendorNames = (vendors ?? [])
          .map((vendor) => vendor.display_name)
          .filter((value): value is string => Boolean(value));
        const vendorNameSet = new Set(vendorNames.map((name) => normalizeKey(name)));
        const vendorIdSet = new Set(vendorIds);

        if ((vendors ?? []).length === 0) {
          setDigitalSummary({
            todayTotalVidas: 0,
            todayRegistered: 0,
            yesterdayTotalVidas: 0,
            yesterdayRegistered: 0,
            pendingToday: [],
            pendingYesterday: [],
          });
          setDigitalLoading(false);
          return;
        }

        const { data: digitalRows, error: digitalError } = await supabase
          .from("aceite_digital")
          .select("vendor_user_id, vendor_name, entry_date, vidas")
          .in("entry_date", [todayKey, yesterdayKey]);

        if (!active) return;
        if (digitalError) throw new Error(digitalError.message);

        const todayRows = (digitalRows ?? []).filter((row) => row.entry_date === todayKey);
        const yesterdayRows = (digitalRows ?? []).filter((row) => row.entry_date === yesterdayKey);

        const matchesVendor = (row: { vendor_user_id: string | null; vendor_name: string | null }) => {
          if (vendorIdSet.size === 0 && vendorNameSet.size === 0) return false;
          if (row.vendor_user_id && vendorIdSet.has(row.vendor_user_id)) return true;
          if (row.vendor_name && vendorNameSet.has(normalizeKey(row.vendor_name))) return true;
          return false;
        };

        const sumVidas = (rows: typeof todayRows) =>
          rows.reduce((acc, row) => {
            if (!matchesVendor(row)) return acc;
            const value = Number(row.vidas ?? 0);
            return acc + (Number.isFinite(value) ? value : 0);
          }, 0);

        const acceptedTodayIds = new Set(
          todayRows.map((row) => row.vendor_user_id).filter((value): value is string => Boolean(value)),
        );
        const acceptedTodayNames = new Set(
          todayRows
            .map((row) => row.vendor_name)
            .filter((value): value is string => Boolean(value))
            .map((name) => normalizeKey(name)),
        );
        const acceptedYesterdayIds = new Set(
          yesterdayRows.map((row) => row.vendor_user_id).filter((value): value is string => Boolean(value)),
        );
        const acceptedYesterdayNames = new Set(
          yesterdayRows
            .map((row) => row.vendor_name)
            .filter((value): value is string => Boolean(value))
            .map((name) => normalizeKey(name)),
        );

        const pendingToday: string[] = [];
        const pendingYesterday: string[] = [];
        let todayRegistered = 0;
        let yesterdayRegistered = 0;

        (vendors ?? []).forEach((vendor) => {
          const name = vendor.display_name ?? vendor.user_id ?? "Vendedor";
          const nameKey = vendor.display_name ? normalizeKey(vendor.display_name) : "";
          const isToday =
            (vendor.user_id && acceptedTodayIds.has(vendor.user_id)) ||
            (nameKey && acceptedTodayNames.has(nameKey));
          const isYesterday =
            (vendor.user_id && acceptedYesterdayIds.has(vendor.user_id)) ||
            (nameKey && acceptedYesterdayNames.has(nameKey));

          if (isToday) todayRegistered += 1;
          if (isYesterday) yesterdayRegistered += 1;
          if (!isToday) pendingToday.push(name);
          if (!isYesterday) pendingYesterday.push(name);
        });

        if (!active) return;
        setDigitalSummary({
          todayTotalVidas: sumVidas(todayRows),
          todayRegistered,
          yesterdayTotalVidas: sumVidas(yesterdayRows),
          yesterdayRegistered,
          pendingToday,
          pendingYesterday,
        });
      } catch (err) {
        if (!active) return;
        setDigitalError(err instanceof Error ? err.message : "Erro ao carregar aceite digital.");
        setDigitalSummary(null);
      } finally {
        if (active) setDigitalLoading(false);
      }
    };

    loadDigitalSummary();
    return () => {
      active = false;
    };
  }, [activeSupervisorId, canViewTeamStats, todayKey, yesterdayKey]);

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

  const exportVendorVidasPdf = () => {
    if (vendorVidasSeries.length === 0) return;
    const total = vendorVidasSummary.total || vendorVidasSeries.reduce((acc, item) => acc + item.value, 0);
    const maxValue = vendorVidasSeries[0]?.value ?? 1;
    const periodLabel = `${vendorVidasFrom || "-"} a ${vendorVidasTo || "-"}`;
    const supervisorLabel =
      activeSupervisorId && supervisores.length
        ? supervisores.find((item) => item.id === activeSupervisorId)?.display_name ?? "Supervisor"
        : "Todos";

    const rowsHtml = vendorVidasSeries
      .map((item, index) => {
        const percent = total ? ((item.value / total) * 100).toFixed(1) : "0.0";
        return `
          <tr>
            <td>${index + 1}</td>
            <td>${item.label}</td>
            <td style="text-align:right;">${formatNumber(item.value)}</td>
            <td style="text-align:right;">${percent}%</td>
          </tr>
        `;
      })
      .join("");

    const barsHtml = vendorVidasSeries
      .map((item) => {
        const height = Math.max(8, Math.round((item.value / maxValue) * 160));
        return `
          <div class="bar-item">
            <div class="bar-value">${formatNumber(item.value)}</div>
            <div class="bar" style="height:${height}px"></div>
            <div class="bar-label">${item.label}</div>
          </div>
        `;
      })
      .join("");

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Vidas por vendedor</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; color: #0f172a; padding: 24px; }
            h1 { margin: 0 0 6px; font-size: 20px; }
            .meta { font-size: 12px; color: #475569; margin-bottom: 16px; }
            .summary { display: flex; gap: 12px; margin-bottom: 16px; }
            .summary .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 12px; font-size: 12px; }
            .bars { display: flex; align-items: flex-end; gap: 12px; overflow-x: auto; padding-bottom: 8px; }
            .bar-item { min-width: 72px; text-align: center; }
            .bar { width: 36px; margin: 6px auto 4px; border-radius: 10px 10px 0 0; background: #0f766e; }
            .bar-value { font-size: 11px; font-weight: bold; }
            .bar-label { font-size: 10px; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 4px; font-size: 12px; text-align: left; }
            th { color: #475569; font-weight: 600; }
          </style>
        </head>
        <body>
          <h1>Vidas por vendedor</h1>
          <div class="meta">Periodo: ${periodLabel} • Supervisor: ${supervisorLabel}</div>
          <div class="summary">
            <div class="card">Total de vidas: <strong>${formatNumber(total)}</strong></div>
            <div class="card">Vendedores: <strong>${vendorVidasSummary.totalVendors}</strong></div>
          </div>
          <div class="bars">${barsHtml}</div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Vendedor</th>
                <th style="text-align:right;">Vidas</th>
                <th style="text-align:right;">%</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      setVendorVidasError("Nao foi possivel abrir a janela para exportar PDF.");
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
    }, 300);
  };

  const formatPendingList = (names: string[], limit = 6) => {
    if (names.length === 0) return "Nenhuma pendencia.";
    const slice = names.slice(0, limit);
    const extra = names.length - slice.length;
    return `${slice.join(", ")}${extra > 0 ? ` e mais ${extra}` : ""}`;
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

          {canViewTeamStats && (
            <section className="rounded-2xl border border-sea/15 bg-white/90 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg text-ink">Aceite digital</h3>
                  <p className="mt-1 text-xs text-ink/60">
                    Resumo de registros de vidas e pendencias do time.
                  </p>
                </div>
              </div>

              {digitalLoading ? (
                <p className="mt-3 text-xs text-ink/60">Carregando aceite digital...</p>
              ) : digitalError ? (
                <p className="mt-3 text-xs text-red-500">{digitalError}</p>
              ) : digitalSummary ? (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-sea/15 bg-sand/30 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Hoje</p>
                    <p className="mt-2 text-2xl font-semibold text-ink">
                      {formatNumber(digitalSummary.todayTotalVidas)}
                    </p>
                    <p className="text-[11px] text-ink/60">
                      {digitalSummary.todayRegistered} vendedor(es) registraram
                    </p>
                  </div>
                  <div className="rounded-xl border border-sea/15 bg-sand/30 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Ontem</p>
                    <p className="mt-2 text-2xl font-semibold text-ink">
                      {formatNumber(digitalSummary.yesterdayTotalVidas)}
                    </p>
                    <p className="text-[11px] text-ink/60">
                      {digitalSummary.yesterdayRegistered} vendedor(es) registraram
                    </p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-amber-700">Pendencias</p>
                    <p className="mt-2 text-sm text-amber-700">
                      Ontem: {digitalSummary.pendingYesterday.length} vendedor(es)
                    </p>
                    <p className="text-[11px] text-amber-700">
                      {formatPendingList(digitalSummary.pendingYesterday)}
                    </p>
                    <p className="mt-2 text-sm text-amber-700">
                      Hoje: {digitalSummary.pendingToday.length} vendedor(es)
                    </p>
                    <p className="text-[11px] text-amber-700">
                      {formatPendingList(digitalSummary.pendingToday)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-ink/60">Sem dados de aceite digital.</p>
              )}
            </section>
          )}

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

          {canViewTeamStats && (
            <section className="rounded-2xl border border-sea/15 bg-white/90 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg text-ink">Vidas por vendedor</h3>
                  <p className="mt-1 text-xs text-ink/60">
                    Soma de vidas registradas por vendedor no periodo selecionado.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                    De
                    <input
                      type="date"
                      value={vendorVidasFrom}
                      onChange={(event) => setVendorVidasFrom(event.target.value)}
                      className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                    Ate
                    <input
                      type="date"
                      value={vendorVidasTo}
                      onChange={(event) => setVendorVidasTo(event.target.value)}
                      className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={exportVendorVidasPdf}
                    disabled={vendorVidasSeries.length === 0 || vendorVidasLoading}
                    className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
                  >
                    Exportar PDF
                  </button>
                </div>
              </div>

              {vendorVidasError && (
                <p className="mt-3 text-xs text-red-500">{vendorVidasError}</p>
              )}
              {vendorVidasLoading ? (
                <p className="mt-3 text-xs text-ink/60">Carregando grafico...</p>
              ) : vendorVidasSeries.length === 0 ? (
                <p className="mt-3 text-xs text-ink/60">Sem dados para o periodo.</p>
              ) : (
                <div className="mt-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink/60">
                    <span>Total de vidas: {formatNumber(vendorVidasSummary.total)}</span>
                    <span>
                      Mostrando top 10{vendorVidasSummary.hiddenCount > 0 ? ` (+${vendorVidasSummary.hiddenCount} outros)` : ""}
                    </span>
                  </div>
                  <div className="flex items-end gap-4 overflow-x-auto pb-2">
                    {(() => {
                      const maxValue = vendorVidasSeries[0]?.value ?? 1;
                      const total = vendorVidasSummary.total || vendorVidasSeries.reduce((acc, item) => acc + item.value, 0);
                      return vendorVidasSeries.map((item) => {
                        const height = Math.max(6, Math.round((item.value / maxValue) * 160));
                        const percent = total ? ((item.value / total) * 100).toFixed(1) : "0.0";
                        return (
                          <div
                            key={item.label}
                            className="flex min-w-[72px] flex-col items-center gap-2"
                            title={`${item.label} • ${formatNumber(item.value)} vidas (${percent}%) • ${vendorVidasFrom} a ${vendorVidasTo}`}
                          >
                            <span className="text-[11px] font-semibold text-ink">
                              {formatNumber(item.value)}
                            </span>
                            <div
                              className="w-10 rounded-t-xl bg-sea"
                              style={{ height }}
                            />
                            <span className="w-20 truncate text-center text-[11px] text-ink/70">
                              {item.label}
                            </span>
                            <span className="text-[10px] text-ink/50">{percent}%</span>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-[420px] w-full text-left text-xs text-ink/70">
                      <thead>
                        <tr className="border-b border-sea/20">
                          <th className="py-2 pr-2">#</th>
                          <th className="py-2 pr-2">Vendedor</th>
                          <th className="py-2 pr-2 text-right">Vidas</th>
                          <th className="py-2 pr-2 text-right">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendorVidasSeries.map((item, index) => {
                          const total = vendorVidasSummary.total || vendorVidasSeries.reduce((acc, row) => acc + row.value, 0);
                          const percent = total ? ((item.value / total) * 100).toFixed(1) : "0.0";
                          return (
                            <tr key={item.label} className="border-b border-sea/10">
                              <td className="py-2 pr-2">{index + 1}</td>
                              <td className="py-2 pr-2">{item.label}</td>
                              <td className="py-2 pr-2 text-right">{formatNumber(item.value)}</td>
                              <td className="py-2 pr-2 text-right">{percent}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
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
