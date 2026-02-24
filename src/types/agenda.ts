export type AgendaRow = {
  id: string;
  data_da_ultima_visita: string | null;
  consultor: string | null;
  cod_1: string | null;
  empresa: string | null;
  perfil_visita: string | null;
  dt_mar_25: string | null;
  consultor_mar_25: string | null;
  corte: number | null;
  venc: number | null;
  valor: number | null;
  tit: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  supervisor: string | null;
  vendedor: string | null;
  cod_2: string | null;
  nome_fantasia: string | null;
  grupo: string | null;
  situacao: string | null;
  obs_contrato_1: string | null;
  obs_contrato_2: string | null;
  created_at: string | null;
};

export type AgendaFilters = {
  global: string;
  columns: Record<string, string[]>;
  dateRanges: {
    data_da_ultima_visita: { from?: string; to?: string };
    dt_mar_25: { from?: string; to?: string };
  };
};
