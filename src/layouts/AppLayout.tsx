import { NavLink, Outlet } from "react-router-dom";
import { CalendarDays, LayoutDashboard, MapPin, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../types/roles";

const navItems = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Agenda", to: "/agenda", icon: CalendarDays },
  { label: "Rotas", to: "/rotas", icon: MapPin },
];

export default function AppLayout() {
  const { profile, role, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-hero-gradient">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 lg:flex-row lg:gap-6">
        <aside className="mb-6 w-full shrink-0 rounded-3xl bg-white/80 p-6 shadow-card backdrop-blur lg:mb-0 lg:w-64">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-muted">Odontoart</p>
              <h1 className="font-display text-xl text-ink">Agenda+ Rotas</h1>
            </div>
            <span className="rounded-full bg-sea/10 px-3 py-1 text-xs font-semibold text-sea">
              Interno
            </span>
          </div>

          <div className="mt-6 rounded-2xl border border-mist/60 bg-white px-4 py-3">
            <p className="text-xs text-muted">Colaborador</p>
            <p className="font-semibold text-ink">{profile?.display_name ?? "Perfil pendente"}</p>
            <p className="text-xs text-muted">{role ? ROLE_LABELS[role] : "Sem função"}</p>
          </div>

          <nav className="mt-6 flex flex-col gap-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    [
                      "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition",
                      isActive
                        ? "bg-sea text-white shadow"
                        : "text-muted hover:bg-sea/10 hover:text-sea",
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
            onClick={() => signOut()}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl border border-mist bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:border-sea/60 hover:text-sea"
          >
            <LogOut size={16} />
            Sair
          </button>
        </aside>

        <main className="flex-1 rounded-3xl bg-white/80 p-6 shadow-card backdrop-blur">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
