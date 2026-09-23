import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import type { ModuloClave } from "../../types/database";

// Usuarios y Empresas son la base: existen para toda organización. Reglas y
// Excepciones pertenecen al módulo de conciliación y solo aparecen si está
// abierto. Organizaciones es de la organización maestra.
const TABS: { a: string; etiqueta: string; end?: boolean; modulo?: ModuloClave; soloMaestra?: boolean }[] = [
  { a: "/admin", etiqueta: "Usuarios", end: true },
  { a: "/admin/empresas", etiqueta: "Entidades" },
  { a: "/admin/organizacion", etiqueta: "Marca" },
  { a: "/admin/suscripcion", etiqueta: "Suscripción" },
  { a: "/admin/organizaciones", etiqueta: "Organizaciones", soloMaestra: true },
  { a: "/admin/reglas", etiqueta: "Reglas de clasificación", modulo: "conciliacion" },
  { a: "/admin/excepciones", etiqueta: "Excepciones de proveedor", modulo: "conciliacion" },
];

export function AdminLayout() {
  const { tieneModulo, esAdminGlobal, grupo } = useAuth();

  const visibles = TABS.filter((t) => (!t.modulo || tieneModulo(t.modulo)) && (!t.soloMaestra || esAdminGlobal));

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Administración</h1>
      <p className="mb-4 text-sm text-slate-500">{grupo?.marca_comercial ?? grupo?.nombre}</p>
      <div className="mb-4 flex gap-2 border-b border-slate-200">
        {visibles.map((t) => (
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
