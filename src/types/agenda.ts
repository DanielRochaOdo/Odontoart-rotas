export type AgendaRow = {
  id: string;
  data_da_ultima_visita: string | null;
  cod_1: string | null;
  empresa: string | null;
  perfil_visita: string | null;
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
  nome_fantasia: string | null;
  grupo: string | null;
  situacao: string | null;
  obs_contrato_1: string | null;
  visit_generated_at?: string | null;
  visit_assigned_to?: string | null;
  visit_route_id?: string | null;
  visit_completed_at?: string | null;
  visit_completed_vidas?: number | null;
  created_at: string | null;
};

export type AgendaFilters = {
  global: string;
  columns: Record<string, string[]>;
  dateRanges: {
    data_da_ultima_visita: { from?: string; to?: string; month?: string; year?: string };
  };
};
