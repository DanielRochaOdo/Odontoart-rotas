import { createClient } from "@supabase/supabase-js";

const dashboardUrl = import.meta.env.VITE_DASHBOARD_URL as string | undefined;
const dashboardAnonKey = import.meta.env.VITE_DASHBOARD_ANON_KEY as string | undefined;

if (!dashboardUrl || !dashboardAnonKey) {
  console.warn("Missing dashboard Supabase env vars. Check VITE_DASHBOARD_URL and VITE_DASHBOARD_ANON_KEY.");
}

export const supabaseDash = createClient(dashboardUrl ?? "", dashboardAnonKey ?? "", {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
