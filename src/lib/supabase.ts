import { createClient, processLock } from "@supabase/supabase-js";
import { dashboardAwareFetch } from "./dashboardCacheEvents";
import { dashboardQueryCache } from "./queryCache";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const isStandalonePwa = () => {
  if (typeof window === "undefined") return false;
  const standaloneByDisplayMode =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const standaloneByIOS =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standaloneByDisplayMode || standaloneByIOS;
};

const shouldUseFallbackAuthLock = isStandalonePwa();

if (!supabaseUrl || !supabaseAnonKey) {
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
  global: { fetch: dashboardAwareFetch },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    lock: shouldUseFallbackAuthLock ? processLock : undefined,
  },
});

let cacheUserId: string | undefined;
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT" || session?.user.id !== cacheUserId) dashboardQueryCache.invalidate();
  cacheUserId = session?.user.id;
});
