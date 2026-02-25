import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  CalendarDays,
  LayoutDashboard,
  LogOut,
  ChevronRight,
  ChevronLeft,
  CalendarCheck,
  Settings,
  MapPin,
  Building2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../types/roles";

type NavItem = {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  roles?: Array<"SUPERVISOR" | "ASSISTENTE" | "VENDEDOR">;
};

const navItems: NavItem[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard, roles: ["SUPERVISOR", "ASSISTENTE", "VENDEDOR"] },
  { label: "Agenda", to: "/agenda", icon: CalendarDays, roles: ["SUPERVISOR", "ASSISTENTE"] },
  { label: "Visitas", to: "/visitas", icon: CalendarCheck, roles: ["SUPERVISOR", "ASSISTENTE", "VENDEDOR"] },
  { label: "Clientes", to: "/clientes", icon: Building2, roles: ["SUPERVISOR", "ASSISTENTE"] },
  { label: "Configuracoes", to: "/configuracoes", icon: Settings, roles: ["SUPERVISOR"] },
];

export default function AppLayout() {
  const { profile, role, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem("sidebarCollapsed");
      return stored ? stored === "true" : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("sidebarCollapsed", String(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed]);

  const initials = useMemo(() => {
    const name = profile?.display_name ?? "Odontoart";
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }, [profile?.display_name]);

  return (
    <div className="min-h-screen bg-hero-gradient overflow-x-hidden text-ink">
      <div className="flex min-h-screen w-full flex-col py-6 md:flex-row md:items-start md:gap-6 md:px-0">
        <aside
          className={[
            "mb-6 w-full shrink-0 rounded-none border border-sea/20 bg-gradient-to-b from-white via-white to-sand/60 shadow-card md:mb-0 md:sticky md:top-6 md:rounded-r-3xl md:border-l-0",
            collapsed ? "p-4 md:w-20 md:py-6" : "p-5 md:w-56",
          ].join(" ")}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => setCollapsed((prev) => !prev)}
                className="rounded-full border border-sea/20 bg-white/80 p-1 text-sea hover:border-sea"
                aria-label="Expandir sidebar"
              >
                <ChevronRight size={16} />
              </button>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sea/15 text-sea">
                <MapPin size={18} />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sea/15 text-sea">
                    <MapPin size={18} />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-muted">Odontoart</p>
                    <h1 className="font-display text-xl text-ink">Agenda+</h1>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => !prev)}
                  className="rounded-full border border-sea/20 bg-white/80 p-1 text-sea hover:border-sea"
                  aria-label="Recolher sidebar"
                >
                  <ChevronLeft size={16} />
                </button>
              </div>
            </div>
          )}

          {collapsed ? (
            <div className="mt-5 flex flex-col items-center gap-2 rounded-2xl border border-sea/20 bg-sand/60 px-3 py-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-semibold text-sea">
                {initials}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-sea/20 bg-sand/60 px-4 py-3">
              <p className="text-xs text-ink/70">Colaborador</p>
              <p className="font-semibold text-ink">{profile?.display_name ?? "Perfil pendente"}</p>
              <p className="text-xs text-ink/60">{role ? ROLE_LABELS[role] : "Sem função"}</p>
            </div>
          )}

          <nav className={["mt-6 flex flex-col gap-2", collapsed ? "items-center" : ""].join(" ")}>
            {navItems
              .filter((item) => !item.roles || (role ? item.roles.includes(role) : false))
              .map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    [
                      "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition",
                      collapsed ? "w-11 justify-center px-2" : "",
                      isActive
                        ? "bg-sea text-white shadow-lg shadow-sea/25"
                        : "bg-white/70 text-ink/70 hover:bg-sea/10 hover:text-sea",
                    ].join(" ")
                  }
                  title={collapsed ? item.label : undefined}
                >
                  <Icon size={18} />
                  {!collapsed && item.label}
                </NavLink>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={() => signOut()}
            className={[
              "mt-6 flex items-center justify-center gap-2 rounded-xl border border-sea/30 bg-white/90 px-3 py-2 text-sm font-semibold text-ink transition hover:border-sea hover:text-sea",
              collapsed ? "w-11 self-center px-2" : "w-full",
            ].join(" ")}
          >
            <LogOut size={16} />
            {!collapsed && "Sair"}
          </button>
        </aside>

        <main className="min-w-0 flex-1 rounded-3xl border border-sea/15 bg-white/95 p-6 shadow-card md:mr-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
