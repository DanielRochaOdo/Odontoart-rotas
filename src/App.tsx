import { BrowserRouter, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./layouts/AppLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Agenda from "./pages/Agenda";
import RoutesPage from "./pages/Routes";
import Visitas from "./pages/Visitas";
import AceiteDigital from "./pages/AceiteDigital";
import Clientes from "./pages/Clientes";
import Settings from "./pages/Settings";
import Logs from "./pages/Logs";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="agenda" element={<Agenda />} />
            <Route path="rotas" element={<RoutesPage />} />
            <Route path="visitas" element={<Visitas />} />
            <Route path="aceite-digital" element={<AceiteDigital />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="configuracoes" element={<Settings />} />
            <Route path="logs" element={<Logs />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
