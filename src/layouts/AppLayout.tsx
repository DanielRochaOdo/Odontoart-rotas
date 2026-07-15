import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  LogOut,
  CalendarCheck,
  Settings,
  MapPin,
  Building2,
  Menu,
  X,
  ClipboardCheck,
  Sun,
  Moon,
  History,
  ChartNoAxesCombined,
  ListChecks,
  Megaphone,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../types/roles";
import PwaInstallHint from "../components/PwaInstallHint";
import { useAutoFormDraftPersistence } from "../hooks/useAutoFormDraftPersistence";
import { useLocalStorageState } from "../hooks/useLocalStorageState";
import FilaAlertsModal from "../components/FilaAlertsModal";
import NotificationsBell from "../components/notifications/NotificationsBell";

type NavItem = {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  roles?: Array<"SUPERVISOR" | "ASSISTENTE" | "VENDEDOR">;
};

const navItems: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, roles: ["SUPERVISOR", "ASSISTENTE", "VENDEDOR"] },
  { label: "Rotas", to: "/agenda", icon: MapPin, roles: ["SUPERVISOR", "ASSISTENTE"] },
  { label: "Agenda", to: "/visitas", icon: CalendarCheck, roles: ["SUPERVISOR", "ASSISTENTE", "VENDEDOR"] },
  { label: "Aceite digital", to: "/aceite-digital", icon: ClipboardCheck, roles: ["VENDEDOR"] },
  { label: "Empresas", to: "/clientes", icon: Building2, roles: ["SUPERVISOR", "ASSISTENTE"] },
  { label: "Fila", to: "/fila", icon: ListChecks, roles: ["SUPERVISOR", "ASSISTENTE"] },
  { label: "KPI", to: "/kpi", icon: ChartNoAxesCombined, roles: ["SUPERVISOR", "ASSISTENTE"] },
  { label: "Logs", to: "/logs", icon: History, roles: ["SUPERVISOR"] },
  { label: "Novidades", to: "/novidades", icon: Megaphone, roles: ["SUPERVISOR", "ASSISTENTE", "VENDEDOR"] },
  { label: "Configuracoes", to: "/configuracoes", icon: Settings, roles: ["SUPERVISOR"] },
];

const ANDROID_ASSETS_HOST = "appassets.androidplatform.net";
const isAndroidAppHost = () => {
  if (typeof window === "undefined") return false;
  return window.location.hostname === ANDROID_ASSETS_HOST;
};

export default function AppLayout() {
  const { profile, profileError, role, session, signOut } = useAuth();
  useAutoFormDraftPersistence(session?.user?.id ?? "anonymous");
  const [theme, setTheme] = useLocalStorageState<"light" | "dark">("theme", "light", {
    parse: (raw) => (raw === "dark" ? "dark" : "light"),
    serialize: (value) => value,
  });
  const [collapsed, setCollapsed] = useLocalStorageState<boolean>("sidebarCollapsed", true, {
    parse: (raw) => raw === "true",
    serialize: (value) => String(value),
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [vendorSettingsOpen, setVendorSettingsOpen] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    document.body.classList.toggle("dark", theme === "dark");
    root.style.setProperty("--sidebar-width", collapsed ? "84px" : "272px");
  }, [theme, collapsed]);
  const isVendor = role === "VENDEDOR";
  const enableVendorSettingsInSidebar = isVendor && isAndroidAppHost();
  const effectiveVendorSettingsOpen = enableVendorSettingsInSidebar && vendorSettingsOpen;

  const initials = useMemo(() => {
    const name = profile?.nome ?? profile?.display_name ?? "Odontoart";
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }, [profile?.display_name, profile?.nome]);
  const fallbackDisplayName = useMemo(() => {
    const metadata = session?.user?.user_metadata as
      | { nome?: string; display_name?: string; name?: string }
      | undefined;
    const fromMetadata = metadata?.nome ?? metadata?.display_name ?? metadata?.name;
    if (fromMetadata && typeof fromMetadata === "string" && fromMetadata.trim()) {
      return fromMetadata.trim();
    }
    const email = session?.user?.email ?? "";
    if (!email) return null;
    return email.split("@")[0] ?? null;
  }, [session?.user?.email, session?.user?.user_metadata]);
  const resolvedDisplayName = profile?.nome ?? profile?.display_name ?? fallbackDisplayName ?? "Perfil pendente";
  const visibleNavItems = useMemo(
    () =>
      navItems.filter((item) => {
        if (item.roles && (!role || !item.roles.includes(role))) return false;
        return true;
      }),
    [role],
  );
  const isDarkTheme = theme === "dark";

  return (
    <div className="min-h-screen bg-hero-gradient overflow-x-hidden text-ink">
      <div className="md:hidden">
        <div className="flex items-center justify-between border-b border-sea/15 bg-white/90 px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sea/15 text-sea">
              <MapPin size={16} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted">Odontoart</p>
              <h1 className="font-display text-base text-ink">Agenda+</h1>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-full border border-sea/20 bg-white/80 p-2 text-sea hover:border-sea"
            aria-label="Abrir menu"
          >
            <Menu size={18} />
          </button>
          <NotificationsBell />
        </div>
        <div className="px-4 pt-3">
          <PwaInstallHint />
        </div>
      </div>

      <div className="flex min-h-screen w-full flex-col gap-4 px-4 py-4 md:flex-row md:items-start md:gap-6 md:px-0 md:py-6">
        <aside
          className={[
            "normal-case mb-6 hidden shrink-0 border-r md:fixed md:bottom-0 md:left-0 md:top-0 md:z-30 md:mb-0 md:flex md:flex-col md:overflow-y-auto md:overflow-x-hidden no-scrollbar",
            isDarkTheme
              ? "border-mist/50 bg-paper/95 text-ink shadow-card backdrop-blur-xl"
              : "border-sea/20 bg-gradient-to-b from-white via-white to-sand/60 text-ink shadow-card",
            collapsed ? "md:w-[84px]" : "md:w-[272px]",
          ].join(" ")}
        >
          <div className="flex h-full flex-col">
            {collapsed ? (
              <>
                <div className={["flex h-16 items-center justify-center border-b", isDarkTheme ? "border-mist/60" : "border-sea/20"].join(" ")}>
                  <div className={["flex h-9 w-9 items-center justify-center rounded-xl", isDarkTheme ? "border border-sea/30 bg-sea/10 text-seaLight" : "bg-sea/15 text-sea"].join(" ")}>
                    <MapPin size={16} />
                  </div>
                </div>
                <div className={["flex h-14 items-center justify-center border-b", isDarkTheme ? "border-mist/60" : "border-sea/20"].join(" ")}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((prev) => !prev)}
                    className={[
                      "p-2 transition",
                      isDarkTheme
                        ? "rounded-lg border border-mist/60 bg-white/5 text-ink/70 hover:border-sea/35 hover:text-seaLight"
                        : "rounded-full border border-sea/20 bg-white/80 text-sea hover:border-sea",
                    ].join(" ")}
                    aria-label="Expandir menu"
                  >
                    <Menu size={16} />
                  </button>
                </div>
              </>
            ) : (
              <div className={["flex h-16 items-center justify-between border-b px-4", isDarkTheme ? "border-mist/60" : "border-sea/20"].join(" ")}>
                <div className="flex items-center gap-3">
                  <div className={["flex h-9 w-9 items-center justify-center rounded-xl", isDarkTheme ? "border border-sea/30 bg-sea/10 text-seaLight" : "bg-sea/15 text-sea"].join(" ")}>
                    <MapPin size={16} />
                  </div>
                  <p className="truncate font-display text-[1.02rem] font-semibold tracking-tight text-ink">
                    Odontoart Rotas
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => !prev)}
                  className={[
                    "p-2 transition",
                    isDarkTheme
                      ? "rounded-lg border border-mist/60 bg-white/5 text-ink/70 hover:border-sea/35 hover:text-seaLight"
                      : "rounded-full border border-sea/20 bg-white/80 text-sea hover:border-sea",
                  ].join(" ")}
                  aria-label="Recolher menu"
                >
                  <Menu size={16} />
                </button>
              </div>
            )}

            <nav className={["flex-1 py-4", collapsed ? "px-2" : "px-3"].join(" ")}>
              <div className={["flex flex-col", collapsed ? "items-center gap-2" : "gap-1.5"].join(" ")}>
                {visibleNavItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === "/"}
                        onClick={() => setVendorSettingsOpen(false)}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          [
                            "group relative flex items-center transition",
                            collapsed
                              ? "h-11 w-11 justify-center rounded-2xl"
                              : "w-full gap-3 rounded-xl px-3 py-2.5 text-[1.05rem] font-semibold",
                            isActive
                              ? collapsed
                                ? isDarkTheme
                                  ? "bg-sea/15 text-seaLight"
                                  : "bg-sea/12 text-sea"
                                : isDarkTheme
                                  ? "border border-sea/30 bg-sea/10 text-seaLight"
                                  : "border border-sea/25 bg-sea/12 text-sea"
                              : collapsed
                                ? isDarkTheme
                                  ? "text-ink/70 hover:bg-white/8 hover:text-ink"
                                  : "text-ink/70 hover:bg-sea/10 hover:text-sea"
                                : isDarkTheme
                                  ? "text-ink/70 hover:bg-white/8 hover:text-ink"
                                  : "text-ink/70 hover:bg-sea/10 hover:text-sea",
                          ].join(" ")
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {collapsed && isActive ? (
                              <span className={["absolute -left-2 h-7 w-1 rounded-full", isDarkTheme ? "bg-seaLight" : "bg-sea"].join(" ")} />
                            ) : null}
                            <Icon size={18} className={isActive ? (isDarkTheme ? "text-seaLight" : "text-sea") : ""} />
                            {!collapsed ? <span className="min-w-0 truncate">{item.label}</span> : null}
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                {enableVendorSettingsInSidebar ? (
                  <button
                    type="button"
                    onClick={() => setVendorSettingsOpen((prev) => !prev)}
                    title={collapsed ? "Configuracoes" : undefined}
                    className={[
                      "group relative flex items-center transition",
                      collapsed
                        ? "h-11 w-11 justify-center rounded-2xl"
                        : "w-full gap-3 rounded-xl px-3 py-2.5 text-[1.05rem] font-semibold",
                      effectiveVendorSettingsOpen
                        ? collapsed
                          ? isDarkTheme
                            ? "bg-sea/15 text-seaLight"
                            : "bg-sea/12 text-sea"
                          : isDarkTheme
                            ? "border border-sea/30 bg-sea/10 text-seaLight"
                            : "border border-sea/25 bg-sea/12 text-sea"
                        : collapsed
                          ? isDarkTheme
                            ? "text-ink/70 hover:bg-white/8 hover:text-ink"
                            : "text-ink/70 hover:bg-sea/10 hover:text-sea"
                          : isDarkTheme
                            ? "text-ink/70 hover:bg-white/8 hover:text-ink"
                            : "text-ink/70 hover:bg-sea/10 hover:text-sea",
                    ].join(" ")}
                    aria-label="Configuracoes"
                  >
                    {collapsed && effectiveVendorSettingsOpen ? (
                      <span className={["absolute -left-2 h-7 w-1 rounded-full", isDarkTheme ? "bg-seaLight" : "bg-sea"].join(" ")} />
                    ) : null}
                    <Settings size={18} className={effectiveVendorSettingsOpen ? (isDarkTheme ? "text-seaLight" : "text-sea") : ""} />
                    {!collapsed ? <span className="min-w-0 truncate">Configuracoes</span> : null}
                  </button>
                ) : null}
              </div>
            </nav>

            <div className={["mt-auto border-t p-3", isDarkTheme ? "border-mist/60" : "border-sea/20"].join(" ")}>
              <div className="mb-3 flex justify-end">
                <NotificationsBell />
              </div>
              {enableVendorSettingsInSidebar ? (
                effectiveVendorSettingsOpen ? (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                      className={[
                        "inline-flex h-10 w-full items-center justify-center rounded-xl border transition",
                        isDarkTheme
                          ? "border-mist/60 bg-white/5 text-ink/80 hover:border-sea/35 hover:text-seaLight"
                          : "border-sea/30 bg-white/90 text-ink hover:border-sea hover:text-sea",
                      ].join(" ")}
                      aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
                    >
                      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                      {!collapsed ? <span className="ml-2 text-sm font-semibold">{theme === "dark" ? "Modo claro" : "Modo escuro"}</span> : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => signOut()}
                      className={[
                        "inline-flex h-10 w-full items-center justify-center rounded-xl border transition",
                        isDarkTheme
                          ? "border-mist/60 bg-white/5 text-ink/80 hover:border-sea/35 hover:text-seaLight"
                          : "border-sea/30 bg-white/90 text-ink hover:border-sea hover:text-sea",
                      ].join(" ")}
                      aria-label="Sair"
                    >
                      <LogOut size={15} />
                      {!collapsed ? <span className="ml-2 text-sm font-semibold">Sair</span> : null}
                    </button>
                  </div>
                ) : null
              ) : collapsed ? (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                    className={[
                      "inline-flex h-10 w-full items-center justify-center rounded-xl border transition",
                      isDarkTheme
                        ? "border-mist/60 bg-white/5 text-ink/80 hover:border-sea/35 hover:text-seaLight"
                        : "border-sea/30 bg-white/90 text-ink hover:border-sea hover:text-sea",
                    ].join(" ")}
                    aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
                  >
                    {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => signOut()}
                    className={[
                      "inline-flex h-10 w-full items-center justify-center rounded-xl border transition",
                      isDarkTheme
                        ? "border-mist/60 bg-white/5 text-ink/80 hover:border-sea/35 hover:text-seaLight"
                        : "border-sea/30 bg-white/90 text-ink hover:border-sea hover:text-sea",
                    ].join(" ")}
                    aria-label="Sair"
                  >
                    <LogOut size={15} />
                  </button>
                </div>
              ) : (
                <>
                  <div className={["mb-3 flex items-center gap-3 rounded-xl border px-3 py-2.5", isDarkTheme ? "border-mist/60 bg-white/5" : "border-sea/20 bg-sand/60"].join(" ")}>
                    <div className={["flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold", isDarkTheme ? "bg-sea/20 text-seaLight" : "bg-white text-sea"].join(" ")}>
                      {initials.slice(0, 1) || "O"}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-ink">
                        {resolvedDisplayName}
                      </p>
                      <span
                        className={[
                          "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide",
                          isDarkTheme
                            ? "border-mist/70 bg-sand/30 text-ink/80"
                            : "border-sea/25 bg-white text-ink/70",
                        ].join(" ")}
                      >
                        {role ? ROLE_LABELS[role] : "Sem função"}
                      </span>
                    </div>
                  </div>
                  {profileError ? (
                    <p
                      className={[
                        "mb-3 rounded-xl border px-3 py-2 text-xs leading-relaxed",
                        isDarkTheme
                          ? "border-amber-300/35 bg-amber-400/10 text-amber-100"
                          : "border-amber-300 bg-amber-50 text-amber-900",
                      ].join(" ")}
                    >
                      {profileError}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                      className={[
                        "inline-flex h-10 items-center justify-center rounded-xl border transition",
                        isDarkTheme
                          ? "border-mist/60 bg-white/5 text-ink/80 hover:border-sea/35 hover:text-seaLight"
                          : "border-sea/30 bg-white/90 text-ink hover:border-sea hover:text-sea",
                      ].join(" ")}
                      aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
                    >
                      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => signOut()}
                      className={[
                        "inline-flex h-10 items-center justify-center rounded-xl border transition",
                        isDarkTheme
                          ? "border-mist/60 bg-white/5 text-ink/80 hover:border-sea/35 hover:text-seaLight"
                          : "border-sea/30 bg-white/90 text-ink hover:border-sea hover:text-sea",
                      ].join(" ")}
                      aria-label="Sair"
                    >
                      <LogOut size={15} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </aside>

        <main
          id="app-content-root"
          className={[
            "min-w-0 flex-1 rounded-2xl border border-sea/15 bg-white/95 p-4 shadow-card transition-[margin] duration-200 md:mr-6 md:rounded-3xl md:p-6",
            collapsed ? "md:ml-[96px]" : "md:ml-[288px]",
          ].join(" ")}
        >
          <Outlet />
        </main>
      </div>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative flex h-full w-72 max-w-full flex-col overflow-y-auto bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sea/15 text-sea">
                  <MapPin size={18} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-muted">Odontoart</p>
                  <h1 className="font-display text-lg text-ink">Agenda+</h1>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-full border border-sea/20 bg-white/80 p-1 text-sea hover:border-sea"
                aria-label="Fechar menu"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-3 flex justify-end">
              <NotificationsBell />
            </div>

            <div className="mt-5 rounded-2xl border border-sea/20 bg-sand/60 px-4 py-3">
              <p className="text-xs text-ink/70">Colaborador</p>
              <p className="font-semibold text-ink">{resolvedDisplayName}</p>
              <p className="text-xs text-ink/60">{role ? ROLE_LABELS[role] : "Sem função"}</p>
            </div>
            {profileError ? (
              <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                {profileError}
              </p>
            ) : null}

            <nav className="mt-6 flex flex-col gap-2">
              {visibleNavItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setVendorSettingsOpen(false);
                      }}
                      className={({ isActive }) =>
                        [
                          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition",
                          isActive
                            ? "bg-sea text-white shadow-lg shadow-sea/25"
                            : "bg-white/70 text-ink/70 hover:bg-sea/10 hover:text-sea",
                        ].join(" ")
                      }
                    >
                      <Icon size={18} />
                      {item.label}
                    </NavLink>
                  );
                })}
              {enableVendorSettingsInSidebar ? (
                <button
                  type="button"
                  onClick={() => setVendorSettingsOpen((prev) => !prev)}
                  className={[
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition",
                    effectiveVendorSettingsOpen
                      ? "bg-sea text-white shadow-lg shadow-sea/25"
                      : "bg-white/70 text-ink/70 hover:bg-sea/10 hover:text-sea",
                  ].join(" ")}
                  aria-label="Configuracoes"
                >
                  <Settings size={18} />
                  Configuracoes
                </button>
              ) : null}
            </nav>

            <div className="mt-auto pt-6">
              {enableVendorSettingsInSidebar ? (
                effectiveVendorSettingsOpen ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-sea/30 bg-white/90 px-3 py-2 text-sm font-semibold text-ink transition hover:border-sea hover:text-sea"
                    >
                      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                      {theme === "dark" ? "Modo claro" : "Modo escuro"}
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        setMobileMenuOpen(false);
                        setVendorSettingsOpen(false);
                        await signOut();
                      }}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-sea/30 bg-white/90 px-3 py-2 text-sm font-semibold text-ink transition hover:border-sea hover:text-sea"
                    >
                      <LogOut size={16} />
                      Sair
                    </button>
                  </>
                ) : null
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-sea/30 bg-white/90 px-3 py-2 text-sm font-semibold text-ink transition hover:border-sea hover:text-sea"
                  >
                    {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                    {theme === "dark" ? "Modo claro" : "Modo escuro"}
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      setMobileMenuOpen(false);
                      await signOut();
                    }}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-sea/30 bg-white/90 px-3 py-2 text-sm font-semibold text-ink transition hover:border-sea hover:text-sea"
                  >
                    <LogOut size={16} />
                    Sair
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <FilaAlertsModal />
    </div>
  );
}
