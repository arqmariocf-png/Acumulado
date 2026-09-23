import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { AppRol, Profile } from "../types/database";

export function ProtectedRoute({
  soloAdmin = false,
  roles,
  oPermiso,
}: {
  soloAdmin?: boolean;
  roles?: AppRol[];
  /** Permiso adicional fuera del rol (ej. profiles.bbva_mantenimiento). */
  oPermiso?: (perfil: Profile) => boolean;
}) {
  const { cargando, session, perfil } = useAuth();

  if (cargando) return <div className="p-8 text-center text-slate-500">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;

  if (perfil?.rol === "pendiente" || !perfil) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Cuenta sin acceso todavía</h1>
        <p className="mt-2 text-sm text-slate-600">
          Tu usuario existe pero un administrador todavía no te asigna rol ni empresa. Pídele que lo haga desde el panel de Admin.
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
  if (roles && perfil.rol !== "admin" && !roles.includes(perfil.rol) && !(oPermiso && oPermiso(perfil))) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
