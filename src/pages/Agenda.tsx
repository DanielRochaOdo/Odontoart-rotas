import { useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  type ColumnDef,
  type SortingState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  clearAgendaOptionsCache,
  fetchAgenda,
  fetchAgendaForGeneration,
  fetchAgendaScheduledVisits,
  fetchDistinctOptions,
  fetchSupervisores,
  fetchVendedores,
  type AgendaScheduledVisit,
} from "../lib/agendaApi";
import type { AgendaRow } from "../types/agenda";
import { useAgendaFilters } from "../hooks/useAgendaFilters";
import MultiSelectFilter from "../components/agenda/MultiSelectFilter";
import AgendaDrawer from "../components/agenda/AgendaDrawer";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { onProfilesUpdated } from "../lib/profileEvents";
import { PERFIL_VISITA_PRESETS, isPresetPerfilVisita } from "../lib/perfilVisita";

const FILTER_SOURCES: Record<string, string[]> = {
  supervisor: ["supervisor"],
  vendedor: ["vendedor"],
  cod_1: ["cod_1"],
  bairro: ["bairro"],
  cidade: ["cidade"],
  uf: ["uf"],
  grupo: ["grupo"],
  perfil_visita: ["perfil_visita"],
  empresa_nome: ["empresa", "nome_fantasia"],
};

const FILTER_LABELS: Record<string, string> = {
  supervisor: "Supervisor",
  vendedor: "Vendedor",
  cod_1: "Codigo",
  bairro: "Bairro",
  cidade: "Cidade",
  uf: "UF",
  grupo: "Grupo",
  perfil_visita: "Perfil Visita",
  empresa_nome: "Empresa",
};

const parseDateValue = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00`);
  }
  return new Date(value);
};

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR").format(date);
};

const formatVisitBadge = (value: string | null) => {
  if (!value) return "-";
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return value;
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  }).format(date);
  return formatted.replace(".", "").toUpperCase();
};

const escapeOrValue = (value: string) => `"${value.replace(/"/g, '\\"')}"`;

const MONTH_OPTIONS = [
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Marco" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

export default function Agenda() {
  const { role, session } = useAuth();
  const canAccess = role === "SUPERVISOR" || role === "ASSISTENTE";
  const { filters, setFilters, clearFilters } = useAgendaFilters();
  const [globalQuery, setGlobalQuery] = useState(filters.global);
  const typingGlobalRef = useRef(false);
  const [data, setData] = useState<AgendaRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [selectedRow, setSelectedRow] = useState<AgendaRow | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedAgendaIds, setSelectedAgendaIds] = useState<string[]>([]);
  const [scheduledVisitsByAgenda, setScheduledVisitsByAgenda] = useState<
    Record<string, AgendaScheduledVisit[]>
  >({});
  const [scheduleModalRow, setScheduleModalRow] = useState<AgendaRow | null>(null);
  const [scheduleDrafts, setScheduleDrafts] = useState<
    Array<{
      id?: string;
      vendorId: string;
      vendorName: string;
      date: string;
      perfil: string;
      perfilCustom?: boolean;
      routeId?: string | null;
    }>
  >([]);
  const [scheduleOriginal, setScheduleOriginal] = useState<AgendaScheduledVisit[]>([]);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [vendedores, setVendedores] = useState<
    { user_id: string; display_name: string | null; role: string }[]
  >([]);
  const [supervisores, setSupervisores] = useState<
    { user_id: string; display_name: string | null; role: string }[]
  >([]);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [vendorQuery, setVendorQuery] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const restoredViewRef = useRef(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (restoredViewRef.current) return;
    try {
      const raw = sessionStorage.getItem("agendaViewState");
      if (!raw) {
        restoredViewRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as Partial<{
        pageIndex: number;
        pageSize: number;
        sorting: SortingState;
        selectedRowId: string | null;
      }>;
      if (typeof parsed.pageIndex === "number") setPageIndex(parsed.pageIndex);
      if (typeof parsed.pageSize === "number") setPageSize(parsed.pageSize);
      if (Array.isArray(parsed.sorting)) setSorting(parsed.sorting);
      if (typeof parsed.selectedRowId === "string") setSelectedRowId(parsed.selectedRowId);
      restoredViewRef.current = true;
    } catch {
      restoredViewRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!restoredViewRef.current) return;
    const payload = {
      pageIndex,
      pageSize,
      sorting,
      selectedRowId,
    };
    try {
      sessionStorage.setItem("agendaViewState", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [pageIndex, pageSize, selectedRowId, sorting]);

  const canGenerate = role === "SUPERVISOR" || role === "ASSISTENTE";
  const canEdit = role === "SUPERVISOR" || role === "ASSISTENTE";

  const vendorOptions = useMemo(
    () =>
      vendedores
        .map((vendor) => ({
          value: vendor.display_name ?? vendor.user_id,
          label: vendor.display_name ?? vendor.user_id,
        }))
        .filter((option) => option.value),
    [vendedores],
  );

  const vendorById = useMemo(
    () => new Map(vendedores.map((vendor) => [vendor.user_id, vendor.display_name ?? vendor.user_id])),
    [vendedores],
  );

  useEffect(() => {
    setPageIndex(0);
  }, [filters, sorting]);

  useEffect(() => {
    setSelectedAgendaIds([]);
  }, [filters, sorting]);

  useEffect(() => {
    if (typingGlobalRef.current) {
      if (filters.global === globalQuery) {
        typingGlobalRef.current = false;
      }
      return;
    }
    if (filters.global !== globalQuery) {
      setGlobalQuery(filters.global);
    }
  }, [filters.global, globalQuery]);

  useEffect(() => {
    const handler = window.setTimeout(() => {
      setFilters((prev) =>
        prev.global === globalQuery ? prev : { ...prev, global: globalQuery },
      );
      typingGlobalRef.current = false;
    }, 250);
    return () => window.clearTimeout(handler);
  }, [globalQuery, setFilters]);

  useEffect(() => {
    const loadOptions = async () => {
      clearAgendaOptionsCache();
      const entries = await Promise.all(
        Object.entries(FILTER_SOURCES).map(async ([key, sources]) => [
          key,
          await fetchDistinctOptions(key, sources),
        ]),
      );
      setFilterOptions(Object.fromEntries(entries));
    };

    loadOptions().catch((err) => {
      console.error(err);
    });
  }, [refreshKey]);

  useEffect(() => {
    if (!canGenerate) return;
    let active = true;
    const loadVendedores = () => {
      fetchVendedores()
        .then((data) => {
          if (active) setVendedores(data);
        })
        .catch((err) => {
          console.error(err);
        });
    };
    const loadSupervisores = () => {
      fetchSupervisores()
        .then((data) => {
          if (active) setSupervisores(data);
        })
        .catch((err) => {
          console.error(err);
        });
    };
    loadVendedores();
    loadSupervisores();
    const unsubscribe = onProfilesUpdated(() => {
      loadVendedores();
      loadSupervisores();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [canGenerate]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchAgenda(pageIndex, pageSize, sorting, filters);
        setData(result.data);
        setTotalCount(result.count);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao carregar agenda");
        setData([]);
      }
      setLoading(false);
    };

    load();
  }, [filters, pageIndex, pageSize, sorting, refreshKey]);

  useEffect(() => {
    let active = true;
    const agendaIds = data.map((row) => row.id);
    if (agendaIds.length === 0) {
      setScheduledVisitsByAgenda({});
      return () => {
        active = false;
      };
    }

    fetchAgendaScheduledVisits(agendaIds)
      .then((visits) => {
        if (!active) return;
        const grouped: Record<string, AgendaScheduledVisit[]> = {};
        visits.forEach((visit) => {
          if (!grouped[visit.agenda_id]) grouped[visit.agenda_id] = [];
          grouped[visit.agenda_id].push(visit);
        });
        setScheduledVisitsByAgenda(grouped);
      })
      .catch((err) => {
        console.error(err);
        if (active) setScheduledVisitsByAgenda({});
      });

    return () => {
      active = false;
    };
  }, [data, scheduleRefreshKey]);

  useEffect(() => {
    if (!selectedRowId) return;
    if (selectedRow?.id === selectedRowId) return;
    const found = data.find((row) => row.id === selectedRowId);
    if (found) {
      setSelectedRow(found);
    }
  }, [data, selectedRow, selectedRowId]);

  const filteredVendedores = useMemo(() => {
    if (!vendorQuery.trim()) return vendedores;
    const term = vendorQuery.trim().toLowerCase();
    return vendedores.filter((vendor) =>
      (vendor.display_name ?? vendor.user_id ?? "").toLowerCase().includes(term),
    );
  }, [vendorQuery, vendedores]);

  const selectedAgendaSet = useMemo(() => new Set(selectedAgendaIds), [selectedAgendaIds]);
  const visibleAgendaIds = useMemo(() => data.map((row) => row.id), [data]);
  const allVisibleSelected =
    visibleAgendaIds.length > 0 && visibleAgendaIds.every((id) => selectedAgendaSet.has(id));
  const someVisibleSelected =
    visibleAgendaIds.some((id) => selectedAgendaSet.has(id)) && !allVisibleSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const toggleAgendaSelection = (agendaId: string) => {
    setSelectedAgendaIds((prev) =>
      prev.includes(agendaId) ? prev.filter((id) => id !== agendaId) : [...prev, agendaId],
    );
  };

  const setVisibleSelection = (checked: boolean) => {
    setSelectedAgendaIds((prev) => {
      if (checked) {
        const next = new Set(prev);
        visibleAgendaIds.forEach((id) => next.add(id));
        return Array.from(next);
      }
      return prev.filter((id) => !visibleAgendaIds.includes(id));
    });
  };

  const handleToggleVendor = (vendorId: string) => {
    setSelectedVendorIds((prev) =>
      prev.includes(vendorId) ? prev.filter((id) => id !== vendorId) : [...prev, vendorId],
    );
  };

  const handleGenerateVisits = async () => {
    if (!canGenerate) return;
    const selectedVendors = vendedores.filter((vendor) => selectedVendorIds.includes(vendor.user_id));
    if (selectedVendors.length === 0) {
      setGenerateMessage("Selecione pelo menos um vendedor para gerar visitas.");
      return;
    }
    if (selectedAgendaIds.length === 0) {
      setGenerateMessage("Selecione pelo menos uma empresa para gerar visitas.");
      return;
    }
    if (!visitDate) {
      setGenerateMessage("Selecione a data da visita.");
      return;
    }

    setGenerating(true);
    setGenerateMessage(null);

    try {
      const rows = await fetchAgendaForGeneration(filters, selectedAgendaIds);
      if (rows.length === 0) {
        setGenerateMessage("Nenhum registro encontrado para gerar visitas.");
        return;
      }

      const chunkSize = 500;
      const agendaIds = rows.map((row) => row.id);
      const visitBase = new Date(`${visitDate}T12:00:00`);
      const routeDate = visitDate;
      const displayDate = new Intl.DateTimeFormat("pt-BR").format(visitBase);

      for (const vendor of selectedVendors) {
        const routeName = `Visitas ${displayDate} - ${vendor.display_name ?? "Vendedor"}`;

        const { data: route, error: routeError } = await supabase
          .from("routes")
          .insert({
            name: routeName,
            date: routeDate,
            assigned_to_user_id: vendor.user_id,
            created_by: session?.user.id ?? null,
          })
          .select("id")
          .single();

        if (routeError || !route) {
          throw new Error(routeError?.message ?? "Erro ao criar rota de visitas.");
        }

        const stopRows = rows.map((row, index) => ({
          route_id: route.id,
          agenda_id: row.id,
          stop_order: index + 1,
        }));

        for (let i = 0; i < stopRows.length; i += chunkSize) {
          const chunk = stopRows.slice(i, i + chunkSize);
          const { error: stopError } = await supabase.from("route_stops").insert(chunk);
          if (stopError) {
            throw new Error(stopError.message);
          }
        }

        const visitRows = rows.map((row) => ({
          agenda_id: row.id,
          assigned_to_user_id: vendor.user_id,
          assigned_to_name: vendor.display_name ?? vendor.user_id,
          visit_date: routeDate,
          perfil_visita: row.perfil_visita ?? null,
          route_id: route.id,
          created_by: session?.user.id ?? null,
        }));

        for (let i = 0; i < visitRows.length; i += chunkSize) {
          const chunk = visitRows.slice(i, i + chunkSize);
          const { error: visitError } = await supabase
            .from("visits")
            .upsert(chunk, {
              onConflict: "agenda_id,assigned_to_user_id,visit_date",
              ignoreDuplicates: true,
            });

          if (visitError) {
            throw new Error(visitError.message);
          }
        }
      }

      for (let i = 0; i < agendaIds.length; i += chunkSize) {
        const chunkIds = agendaIds.slice(i, i + chunkSize);
        const { error: updateError } = await supabase
          .from("agenda")
          .update({
            visit_generated_at: visitBase.toISOString(),
          })
          .in("id", chunkIds)
          .is("visit_generated_at", null);

        if (updateError) {
          throw new Error(updateError.message);
        }
      }

      const totalVisits = rows.length * selectedVendors.length;
      setGenerateMessage(
        `Geradas ${totalVisits} visitas (${rows.length} empresa(s)) para ${selectedVendors.length} vendedor(es).`,
      );
      setSelectedAgendaIds([]);
      setSelectedVendorIds([]);
      setVendorQuery("");
      setVisitDate("");
      setShowGenerateModal(false);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setGenerateMessage(err instanceof Error ? err.message : "Erro ao gerar visitas.");
    } finally {
      setGenerating(false);
    }
  };

  const handleDrawerUpdated = (updated: AgendaRow) => {
    setSelectedRow(updated);
    setSelectedRowId(updated.id);
    setRefreshKey((value) => value + 1);
  };

  const handleDrawerDeleted = () => {
    setSelectedRow(null);
    setSelectedRowId(null);
    setRefreshKey((value) => value + 1);
  };

  const openScheduleModal = (row: AgendaRow) => {
    const visits = scheduledVisitsByAgenda[row.id] ?? [];
    const drafts = visits.map((visit) => {
      const basePerfil = visit.perfil_visita ?? row.perfil_visita ?? "";
      return {
        id: visit.id,
        vendorId: visit.assigned_to_user_id ?? "",
        vendorName: visit.assigned_to_name ?? "",
        date: visit.visit_date,
        perfil: basePerfil,
        perfilCustom: Boolean(basePerfil && !isPresetPerfilVisita(basePerfil)),
        routeId: visit.route_id ?? null,
      };
    });
    setScheduleModalRow(row);
    setScheduleDrafts(drafts);
    setScheduleOriginal(visits);
    setScheduleError(null);
  };

  const closeScheduleModal = () => {
    setScheduleModalRow(null);
    setScheduleDrafts([]);
    setScheduleOriginal([]);
    setScheduleError(null);
  };

  const handleAddScheduleDraft = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    const fallbackDate = scheduleDrafts[0]?.date ?? local.toISOString().slice(0, 10);
    const fallbackPerfil = scheduleModalRow?.perfil_visita ?? "";
    setScheduleDrafts((prev) => [
      ...prev,
      {
        vendorId: "",
        vendorName: "",
        date: fallbackDate,
        perfil: fallbackPerfil,
        perfilCustom: Boolean(fallbackPerfil && !isPresetPerfilVisita(fallbackPerfil)),
      },
    ]);
  };

  const updateScheduleDraft = (index: number, patch: Partial<(typeof scheduleDrafts)[number]>) => {
    setScheduleDrafts((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)),
    );
  };

  const removeScheduleDraft = (index: number) => {
    setScheduleDrafts((prev) => prev.filter((_, idx) => idx !== index));
  };

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

    const displayDate = new Intl.DateTimeFormat("pt-BR").format(new Date(`${dateValue}T12:00:00`));
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

  const removeRouteStop = async (routeId: string, agendaId: string) => {
    const { error } = await supabase
      .from("route_stops")
      .delete()
      .eq("route_id", routeId)
      .eq("agenda_id", agendaId);
    if (error) throw new Error(error.message);
  };

  const handleScheduleSave = async () => {
    if (!scheduleModalRow) return;

    for (const draft of scheduleDrafts) {
      if (!draft.vendorId) {
        setScheduleError("Selecione o vendedor.");
        return;
      }
      if (!draft.date) {
        setScheduleError("Selecione a data da visita.");
        return;
      }
    }

    const seen = new Set<string>();
    for (const draft of scheduleDrafts) {
      const key = `${draft.vendorId}::${draft.date}`;
      if (seen.has(key)) {
        setScheduleError("Nao e permitido repetir o mesmo vendedor na mesma data.");
        return;
      }
      seen.add(key);
    }

    setScheduleSaving(true);
    setScheduleError(null);
    try {
      const originalById = new Map(scheduleOriginal.map((visit) => [visit.id, visit]));
      const draftIds = new Set(scheduleDrafts.filter((item) => item.id).map((item) => item.id as string));
      const removed = scheduleOriginal.filter((visit) => !draftIds.has(visit.id));

      for (const visit of removed) {
        if (visit.route_id) {
          await removeRouteStop(visit.route_id, visit.agenda_id);
        }
        const { error } = await supabase.from("visits").delete().eq("id", visit.id);
        if (error) throw new Error(error.message);
      }

      for (const draft of scheduleDrafts) {
        const vendorName =
          vendorById.get(draft.vendorId) ?? draft.vendorName ?? draft.vendorId ?? "Vendedor";
        if (!draft.id) {
          const routeId = await ensureRoute(draft.vendorId, vendorName, draft.date);
          const { data, error } = await supabase
            .from("visits")
            .insert({
              agenda_id: scheduleModalRow.id,
              assigned_to_user_id: draft.vendorId,
              assigned_to_name: vendorName,
              visit_date: draft.date,
              perfil_visita: draft.perfil.trim() || null,
              route_id: routeId,
              created_by: session?.user.id ?? null,
            })
            .select("id")
            .single();
          if (error || !data) throw new Error(error?.message ?? "Erro ao adicionar visita.");
          await ensureRouteStop(routeId, scheduleModalRow.id);
          continue;
        }

        const original = originalById.get(draft.id);
        if (!original) continue;

        const vendorChanged = (original.assigned_to_user_id ?? "") !== draft.vendorId;
        const dateChanged = original.visit_date !== draft.date;
        const perfilChanged = (original.perfil_visita ?? "") !== draft.perfil;

        if (vendorChanged || dateChanged) {
          const routeId = await ensureRoute(draft.vendorId, vendorName, draft.date);
          if (original.route_id && original.route_id !== routeId) {
            await removeRouteStop(original.route_id, original.agenda_id);
          }
          await ensureRouteStop(routeId, scheduleModalRow.id);

          const { error } = await supabase
            .from("visits")
            .update({
              assigned_to_user_id: draft.vendorId,
              assigned_to_name: vendorName,
              visit_date: draft.date,
              perfil_visita: draft.perfil.trim() || null,
              route_id: routeId,
            })
            .eq("id", draft.id);
          if (error) throw new Error(error.message);
        } else if (perfilChanged) {
          const { error } = await supabase
            .from("visits")
            .update({
              perfil_visita: draft.perfil.trim() || null,
            })
            .eq("id", draft.id);
          if (error) throw new Error(error.message);
        }
      }

      if (scheduleDrafts.length === 0) {
        const { error } = await supabase
          .from("agenda")
          .update({ visit_generated_at: null })
          .eq("id", scheduleModalRow.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from("agenda")
          .update({ visit_generated_at: new Date().toISOString() })
          .eq("id", scheduleModalRow.id)
          .is("visit_generated_at", null);
        if (error) throw new Error(error.message);
      }

      if (scheduleDrafts.length > 0) {
        const resolvedPerfil =
          scheduleDrafts
            .map((draft) => draft.perfil.trim())
            .find((value) => value.length > 0) ?? null;
        const currentPerfil = scheduleModalRow.perfil_visita ?? null;

        if (resolvedPerfil !== currentPerfil) {
          const { error: agendaPerfilError } = await supabase
            .from("agenda")
            .update({ perfil_visita: resolvedPerfil })
            .eq("id", scheduleModalRow.id);
          if (agendaPerfilError) throw new Error(agendaPerfilError.message);

          const codigo = scheduleModalRow.cod_1?.trim() ?? "";
          const empresa = scheduleModalRow.empresa?.trim() ?? "";
          const nomeFantasia = scheduleModalRow.nome_fantasia?.trim() ?? "";

          let clientesQuery = supabase.from("clientes").update({ perfil_visita: resolvedPerfil });
          let hasClienteFilter = false;
          if (codigo) {
            clientesQuery = clientesQuery.eq("codigo", codigo);
            hasClienteFilter = true;
          } else if (empresa && nomeFantasia) {
            clientesQuery = clientesQuery.or(
              `empresa.eq.${escapeOrValue(empresa)},nome_fantasia.eq.${escapeOrValue(nomeFantasia)}`,
            );
            hasClienteFilter = true;
          } else if (empresa) {
            clientesQuery = clientesQuery.eq("empresa", empresa);
            hasClienteFilter = true;
          } else if (nomeFantasia) {
            clientesQuery = clientesQuery.eq("nome_fantasia", nomeFantasia);
            hasClienteFilter = true;
          }

          if (hasClienteFilter) {
            const { error: clienteError } = await clientesQuery;
            if (clienteError) throw new Error(clienteError.message);
          }

          setData((prev) =>
            prev.map((row) =>
              row.id === scheduleModalRow.id ? { ...row, perfil_visita: resolvedPerfil } : row,
            ),
          );
          setSelectedRow((prev) =>
            prev?.id === scheduleModalRow.id ? { ...prev, perfil_visita: resolvedPerfil } : prev,
          );
        }
      }

      setScheduleModalRow(null);
      setScheduleDrafts([]);
      setScheduleOriginal([]);
      setScheduleRefreshKey((prev) => prev + 1);
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : "Erro ao salvar visitas.");
    } finally {
      setScheduleSaving(false);
    }
  };

  const columns = useMemo<ColumnDef<AgendaRow>[]>(
    () => {
      const renderSortLabel = (
        column: {
          getToggleSortingHandler: () => ((event: unknown) => void) | undefined;
          getIsSorted: () => false | "asc" | "desc";
          getCanSort: () => boolean;
        },
        label: string,
      ) => {
        const handler = column.getToggleSortingHandler();
        return (
          <button
            type="button"
            onClick={handler}
            disabled={!column.getCanSort() || !handler}
            className="flex items-center gap-1 text-left disabled:opacity-70"
          >
            <span className="leading-tight">{label}</span>
            {column.getIsSorted() ? (
              <span className="text-[10px] text-sea">
                {column.getIsSorted() === "desc" ? "▼" : "▲"}
              </span>
            ) : null}
          </button>
        );
      };

      return [
      {
        id: "select",
        header: () => (
          <div className="flex items-center justify-center">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => setVisibleSelection(event.target.checked)}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="h-4 w-4 accent-sea"
              aria-label="Selecionar todos nesta pagina"
              title="Selecionar todos nesta pagina"
            />
          </div>
        ),
        cell: (info) => {
          const rowId = info.row.original.id;
          const checked = selectedAgendaSet.has(rowId);
          return (
            <div className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleAgendaSelection(rowId)}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                className="h-4 w-4 accent-sea"
                aria-label="Selecionar empresa"
              />
            </div>
          );
        },
        enableSorting: false,
        size: 25,
      },
      {
        id: "obs",
        header: () => (
          <div className="flex items-center justify-center text-[11px] font-semibold text-ink/60">
            Obs
          </div>
        ),
        cell: (info) => {
          const rowId = info.row.original.id;
          const visits = scheduledVisitsByAgenda[rowId] ?? [];
          if (visits.length === 0) return null;
          const visitDate = visits[0]?.visit_date ?? null;
          const badgeText = formatVisitBadge(visitDate);
          const titleText = visitDate ? `Visita agendada: ${formatDate(visitDate)}` : "Visita agendada";
          return (
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openScheduleModal(info.row.original);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                className="inline-flex min-h-6 items-center justify-center rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700 hover:border-red-300"
                title={titleText}
                aria-label={titleText}
              >
                {badgeText}
              </button>
            </div>
          );
        },
        enableSorting: false,
        size: 70,
      },
      {
        accessorKey: "data_da_ultima_visita",
        header: ({ column }) => renderSortLabel(column, "Data ultima visita"),
        cell: (info) => formatDate(info.getValue() as string | null),
      },
      {
        accessorKey: "cod_1",
        header: ({ column }) => (
          <div className="flex items-center justify-between gap-2">
            {renderSortLabel(column, "Codigo")}
            <MultiSelectFilter
              label={
                (filters.columns.cod_1 ?? []).length
                  ? `Filtro (${filters.columns.cod_1.length})`
                  : "Filtro"
              }
              options={filterOptions.cod_1 ?? []}
              value={filters.columns.cod_1}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, cod_1: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
      },
      {
        accessorKey: "supervisor",
        header: ({ column }) => (
          <div className="flex items-center justify-between gap-2">
            {renderSortLabel(column, "Supervisor")}
            <MultiSelectFilter
              label={
                (filters.columns.supervisor ?? []).length
                  ? `Filtro (${filters.columns.supervisor.length})`
                  : "Filtro"
              }
              options={filterOptions.supervisor ?? []}
              value={filters.columns.supervisor}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, supervisor: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
      },
      {
        accessorKey: "empresa",
        header: ({ column }) => (
          <div className="flex items-center justify-between gap-2">
            {renderSortLabel(column, "Empresa")}
            <MultiSelectFilter
              label={
                (filters.columns.empresa_nome ?? []).length
                  ? `Filtro (${filters.columns.empresa_nome.length})`
                  : "Filtro"
              }
              options={filterOptions.empresa_nome ?? []}
              value={filters.columns.empresa_nome}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, empresa_nome: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => {
          const row = info.row.original;
          const name = row.empresa ?? "-";
          return (
            <div>
              <p className="text-sm font-semibold text-ink">{name}</p>
              <p className="text-xs text-ink/60">{row.nome_fantasia ?? ""}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "bairro",
        header: ({ column }) => (
          <div className="flex items-center justify-between gap-2">
            {renderSortLabel(column, "Bairro")}
            <MultiSelectFilter
              label={
                (filters.columns.bairro ?? []).length
                  ? `Filtro (${filters.columns.bairro.length})`
                  : "Filtro"
              }
              options={filterOptions.bairro ?? []}
              value={filters.columns.bairro}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, bairro: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
      },
      {
        accessorKey: "cidade",
        header: ({ column }) => (
          <div className="flex items-center justify-between gap-2">
            {renderSortLabel(column, "Cidade")}
            <MultiSelectFilter
              label={
                (filters.columns.cidade ?? []).length
                  ? `Filtro (${filters.columns.cidade.length})`
                  : "Filtro"
              }
              options={filterOptions.cidade ?? []}
              value={filters.columns.cidade}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, cidade: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
      },
      {
        accessorKey: "uf",
        header: ({ column }) => (
          <div className="flex items-center justify-between gap-2">
            {renderSortLabel(column, "UF")}
            <MultiSelectFilter
              label={
                (filters.columns.uf ?? []).length ? `Filtro (${filters.columns.uf.length})` : "Filtro"
              }
              options={filterOptions.uf ?? []}
              value={filters.columns.uf}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, uf: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
      },
      {
        accessorKey: "vendedor",
        header: ({ column }) => (
          <div className="flex items-center justify-between gap-2">
            {renderSortLabel(column, "Vendedor")}
            <MultiSelectFilter
              label={
                (filters.columns.vendedor ?? []).length
                  ? `Filtro (${filters.columns.vendedor.length})`
                  : "Filtro"
              }
              options={filterOptions.vendedor ?? []}
              value={filters.columns.vendedor}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, vendedor: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
      },
      {
        accessorKey: "grupo",
        header: ({ column }) => (
          <div className="flex items-center justify-between gap-2">
            {renderSortLabel(column, "Grupo")}
            <MultiSelectFilter
              label={
                (filters.columns.grupo ?? []).length
                  ? `Filtro (${filters.columns.grupo.length})`
                  : "Filtro"
              }
              options={filterOptions.grupo ?? []}
              value={filters.columns.grupo}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, grupo: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
      },
      {
        accessorKey: "perfil_visita",
        header: ({ column }) => (
          <div className="flex items-center justify-between gap-2">
            {renderSortLabel(column, "Perfil Visita")}
            <MultiSelectFilter
              label={
                (filters.columns.perfil_visita ?? []).length
                  ? `Filtro (${filters.columns.perfil_visita.length})`
                  : "Filtro"
              }
              options={filterOptions.perfil_visita ?? []}
              value={filters.columns.perfil_visita}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, perfil_visita: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
      },
    ];
    },
    [
      allVisibleSelected,
      filterOptions,
      filters.columns,
      openScheduleModal,
      selectedAgendaSet,
      scheduledVisitsByAgenda,
      setFilters,
      setVisibleSelection,
      toggleAgendaSelection,
    ],
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    state: { sorting },
    onSortingChange: setSorting,
    pageCount: Math.ceil(totalCount / pageSize),
  });

  const activeChips = useMemo(() => {
    const chips: { label: string; onRemove: () => void }[] = [];

    if (filters.global) {
      chips.push({
        label: `Busca: ${filters.global}`,
        onRemove: () => setFilters((prev) => ({ ...prev, global: "" })),
      });
    }

    Object.entries(filters.columns).forEach(([key, values]) => {
      values.forEach((value) => {
        chips.push({
          label: `${FILTER_LABELS[key] ?? key}: ${value}`,
          onRemove: () =>
            setFilters((prev) => ({
              ...prev,
              columns: {
                ...prev.columns,
                [key]: prev.columns[key].filter((item) => item !== value),
              },
            })),
        });
      });
    });

    if (filters.dateRanges.data_da_ultima_visita.from || filters.dateRanges.data_da_ultima_visita.to) {
      chips.push({
        label: `Data ultima visita: ${filters.dateRanges.data_da_ultima_visita.from ?? ""} - ${filters.dateRanges.data_da_ultima_visita.to ?? ""}`,
        onRemove: () =>
          setFilters((prev) => ({
            ...prev,
            dateRanges: { ...prev.dateRanges, data_da_ultima_visita: {} },
          })),
      });
    }

    if (filters.dateRanges.data_da_ultima_visita.year) {
      const monthLabel = filters.dateRanges.data_da_ultima_visita.month
        ? MONTH_OPTIONS.find((option) => option.value === filters.dateRanges.data_da_ultima_visita.month)?.label
        : null;
      chips.push({
        label: monthLabel
          ? `Mes/Ano: ${monthLabel} ${filters.dateRanges.data_da_ultima_visita.year}`
          : `Ano: ${filters.dateRanges.data_da_ultima_visita.year}`,
        onRemove: () =>
          setFilters((prev) => ({
            ...prev,
            dateRanges: {
              ...prev.dateRanges,
              data_da_ultima_visita: { ...prev.dateRanges.data_da_ultima_visita, month: undefined, year: undefined },
            },
          })),
      });
    }

    return chips;
  }, [filters, setFilters]);

  if (!canAccess) {
    return (
      <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">
        Este modulo e restrito a supervisao e assistencia.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-ink">Agenda</h2>
      </header>

      <section className="rounded-2xl border border-sea/20 bg-sand/30 p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-ink/70">Busca global</label>
            <input
              value={globalQuery}
              onChange={(event) => {
                typingGlobalRef.current = true;
                setGlobalQuery(event.target.value);
              }}
              placeholder="Empresa, cidade, vendedor..."
              id="agenda-global-search"
              name="agendaGlobalSearch"
              className="w-64 rounded-lg border border-sea/20 bg-white/90 px-3 py-2 text-sm outline-none focus:border-sea"
            />
          </div>

          <div className="flex flex-col gap-1 md:hidden">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold text-ink/70">Bairro</label>
              <MultiSelectFilter
                label={
                  (filters.columns.bairro ?? []).length
                    ? `Selecionados (${filters.columns.bairro.length})`
                    : "Selecionar"
                }
                options={filterOptions.bairro ?? []}
                value={filters.columns.bairro}
                onApply={(next) =>
                  setFilters((prev) => ({
                    ...prev,
                    columns: { ...prev.columns, bairro: next },
                  }))
                }
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-ink/70">Data ultima visita</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={filters.dateRanges.data_da_ultima_visita.from ?? ""}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    dateRanges: {
                      ...prev.dateRanges,
                      data_da_ultima_visita: {
                        ...prev.dateRanges.data_da_ultima_visita,
                        from: event.target.value || undefined,
                        month: undefined,
                        year: undefined,
                      },
                    },
                  }))
                }
                id="agenda-duv-from"
                name="agendaDuvFrom"
                className="rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
              />
              <span className="text-xs text-ink/50">ate</span>
              <input
                type="date"
                value={filters.dateRanges.data_da_ultima_visita.to ?? ""}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    dateRanges: {
                      ...prev.dateRanges,
                      data_da_ultima_visita: {
                        ...prev.dateRanges.data_da_ultima_visita,
                        to: event.target.value || undefined,
                        month: undefined,
                        year: undefined,
                      },
                    },
                  }))
                }
                id="agenda-duv-to"
                name="agendaDuvTo"
                className="rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
              />
              <span className="w-full text-left text-xs font-semibold text-ink/50 md:w-auto md:pt-2">
                Ou
              </span>
              <select
                value={filters.dateRanges.data_da_ultima_visita.month ?? ""}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    dateRanges: {
                      ...prev.dateRanges,
                      data_da_ultima_visita: {
                        ...prev.dateRanges.data_da_ultima_visita,
                        month: event.target.value || undefined,
                        year:
                          event.target.value && !prev.dateRanges.data_da_ultima_visita.year
                            ? String(new Date().getFullYear())
                            : prev.dateRanges.data_da_ultima_visita.year,
                        from: undefined,
                        to: undefined,
                      },
                    },
                  }))
                }
                id="agenda-duv-month"
                name="agendaDuvMonth"
                className="rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
              >
                <option value="">Mes</option>
                {MONTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                inputMode="numeric"
                placeholder="Ano"
                value={filters.dateRanges.data_da_ultima_visita.year ?? ""}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    dateRanges: {
                      ...prev.dateRanges,
                      data_da_ultima_visita: {
                        ...prev.dateRanges.data_da_ultima_visita,
                        year: event.target.value || undefined,
                        from: undefined,
                        to: undefined,
                      },
                    },
                  }))
                }
                id="agenda-duv-year"
                name="agendaDuvYear"
                className="w-24 rounded-lg border border-sea/20 bg-white/90 px-2 py-2 text-xs text-ink outline-none focus:border-sea"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={clearFilters}
            className="self-end rounded-lg border border-sea/30 bg-white/80 px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea md:mt-5"
          >
            Limpar filtros
          </button>
          {canGenerate && (
            <div className="flex w-full items-center justify-between gap-2 md:ml-auto md:w-auto md:justify-start md:self-end md:mt-5">
              <button
                type="button"
                onClick={() => {
                  setGenerateMessage(null);
                  setShowGenerateModal(true);
                }}
                disabled={totalCount === 0}
                className="order-1 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60 md:order-2"
              >
                Gerar visitas
              </button>
              <div className="order-2 text-xs text-ink/60 md:order-1">
                <div>Empresas: {totalCount}</div>
                <div>Selecionadas: {selectedAgendaIds.length}</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {generateMessage && (
        <div className="rounded-xl border border-sea/20 bg-white/80 px-3 py-2 text-xs text-ink/70">
          {generateMessage}
        </div>
      )}

      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => (generating ? null : setShowGenerateModal(false))}
          />
          <div className="relative w-full max-w-lg rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg text-ink">Gerar visitas</h3>
            <p className="mt-1 text-xs text-ink/60">
              Selecione os vendedores, a data e as empresas marcadas na lista para gerar as visitas.
            </p>
            <p className="mt-2 text-xs text-ink/60">
              Empresas selecionadas: {selectedAgendaIds.length}
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-2 text-xs font-semibold text-ink/70">
                Vendedores destino
                <div className="rounded-xl border border-sea/20 bg-white/90 p-3">
                  <input
                    value={vendorQuery}
                    onChange={(event) => setVendorQuery(event.target.value)}
                    placeholder="Buscar vendedor..."
                    id="agenda-generate-vendor-search"
                    name="agendaGenerateVendorSearch"
                    className="w-full rounded-lg border border-sea/20 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-sea"
                  />
                  <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                    {filteredVendedores.length === 0 ? (
                      <p className="text-xs text-ink/60">Nenhum vendedor encontrado.</p>
                    ) : (
                      filteredVendedores.map((vendor) => {
                        const checked = selectedVendorIds.includes(vendor.user_id);
                        return (
                          <label
                            key={vendor.user_id}
                            className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1 text-xs text-ink hover:bg-sea/10"
                          >
                            <span>{vendor.display_name ?? vendor.user_id}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleVendor(vendor.user_id)}
                              name={`agendaGenerateVendor-${vendor.user_id}`}
                              className="h-4 w-4 accent-sea"
                            />
                          </label>
                        );
                      })
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-ink/60">
                    <button
                      type="button"
                      className="text-sea"
                      onClick={() => setSelectedVendorIds(vendedores.map((vendor) => vendor.user_id))}
                    >
                      Selecionar todos
                    </button>
                    <button type="button" onClick={() => setSelectedVendorIds([])}>
                      Limpar
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-ink/60">
                    Selecionados: {selectedVendorIds.length}
                  </p>
                </div>
              </div>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">
                Data da visita
                <input
                  type="date"
                  value={visitDate}
                  onChange={(event) => setVisitDate(event.target.value)}
                  id="agenda-generate-visit-date"
                  name="agendaGenerateVisitDate"
                  className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea"
                />
              </label>
            </div>

            {generateMessage && (
              <p className="mt-3 text-xs text-ink/70">{generateMessage}</p>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowGenerateModal(false)}
                disabled={generating}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGenerateVisits}
                disabled={
                  selectedVendorIds.length === 0 ||
                  selectedAgendaIds.length === 0 ||
                  !visitDate ||
                  generating ||
                  totalCount === 0
                }
                className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
              >
                {generating ? "Gerando..." : `Confirmar (${selectedAgendaIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {scheduleModalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => (scheduleSaving ? null : closeScheduleModal())}
          />
          <div className="relative w-full max-w-3xl rounded-3xl border border-sea/20 bg-white p-6 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg text-ink">Visitas agendadas</h3>
                <p className="mt-1 text-xs text-ink/60">
                  {scheduleModalRow.empresa ?? scheduleModalRow.nome_fantasia ?? "Empresa"}
                </p>
              </div>
              <span className="rounded-full bg-sea/10 px-2 py-1 text-[10px] font-semibold text-sea">
                COD {scheduleModalRow.cod_1 ?? "-"}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {scheduleDrafts.length === 0 ? (
                <p className="text-xs text-ink/60">Nenhuma visita agendada.</p>
              ) : (
                scheduleDrafts.map((draft, index) => (
                  <div
                    key={draft.id ?? `draft-${index}`}
                    className="rounded-2xl border border-sea/20 bg-white/90 p-3"
                  >
                    <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr_auto] md:items-end">
                      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                        Vendedor
                        <select
                          value={draft.vendorId}
                          onChange={(event) =>
                            updateScheduleDraft(index, { vendorId: event.target.value })
                          }
                          disabled={scheduleSaving}
                          className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea disabled:opacity-60"
                        >
                          <option value="">Selecione</option>
                          {draft.vendorId &&
                            !vendedores.some((vendor) => vendor.user_id === draft.vendorId) && (
                              <option value={draft.vendorId}>
                                {vendorById.get(draft.vendorId) ?? draft.vendorName ?? draft.vendorId}
                              </option>
                            )}
                          {vendedores.map((vendor) => (
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
                          value={draft.date}
                          onChange={(event) => updateScheduleDraft(index, { date: event.target.value })}
                          disabled={scheduleSaving}
                          className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea disabled:opacity-60"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink/70">
                        Perfil visita
                        <select
                          value={
                            draft.perfilCustom
                              ? "__custom__"
                              : draft.perfil
                                ? draft.perfil
                                : ""
                          }
                          onChange={(event) =>
                            updateScheduleDraft(index, {
                              perfilCustom: event.target.value === "__custom__",
                              perfil: event.target.value === "__custom__" ? draft.perfil : event.target.value,
                            })
                          }
                          disabled={scheduleSaving}
                          className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-xs text-ink outline-none focus:border-sea disabled:opacity-60"
                        >
                          <option value="">Selecione</option>
                          {PERFIL_VISITA_PRESETS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                          <option value="__custom__">Horario customizado</option>
                        </select>
                        {draft.perfilCustom && (
                          <input
                            value={draft.perfil}
                            onChange={(event) => updateScheduleDraft(index, { perfil: event.target.value })}
                            disabled={scheduleSaving}
                            placeholder="Informe o horario customizado"
                            className="rounded-lg border border-sea/20 bg-white px-2 py-2 text-[11px] text-ink outline-none focus:border-sea disabled:opacity-60"
                          />
                        )}
                      </label>
                      <button
                        type="button"
                        onClick={() => removeScheduleDraft(index)}
                        disabled={scheduleSaving}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600 hover:border-red-300 disabled:opacity-60"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {scheduleError && (
              <p className="mt-3 text-xs text-red-500">{scheduleError}</p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleAddScheduleDraft}
                disabled={scheduleSaving}
                className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
              >
                Adicionar vendedor
              </button>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={closeScheduleModal}
                  disabled={scheduleSaving}
                  className="rounded-lg border border-sea/30 bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:border-sea hover:text-sea disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleScheduleSave}
                  disabled={scheduleSaving}
                  className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
                >
                  {scheduleSaving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeChips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={chip.onRemove}
              className="rounded-full border border-sea/30 bg-white/80 px-3 py-1 text-xs text-sea hover:border-sea hover:text-seaLight"
            >
              {chip.label} ✕
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-sea/15 bg-white/90">
        <div className="md:hidden">
          {loading ? (
            <div className="px-4 py-6 text-center text-sm text-ink/60">Carregando agenda...</div>
          ) : error ? (
            <div className="px-4 py-6 text-center text-sm text-red-500">{error}</div>
          ) : data.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-ink/60">Nenhum registro encontrado.</div>
          ) : (
            <div className="space-y-3 px-3 py-3">
              {data.map((row) => {
                const empresaLabel = row.empresa ?? row.nome_fantasia ?? "Sem empresa";
                const locationLine = `${row.bairro ? `${row.bairro} · ` : ""}${row.cidade ?? ""}${
                  row.uf ? ` / ${row.uf}` : ""
                }`;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedRow(row)}
                    className="w-full rounded-2xl border border-sea/15 bg-white/95 p-4 text-left shadow-sm transition hover:shadow-card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-ink">{empresaLabel}</p>
                        {row.endereco && (
                          <p className="mt-1 text-xs text-ink/60">{row.endereco}</p>
                        )}
                        <p className="text-xs text-ink/50">{locationLine || "-"}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <label
                          className="flex items-center gap-1 text-[10px] text-ink/60"
                          onClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selectedAgendaSet.has(row.id)}
                            onChange={() => toggleAgendaSelection(row.id)}
                            className="h-3.5 w-3.5 accent-sea"
                            aria-label="Selecionar empresa"
                          />
                          Selecionar
                        </label>
                        {(() => {
                          const scheduled = scheduledVisitsByAgenda[row.id] ?? [];
                          if (scheduled.length === 0) return null;
                          const visitDate = scheduled[0]?.visit_date ?? null;
                          const badgeText = formatVisitBadge(visitDate);
                          const titleText = visitDate ? `Visita agendada: ${formatDate(visitDate)}` : "Visita agendada";
                          return (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openScheduleModal(row);
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                              className="inline-flex min-h-7 items-center justify-center rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-700"
                              title={titleText}
                              aria-label={titleText}
                            >
                              {badgeText}
                            </button>
                          );
                        })()}
                        <span className="rounded-full bg-sea/10 px-2 py-1 text-[10px] font-semibold text-sea">
                          COD {row.cod_1 ?? "-"}
                        </span>
                        {row.perfil_visita && (
                          <span className="rounded-full bg-sand px-2 py-1 text-[10px] font-semibold text-ink/70">
                            {row.perfil_visita}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-ink/60">
                      <div className="rounded-xl bg-sand/60 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-ink/40">Supervisor</p>
                        <p className="text-[11px] font-semibold text-ink/70">{row.supervisor ?? "-"}</p>
                      </div>
                      <div className="rounded-xl bg-sand/60 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-ink/40">Vendedor</p>
                        <p className="text-[11px] font-semibold text-ink/70">{row.vendedor ?? "-"}</p>
                      </div>
                      <div className="rounded-xl bg-sand/60 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-ink/40">Ultima visita</p>
                        <p className="text-[11px] font-semibold text-ink/70">
                          {formatDate(row.data_da_ultima_visita)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-sand/60 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-ink/40">Grupo</p>
                        <p className="text-[11px] font-semibold text-ink/70">{row.grupo ?? "-"}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sea/15 px-4 py-3 text-xs text-ink/60">
            <div>
              Pagina {pageIndex + 1} de {Math.max(1, Math.ceil(totalCount / pageSize))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                disabled={pageIndex === 0}
                className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setPageIndex((prev) => prev + 1)}
                disabled={(pageIndex + 1) * pageSize >= totalCount}
                className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1 disabled:opacity-50"
              >
                Proxima
              </button>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1"
              >
                {[25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size} / pagina
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <thead className="sticky top-0 z-30 bg-sand/60 shadow-sm overflow-visible">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const isTight = header.column.id === "select" || header.column.id === "obs";
                      const tightStyles = isTight
                        ? {
                            width: header.getSize(),
                            minWidth: header.getSize(),
                            maxWidth: header.getSize(),
                          }
                        : undefined;
                      return (
                        <th
                          key={header.id}
                          style={tightStyles}
                          className={`relative align-top whitespace-normal border-b border-sea/20 py-3 text-xs font-semibold text-ink/70 overflow-visible ${
                            isTight ? "px-1 text-center" : "px-4"
                          }`}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-ink/60">
                      Carregando agenda...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-red-500">
                      {error}
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-ink/60">
                      Nenhum registro encontrado.
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b border-sea/10 hover:bg-sea/10"
                      onClick={() => {
                        setSelectedRow(row.original);
                        setSelectedRowId(row.original.id);
                      }}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const isTight = cell.column.id === "select" || cell.column.id === "obs";
                        const tightStyles = isTight
                          ? {
                              width: cell.column.getSize(),
                              minWidth: cell.column.getSize(),
                              maxWidth: cell.column.getSize(),
                            }
                          : undefined;
                        return (
                          <td
                            key={cell.id}
                            style={tightStyles}
                            className={`whitespace-normal break-words py-3 text-sm text-ink ${
                              isTight ? "px-1 text-center" : "px-4"
                            }`}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sea/15 px-4 py-3 text-xs text-ink/60">
            <div>
              Pagina {pageIndex + 1} de {Math.max(1, Math.ceil(totalCount / pageSize))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                disabled={pageIndex === 0}
                className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setPageIndex((prev) => prev + 1)}
                disabled={(pageIndex + 1) * pageSize >= totalCount}
                className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1 disabled:opacity-50"
              >
                Proxima
              </button>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="rounded-lg border border-sea/30 bg-white/80 px-2 py-1"
              >
                {[25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size} / pagina
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <AgendaDrawer
        key={selectedRow?.id ?? "agenda-drawer"}
        row={selectedRow}
        onClose={() => {
          setSelectedRow(null);
          setSelectedRowId(null);
        }}
        canEdit={canEdit}
        userEmail={session?.user.email ?? null}
        vendorOptions={vendorOptions}
        supervisorOptions={supervisores
          .map((supervisor) => supervisor.display_name)
          .filter((value): value is string => Boolean(value))}
        onUpdated={handleDrawerUpdated}
        onDeleted={handleDrawerDeleted}
      />
    </div>
  );
}

