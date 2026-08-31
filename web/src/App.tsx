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
const AdminProyectos = lazy(() => import("./pages/admin/Proyectos").then((m) => ({ default: m.Proyectos })));
const RH = lazy(() => import("./pages/RH").then((m) => ({ default: m.RH })));
const RequisicionesLayout = lazy(() => import("./pages/requisiciones/RequisicionesLayout").then((m) => ({ default: m.RequisicionesLayout })));
const MisRequisiciones = lazy(() => import("./pages/requisiciones/MisRequisiciones").then((m) => ({ default: m.MisRequisiciones })));
const Resolucion = lazy(() => import("./pages/requisiciones/Resolucion").then((m) => ({ default: m.Resolucion })));
const InventarioLayout = lazy(() => import("./pages/inventario/InventarioLayout").then((m) => ({ default: m.InventarioLayout })));
const InventarioMovimientos = lazy(() => import("./pages/inventario/Movimientos").then((m) => ({ default: m.Movimientos })));
const InventarioExistencias = lazy(() => import("./pages/inventario/Existencias").then((m) => ({ default: m.Existencias })));
const InventarioProductos = lazy(() => import("./pages/inventario/Productos").then((m) => ({ default: m.Productos })));
const InventarioMatch = lazy(() => import("./pages/inventario/Match").then((m) => ({ default: m.Match })));
const PreciosLayout = lazy(() => import("./pages/precios/PreciosLayout").then((m) => ({ default: m.PreciosLayout })));
const PreciosAnalisis = lazy(() => import("./pages/precios/Analisis").then((m) => ({ default: m.Analisis })));
const PreciosPublicados = lazy(() => import("./pages/precios/Publicados").then((m) => ({ default: m.Publicados })));
const PreciosCatalogo = lazy(() => import("./pages/precios/Catalogo").then((m) => ({ default: m.Catalogo })));
const PreciosDetalle = lazy(() => import("./pages/precios/Detalle").then((m) => ({ default: m.Detalle })));

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

                  <Route path="/inventario" element={<InventarioLayout />}>
                    <Route index element={<InventarioMovimientos />} />
                    <Route path="existencias" element={<InventarioExistencias />} />
                    <Route path="productos" element={<InventarioProductos />} />
                    <Route path="match" element={<InventarioMatch />} />
                  </Route>

                  <Route path="/requisiciones" element={<RequisicionesLayout />}>
                    <Route index element={<MisRequisiciones />} />
                    <Route element={<ProtectedRoute roles={["admin", "corporativo"]} />}>
                      <Route path="resolucion" element={<Resolucion />} />
                    </Route>
                  </Route>

                  {/* El detalle vive fuera del layout de pestanas: es una
                      tarjeta completa y ahi las pestanas estorban. */}
                  <Route path="/precios/:id" element={<PreciosDetalle />} />
                  <Route path="/precios" element={<PreciosLayout />}>
                    <Route index element={<PreciosAnalisis />} />
                    <Route path="publicados" element={<PreciosPublicados />} />
                    <Route path="catalogo" element={<PreciosCatalogo />} />
                  </Route>

                  <Route element={<ProtectedRoute roles={["rh", "rh_documentos"]} />}>
                    <Route path="/rh" element={<RH />} />
                  </Route>

                  <Route element={<ProtectedRoute soloAdmin />}>
                    <Route path="/admin" element={<AdminLayout />}>
                      <Route index element={<Usuarios />} />
                      <Route path="reglas" element={<Reglas />} />
                      <Route path="excepciones" element={<Excepciones />} />
                      <Route path="proyectos" element={<AdminProyectos />} />
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
