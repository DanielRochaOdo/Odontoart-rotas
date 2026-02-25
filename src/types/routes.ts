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
  agenda_id: string | null;
  stop_order: number | null;
  notes: string | null;
  agenda?: {
    id: string;
    empresa: string | null;
    nome_fantasia: string | null;
    endereco: string | null;
    cidade: string | null;
    uf: string | null;
  } | null;
};
