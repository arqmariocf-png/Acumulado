import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";

// Cada página en su propio chunk: nadie necesita el código de Admin o Carga
// en la carga inicial del Dashboard, y viceversa.
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Movimientos = lazy(() => import("./pages/Movimientos").then((m) => ({ default: m.Movimientos })));
const Carga = lazy(() => import("./pages/Carga").then((m) => ({ default: m.Carga })));
const ReportesEspeciales = lazy(() => import("./pages/ReportesEspeciales").then((m) => ({ default: m.ReportesEspeciales })));
const SaldosDiarios = lazy(() => import("./pages/SaldosDiarios").then((m) => ({ default: m.SaldosDiarios })));
const PrestamosIntercompania = lazy(() => import("./pages/PrestamosIntercompania").then((m) => ({ default: m.PrestamosIntercompania })));
const PerfilFiscal = lazy(() => import("./pages/PerfilFiscal").then((m) => ({ default: m.PerfilFiscal })));
const Pendientes = lazy(() => import("./pages/Pendientes").then((m) => ({ default: m.Pendientes })));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout").then((m) => ({ default: m.AdminLayout })));
const Usuarios = lazy(() => import("./pages/admin/Usuarios").then((m) => ({ default: m.Usuarios })));
const Reglas = lazy(() => import("./pages/admin/Reglas").then((m) => ({ default: m.Reglas })));
const Excepciones = lazy(() => import("./pages/admin/Excepciones").then((m) => ({ default: m.Excepciones })));
const RH = lazy(() => import("./pages/RH").then((m) => ({ default: m.RH })));

const queryClient = new QueryClient();

function Cargando() {
  return <div className="p-8 text-center text-sm text-slate-500">Cargando…</div>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<Cargando />}>
            <Routes>
              <Route path="/login" element={<Login />} />

              <Route element={<ProtectedRoute />}>
                <Route element={<Layout />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/movimientos" element={<Movimientos />} />
                  <Route path="/carga" element={<Carga />} />
                  <Route path="/reportes" element={<ReportesEspeciales />} />
                  <Route path="/prestamos-intercompania" element={<PrestamosIntercompania />} />
                  <Route path="/perfil-fiscal" element={<PerfilFiscal />} />
                  <Route path="/pendientes" element={<Pendientes />} />

                  <Route element={<ProtectedRoute roles={["corporativo", "direccion"]} />}>
                    <Route path="/saldos" element={<SaldosDiarios />} />
                  </Route>

                  <Route element={<ProtectedRoute roles={["rh"]} />}>
                    <Route path="/rh" element={<RH />} />
                  </Route>

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
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
