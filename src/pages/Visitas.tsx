import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, endOfMonth, endOfWeek, format, isAfter, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { fetchVendedores } from "../lib/agendaApi";
import { onProfilesUpdated } from "../lib/profileEvents";
import {
  PERFIL_VISITA_PRESETS,
  extractCustomTimes,
  isPresetPerfilVisita,
  normalizePerfilVisita,
} from "../lib/perfilVisita";

type VisitRow = {
  id: string;
  agenda_id: string;
  visit_date: string;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  perfil_visita: string | null;
  perfil_visita_opcoes?: string | null;
  route_id: string | null;
  completed_at: string | null;
  completed_vidas: number | null;
  no_visit_reason: string | null;
  agenda?: {
    id: string;
    empresa: string | null;
    nome_fantasia: string | null;
    endereco: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    situacao: string | null;
    perfil_visita: string | null;
    supervisor?: string | null;
  } | null;
};

type VendorOption = {
  user_id: string;
  display_name: string | null;
  role: string;
  supervisor_id?: string | null;
};

const formatDateKey = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return format(new Date(value), "yyyy-MM-dd");
};

const toDateInput = (value: string | null) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const normalize = (value: string | null) => (value ?? "").trim().toLowerCase();
const formatVisitDate = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, "dd/MM/yyyy");
};

const NO_VISIT_REASONS = [
  "RESPONSAVEL NÃO COMPARECEU",
  "VISITA REMARCADA",
  "EMPRESA FECHADA",
];


export default function Visitas() {
  const { role, session, profile } = useAuth();
  const isVendor = role === "VENDEDOR";
  const canManage = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canAccess = canManage || isVendor;
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [editState, setEditState] = useState<Record<string, { vendorId: string; date: string }>>({});
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [editingVisits, setEditingVisits] = useState<Record<string, boolean>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [maxVisibleDate, setMaxVisibleDate] = useState<string | null>(null);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);
  const [supervisores, setSupervisores] = useState<
    { id: string; user_id: string | null; display_name: string | null }[]
  >([]);
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>("all");
  const restoredViewRef = useRef(false);

  useEffect(() => {
    if (restoredViewRef.current) return;
    try {
      const raw = sessionStorage.getItem("visitasViewState");
      if (!raw) {
        restoredViewRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as Partial<{
        currentMonth: string;
        selectedDate: string | null;
        expandedVendor: string | null;
        selectedSupervisorId: string;
      }>;
      if (parsed.currentMonth) setCurrentMonth(new Date(parsed.currentMonth));
      if (parsed.selectedDate) setSelectedDate(new Date(parsed.selectedDate));
      if (parsed.expandedVendor) setExpandedVendor(parsed.expandedVendor);
      if (parsed.selectedSupervisorId) setSelectedSupervisorId(parsed.selectedSupervisorId);
      restoredViewRef.current = true;
    } catch {
      restoredViewRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!restoredViewRef.current) return;
    const payload = {
      currentMonth: currentMonth.toISOString(),
      selectedDate: selectedDate ? selectedDate.toISOString() : null,
      expandedVendor,
      selectedSupervisorId,
    };
    try {
      sessionStorage.setItem("visitasViewState", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [currentMonth, expandedVendor, selectedDate, selectedSupervisorId]);
  const [confirmVisit, setConfirmVisit] = useState<VisitRow | null>(null);
  const [noVisit, setNoVisit] = useState<{ id: string; reason: string } | null>(null);
  const [completeVisit, setCompleteVisit] = useState<{
    id: string;
    agendaId: string;
    vidas: string;
    perfil: string;
    customManual: boolean;
    customTime: string;
    customOptions: string[];
    customEditEnabled: boolean;
  } | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    const loadVendors = () => {
      fetchVendedores()
        .then((data) => {
          if (active) setVendors(data as VendorOption[]);
        })
        .catch((err) => {
          console.error(err);
        });
    };
    const loadSupervisores = async () => {
      const { data, error: supaError } = await supabase
        .from("profiles")
        .select("id, user_id, display_name")
        .eq("role", "SUPERVISOR")
        .order("display_name", { ascending: true });
      if (!active) return;
      if (supaError) {
        console.error(supaError);
        setSupervisores([]);
        return;
      }
      setSupervisores(data ?? []);
    };
    loadVendors();
    loadSupervisores();
    const unsubscribe = onProfilesUpdated(() => {
      loadVendors();
      loadSupervisores();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [canManage]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      const start = startOfMonth(currentMonth);
      const end = endOfMonth(currentMonth);
      const startDate = format(start, "yyyy-MM-dd");
      const endDate = format(end, "yyyy-MM-dd");
      const todayKey = format(new Date(), "yyyy-MM-dd");
      const yesterdayKey = format(addDays(new Date(), -1), "yyyy-MM-dd");
      let effectiveEnd = endDate;
      let maxDate = endDate;

      if (isVendor) {
        let blocked = false;
        if (session?.user.id || profile?.display_name) {
          let baseQuery = supabase
            .from("visits")
            .select("id", { count: "exact", head: true })
            .eq("visit_date", yesterdayKey)
            .is("completed_at", null);

          if (session?.user.id && profile?.display_name) {
            baseQuery = baseQuery.or(
              `assigned_to_user_id.eq.${session.user.id},assigned_to_name.eq.${profile.display_name}`,
            );
          } else if (session?.user.id) {
            baseQuery = baseQuery.eq("assigned_to_user_id", session.user.id);
          } else if (profile?.display_name) {
            baseQuery = baseQuery.eq("assigned_to_name", profile.display_name);
          }

          const { count, error: countError } = await baseQuery;
          if (!countError && (count ?? 0) > 0) {
            blocked = true;
          }
        }

        if (blocked) {
          maxDate = yesterdayKey;
          setBlockMessage("Conclua todas as visitas de ontem para ver as visitas de hoje.");
        } else {
          maxDate = todayKey;
          setBlockMessage(null);
        }

        setMaxVisibleDate(maxDate);
        effectiveEnd = maxDate < endDate ? maxDate : endDate;
        if (effectiveEnd < startDate) {
          setVisits([]);
          setLoading(false);
          return;
        }
      } else {
        setMaxVisibleDate(null);
        setBlockMessage(null);
      }

      const { data, error: supaError } = await supabase
        .from("visits")
        .select(
          "id, agenda_id, visit_date, assigned_to_user_id, assigned_to_name, perfil_visita, perfil_visita_opcoes, route_id, completed_at, completed_vidas, no_visit_reason, agenda:agenda_id (id, empresa, nome_fantasia, endereco, bairro, cidade, uf, situacao, perfil_visita, supervisor)",
        )
        .gte("visit_date", startDate)
        .lte("visit_date", effectiveEnd)
        .order("visit_date", { ascending: true });

      if (supaError) {
        setError(supaError.message);
        setVisits([]);
      } else {
        type VisitRowJoin = VisitRow & {
          agenda?: VisitRow["agenda"] | VisitRow["agenda"][] | null;
        };
        const normalized = (data ?? []).map((row) => {
          const item = row as VisitRowJoin;
          const agenda = Array.isArray(item.agenda) ? item.agenda[0] ?? null : item.agenda ?? null;
          return { ...item, agenda };
        }) as VisitRow[];
        setVisits(normalized);
      }

      setLoading(false);
    };

    load();
  }, [currentMonth, refreshKey, isVendor, profile?.display_name, session?.user.id]);

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    const days = [] as Date[];
    let date = start;
    while (date <= end) {
      days.push(date);
      date = addDays(date, 1);
    }
    return days;
  }, [currentMonth]);

  const filteredVisits = useMemo(() => {
    if (!canManage || selectedSupervisorId === "all") return visits;
    const supervisor = supervisores.find(
      (item) => item.id === selectedSupervisorId || item.user_id === selectedSupervisorId,
    );
    const supervisorName = supervisor?.display_name ? normalize(supervisor.display_name) : "";
    const supervisorIds = new Set<string>();
    if (supervisor?.id) supervisorIds.add(supervisor.id);
    if (supervisor?.user_id) supervisorIds.add(supervisor.user_id);
    const vendorIds = vendors
      .filter((vendor) => (vendor.supervisor_id ? supervisorIds.has(vendor.supervisor_id) : false))
      .map((vendor) => vendor.user_id)
      .filter(Boolean);
    const vendorNames = vendors
      .filter((vendor) => (vendor.supervisor_id ? supervisorIds.has(vendor.supervisor_id) : false))
      .map((vendor) => vendor.display_name)
      .filter((value): value is string => Boolean(value))
      .map((value) => normalize(value));
    const vendorIdSet = new Set(vendorIds);
    const vendorNameSet = new Set(vendorNames);
    if (vendorIdSet.size === 0 && vendorNameSet.size === 0) return [];
    return visits.filter((visit) => {
      if (visit.assigned_to_user_id && vendorIdSet.has(visit.assigned_to_user_id)) return true;
      if (visit.assigned_to_name && vendorNameSet.has(normalize(visit.assigned_to_name))) return true;
      if (supervisorName && visit.agenda?.supervisor) {
        return normalize(visit.agenda.supervisor) === supervisorName;
      }
      return false;
    });
  }, [canManage, selectedSupervisorId, supervisores, vendors, visits]);

  const visitsByDate = useMemo(() => {
    const map = new Map<string, VisitRow[]>();
    filteredVisits.forEach((visit) => {
      if (!visit.visit_date) return;
      const key = formatDateKey(visit.visit_date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(visit);
    });
    return map;
  }, [filteredVisits]);

  useEffect(() => {
    if (!isVendor || !maxVisibleDate || !selectedDate) return;
    const maxDate = new Date(`${maxVisibleDate}T12:00:00`);
    if (isAfter(selectedDate, maxDate)) {
      setSelectedDate(maxDate);
    }
  }, [isVendor, maxVisibleDate, selectedDate]);

  const selectedVisits = useMemo(() => {
    if (!selectedDate) return [] as VisitRow[];
    const key = format(selectedDate, "yyyy-MM-dd");
    return visitsByDate.get(key) ?? [];
  }, [selectedDate, visitsByDate]);

  const vendorById = useMemo(
    () => new Map(vendors.map((vendor) => [vendor.user_id, vendor])),
    [vendors],
  );

  const groupedBySeller = useMemo(() => {
    const groups: Record<string, VisitRow[]> = {};
    selectedVisits.forEach((visit) => {
      const seller =
        visit.assigned_to_name ??
        (visit.assigned_to_user_id
          ? vendorById.get(visit.assigned_to_user_id)?.display_name
          : null) ??
        "Sem vendedor";
      if (!groups[seller]) groups[seller] = [];
      groups[seller].push(visit);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [selectedVisits, vendorById]);

  useEffect(() => {
    if (!visits.length) {
      setEditState({});
      setEditingVisits({});
      return;
    }
    setEditState((prev) => {
      const next: Record<string, { vendorId: string; date: string }> = { ...prev };
      const validIds = new Set(visits.map((visit) => visit.id));
      Object.keys(next).forEach((id) => {
        if (!validIds.has(id)) {
          delete next[id];
        }
      });
      visits.forEach((visit) => {
        if (!next[visit.id]) {
          const vendorName = visit.assigned_to_name ?? "";
          const matchedVendor =
            visit.assigned_to_user_id
              ? vendors.find((vendor) => vendor.user_id === visit.assigned_to_user_id)
              : vendors.find((vendor) => normalize(vendor.display_name) === normalize(vendorName));
          next[visit.id] = {
            vendorId: matchedVendor?.user_id ?? "",
            date: toDateInput(visit.visit_date),
          };
        } else {
          if (!next[visit.id].date) {
            next[visit.id].date = toDateInput(visit.visit_date);
          }
          if (!next[visit.id].vendorId) {
            const vendorName = visit.assigned_to_name ?? "";
            const matchedVendor =
              visit.assigned_to_user_id
                ? vendors.find((vendor) => vendor.user_id === visit.assigned_to_user_id)
                : vendors.find((vendor) => normalize(vendor.display_name) === normalize(vendorName));
            if (matchedVendor) {
              next[visit.id].vendorId = matchedVendor.user_id;
            }
          }
        }
      });
      return next;
    });
    setEditingVisits((prev) => {
      const next: Record<string, boolean> = { ...prev };
      const validIds = new Set(visits.map((visit) => visit.id));
      Object.keys(next).forEach((id) => {
        if (!validIds.has(id)) delete next[id];
      });
      return next;
    });
  }, [visits, vendors]);

  const ensureRoute = async (vendorId: string, vendorName: string, dateValue: string) => {
    const { data: existing, error } = await supabase
      .from("routes")
      .select("id")
      .eq("assigned_to_user_id", vendorId)
      .eq("date", dateValue)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (existing?.id) {
      return existing.id as string;
    }

    const displayDate = format(new Date(`${dateValue}T12:00:00`), "dd/MM/yyyy");
    const { data: created, error: createError } = await supabase
      .from("routes")
      .insert({
        name: `Visitas ${displayDate} - ${vendorName || "Vendedor"}`,
        date: dateValue,
        assigned_to_user_id: vendorId,
        created_by: session?.user.id ?? null,
      })
      .select("id")
      .single();

    if (createError || !created) {
      throw new Error(createError?.message ?? "Erro ao criar rota.");
    }

    return created.id as string;
  };

  const getNextStopOrder = async (routeId: string) => {
    const { count, error } = await supabase
      .from("route_stops")
      .select("id", { count: "exact", head: true })
      .eq("route_id", routeId);

    if (error) {
      throw new Error(error.message);
    }

    return (count ?? 0) + 1;
  };

  const ensureRouteStop = async (routeId: string, agendaId: string) => {
    const { data: existing, error } = await supabase
      .from("route_stops")
      .select("id")
      .eq("route_id", routeId)
      .eq("agenda_id", agendaId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (existing?.id) return;

    const stopOrder = await getNextStopOrder(routeId);
    const { error: insertError } = await supabase.from("route_stops").insert({
      route_id: routeId,
      agenda_id: agendaId,
      stop_order: stopOrder,
    });
    if (insertError) throw new Error(insertError.message);
  };

  const handleSaveVisit = async (visitId: string) => {
    const state = editState[visitId];
    if (!state) return;
    if (!state.date) {
      setError("Selecione a data da visita.");
      return;
    }
    if (!state.vendorId) {
      setError("Selecione o vendedor.");
      return;
    }

    const visit = visits.find((item) => item.id === visitId);
    if (!visit) return;
    if (visit.completed_at) {
      setError("Visita registrada. Edicao bloqueada.");
      return;
    }

    const vendor = vendorById.get(state.vendorId);
    const vendorName = vendor?.display_name ?? vendor?.user_id ?? visit.assigned_to_name ?? "Sem vendedor";

    setSavingId(visitId);
    setError(null);
    try {
      const routeId = await ensureRoute(state.vendorId, vendorName, state.date);
      const sameVendor =
        (visit.assigned_to_user_id && visit.assigned_to_user_id === state.vendorId) ||
        (!visit.assigned_to_user_id &&
          normalize(visit.assigned_to_name) === normalize(vendorName));

      if (!sameVendor) {
        const { error: insertError } = await supabase
          .from("visits")
          .upsert(
            [
              {
                agenda_id: visit.agenda_id,
                assigned_to_user_id: state.vendorId,
                assigned_to_name: vendorName,
                visit_date: state.date,
                perfil_visita: visit.perfil_visita ?? null,
                route_id: routeId,
                created_by: session?.user.id ?? null,
              },
            ],
            {
              onConflict: "agenda_id,assigned_to_user_id,visit_date",
              ignoreDuplicates: true,
            },
          );

        if (insertError) throw new Error(insertError.message);

        await ensureRouteStop(routeId, visit.agenda_id);
        setRefreshKey((prev) => prev + 1);
        return;
      }

      if (visit.route_id && visit.route_id !== routeId) {
        await supabase
          .from("route_stops")
          .delete()
          .eq("route_id", visit.route_id)
          .eq("agenda_id", visit.agenda_id);
      }

      await ensureRouteStop(routeId, visit.agenda_id);

      const { error: updateError } = await supabase
        .from("visits")
        .update({
          assigned_to_user_id: state.vendorId,
          assigned_to_name: vendorName,
          visit_date: state.date,
          route_id: routeId,
        })
        .eq("id", visitId);

      if (updateError) throw new Error(updateError.message);

      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar visita.");
    } finally {
      setSavingId(null);
    }
  };

  const handleRemoveVisit = async (visitId: string) => {
    const confirmRemove = window.confirm("Remover esta visita e voltar para a agenda?");
    if (!confirmRemove) return;
    setRemovingId(visitId);
    setError(null);
    try {
      const visit = visits.find((item) => item.id === visitId);
      if (!visit) {
        setRemovingId(null);
        return;
      }

      if (visit.route_id) {
        const { error: deleteStopError } = await supabase
          .from("route_stops")
          .delete()
          .eq("route_id", visit.route_id)
          .eq("agenda_id", visit.agenda_id);
        if (deleteStopError) throw new Error(deleteStopError.message);
      }

      const { error: deleteError } = await supabase.from("visits").delete().eq("id", visitId);
      if (deleteError) throw new Error(deleteError.message);

      const { count, error: countError } = await supabase
        .from("visits")
        .select("id", { count: "exact", head: true })
        .eq("agenda_id", visit.agenda_id);

      if (countError) throw new Error(countError.message);

      if ((count ?? 0) === 0) {
        const { error: updateError } = await supabase
          .from("agenda")
          .update({ visit_generated_at: null })
          .eq("id", visit.agenda_id);
        if (updateError) throw new Error(updateError.message);
      }

      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover visita.");
    } finally {
      setRemovingId(null);
    }
  };

  const openCompleteModal = (item: VisitRow) => {
    const agendaPerfil = item.agenda?.perfil_visita ?? "";
    const visitPerfil = item.perfil_visita ?? "";
    const visitOptionsRaw = item.perfil_visita_opcoes ?? "";
    const agendaOptions = extractCustomTimes(agendaPerfil);
    const visitOptions = extractCustomTimes(visitOptionsRaw || visitPerfil);
    const customOptions =
      agendaOptions.length >= visitOptions.length ? agendaOptions : visitOptions;
    const rawPerfil = agendaPerfil || visitOptionsRaw || visitPerfil;
    const normalized = normalizePerfilVisita(rawPerfil);
    const isPreset = normalized !== "" && isPresetPerfilVisita(normalized);
    const hasCustomOptions = customOptions.length > 0 && !isPreset;
    const selectedPerfil = hasCustomOptions
      ? customOptions.find((option) => option === visitPerfil) ?? customOptions[0]
      : normalized;
    setCompleteVisit({
      id: item.id,
      agendaId: item.agenda_id,
      vidas: item.completed_vidas?.toString() ?? "",
      perfil: selectedPerfil,
      customManual: false,
      customTime: hasCustomOptions ? selectedPerfil : "",
      customOptions: hasCustomOptions ? customOptions : [],
      customEditEnabled: false,
    });
  };

  const handleStartRegister = (item: VisitRow) => {
    setConfirmVisit(item);
  };

  const handleConfirmNoVisit = async () => {
    if (!noVisit) return;
    if (!noVisit.reason) {
      setError("Selecione o motivo.");
      return;
    }
    setSavingId(noVisit.id);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from("visits")
        .update({
          completed_at: new Date().toISOString(),
          no_visit_reason: noVisit.reason,
        })
        .eq("id", noVisit.id);

      if (updateError) throw new Error(updateError.message);

      setNoVisit(null);
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registrar visita.");
    } finally {
      setSavingId(null);
    }
  };

  const handleConfirmVisit = async () => {
    if (!completeVisit) return;
    const vidasValue = completeVisit.vidas.trim();
    if (!vidasValue) {
      setError("Informe a quantidade de vidas.");
      return;
    }
    if (!/^\d+$/.test(vidasValue)) {
      setError("Quantidade de vidas deve conter apenas numeros.");
      return;
    }
    const vidas = Number(vidasValue);
    if (!Number.isInteger(vidas) || vidas < 0) {
      setError("Quantidade de vidas deve ser um numero inteiro valido.");
      return;
    }
    if (!completeVisit.perfil) {
      setError("Selecione o horario da visita.");
      return;
    }

    setSavingId(completeVisit.id);
    setError(null);
    try {
      const visit = visits.find((item) => item.id === completeVisit.id);
      if (!visit) {
        throw new Error("Visita nao encontrada.");
      }

      const cleanedOptions = completeVisit.customOptions
        .map((option) => option.trim())
        .filter(Boolean);
      const customTime = completeVisit.customManual ? completeVisit.customTime.trim() : "";
      const normalizedOptions = [...cleanedOptions];
      if (customTime && !normalizedOptions.includes(customTime)) {
        normalizedOptions.push(customTime);
      }
      const perfilOpcoesString = normalizedOptions.length > 0 ? normalizedOptions.join(" • ") : null;

      const { error: updateError } = await supabase
        .from("visits")
        .update({
          completed_at: new Date().toISOString(),
          completed_vidas: vidas,
          perfil_visita: completeVisit.perfil,
          perfil_visita_opcoes:
            perfilOpcoesString,
          no_visit_reason: null,
        })
        .eq("id", completeVisit.id);

      if (updateError) throw new Error(updateError.message);

      setCompleteVisit(null);
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registrar visita.");
    } finally {
      setSavingId(null);
    }
  };

  const updateCustomOptions = (options: string[]) => {
    setCompleteVisit((prev) => {
      if (!prev) return prev;
      const cleaned = options.map((item) => item.trim());
      const available = cleaned.filter(Boolean);
      const shouldUpdatePerfil =
        !prev.customManual && (prev.perfil === "" || !available.includes(prev.perfil));
      return {
        ...prev,
        customOptions: cleaned,
        perfil: shouldUpdatePerfil ? (available[0] ?? "") : prev.perfil,
        customTime: prev.customManual ? prev.customTime : prev.customTime,
      };
    });
  };

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-ink">Visitas</h2>
            <p className="mt-2 text-sm text-ink/60">
              Calendario de visitas por vendedor. Clique em um dia para ver as visitas detalhadas.
            </p>
          </div>
          {canManage && (
            <label className="flex min-w-[220px] flex-col gap-1 text-xs font-semibold text-ink/70">
              Supervisor
              <select
                id="visitas-supervisor-select"
                name="visitasSupervisorSelect"
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

      {!canAccess ? (
        <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
          Este modulo e restrito a usuarios autorizados.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <section className="rounded-2xl border border-sea/15 bg-white/95 p-4 shadow-card">
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="rounded-full border border-sea/20 bg-white/80 p-2 text-sea hover:border-sea"
                onClick={() => setCurrentMonth(addDays(currentMonth, -30))}
              >
                <ChevronLeft size={18} />
              </button>
              <div className="text-sm font-semibold text-ink">
                {format(currentMonth, "MMMM 'de' yyyy", { locale: ptBR })}
              </div>
              <button
                type="button"
                className="rounded-full border border-sea/20 bg-white/80 p-2 text-sea hover:border-sea"
                onClick={() => setCurrentMonth(addDays(currentMonth, 30))}
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-2 text-center text-xs text-ink/60">
              {["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"].map((day) => (
                <span key={day} className="font-semibold">
                  {day}
                </span>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-7 gap-2">
              {calendarDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const count = visitsByDate.get(key)?.length ?? 0;
                const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                const maxDate = isVendor && maxVisibleDate ? new Date(`${maxVisibleDate}T12:00:00`) : null;
                const isDisabled = maxDate ? isAfter(day, maxDate) : false;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => (isDisabled ? null : setSelectedDate(day))}
                    disabled={isDisabled}
                    className={[
                      "flex h-16 flex-col items-center justify-center rounded-xl border px-1 text-xs transition",
                      isSameMonth(day, currentMonth) ? "border-sea/20 bg-white" : "border-mist/50 bg-white/50 text-ink/40",
                      isSelected ? "border-sea bg-sand/60 shadow-sm" : "hover:border-sea hover:bg-sand/40",
                      isDisabled ? "cursor-not-allowed opacity-40 hover:border-sea/20 hover:bg-white/50" : "",
                    ].join(" ")}
                  >
                    <span className="text-sm font-semibold text-ink">{format(day, "d")}</span>
                    <span className="text-[10px] text-ink/60">{count} visitas</span>
                  </button>
                );
              })}
            </div>

            {loading && (
              <p className="mt-4 text-sm text-ink/60">Carregando visitas...</p>
            )}
            {error && (
              <p className="mt-4 text-sm text-red-500">{error}</p>
            )}
          </section>

          <section className="rounded-2xl border border-sea/15 bg-white/95 p-4 shadow-card">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-ink">Visitas do dia</h3>
              <span className="text-xs text-ink/60">
                {selectedDate ? format(selectedDate, "dd/MM/yyyy") : "Selecione uma data"}
              </span>
            </div>

            {selectedVisits.length === 0 ? (
              <p className="mt-4 text-sm text-ink/60">Nenhuma visita para esta data.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {groupedBySeller.map(([seller, items]) => {
                  const isExpanded = expandedVendor === seller;
                  return (
                    <div key={seller} className="rounded-2xl border border-sea/20 bg-sand/20 p-3">
                      <button
                        type="button"
                        onClick={() => setExpandedVendor(isExpanded ? null : seller)}
                        className="flex w-full items-center justify-between text-left"
                      >
                        <span className="text-sm font-semibold text-ink">{seller}</span>
                        <span className="text-xs text-ink/60">{items.length} empresa(s)</span>
                      </button>

                      {isExpanded && (
                        <div className="mt-3 space-y-3 text-xs text-ink/70">
                          {items.map((item) => {
                            const state = editState[item.id] ?? {
                              vendorId: "",
                              date: toDateInput(item.visit_date),
                            };
                            const isEditing = editingVisits[item.id] ?? false;
                            const displayVendor =
                              item.assigned_to_name ??
                              (item.assigned_to_user_id
                                ? vendorById.get(item.assigned_to_user_id)?.display_name
                                : null) ??
                              "Sem vendedor";
                            const isCompleted = Boolean(item.completed_at);
                            return (
                              <div key={item.id} className="rounded-xl border border-sea/10 bg-white/90 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-ink">
                                      {item.agenda?.empresa ?? item.agenda?.nome_fantasia ?? "Sem nome"}
                                    </p>
                                    <p className="text-xs text-ink/60">
                                      {item.agenda?.bairro
                                        ? `${item.agenda.bairro} - ${item.agenda.cidade ?? ""} / ${item.agenda?.uf ?? ""}`
                                        : item.agenda?.cidade
                                          ? `${item.agenda.cidade} / ${item.agenda?.uf ?? ""}`
                                          : ""}
                                    </p>
                                    {item.agenda?.endereco ? (
                                      <p className="text-[11px] text-ink/50">{item.agenda.endereco}</p>
                                    ) : null}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {item.agenda?.situacao ? (
                                      <span className="inline-flex rounded-full bg-sea/10 px-2 py-0.5 text-[10px] font-semibold text-sea">
                                        {item.agenda.situacao}
                                      </span>
                                    ) : null}
                                    {canManage && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (isCompleted) return;
                                          setEditingVisits((prev) => ({
                                            ...prev,
                                            [item.id]: !isEditing,
                                          }));
                                        }}
                                        disabled={isCompleted}
                                        className="rounded-full border border-sea/20 bg-white px-2 py-1 text-[11px] text-sea hover:border-sea"
                                        aria-label="Editar visita"
                                        title="Editar visita"
                                      >
                                        <Pencil size={12} />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {canManage && isEditing && !isCompleted ? (
                                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                                    <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                                      Vendedor
                                      <select
                                        value={state.vendorId}
                                        onChange={(event) =>
                                          setEditState((prev) => ({
                                            ...prev,
                                            [item.id]: { ...state, vendorId: event.target.value },
                                          }))
                                        }
                                        className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                                      >
                                        <option value="">Selecione</option>
                                        {vendors.map((vendor) => (
                                          <option key={vendor.user_id} value={vendor.user_id}>
                                            {vendor.display_name ?? vendor.user_id}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                                      Data
                                      <input
                                        type="date"
                                        value={state.date}
                                        onChange={(event) =>
                                          setEditState((prev) => ({
                                            ...prev,
                                            [item.id]: { ...state, date: event.target.value },
                                          }))
                                        }
                                        className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                                      />
                                    </label>
                                    <div className="flex flex-wrap items-end gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleSaveVisit(item.id)}
                                        disabled={savingId === item.id}
                                        className="rounded-lg bg-sea px-3 py-2 text-[11px] font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                                      >
                                        {savingId === item.id ? "Salvando..." : "Salvar"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveVisit(item.id)}
                                        disabled={removingId === item.id}
                                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600 hover:border-red-300 disabled:opacity-60"
                                      >
                                        {removingId === item.id ? "Removendo..." : "Remover"}
                                      </button>
                                    </div>
                                  </div>
                                ) : canManage ? (
                                  <div className="mt-3 grid gap-1 text-[11px] text-ink/60">
                                    <span>Vendedor: {displayVendor}</span>
                                    <span>
                                      Perfil visita: {item.agenda?.perfil_visita ?? item.perfil_visita ?? "-"}
                                    </span>
                                    <span>Data: {formatVisitDate(item.visit_date)}</span>
                                    {isCompleted ? (
                                      <span className="rounded-lg border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] font-semibold text-red-600">
                                        Visita registrada. Edicao bloqueada.
                                      </span>
                                    ) : null}
                                    {item.no_visit_reason ? (
                                      <span>Motivo: {item.no_visit_reason}</span>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                    <div className="grid gap-1 text-[11px] text-ink/60">
                                      <span>
                                        Perfil visita: {item.agenda?.perfil_visita ?? item.perfil_visita ?? "-"}
                                      </span>
                                      <span>Data: {formatVisitDate(item.visit_date)}</span>
                                      {item.no_visit_reason ? (
                                        <span>Motivo: {item.no_visit_reason}</span>
                                      ) : null}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleStartRegister(item)}
                                      disabled={isCompleted}
                                      className="rounded-lg bg-sea px-3 py-2 text-[11px] font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                                    >
                                      {isCompleted
                                        ? item.no_visit_reason
                                          ? "Visita nao realizada"
                                          : "Visita registrada"
                                        : "Registrar visita"}
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {isVendor && blockMessage && (
              <p className="mt-4 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-bold text-red-600">
                {blockMessage}
              </p>
            )}
          </section>
        </div>
      )}

      {completeVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setCompleteVisit(null)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Registrar visita</h3>
            <p className="mt-1 text-xs text-ink/60">
              Informe a quantidade de vidas e o horario da visita.
            </p>

            <div className="mt-4 grid gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                Quantidade de vidas
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={0}
                  step={1}
                  value={completeVisit.vidas}
                  onChange={(event) =>
                    setCompleteVisit((prev) =>
                      prev ? { ...prev, vidas: event.target.value } : prev,
                    )
                  }
                  className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                Horario da visita
                {completeVisit.customOptions.filter((option) => option.trim()).length > 0 ? (
                  <div className="rounded-lg border border-sea/20 bg-sand/40 px-3 py-2 text-[11px] text-ink/70">
                    Perfil visita: Horario customizado
                    <div className="mt-1 flex flex-wrap gap-1">
                      {completeVisit.customOptions
                        .filter((option) => option.trim())
                        .map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() =>
                              setCompleteVisit((prev) =>
                                prev ? { ...prev, perfil: option, customManual: false } : prev,
                              )
                            }
                            className={[
                              "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                              completeVisit.perfil === option
                                ? "border-sea bg-sea/20 text-sea"
                                : "border-sea/20 bg-white/80 text-ink/70",
                            ].join(" ")}
                          >
                            {option}
                          </button>
                        ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setCompleteVisit((prev) =>
                            prev ? { ...prev, customEditEnabled: !prev.customEditEnabled } : prev,
                          )
                        }
                        className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1 text-[10px] font-semibold text-ink/70"
                      >
                        {completeVisit.customEditEnabled ? "Fechar edicao" : "Editar horarios"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCompleteVisit((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  customManual: true,
                                  customTime: prev.customTime || "",
                                }
                              : prev,
                          )
                        }
                        className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1 text-[10px] font-semibold text-ink/70"
                      >
                        Outro horario
                      </button>
                    </div>
                    {completeVisit.customEditEnabled && (
                      <div className="mt-2 space-y-2">
                        {completeVisit.customOptions.map((time, index) => (
                          <div key={`${time}-${index}`} className="flex items-center gap-2">
                            <input
                              type="time"
                              value={time}
                              onChange={(event) => {
                                const next = [...completeVisit.customOptions];
                                next[index] = event.target.value;
                                updateCustomOptions(next);
                              }}
                              className="rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                            />
                            {completeVisit.customOptions.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const next = completeVisit.customOptions.filter((_, idx) => idx !== index);
                                  updateCustomOptions(next.length ? next : [""]);
                                }}
                                className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-[10px] text-ink/70"
                              >
                                Remover
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => updateCustomOptions([...completeVisit.customOptions, ""])}
                          className="rounded-lg border border-sea/30 bg-white px-2 py-1 text-[10px] text-ink/70"
                        >
                          Adicionar horario
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <select
                    value={completeVisit.customManual ? "__custom__" : completeVisit.perfil}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "__custom__") {
                        setCompleteVisit((prev) =>
                          prev
                            ? {
                                ...prev,
                                customManual: true,
                                perfil: prev.customTime,
                              }
                            : prev,
                        );
                      } else {
                        setCompleteVisit((prev) =>
                          prev
                            ? {
                                ...prev,
                                customManual: false,
                                perfil: value,
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
                    <option value="__custom__">Outro horario</option>
                  </select>
                )}
              </label>
              {completeVisit.customManual && (
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                  Horario customizado
                  <input
                    type="time"
                    value={completeVisit.customTime}
                    onChange={(event) =>
                      setCompleteVisit((prev) =>
                        prev
                          ? {
                              ...prev,
                              customTime: event.target.value,
                              perfil: event.target.value,
                            }
                          : prev,
                      )
                    }
                    className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                  />
                </label>
              )}
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setCompleteVisit(null)}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmVisit}
                disabled={savingId === completeVisit.id}
                className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {savingId === completeVisit.id ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setConfirmVisit(null)}
          />
          <div className="relative w-full max-w-sm rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Visita feita?</h3>
            <p className="mt-1 text-xs text-ink/60">
              Confirme se a visita foi realizada.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmVisit(null);
                  setNoVisit({ id: confirmVisit.id, reason: "" });
                }}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Nao
              </button>
              <button
                type="button"
                onClick={() => {
                  const visit = confirmVisit;
                  setConfirmVisit(null);
                  if (visit) openCompleteModal(visit);
                }}
                className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight"
              >
                Sim
              </button>
            </div>
          </div>
        </div>
      )}

      {noVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setNoVisit(null)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Motivo da visita nao realizada</h3>
            <p className="mt-1 text-xs text-ink/60">
              Selecione o motivo.
            </p>
            <div className="mt-4">
              <select
                value={noVisit.reason}
                onChange={(event) =>
                  setNoVisit((prev) => (prev ? { ...prev, reason: event.target.value } : prev))
                }
                className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"
              >
                <option value="">Selecione</option>
                {NO_VISIT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setNoVisit(null)}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmNoVisit}
                disabled={savingId === noVisit.id}
                className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {savingId === noVisit.id ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
