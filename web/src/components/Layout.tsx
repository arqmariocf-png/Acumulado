import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { ModuloClave } from "../types/database";

// Cada enlace declara de qué módulo depende; el menú se arma con los módulos
// que la organización tiene abiertos (ver grupo_modulos en
// 20260923090001_grupos_modulos.sql). "Inicio" no depende de ninguno: es la
// base que toda organización tiene.
const ENLACES: { a: string; etiqueta: string; modulo?: ModuloClave; end?: boolean }[] = [
  { a: "/inicio", etiqueta: "Inicio" },
  { a: "/", etiqueta: "Dashboard", modulo: "conciliacion", end: true },
  { a: "/movimientos", etiqueta: "Movimientos", modulo: "conciliacion" },
  { a: "/inventario", etiqueta: "Inventario", modulo: "inventario" },
  { a: "/carga", etiqueta: "Carga", modulo: "conciliacion" },
  { a: "/reportes", etiqueta: "Reportes especiales", modulo: "conciliacion" },
  { a: "/pendientes", etiqueta: "Pendientes", modulo: "conciliacion" },
];

const CLASE_ENLACE = ({ isActive }: { isActive: boolean }) =>
  `rounded px-2 py-1 ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`;

export function Layout() {
  const { perfil, grupo, tieneModulo, cerrarSesion } = useAuth();
  const esAdmin = perfil?.rol === "admin";
  const veRH = (perfil?.rol === "rh" || esAdmin) && tieneModulo("rh");
  const marca = grupo?.marca_comercial ?? grupo?.nombre;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold text-slate-900">Acumulado{marca ? ` · ${marca}` : ""}</span>
            <nav className="flex gap-4 text-sm">
              {ENLACES.filter((e) => !e.modulo || tieneModulo(e.modulo)).map((e) => (
                <NavLink key={e.a} to={e.a} end={e.end} className={CLASE_ENLACE}>
                  {e.etiqueta}
                </NavLink>
              ))}
              {veRH && (
                <NavLink to="/rh" className={CLASE_ENLACE}>
                  RH
                </NavLink>
              )}
              {esAdmin && (
                <NavLink to="/admin" className={CLASE_ENLACE}>
                  Admin
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>
              {perfil?.nombre} · <span className="text-slate-400">{perfil?.rol}</span>
            </span>
            <button onClick={cerrarSesion} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
