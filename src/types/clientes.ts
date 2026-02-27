export type ClienteRow = {
  id: string;
  codigo: string | null;
  valor: number | null;
  cep: string | null;
  empresa: string | null;
  nome_fantasia: string | null;
  perfil_visita: string | null;
  situacao: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  created_at: string | null;
};

export type ClienteHistoryRow = {
  id: string;
  visit_date: string | null;
  assigned_to_name: string | null;
  assigned_to_user_id: string | null;
  perfil_visita: string | null;
  perfil_visita_opcoes: string | null;
  completed_at: string | null;
  completed_vidas: number | null;
  situacao: string | null;
  supervisor: string | null;
};
