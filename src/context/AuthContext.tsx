/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { UserRole } from "../types/roles";

export type Profile = {
  id: string;
  user_id: string;
  role: UserRole;
  display_name: string | null;
  nome?: string | null;
  created_at: string;
};

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  role: UserRole | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (activeSession: Session | null) => {
    if (!activeSession) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, user_id, role, display_name, nome, created_at")
      .eq("user_id", activeSession.user.id)
      .single();

    if (error) {
      setProfile(null);
      return;
    }

    setProfile(data as Profile);
  };

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session ?? null);
      fetchProfile(data.session ?? null).finally(() => {
        if (isMounted) setLoading(false);
      });
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_, nextSession) => {
      setSession(nextSession);
      setLoading(true);
      fetchProfile(nextSession).finally(() => setLoading(false));
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      role: profile?.role ?? null,
      loading,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return error ? { error: error.message } : {};
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
      refreshProfile: async () => {
        await fetchProfile(session);
      },
    }),
    [session, profile, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
