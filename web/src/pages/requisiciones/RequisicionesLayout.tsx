import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";

export function RequisicionesLayout() {
  const { perfil } = useAuth();
  const puedeResolver = perfil?.rol === "admin" || perfil?.rol === "corporativo";

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Requisiciones</h1>
      <div className="mb-4 flex gap-2 border-b border-slate-200">
        <NavLink
          to="/requisiciones"
          end
          className={({ isActive }) =>
            `border-b-2 px-3 py-2 text-sm ${isActive ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`
          }
        >
          Mis requisiciones
        </NavLink>
        {puedeResolver && (
          <NavLink
            to="/requisiciones/resolucion"
            className={({ isActive }) =>
              `border-b-2 px-3 py-2 text-sm ${isActive ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`
            }
          >
            Resolución
          </NavLink>
        )}
      </div>
      <Outlet />
    </div>
  );
}
