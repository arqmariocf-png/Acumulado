import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Movimientos } from "./pages/Movimientos";
import { Carga } from "./pages/Carga";
import { ReportesEspeciales } from "./pages/ReportesEspeciales";
import { Pendientes } from "./pages/Pendientes";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { Usuarios } from "./pages/admin/Usuarios";
import { Reglas } from "./pages/admin/Reglas";
import { Excepciones } from "./pages/admin/Excepciones";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/movimientos" element={<Movimientos />} />
                <Route path="/carga" element={<Carga />} />
                <Route path="/reportes" element={<ReportesEspeciales />} />
                <Route path="/pendientes" element={<Pendientes />} />

                <Route element={<ProtectedRoute soloAdmin />}>
                  <Route path="/admin" element={<AdminLayout />}>
                    <Route index element={<Usuarios />} />
                    <Route path="reglas" element={<Reglas />} />
                    <Route path="excepciones" element={<Excepciones />} />
                  </Route>
                </Route>
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
