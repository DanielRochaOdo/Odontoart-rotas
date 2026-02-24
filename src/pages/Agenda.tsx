import { useEffect, useMemo, useState } from "react";
import {
  flexRender,
  type ColumnDef,
  type SortingState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Download } from "lucide-react";
import { fetchAgenda, fetchDistinctOptions, exportAgendaCsv } from "../lib/agendaApi";
import type { AgendaRow } from "../types/agenda";
import { useAgendaFilters } from "../hooks/useAgendaFilters";
import MultiSelectFilter from "../components/agenda/MultiSelectFilter";
import DateRangeFilter from "../components/agenda/DateRangeFilter";
import AgendaDrawer from "../components/agenda/AgendaDrawer";
import { useAuth } from "../context/AuthContext";

const FILTER_SOURCES: Record<string, string[]> = {
  consultor: ["consultor"],
  supervisor: ["supervisor"],
  vendedor: ["vendedor"],
  cidade: ["cidade"],
  uf: ["uf"],
  situacao: ["situacao"],
  grupo: ["grupo"],
  perfil_visita: ["perfil_visita"],
  empresa_nome: ["empresa", "nome_fantasia"],
};

const FILTER_LABELS: Record<string, string> = {
  consultor: "Consultor",
  supervisor: "Supervisor",
  vendedor: "Vendedor",
  cidade: "Cidade",
  uf: "UF",
  situacao: "Situacao",
  grupo: "Grupo",
  perfil_visita: "Perfil Visita",
  empresa_nome: "Empresa/Nome Fantasia",
};

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR").format(date);
};

const createCsv = (rows: Record<string, unknown>[]) => {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escapeValue = (value: unknown) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((key) => escapeValue(row[key])).join(","));
  });
  return lines.join("\n");
};

export default function Agenda() {
  const { role } = useAuth();
  const { filters, setFilters, clearFilters } = useAgendaFilters();
  const [data, setData] = useState<AgendaRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [selectedRow, setSelectedRow] = useState<AgendaRow | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setPageIndex(0);
  }, [filters, sorting]);

  useEffect(() => {
    const loadOptions = async () => {
      const entries = await Promise.all(
        Object.entries(FILTER_SOURCES).map(async ([key, sources]) => [
          key,
          await fetchDistinctOptions(sources),
        ]),
      );
      setFilterOptions(Object.fromEntries(entries));
    };

    loadOptions().catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
    });
  }, []);

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
  }, [filters, pageIndex, pageSize, sorting]);

  const columns = useMemo<ColumnDef<AgendaRow>[]>(
    () => [
      {
        accessorKey: "data_da_ultima_visita",
        header: () => <span>Data ultima visita</span>,
        cell: (info) => formatDate(info.getValue() as string | null),
      },
      {
        accessorKey: "empresa",
        header: () => (
          <div className="flex items-center gap-2">
            <span>Empresa / Nome Fantasia</span>
            <MultiSelectFilter
              label={
                filters.columns.empresa_nome.length
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
          return (
            <div>
              <p className="text-sm font-semibold text-ink">{row.empresa ?? "-"}</p>
              <p className="text-xs text-muted">{row.nome_fantasia ?? ""}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "cidade",
        header: () => (
          <div className="flex items-center gap-2">
            <span>Cidade</span>
            <MultiSelectFilter
              label={filters.columns.cidade.length ? `Filtro (${filters.columns.cidade.length})` : "Filtro"}
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
        header: () => (
          <div className="flex items-center gap-2">
            <span>UF</span>
            <MultiSelectFilter
              label={filters.columns.uf.length ? `Filtro (${filters.columns.uf.length})` : "Filtro"}
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
        accessorKey: "consultor",
        header: () => (
          <div className="flex items-center gap-2">
            <span>Consultor</span>
            <MultiSelectFilter
              label={filters.columns.consultor.length ? `Filtro (${filters.columns.consultor.length})` : "Filtro"}
              options={filterOptions.consultor ?? []}
              value={filters.columns.consultor}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, consultor: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
      },
      {
        accessorKey: "supervisor",
        header: () => (
          <div className="flex items-center gap-2">
            <span>Supervisor</span>
            <MultiSelectFilter
              label={filters.columns.supervisor.length ? `Filtro (${filters.columns.supervisor.length})` : "Filtro"}
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
        accessorKey: "vendedor",
        header: () => (
          <div className="flex items-center gap-2">
            <span>Vendedor</span>
            <MultiSelectFilter
              label={filters.columns.vendedor.length ? `Filtro (${filters.columns.vendedor.length})` : "Filtro"}
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
        accessorKey: "situacao",
        header: () => (
          <div className="flex items-center gap-2">
            <span>Situacao</span>
            <MultiSelectFilter
              label={filters.columns.situacao.length ? `Filtro (${filters.columns.situacao.length})` : "Filtro"}
              options={filterOptions.situacao ?? []}
              value={filters.columns.situacao}
              onApply={(next) =>
                setFilters((prev) => ({
                  ...prev,
                  columns: { ...prev.columns, situacao: next },
                }))
              }
            />
          </div>
        ),
        cell: (info) => info.getValue<string | null>() ?? "-",
      },
      {
        accessorKey: "grupo",
        header: () => (
          <div className="flex items-center gap-2">
            <span>Grupo</span>
            <MultiSelectFilter
              label={filters.columns.grupo.length ? `Filtro (${filters.columns.grupo.length})` : "Filtro"}
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
        header: () => (
          <div className="flex items-center gap-2">
            <span>Perfil Visita</span>
            <MultiSelectFilter
              label={
                filters.columns.perfil_visita.length
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
      {
        accessorKey: "dt_mar_25",
        header: () => <span>Dt mar/25</span>,
        cell: (info) => formatDate(info.getValue() as string | null),
      },
    ],
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

    if (filters.dateRanges.dt_mar_25.from || filters.dateRanges.dt_mar_25.to) {
      chips.push({
        label: `Dt mar/25: ${filters.dateRanges.dt_mar_25.from ?? ""} - ${filters.dateRanges.dt_mar_25.to ?? ""}`,
        onRemove: () =>
          setFilters((prev) => ({
            ...prev,
            dateRanges: { ...prev.dateRanges, dt_mar_25: {} },
          })),
      });
    }

    return chips;
  }, [filters, setFilters]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await exportAgendaCsv(filters);
      const csv = createCsv(rows as Record<string, unknown>[]);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "agenda.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    setExporting(false);
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-ink">Agenda</h2>
        <p className="mt-2 text-sm text-muted">
          Visualizacao em formato grid com filtros e ordenacao.
        </p>
      </header>

      <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-mist/60 bg-white p-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Busca global</span>
          <input
            value={filters.global}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, global: event.target.value }))
            }
            placeholder="Empresa, cidade, vendedor..."
            className="w-64 rounded-lg border border-mist px-3 py-2 text-sm outline-none focus:border-sea"
          />
        </div>
        <DateRangeFilter
          label="Data da ultima visita"
          value={filters.dateRanges.data_da_ultima_visita}
          onChange={(next) =>
            setFilters((prev) => ({
              ...prev,
              dateRanges: { ...prev.dateRanges, data_da_ultima_visita: next },
            }))
          }
        />
        <DateRangeFilter
          label="Dt mar/25"
          value={filters.dateRanges.dt_mar_25}
          onChange={(next) =>
            setFilters((prev) => ({
              ...prev,
              dateRanges: { ...prev.dateRanges, dt_mar_25: next },
            }))
          }
        />
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-lg border border-mist px-3 py-2 text-xs font-semibold text-muted hover:border-sea/60 hover:text-sea"
        >
          Limpar filtros
        </button>
        {(role === "SUPERVISOR" || role === "ASSISTENTE") && (
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-sea px-3 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-70"
          >
            <Download size={14} />
            {exporting ? "Exportando" : "Exportar CSV"}
          </button>
        )}
      </section>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeChips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={chip.onRemove}
              className="rounded-full border border-mist px-3 py-1 text-xs text-muted hover:border-sea hover:text-sea"
            >
              {chip.label} ✕
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-mist/60 bg-white">
        <div className="overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-white shadow-sm">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="whitespace-nowrap border-b border-mist/60 px-4 py-3 text-xs font-semibold text-muted"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-2">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() ? (
                          <span className="text-[10px] text-sea">
                            {header.column.getIsSorted() === "desc" ? "▼" : "▲"}
                          </span>
                        ) : null}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-muted">
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
                  <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-muted">
                    Nenhum registro encontrado.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-mist/40 hover:bg-sea/5"
                    onClick={() => setSelectedRow(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="whitespace-nowrap px-4 py-3 text-sm text-ink">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-mist/60 px-4 py-3 text-xs text-muted">
          <div>
            Pagina {pageIndex + 1} de {Math.max(1, Math.ceil(totalCount / pageSize))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
              disabled={pageIndex === 0}
              className="rounded-lg border border-mist px-2 py-1 disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPageIndex((prev) => prev + 1)}
              disabled={(pageIndex + 1) * pageSize >= totalCount}
              className="rounded-lg border border-mist px-2 py-1 disabled:opacity-50"
            >
              Proxima
            </button>
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="rounded-lg border border-mist px-2 py-1"
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

      <AgendaDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  );
}
