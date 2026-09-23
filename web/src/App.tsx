import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";

// Cada página en su propio chunk: nadie necesita el código de Admin o Carga
// en la carga inicial del Dashboard, y viceversa.
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Inicio = lazy(() => import("./pages/Inicio").then((m) => ({ default: m.Inicio })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Movimientos = lazy(() => import("./pages/Movimientos").then((m) => ({ default: m.Movimientos })));
const Carga = lazy(() => import("./pages/Carga").then((m) => ({ default: m.Carga })));
const ReportesEspeciales = lazy(() => import("./pages/ReportesEspeciales").then((m) => ({ default: m.ReportesEspeciales })));
const Pendientes = lazy(() => import("./pages/Pendientes").then((m) => ({ default: m.Pendientes })));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout").then((m) => ({ default: m.AdminLayout })));
const Usuarios = lazy(() => import("./pages/admin/Usuarios").then((m) => ({ default: m.Usuarios })));
const Empresas = lazy(() => import("./pages/admin/Empresas").then((m) => ({ default: m.Empresas })));
const MiOrganizacion = lazy(() => import("./pages/admin/MiOrganizacion").then((m) => ({ default: m.MiOrganizacion })));
const SuscripcionAdmin = lazy(() => import("./pages/admin/Suscripcion").then((m) => ({ default: m.Suscripcion })));
const Organizaciones = lazy(() => import("./pages/admin/Organizaciones").then((m) => ({ default: m.Organizaciones })));
const Reglas = lazy(() => import("./pages/admin/Reglas").then((m) => ({ default: m.Reglas })));
const Excepciones = lazy(() => import("./pages/admin/Excepciones").then((m) => ({ default: m.Excepciones })));
const RH = lazy(() => import("./pages/RH").then((m) => ({ default: m.RH })));
const InventarioLayout = lazy(() => import("./pages/inventario/InventarioLayout").then((m) => ({ default: m.InventarioLayout })));
const InventarioMovimientos = lazy(() => import("./pages/inventario/Movimientos").then((m) => ({ default: m.Movimientos })));
const InventarioExistencias = lazy(() => import("./pages/inventario/Existencias").then((m) => ({ default: m.Existencias })));
const InventarioProductos = lazy(() => import("./pages/inventario/Productos").then((m) => ({ default: m.Productos })));
const InventarioMatch = lazy(() => import("./pages/inventario/Match").then((m) => ({ default: m.Match })));
const Proyectos = lazy(() => import("./pages/proyectos/Proyectos").then((m) => ({ default: m.Proyectos })));
const ProyectoDetalle = lazy(() => import("./pages/proyectos/ProyectoDetalle").then((m) => ({ default: m.ProyectoDetalle })));

const queryClient = new QueryClient();

function Cargando() {
  return <div className="p-8 text-center text-sm text-slate-500">Cargando…</div>;
}

// La raíz depende de lo que la organización tenga abierto: con conciliación
// (el caso de Grupo Loma) la portada sigue siendo el Dashboard de siempre;
// sin ella, la portada es Inicio -- la base que toda organización tiene.
function Raiz() {
  const { tieneModulo } = useAuth();
  if (tieneModulo("conciliacion")) return <Dashboard />;
  // Una organización que solo trae Proyectos entra directo a lo suyo; si no
  // tiene ningún módulo abierto, a la portada de la organización.
  if (tieneModulo("proyectos")) return <Navigate to="/proyectos" replace />;
  return <Navigate to="/inicio" replace />;
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
                  <Route path="/" element={<Raiz />} />
                  <Route path="/inicio" element={<Inicio />} />

                  <Route element={<ProtectedRoute modulo="conciliacion" />}>
                    <Route path="/movimientos" element={<Movimientos />} />
                    <Route path="/carga" element={<Carga />} />
                    <Route path="/reportes" element={<ReportesEspeciales />} />
                    <Route path="/pendientes" element={<Pendientes />} />
                  </Route>

                  <Route element={<ProtectedRoute modulo="proyectos" />}>
                    <Route path="/proyectos" element={<Proyectos />} />
                    <Route path="/proyectos/:id" element={<ProyectoDetalle />} />
                  </Route>

                  <Route element={<ProtectedRoute modulo="inventario" />}>
                    <Route path="/inventario" element={<InventarioLayout />}>
                      <Route index element={<InventarioMovimientos />} />
                      <Route path="existencias" element={<InventarioExistencias />} />
                      <Route path="productos" element={<InventarioProductos />} />
                      <Route path="match" element={<InventarioMatch />} />
                    </Route>
                  </Route>

                  <Route element={<ProtectedRoute roles={["rh"]} modulo="rh" />}>
                    <Route path="/rh" element={<RH />} />
                  </Route>

                  <Route element={<ProtectedRoute soloAdmin />}>
                    <Route path="/admin" element={<AdminLayout />}>
                      <Route index element={<Usuarios />} />
                      <Route path="empresas" element={<Empresas />} />
                      <Route path="organizacion" element={<MiOrganizacion />} />
                      <Route path="suscripcion" element={<SuscripcionAdmin />} />
                      <Route path="organizaciones" element={<Organizaciones />} />
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
