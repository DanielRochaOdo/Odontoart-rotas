import type { AgendaRow } from "../../types/agenda";

const formatValue = (value: string | number | null) => (value === null || value === "" ? "-" : String(value));

const FIELDS: { key: keyof AgendaRow; label: string }[] = [
  { key: "data_da_ultima_visita", label: "Data da ultima visita" },
  { key: "consultor", label: "Consultor" },
  { key: "cod_1", label: "Cod." },
  { key: "empresa", label: "Empresa" },
  { key: "perfil_visita", label: "Perfil Visita" },
  { key: "dt_mar_25", label: "Dt mar/25" },
  { key: "consultor_mar_25", label: "Consultor Mar/25" },
  { key: "corte", label: "Corte" },
  { key: "venc", label: "VenC" },
  { key: "valor", label: "Valor" },
  { key: "tit", label: "TIT" },
  { key: "endereco", label: "Endereco" },
  { key: "bairro", label: "Bairro" },
  { key: "cidade", label: "Cidade" },
  { key: "uf", label: "UF" },
  { key: "supervisor", label: "Supervisor" },
  { key: "vendedor", label: "Vendedor" },
  { key: "cod_2", label: "Cod. (2)" },
  { key: "nome_fantasia", label: "Nome Fantasia" },
  { key: "grupo", label: "Grupo" },
  { key: "situacao", label: "Situacao" },
  { key: "obs_contrato_1", label: "Obs. Contrato" },
  { key: "obs_contrato_2", label: "Obs. Contrato (2)" },
];

type AgendaDrawerProps = {
  row: AgendaRow | null;
  onClose: () => void;
};

export default function AgendaDrawer({ row, onClose }: AgendaDrawerProps) {
  if (!row) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/30"
        onClick={onClose}
      />
      <div className="relative h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Agenda</p>
            <h3 className="mt-2 font-display text-xl text-ink">
              {row.empresa ?? row.nome_fantasia ?? "Detalhe"}
            </h3>
            <p className="text-sm text-muted">
              {row.cidade ? `${row.cidade} / ${row.uf ?? ""}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-mist px-3 py-1 text-xs text-muted"
          >
            Fechar
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {FIELDS.map((field) => (
            <div key={field.key} className="flex items-center justify-between border-b border-mist/50 pb-2">
              <span className="text-xs font-semibold text-muted">{field.label}</span>
              <span className="text-sm text-ink">{formatValue(row[field.key] as string | number | null)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
