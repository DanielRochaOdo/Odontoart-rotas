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
  fetchDistinctOptions,
  fetchSupervisores,
  fetchVendedores,
} from "../lib/agendaApi";
import type { AgendaRow } from "../types/agenda";
import { useAgendaFilters } from "../hooks/useAgendaFilters";
import MultiSelectFilter from "../components/agenda/MultiSelectFilter";
import AgendaDrawer from "../components/agenda/AgendaDrawer";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { onProfilesUpdated } from "../lib/profileEvents";

const FILTER_SOURCES: Record<string, string[]> = {
  supervisor: ["supervisor"],
  vendedor: ["vendedor"],
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
  bairro: "Bairro",
  cidade: "Cidade",
  uf: "UF",
  grupo: "Grupo",
  perfil_visita: "Perfil Visita",
  empresa_nome: "Empresa",
};

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR").format(date);
};

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

  useEffect(() => {
    setPageIndex(0);
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
    if (!visitDate) {
      setGenerateMessage("Selecione a data da visita.");
      return;
    }

    setGenerating(true);
    setGenerateMessage(null);

    try {
      const rows = await fetchAgendaForGeneration(filters);
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
        accessorKey: "data_da_ultima_visita",
        header: ({ column }) => renderSortLabel(column, "Data ultima visita"),
        cell: (info) => formatDate(info.getValue() as string | null),
      },
      {
        accessorKey: "cod_1",
        header: ({ column }) => renderSortLabel(column, "Codigo"),
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
    [filterOptions, filters.columns, setFilters],
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
              <span className="order-2 text-xs text-ink/60 md:order-1">
                Empresas: {totalCount}
              </span>
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
              Selecione os vendedores e a data para gerar as visitas com base nos filtros atuais.
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
        disabled={selectedVendorIds.length === 0 || !visitDate || generating || totalCount === 0}
        className="rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60"
      >
                {generating ? "Gerando..." : `Confirmar (${totalCount})`}
              </button>
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
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="relative align-top whitespace-normal border-b border-sea/20 px-4 py-3 text-xs font-semibold text-ink/70 overflow-visible"
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
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
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="whitespace-normal break-words px-4 py-3 text-sm text-ink">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
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

