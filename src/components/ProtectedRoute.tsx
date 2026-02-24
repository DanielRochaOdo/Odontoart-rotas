import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-hero-gradient">
        <div className="rounded-3xl bg-white/80 backdrop-blur px-8 py-6 shadow-card">
          <p className="text-sm uppercase tracking-[0.2em] text-muted">Odontoart</p>
          <h1 className="font-display text-xl text-ink">Carregando ambiente...</h1>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
