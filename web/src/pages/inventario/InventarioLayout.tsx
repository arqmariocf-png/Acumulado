import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  { a: "/inventario", etiqueta: "Registrar movimiento", end: true },
  { a: "/inventario/existencias", etiqueta: "Existencias" },
  { a: "/inventario/productos", etiqueta: "Productos" },
  { a: "/inventario/match", etiqueta: "Match con OC/OV" },
];

export function InventarioLayout() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Inventario</h1>
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
