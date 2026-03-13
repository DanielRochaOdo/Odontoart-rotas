export type PreCadastroStatus = "PENDENTE" | "APROVADO" | "REPROVADO";

export type PreCadastroRow = {
  id: string;
  created_by_user_id: string;
  created_by_name: string | null;
  reviewed_by_user_id: string | null;
  status: PreCadastroStatus;
  review_note: string | null;
  approved_cliente_id: string | null;
  codigo: string | null;
  cnpj: string | null;
  corte: number | null;
  venc: number | null;
  valor: number | null;
  data_da_ultima_visita: string | null;
  cep: string | null;
  empresa: string | null;
  pessoa: string | null;
  contato: string | null;
  grupo: string | null;
  obs_comercial: string | null;
  obs: string | null;
  perfil_visita: string | null;
  situacao: string | null;
  endereco: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export type CreatePreCadastroPayload = {
  codigo?: string | null;
  cnpj?: string | null;
  corte?: number | null;
  venc?: number | null;
  valor?: number | null;
  data_da_ultima_visita?: string | null;
  cep?: string | null;
  empresa?: string | null;
  pessoa?: string | null;
  contato?: string | null;
  grupo?: string | null;
  obs_comercial?: string | null;
  obs?: string | null;
  perfil_visita?: string | null;
  situacao?: string | null;
  endereco?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
};

