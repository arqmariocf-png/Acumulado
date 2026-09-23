import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { AvisoSuscripcion } from "./AvisoSuscripcion";
import type { ModuloClave } from "../types/database";

// Cada enlace declara de qué módulo depende; el menú se arma con los módulos
// que la organización tiene abiertos (ver grupo_modulos en
// 20260923090001_grupos_modulos.sql). "Inicio" no depende de ninguno: es la
// base que toda organización tiene.
const ENLACES: { a: string; etiqueta: string; modulo?: ModuloClave; end?: boolean }[] = [
  { a: "/inicio", etiqueta: "Inicio" },
  { a: "/proyectos", etiqueta: "Proyectos", modulo: "proyectos" },
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
  const { perfil, grupo, logoUrl, tieneModulo, cerrarSesion } = useAuth();
  const esAdmin = perfil?.rol === "admin";
  const veRH = (perfil?.rol === "rh" || esAdmin) && tieneModulo("rh");
  const marca = grupo?.marca_comercial ?? grupo?.nombre;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              {logoUrl ? (
                // El logotipo sustituye al nombre: dentro de su propia
                // aplicación, el cliente se ve a sí mismo, no a la plataforma.
                <img src={logoUrl} alt={marca ?? "Organización"} className="h-9 w-auto max-w-[180px] object-contain" />
              ) : (
                <span>Acumulado{marca ? ` · ${marca}` : ""}</span>
              )}
            </span>
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
      <AvisoSuscripcion />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
