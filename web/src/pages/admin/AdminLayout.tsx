import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  { a: "/admin", etiqueta: "Usuarios", end: true },
  { a: "/admin/cuentas", etiqueta: "Cuentas (ajuste de saldo)" },
  { a: "/admin/reglas", etiqueta: "Reglas de clasificación" },
  { a: "/admin/excepciones", etiqueta: "Excepciones de proveedor" },
  { a: "/admin/proyectos", etiqueta: "Proyectos" },
];

export function AdminLayout() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Administración</h1>
      <div className="mb-4 flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <NavLink
            key={t.a}
            to={t.a}
            end={t.end}
            className={({ isActive }) =>
              `border-b-2 px-3 py-2 text-sm ${isActive ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`
            }
          >
            {t.etiqueta}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
