import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";

const ENLACES = [
  { a: "/", etiqueta: "Dashboard" },
  { a: "/movimientos", etiqueta: "Movimientos" },
  { a: "/carga", etiqueta: "Carga" },
  { a: "/reportes", etiqueta: "Reportes especiales" },
  { a: "/pendientes", etiqueta: "Pendientes" },
];

export function Layout() {
  const { perfil, cerrarSesion } = useAuth();
  const esAdmin = perfil?.rol === "admin";
  const veRH = perfil?.rol === "rh" || esAdmin;
  const veProduccion = perfil?.rol === "produccion" || esAdmin;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold text-slate-900">Acumulado · Grupo Loma</span>
            <nav className="flex gap-4 text-sm">
              {ENLACES.map((e) => (
                <NavLink
                  key={e.a}
                  to={e.a}
                  end={e.a === "/"}
                  className={({ isActive }) =>
                    `rounded px-2 py-1 ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`
                  }
                >
                  {e.etiqueta}
                </NavLink>
              ))}
              {veRH && (
                <NavLink
                  to="/rh"
                  className={({ isActive }) =>
                    `rounded px-2 py-1 ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`
                  }
                >
                  RH
                </NavLink>
              )}
              {veProduccion && (
                <NavLink
                  to="/produccion"
                  className={({ isActive }) =>
                    `rounded px-2 py-1 ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`
                  }
                >
                  Producción
                </NavLink>
              )}
              {esAdmin && (
                <NavLink
                  to="/admin"
                  className={({ isActive }) =>
                    `rounded px-2 py-1 ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`
                  }
                >
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
