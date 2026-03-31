export type Route = {
  id: string;
  name: string;
  date: string | null;
  assigned_to_user_id: string | null;
  created_by: string | null;
  created_at: string | null;
};

export type RouteStop = {
  id: string;
  route_id: string;
  cliente_id: string | null;
  agenda_id?: string | null;
  stop_order: number | null;
  notes: string | null;
  cliente?: {
    id: string;
    codigo?: string | null;
    empresa: string | null;
    nome_fantasia: string | null;
    endereco: string | null;
    bairro?: string | null;
    complemento?: string | null;
    cidade: string | null;
    uf: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
};
