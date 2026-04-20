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
  can_access_pre_cadastro: boolean;
  can_access_next_route_dashboard: boolean;
  force_reauth_after?: string | null;
  created_at: string;
};

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  profileError: string | null;
  role: UserRole | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_REQUEST_TIMEOUT_MS = 12000;
const PROFILE_SYNC_INTERVAL_MS = 20_000;
const PROFILE_SELECT_WITH_FORCE_REAUTH =
  "id, user_id, role, display_name, nome, can_access_pre_cadastro, can_access_next_route_dashboard, force_reauth_after, created_at";
const PROFILE_SELECT_FALLBACK =
  "id, user_id, role, display_name, nome, can_access_pre_cadastro, can_access_next_route_dashboard, created_at";
const PROFILE_LOAD_FRIENDLY_ERROR_MESSAGE =
  "Nao conseguimos carregar seu perfil agora. Voce ainda pode sair da conta normalmente. Tente novamente em instantes; se persistir, fale com a supervisao.";

const parseJwtIssuedAtMs = (accessToken?: string | null) => {
  if (!accessToken) return null;
  const parts = accessToken.split(".");
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { iat?: unknown };
    if (typeof payload.iat !== "number") return null;
    return payload.iat * 1000;
  } catch {
    return null;
  }
};

const withTimeout = async <T,>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("AUTH_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const toFriendlyAuthError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return "Falha de conexao. Verifique sua internet e tente novamente.";
  }
  if (normalized.includes("auth_timeout")) {
    return "Tempo esgotado ao validar sessao. Tente novamente.";
  }
  if (normalized.includes("jwt")) {
    return "Erro de autenticacao da sessao. Faca login novamente.";
  }
  return message || "Erro ao autenticar.";
};

const isMissingForceReauthColumnError = (error: { message?: string } | null) => {
  const message = (error?.message ?? "").toLowerCase();
  return message.includes("force_reauth_after") && message.includes("column");
};

const isAuthSessionError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("jwt") ||
    normalized.includes("invalid token") ||
    normalized.includes("refresh token") ||
    normalized.includes("session not found") ||
    normalized.includes("session invalida") ||
    normalized.includes("not authenticated") ||
    normalized.includes("401")
  );
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (activeSession: Session | null) => {
    if (!activeSession) {
      setProfile(null);
      setProfileError(null);
      return;
    }

    try {
      const primary = await supabase
        .from("profiles")
        .select(PROFILE_SELECT_WITH_FORCE_REAUTH)
        .eq("user_id", activeSession.user.id)
        .single();

      let data = primary.data as Profile | null;
      let error = primary.error;

      if (error && isMissingForceReauthColumnError(error)) {
        const fallback = await supabase
          .from("profiles")
          .select(PROFILE_SELECT_FALLBACK)
          .eq("user_id", activeSession.user.id)
          .single();
        data = fallback.data
          ? ({ ...(fallback.data as Omit<Profile, "force_reauth_after">), force_reauth_after: null } as Profile)
          : null;
        error = fallback.error;
      }

      if (error || !data) {
        if (error && isAuthSessionError(error.message ?? "")) {
          try {
            await supabase.auth.signOut({ scope: "local" });
          } catch {
            // ignore
          }
          setSession(null);
          setProfile(null);
          setProfileError(null);
          return;
        }
        setProfile((current) => (current?.user_id === activeSession.user.id ? current : null));
        setProfileError(PROFILE_LOAD_FRIENDLY_ERROR_MESSAGE);
        return;
      }

      const resolvedProfile = data;
      const forceReauthAt = resolvedProfile.force_reauth_after
        ? Date.parse(resolvedProfile.force_reauth_after)
        : Number.NaN;
      const sessionIssuedAt = parseJwtIssuedAtMs(activeSession.access_token);
      const shouldForceSignOut = Number.isFinite(forceReauthAt) && (!sessionIssuedAt || sessionIssuedAt < forceReauthAt);

      if (shouldForceSignOut) {
        await supabase.auth.signOut();
        setProfile(null);
        setProfileError(null);
        return;
      }

      setProfile(resolvedProfile);
      setProfileError(null);
    } catch (error) {
      console.error("Erro ao carregar perfil:", error);
      const message = error instanceof Error ? error.message : String(error ?? "");
      if (isAuthSessionError(message)) {
        try {
          await supabase.auth.signOut({ scope: "local" });
        } catch {
          // ignore
        }
        setSession(null);
        setProfile(null);
        setProfileError(null);
        return;
      }
      setProfile((current) => (current?.user_id === activeSession.user.id ? current : null));
      setProfileError(PROFILE_LOAD_FRIENDLY_ERROR_MESSAGE);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const initializeAuth = async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), AUTH_REQUEST_TIMEOUT_MS);
        if (!isMounted) return;
        const activeSession = data.session ?? null;
        setSession(activeSession);
        await fetchProfile(activeSession);
      } catch (error) {
        console.error("Erro ao inicializar autenticacao:", error);
        if (!isMounted) return;
        setSession(null);
        setProfile(null);
        setProfileError(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void initializeAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((_, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession);
      setLoading(true);
      void fetchProfile(nextSession)
        .catch((error) => {
          console.error("Erro ao atualizar perfil apos evento de auth:", error);
        })
        .finally(() => {
          if (isMounted) setLoading(false);
        });
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.access_token) return;
    const intervalId = window.setInterval(() => {
      void fetchProfile(session);
    }, PROFILE_SYNC_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [session?.access_token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      profileError,
      role: profile?.role ?? null,
      loading,
      signIn: async (email, password) => {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          return { error: "Sem conexao com a internet. Conecte-se e tente novamente." };
        }
        try {
          const { error } = await withTimeout(
            supabase.auth.signInWithPassword({ email, password }),
            AUTH_REQUEST_TIMEOUT_MS,
          );
          return error ? { error: toFriendlyAuthError(error) } : {};
        } catch (error) {
          return { error: toFriendlyAuthError(error) };
        }
      },
      signOut: async () => {
        try {
          await withTimeout(supabase.auth.signOut(), AUTH_REQUEST_TIMEOUT_MS);
        } catch (error) {
          console.error("Erro no signOut global, tentando signOut local:", error);
          try {
            await supabase.auth.signOut({ scope: "local" });
          } catch (localError) {
            console.error("Erro no signOut local:", localError);
          }
        } finally {
          setSession(null);
          setProfile(null);
          setProfileError(null);
          setLoading(false);
        }
      },
      refreshProfile: async () => {
        await fetchProfile(session);
      },
    }),
    [session, profile, profileError, loading],
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
