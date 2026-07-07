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
  is_inactive?: boolean;
  can_access_pre_cadastro: boolean;
  can_access_next_route_dashboard: boolean;
  force_reauth_after?: string | null;
  created_at: string;
};

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  profileError: string | null;
  accessDeniedMessage: string | null;
  role: UserRole | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_REQUEST_TIMEOUT_MS = 12000;
const PROFILE_REQUEST_TIMEOUT_MS = 8000;
const PROFILE_SELECT_WITH_FORCE_REAUTH =
  "id, user_id, role, display_name, nome, is_inactive, can_access_pre_cadastro, can_access_next_route_dashboard, force_reauth_after, created_at";
const PROFILE_SELECT_FALLBACK =
  "id, user_id, role, display_name, nome, is_inactive, can_access_pre_cadastro, can_access_next_route_dashboard, created_at";
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
  if (
    normalized.includes("504") ||
    normalized.includes("gateway timeout") ||
    normalized.includes("upstream request timeout")
  ) {
    return "Servico de autenticacao indisponivel no momento (timeout no servidor). Tente novamente em instantes.";
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

const isInvalidRefreshTokenError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("invalid refresh token") ||
    normalized.includes("refresh token not found") ||
    normalized.includes("session not found") ||
    normalized.includes("refresh token")
  );
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (activeSession: Session | null) => {
    if (!activeSession) {
      setProfile(null);
      setProfileError(null);
      setAccessDeniedMessage(null);
      return;
    }

    try {
      const primaryWithTimeout = await withTimeout(
        supabase
          .from("profiles")
          .select(PROFILE_SELECT_WITH_FORCE_REAUTH)
          .eq("user_id", activeSession.user.id)
          .limit(1),
        PROFILE_REQUEST_TIMEOUT_MS,
      );

      let data: Profile | null = ((primaryWithTimeout.data as Profile[] | null) ?? [])[0] ?? null;
      let error = primaryWithTimeout.error;

      if (error && isMissingForceReauthColumnError(error)) {
        const fallbackWithTimeout = await withTimeout(
          supabase
            .from("profiles")
            .select(PROFILE_SELECT_FALLBACK)
            .eq("user_id", activeSession.user.id)
            .limit(1),
          PROFILE_REQUEST_TIMEOUT_MS,
        );
        const fallbackRow = ((fallbackWithTimeout.data as Omit<Profile, "force_reauth_after">[] | null) ?? [])[0] ?? null;
        data = fallbackRow
          ? ({ ...fallbackRow, force_reauth_after: null } as Profile)
          : null;
        error = fallbackWithTimeout.error;
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
          setAccessDeniedMessage(null);
          return;
        }

        // Fallback for users without profile row: if refresh token was revoked by an access reset,
        // force local sign-out immediately instead of waiting for access token expiration.
        try {
          const { error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError && isInvalidRefreshTokenError(refreshError.message ?? "")) {
            try {
              await supabase.auth.signOut({ scope: "local" });
            } catch {
              // ignore
            }
            setSession(null);
            setProfile(null);
            setProfileError(null);
            setAccessDeniedMessage(null);
            return;
          }
        } catch {
          // ignore refresh fallback failures and keep friendly profile error below
        }

        // Preserve last known profile on transient sync errors.
        setProfile((prev) => prev);
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
        setAccessDeniedMessage(null);
        return;
      }

      if (resolvedProfile.is_inactive) {
        try {
          await supabase.auth.signOut({ scope: "local" });
        } catch {
          // ignore
        }
        setSession(null);
        setProfile(null);
        setProfileError(null);
        setAccessDeniedMessage("Usuario inativo. Entre em contato com o administrador.");
        return;
      }

      setProfile(resolvedProfile);
      setProfileError(null);
      setAccessDeniedMessage(null);
    } catch (error) {
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
          setAccessDeniedMessage(null);
          return;
        }
      // Preserve last known profile on transient sync errors.
      setProfile((prev) => prev);
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
        if (!isMounted) return;
        setSession(null);
        setProfile(null);
        setProfileError(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void initializeAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession);
      const shouldBlockUi = event === "SIGNED_IN" || event === "INITIAL_SESSION";
      if (shouldBlockUi) setLoading(true);
      void fetchProfile(nextSession)
        .catch((error) => {
        })
        .finally(() => {
          if (isMounted && shouldBlockUi) setLoading(false);
        });
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
      profileError,
      accessDeniedMessage,
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
          try {
            await supabase.auth.signOut({ scope: "local" });
          } catch (localError) {
          }
        } finally {
          setSession(null);
          setProfile(null);
          setProfileError(null);
          setAccessDeniedMessage(null);
          setLoading(false);
        }
      },
      refreshProfile: async () => {
        await fetchProfile(session);
      },
    }),
    [session, profile, profileError, accessDeniedMessage, loading],
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
