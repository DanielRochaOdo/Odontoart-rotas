import { createClient } from "@supabase/supabase-js";

const dashboardUrl = (import.meta.env.VITE_DASHBOARD_URL as string | undefined)?.trim();
const dashboardAnonKey = (import.meta.env.VITE_DASHBOARD_ANON_KEY as string | undefined)?.trim();
const primaryUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const primaryAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

if (!dashboardUrl || !dashboardAnonKey) {
}

const resolvedDashboardUrl = dashboardUrl || primaryUrl;
const resolvedDashboardAnonKey = dashboardAnonKey || primaryAnonKey;

if (!resolvedDashboardUrl || !resolvedDashboardAnonKey) {
}

export const supabaseDash = createClient(resolvedDashboardUrl ?? "", resolvedDashboardAnonKey ?? "", {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
