import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";

export function PreciosLayout() {
  const { perfil } = useAuth();

  // Almacén entra sólo a poner precio y proveedor sobre lo que ya cargó
  // supervisión; el catálogo de insumos no es suyo.
  const veCatalogo = perfil?.rol !== "almacen";

  const tabs = [
    { a: "/precios", etiqueta: "Análisis", end: true },
    { a: "/precios/publicados", etiqueta: "Publicados" },
    ...(veCatalogo ? [{ a: "/precios/catalogo", etiqueta: "Catálogo de insumos" }] : []),
  ];

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Precios unitarios</h1>
      <div className="mb-4 flex gap-2 border-b border-slate-200">
        {tabs.map((t) => (
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
