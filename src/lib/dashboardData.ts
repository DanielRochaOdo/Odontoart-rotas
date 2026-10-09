import type { SupabaseClient } from "@supabase/supabase-js";
import { dashboardQueryCache, type QueryCache } from "./queryCache";

export type VisitLite = {
  id: string; cliente_id: string | null; visit_date: string | null;
  completed_at: string | null; no_visit_reason: string | null;
  assigned_to_user_id: string | null; assigned_to_name: string | null; completed_vidas: number | null;
};
export type HistoricalLives = Pick<VisitLite, "visit_date" | "assigned_to_user_id" | "assigned_to_name" | "completed_vidas">;
export type AceiteLite = { entry_date: string | null; vendor_user_id: string | null; vidas: number | null };
export type ClienteLite = {
  id: string; codigo?: string | null; empresa?: string | null; cidade: string | null;
  bairro: string | null; situacao: string | null; vendedor: string | null; categoria: string | null; grupo: string | null;
};
export type ProfileLite = {
  id?: string | null; user_id: string | null; display_name: string | null; role?: string | null; supervisor_id?: string | null;
};
export type ClienteCoverage = {
  data_da_ultima_visita: string | null; situacao: string | null; bairro: string | null;
  cidade: string | null; uf: string | null; vendedor: string | null;
};
export type DashboardScope = { userId: string; role: string };
export const DASHBOARD_CACHE_TTL = 120_000;
const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string; code?: string } | null };
async function allPages<T>(fetchPage: (offset: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await fetchPage(offset);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export function createDashboardLoader(client: SupabaseClient, cache: QueryCache = dashboardQueryCache) {
  const key = (scope: DashboardScope, resource: string, range = "") =>
    `${scope.userId}:${scope.role}|${resource}|${range}`;
  return {
    coverageClients: (scope: DashboardScope, vendorName: string | null) => cache.get(
      key(scope, "clientes", `coverage:${vendorName ?? "all"}`), DASHBOARD_CACHE_TTL,
      () => allPages<ClienteCoverage>((offset) => {
        let query = client.from("v_dash_clientes_active")
          .select("data_da_ultima_visita, situacao, bairro, cidade, uf, vendedor")
          .order("id").range(offset, offset + PAGE_SIZE - 1);
        if (scope.role === "VENDEDOR") {
          if (!vendorName) throw new Error("Perfil de vendedor sem nome de exibicao. Faca login novamente.");
          query = query.eq("vendedor", vendorName);
        }
        return query;
      }),
    ),
    visits: (scope: DashboardScope, from: string, toExclusive: string) => cache.get(
      key(scope, "visits", `${from}:${toExclusive}`), DASHBOARD_CACHE_TTL,
      () => allPages<VisitLite>((offset) => {
        let query = client.from("v_dash_visits_active")
          .select("id, cliente_id, visit_date, completed_at, no_visit_reason, assigned_to_user_id, assigned_to_name, completed_vidas")
          .gte("visit_date", from).lt("visit_date", toExclusive)
          .order("visit_date").order("id").range(offset, offset + PAGE_SIZE - 1);
        if (scope.role === "VENDEDOR") query = query.eq("assigned_to_user_id", scope.userId);
        return query;
      }),
    ),
    aceites: (scope: DashboardScope, from: string, toExclusive: string) => cache.get(
      key(scope, "aceite_digital", `${from}:${toExclusive}`), DASHBOARD_CACHE_TTL,
      () => allPages<AceiteLite>((offset) => {
        let query = client.from("v_dash_aceite_digital_active").select("entry_date, vendor_user_id, vidas")
          .gte("entry_date", from).lt("entry_date", toExclusive)
          .order("entry_date").order("id").range(offset, offset + PAGE_SIZE - 1);
        if (scope.role === "VENDEDOR") query = query.eq("vendor_user_id", scope.userId);
        return query;
      }),
    ),
    clientes: (scope: DashboardScope) => cache.get(key(scope, "clientes"), DASHBOARD_CACHE_TTL,
      () => allPages<ClienteLite>((offset) => client.from("v_dash_clientes_active")
        .select("id, codigo, empresa, cidade, bairro, situacao, vendedor, categoria, grupo")
        .order("empresa").order("id").range(offset, offset + PAGE_SIZE - 1)),
    ),
    profiles: (scope: DashboardScope) => cache.get(key(scope, "profiles"), DASHBOARD_CACHE_TTL,
      () => allPages<ProfileLite>((offset) => client.from("v_dash_profiles_active")
        .select("id, user_id, display_name, role, supervisor_id").in("role", ["VENDEDOR", "SUPERVISOR"])
        .order("id").range(offset, offset + PAGE_SIZE - 1)),
    ),
    historicalLives: (scope: DashboardScope) => cache.get(key(scope, "visits", "monthly-lives"), DASHBOARD_CACHE_TTL, async () => {
      try {
        return await allPages<HistoricalLives>((offset) => {
          let query = client.from("v_dash_visits_monthly_lives")
            .select("visit_date, assigned_to_user_id, assigned_to_name, completed_vidas")
            .order("visit_date").order("assigned_to_user_id").order("assigned_to_name")
            .range(offset, offset + PAGE_SIZE - 1);
          if (scope.role === "VENDEDOR") query = query.eq("assigned_to_user_id", scope.userId);
          return query;
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        // Allows frontend rollout before the optional dashboard view. Do not hide
        // permission/network failures by silently switching data sources.
        if (code !== "PGRST205" && code !== "42P01") throw error;
        return allPages<HistoricalLives>((offset) => {
          let query = client.from("v_dash_visits_active")
            .select("visit_date, assigned_to_user_id, assigned_to_name, completed_vidas")
            .not("visit_date", "is", null).gt("completed_vidas", 0)
            .order("visit_date").order("id").range(offset, offset + PAGE_SIZE - 1);
          if (scope.role === "VENDEDOR") query = query.eq("assigned_to_user_id", scope.userId);
          return query;
        });
      }
    }),
  };
}
