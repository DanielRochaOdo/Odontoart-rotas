import { supabase } from "./supabase";
import type { UserRole } from "../types/roles";

export type SystemNewsType = "MELHORIA" | "ATUALIZACAO" | "CORRECAO" | "MANUTENCAO" | "AVISO";
export type SystemNewsModule =
  | "Agenda"
  | "Rotas"
  | "Empresas"
  | "Visitas"
  | "KPI"
  | "Dashboard"
  | "Configuracoes"
  | "Aplicativo"
  | "Geral";

export type SystemNewsRow = {
  id: string;
  titulo: string;
  descricao: string;
  tipo: SystemNewsType;
  modulo: SystemNewsModule | string;
  roles_permitidos: UserRole[];
  data_publicacao: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type SystemNewsFilters = {
  from: string;
  to: string;
  modulo: string;
  tipo: string;
  ativo: string;
  search: string;
};

export const SYSTEM_NEWS_PAGE_SIZE = 10;

export const fetchSystemNews = async ({
  filters,
  page,
  role,
}: {
  filters: SystemNewsFilters;
  page: number;
  role: UserRole;
}) => {
  let query = supabase
    .from("system_news")
    .select("*", { count: "exact" })
    .order("data_publicacao", { ascending: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * SYSTEM_NEWS_PAGE_SIZE, page * SYSTEM_NEWS_PAGE_SIZE - 1);

  if (filters.from) query = query.gte("data_publicacao", filters.from);
  if (filters.to) query = query.lte("data_publicacao", `${filters.to}T23:59:59.999Z`);
  if (filters.modulo && filters.modulo !== "TODOS") query = query.eq("modulo", filters.modulo);
  if (filters.tipo && filters.tipo !== "TODOS") query = query.eq("tipo", filters.tipo);
  if (filters.ativo && filters.ativo !== "TODOS") query = query.eq("ativo", filters.ativo === "ATIVO");
  if (filters.search.trim()) {
    const term = `%${filters.search.trim()}%`;
    query = query.or(`titulo.ilike.${term},descricao.ilike.${term}`);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as SystemNewsRow[], count: count ?? 0, role };
};

export const requestSystemNewsAdminAccess = async (password: string) => {
  const { data, error } = await supabase.rpc("system_news_request_admin_access", { p_password: password });
  if (error) throw new Error(error.message);
  return Boolean(data);
};

export const createSystemNews = async (payload: Omit<SystemNewsRow, "id" | "created_at" | "updated_at" | "created_by" | "updated_by">) => {
  const { data, error } = await supabase.from("system_news").insert(payload).select("*").single();
  if (error) throw new Error(error.message);
  return data as SystemNewsRow;
};

export const updateSystemNews = async (id: string, payload: Partial<SystemNewsRow>) => {
  const { data, error } = await supabase.from("system_news").update(payload).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data as SystemNewsRow;
};

export const deleteSystemNews = async (id: string) => {
  const { error } = await supabase.from("system_news").delete().eq("id", id);
  if (error) throw new Error(error.message);
};
