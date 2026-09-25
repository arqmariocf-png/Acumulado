import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";

// "Organizaciones" es de la organización maestra: da de alta clientes y les
// abre módulos. El resto de las pestañas las ve el admin de cualquiera.
const TABS: { a: string; etiqueta: string; end?: boolean; soloMaestra?: boolean }[] = [
  { a: "/admin", etiqueta: "Usuarios", end: true },
  { a: "/admin/empresas", etiqueta: "Entidades" },
  { a: "/admin/organizacion", etiqueta: "Marca" },
  { a: "/admin/suscripcion", etiqueta: "Suscripción" },
  { a: "/admin/organizaciones", etiqueta: "Organizaciones", soloMaestra: true },
  { a: "/admin/cuentas", etiqueta: "Cuentas (ajuste de saldo)" },
  { a: "/admin/reglas", etiqueta: "Reglas de clasificación" },
  { a: "/admin/excepciones", etiqueta: "Excepciones de proveedor" },
  { a: "/admin/proyectos", etiqueta: "Proyectos" },
];

export function AdminLayout() {
  const { esAdminGlobal, grupo } = useAuth();
  const visibles = TABS.filter((t) => !t.soloMaestra || esAdminGlobal);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Administración</h1>
      {grupo && <p className="mb-4 text-sm text-slate-500">{grupo.marca_comercial ?? grupo.nombre}</p>}
      <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-200">
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
