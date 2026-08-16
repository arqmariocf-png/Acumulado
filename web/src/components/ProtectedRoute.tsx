import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function ProtectedRoute({ soloAdmin = false }: { soloAdmin?: boolean }) {
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

  return <Outlet />;
}
