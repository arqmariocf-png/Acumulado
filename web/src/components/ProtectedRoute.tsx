import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { AppRol, ModuloClave } from "../types/database";

export function ProtectedRoute({
  soloAdmin = false,
  roles,
  modulo,
}: {
  soloAdmin?: boolean;
  roles?: AppRol[];
  /** Si se indica, la ruta solo existe cuando la organización tiene ese módulo abierto. */
  modulo?: ModuloClave;
}) {
  const { cargando, session, perfil, grupo, tieneModulo } = useAuth();

  if (cargando) return <div className="p-8 text-center text-slate-500">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;

  if (perfil?.rol === "pendiente" || !perfil) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Cuenta sin acceso todavía</h1>
        <p className="mt-2 text-sm text-slate-600">
          Tu usuario existe pero un administrador todavía no te asigna organización, rol ni empresa. Pídele que lo haga desde el panel de Admin.
        </p>
      </div>
    );
  }

  // Un usuario con rol real pero sin organización no puede ver nada: toda la
  // información de la app cuelga de una organización (ver RLS en
  // 20260923090002_grupos_rls.sql).
  if (!grupo) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Cuenta sin organización</h1>
        <p className="mt-2 text-sm text-slate-600">
          Tu usuario tiene rol asignado pero no pertenece a ninguna organización. Un administrador tiene que asignártela desde el panel de Admin.
        </p>
      </div>
    );
  }

  if (soloAdmin && perfil.rol !== "admin") {
    return <Navigate to="/" replace />;
  }

  // 'admin' siempre pasa cualquier restricción de `roles` -- es el rol con
  // acceso total del sistema (SPEC.md sección 6), no tiene sentido pedirle
  // a un admin que además se agregue explícitamente a cada lista.
  if (roles && perfil.rol !== "admin" && !roles.includes(perfil.rol)) {
    return <Navigate to="/" replace />;
  }

  // El módulo cerrado no es un error de permisos del usuario sino de alcance
  // contratado de la organización: se manda a Inicio, que ya explica qué hay
  // abierto y qué no.
  if (modulo && !tieneModulo(modulo)) {
    return <Navigate to="/inicio" replace />;
  }

  return <Outlet />;
}
