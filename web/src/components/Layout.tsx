import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { seccionesPara, type SeccionMenu } from "../lib/menu";
import { AvisoVersion } from "./AvisoVersion";
import { desuscribirsePush, estaSuscrito, pushSoportado, suscribirsePush } from "../lib/push";

export function Layout() {
  const { perfil, cerrarSesion } = useAuth();
  // Menú por áreas con orientación de uso: la visibilidad por rol vive en
  // lib/menu.ts (misma fuente que el inicio y la guía).
  const secciones = seccionesPara(perfil);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 sm:gap-6">
            <span className="text-lg font-semibold text-slate-900">Grupo Loma</span>
            <nav className="flex items-center gap-2 text-sm">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `rounded px-2 py-1 ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`
                }
              >
                Inicio
              </NavLink>
              <MenuModulos secciones={secciones} />
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="hidden sm:inline">
              {perfil?.nombre} · <span className="text-slate-400">{perfil?.rol}</span>
            </span>
            {perfil && <BotonNotificaciones profileId={perfil.id} />}
            <button onClick={cerrarSesion} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
              Salir
            </button>
          </div>
        </div>
      </header>
      <AvisoVersion />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function BotonNotificaciones({ profileId }: { profileId: string }) {
  const [soportado] = useState(pushSoportado());
  const [suscrito, setSuscrito] = useState(false);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (soportado) estaSuscrito().then(setSuscrito);
  }, [soportado]);

  if (!soportado) return null;

  async function alternar() {
    setCargando(true);
    try {
      if (suscrito) {
        await desuscribirsePush();
        setSuscrito(false);
      } else {
        await suscribirsePush(profileId);
        setSuscrito(true);
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <button
      onClick={alternar}
      disabled={cargando}
      title={suscrito ? "Notificaciones activadas -- clic para desactivar" : "Activar recordatorios de tareas del día"}
      className={`rounded border px-2 py-1 text-xs ${suscrito ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-600 hover:bg-slate-100"}`}
    >
      {suscrito ? "🔔 Activas" : "🔔 Activar"}
    </button>
  );
}

function MenuModulos({ secciones }: { secciones: SeccionMenu[] }) {
  const [abierto, setAbierto] = useState(false);
  const location = useLocation();
  const contenedorRef = useRef<HTMLDivElement>(null);

  const activo = secciones.some((s) => s.entradas.some((e) => location.pathname === e.ruta || location.pathname.startsWith(`${e.ruta}/`)));

  useEffect(() => {
    function onClickFuera(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", onClickFuera);
    return () => document.removeEventListener("mousedown", onClickFuera);
  }, []);

  useEffect(() => setAbierto(false), [location.pathname]);

  if (secciones.length === 0) return null;

  return (
    <div ref={contenedorRef} className="relative">
      <button
        onClick={() => setAbierto((v) => !v)}
        className={`flex items-center gap-1 rounded px-2 py-1 ${activo ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
      >
        Módulos
        <span className="text-xs">▾</span>
      </button>
      {abierto && (
        <div className="absolute left-0 z-20 mt-1 max-h-[80vh] w-80 overflow-y-auto rounded border border-slate-200 bg-white py-1 shadow-lg">
          {secciones.map((s) => (
            <div key={s.clave} className="py-1">
              <div className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400" title={s.proposito}>
                {s.titulo}
              </div>
              {s.entradas.map((e) => (
                <NavLink
                  key={e.ruta}
                  to={e.ruta}
                  title={e.uso}
                  className={({ isActive }) => `block px-3 py-1.5 ${isActive ? "bg-slate-100" : "hover:bg-slate-50"}`}
                >
                  <span className={`block text-sm ${location.pathname.startsWith(e.ruta) ? "font-medium text-slate-900" : "text-slate-700"}`}>{e.etiqueta}</span>
                  <span className="block text-[11px] leading-tight text-slate-400">{e.descripcion}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
