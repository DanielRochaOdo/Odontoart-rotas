import { createClient } from "@supabase/supabase-js";

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

const authNoOpLock = async <T>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<T>,
) => fn();

const shouldUseNoOpAuthLock = isStandalonePwa();

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Missing Supabase env vars. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    lock: shouldUseNoOpAuthLock ? authNoOpLock : undefined,
  },
});
