import { Suspense, lazy } from "react";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./layouts/AppLayout";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/DashboardEstrategico"));
const Agenda = lazy(() => import("./pages/Agenda"));
const RoutesPage = lazy(() => import("./pages/Routes"));
const Visitas = lazy(() => import("./pages/Visitas"));
const AceiteDigital = lazy(() => import("./pages/AceiteDigital"));
const Clientes = lazy(() => import("./pages/Clientes"));
const Fila = lazy(() => import("./pages/Fila"));
const Settings = lazy(() => import("./pages/Settings"));
const Logs = lazy(() => import("./pages/Logs"));
const KPI = lazy(() => import("./pages/KPI"));
const NotFound = lazy(() => import("./pages/NotFound"));

const shouldUseHashRouter = () => {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "appassets.androidplatform.net";
};

function AppRoutes() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-ink/70">Carregando...</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="dashboard-estrategico" element={<Navigate to="/dashboard" replace />} />
            <Route path="agenda" element={<Agenda />} />
            <Route path="rotas" element={<RoutesPage />} />
            <Route path="rotas/mapa" element={<Navigate to="/agenda" replace />} />
            <Route path="visitas" element={<Visitas />} />
            <Route path="aceite-digital" element={<AceiteDigital />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="fila" element={<Fila />} />
            <Route path="kpi" element={<KPI />} />
            <Route path="configuracoes" element={<Settings />} />
            <Route path="logs" element={<Logs />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  if (shouldUseHashRouter()) {
    return (
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    );
  }

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
