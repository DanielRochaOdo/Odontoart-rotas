import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  LogOut,
  CalendarCheck,
  Settings,
  MapPin,
  MapPinPlus,
  Building2,
  Menu,
  X,
  CheckSquare,
  Sun,
  Moon,
  History,
  ChartNoAxesCombined,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../types/roles";
import PwaInstallHint from "../components/PwaInstallHint";
import { useAutoFormDraftPersistence } from "../hooks/useAutoFormDraftPersistence";

type NavItem = {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  roles?: Array<"SUPERVISOR" | "ASSISTENTE" | "VENDEDOR">;
  requiresVendorPreCadastroAccess?: boolean;
};

const navItems: NavItem[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard, roles: ["SUPERVISOR", "ASSISTENTE", "VENDEDOR"] },
  { label: "Rotas", to: "/agenda", icon: MapPin, roles: ["SUPERVISOR", "ASSISTENTE"] },
  { label: "Agenda", to: "/visitas", icon: CalendarCheck, roles: ["SUPERVISOR", "ASSISTENTE", "VENDEDOR"] },
  { label: "Aceite digital", to: "/aceite-digital", icon: CheckSquare, roles: ["VENDEDOR"] },
  {
    label: "Pre-cadastro",
    to: "/pre-cadastro",
    icon: MapPinPlus,
    roles: ["SUPERVISOR", "ASSISTENTE", "VENDEDOR"],
    requiresVendorPreCadastroAccess: true,
  },
  { label: "Empresas", to: "/clientes", icon: Building2, roles: ["SUPERVISOR", "ASSISTENTE"] },
  { label: "KPI", to: "/kpi", icon: ChartNoAxesCombined, roles: ["SUPERVISOR", "ASSISTENTE"] },
  { label: "Logs", to: "/logs", icon: History, roles: ["SUPERVISOR"] },
  { label: "Configuracoes", to: "/configuracoes", icon: Settings, roles: ["SUPERVISOR"] },
];

export default function AppLayout() {
  const { profile, role, signOut } = useAuth();
  useAutoFormDraftPersistence();
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") return stored;
      return "light";
    } catch {
      return "light";
    }
  });
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem("sidebarCollapsed");
      return stored ? stored === "true" : true;
    } catch {
      return true;
    }
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("sidebarCollapsed", String(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    document.body.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const initials = useMemo(() => {
    const name = profile?.nome ?? profile?.display_name ?? "Odontoart";
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }, [profile?.display_name, profile?.nome]);
  const visibleNavItems = useMemo(
    () =>
      navItems.filter((item) => {
        if (item.roles && (!role || !item.roles.includes(role))) return false;
        if (item.requiresVendorPreCadastroAccess && role === "VENDEDOR" && !profile?.can_access_pre_cadastro) {
          return false;
        }
        return true;
      }),
    [profile?.can_access_pre_cadastro, role],
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
              ? "border-[#1bd4bf]/12 bg-[#030910]/95 text-slate-100 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl"
              : "border-sea/20 bg-gradient-to-b from-white via-white to-sand/60 text-ink shadow-card",
            collapsed ? "md:w-[84px]" : "md:w-[272px]",
          ].join(" ")}
        >
          <div className="flex h-full flex-col">
            {collapsed ? (
              <>
                <div className={["flex h-16 items-center justify-center border-b", isDarkTheme ? "border-white/10" : "border-sea/20"].join(" ")}>
                  <div className={["flex h-9 w-9 items-center justify-center rounded-xl", isDarkTheme ? "border border-[#21d6c0]/45 bg-[#071922] text-[#21d6c0]" : "bg-sea/15 text-sea"].join(" ")}>
                    <MapPin size={16} />
                  </div>
                </div>
                <div className={["flex h-14 items-center justify-center border-b", isDarkTheme ? "border-white/10" : "border-sea/20"].join(" ")}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((prev) => !prev)}
                    className={[
                      "p-2 transition",
                      isDarkTheme
                        ? "rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:border-[#21d6c0]/40 hover:text-[#6ff3dc]"
                        : "rounded-full border border-sea/20 bg-white/80 text-sea hover:border-sea",
                    ].join(" ")}
                    aria-label="Expandir menu"
                  >
                    <Menu size={16} />
                  </button>
                </div>
              </>
            ) : (
              <div className={["flex h-16 items-center justify-between border-b px-4", isDarkTheme ? "border-white/10" : "border-sea/20"].join(" ")}>
                <div className="flex items-center gap-3">
                  <div className={["flex h-9 w-9 items-center justify-center rounded-xl", isDarkTheme ? "border border-[#21d6c0]/45 bg-[#071922] text-[#21d6c0]" : "bg-sea/15 text-sea"].join(" ")}>
                    <MapPin size={16} />
                  </div>
                  <p className={["truncate font-display text-[1.02rem] font-semibold tracking-tight", isDarkTheme ? "text-slate-100" : "text-ink"].join(" ")}>
                    Odontoart Rotas
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => !prev)}
                  className={[
                    "p-2 transition",
                    isDarkTheme
                      ? "rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:border-[#21d6c0]/40 hover:text-[#6ff3dc]"
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
                                  ? "bg-[#0b2d34] text-[#8bf6e1]"
                                  : "bg-sea/12 text-sea"
                                : isDarkTheme
                                  ? "border border-[#21d6c0]/15 bg-gradient-to-r from-[#0d3a38] to-[#0b2b2d] text-[#bafcf0]"
                                  : "border border-sea/25 bg-sea/12 text-sea"
                              : collapsed
                                ? isDarkTheme
                                  ? "text-slate-300 hover:bg-white/8 hover:text-slate-100"
                                  : "text-ink/70 hover:bg-sea/10 hover:text-sea"
                                : isDarkTheme
                                  ? "text-slate-300 hover:bg-white/8 hover:text-slate-100"
                                  : "text-ink/70 hover:bg-sea/10 hover:text-sea",
                          ].join(" ")
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {collapsed && isActive ? (
                              <span className={["absolute -left-2 h-7 w-1 rounded-full", isDarkTheme ? "bg-[#21d6c0]" : "bg-sea"].join(" ")} />
                            ) : null}
                            <Icon size={18} className={isActive ? (isDarkTheme ? "text-[#8bf6e1]" : "text-sea") : ""} />
                            {!collapsed ? <span className="min-w-0 truncate">{item.label}</span> : null}
                          </>
                        )}
                      </NavLink>
                    );
                  })}
              </div>
            </nav>

            <div className={["mt-auto border-t p-3", isDarkTheme ? "border-white/10" : "border-sea/20"].join(" ")}>
              {collapsed ? (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                    className={[
                      "inline-flex h-10 w-full items-center justify-center rounded-xl border transition",
                      isDarkTheme
                        ? "border-white/10 bg-white/3 text-slate-200 hover:border-[#21d6c0]/35 hover:text-[#9afae8]"
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
                        ? "border-white/10 bg-white/3 text-slate-200 hover:border-[#21d6c0]/35 hover:text-[#9afae8]"
                        : "border-sea/30 bg-white/90 text-ink hover:border-sea hover:text-sea",
                    ].join(" ")}
                    aria-label="Sair"
                  >
                    <LogOut size={15} />
                  </button>
                </div>
              ) : (
                <>
                  <div className={["mb-3 flex items-center gap-3 rounded-xl border px-3 py-2.5", isDarkTheme ? "border-white/10 bg-white/4" : "border-sea/20 bg-sand/60"].join(" ")}>
                    <div className={["flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold", isDarkTheme ? "bg-[#0e4a45] text-[#9df8e9]" : "bg-white text-sea"].join(" ")}>
                      {initials.slice(0, 1) || "O"}
                    </div>
                    <div className="min-w-0">
                      <p className={["truncate text-base font-semibold", isDarkTheme ? "text-slate-100" : "text-ink"].join(" ")}>
                        {profile?.nome ?? profile?.display_name ?? "Perfil pendente"}
                      </p>
                      <span
                        className={[
                          "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide",
                          isDarkTheme
                            ? "border-[#c8b07a]/55 bg-[#2d2517] text-[#f7dfaa]"
                            : "border-sea/25 bg-white text-ink/70",
                        ].join(" ")}
                      >
                        {role ? ROLE_LABELS[role] : "Sem função"}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                      className={[
                        "inline-flex h-10 items-center justify-center rounded-xl border transition",
                        isDarkTheme
                          ? "border-white/10 bg-white/3 text-slate-200 hover:border-[#21d6c0]/35 hover:text-[#9afae8]"
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
                          ? "border-white/10 bg-white/3 text-slate-200 hover:border-[#21d6c0]/35 hover:text-[#9afae8]"
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
          <div className="relative h-full w-72 max-w-full bg-white p-5 shadow-2xl">
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

            <div className="mt-5 rounded-2xl border border-sea/20 bg-sand/60 px-4 py-3">
              <p className="text-xs text-ink/70">Colaborador</p>
              <p className="font-semibold text-ink">{profile?.nome ?? profile?.display_name ?? "Perfil pendente"}</p>
              <p className="text-xs text-ink/60">{role ? ROLE_LABELS[role] : "Sem função"}</p>
            </div>

            <nav className="mt-6 flex flex-col gap-2">
              {visibleNavItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      onClick={() => setMobileMenuOpen(false)}
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
            </nav>

            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-sea/30 bg-white/90 px-3 py-2 text-sm font-semibold text-ink transition hover:border-sea hover:text-sea"
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
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-sea/30 bg-white/90 px-3 py-2 text-sm font-semibold text-ink transition hover:border-sea hover:text-sea"
            >
              <LogOut size={16} />
              Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
