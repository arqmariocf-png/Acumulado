import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { desuscribirsePush, estaSuscrito, pushSoportado, suscribirsePush } from "../lib/push";

const ENLACES = [
  { a: "/", etiqueta: "Inicio" },
  { a: "/movimientos", etiqueta: "Movimientos" },
  { a: "/inventario", etiqueta: "Inventario" },
  { a: "/carga", etiqueta: "Carga" },
  { a: "/reportes", etiqueta: "Reportes especiales" },
  { a: "/prestamos-intercompania", etiqueta: "Préstamos entre empresas" },
  { a: "/perfil-fiscal", etiqueta: "Perfil fiscal" },
  { a: "/requisiciones", etiqueta: "Requisiciones" },
  { a: "/precios", etiqueta: "Precios unitarios" },
  { a: "/tareas", etiqueta: "Tareas" },
  { a: "/proyectos", etiqueta: "Proyectos" },
  { a: "/pendientes", etiqueta: "Pendientes" },
];

// Lo que sí le toca ver a un supervisor de obra: pedir material, armar sus
// precios unitarios, dar seguimiento a sus tareas y ver los planos/avance
// de sus proyectos. El resto de los módulos financieros siguen fuera.
const ENLACES_RESPONSABLE = ["/", "/requisiciones", "/precios", "/tareas", "/proyectos"];

export function Layout() {
  const { perfil, cerrarSesion } = useAuth();
  const esAdmin = perfil?.rol === "admin";
  const veRH = perfil?.rol === "rh" || perfil?.rol === "rh_documentos" || esAdmin;
  const veSaldos = perfil?.rol === "corporativo" || perfil?.rol === "direccion" || esAdmin;
  // 'responsable' es un rol acotado a sus proyectos (ver SPEC.md sección 10)
  // y 'rh_documentos' a subir expedientes (ver 20260828020000_rh_documentos_
  // rol_enum.sql) -- ninguno de los dos debe ver el resto de los módulos
  // financieros/operativos, ni aunque RLS ya se los bloquee del lado del
  // dato (evita que le aparezcan pantallas vacías sin sentido para su rol).
  const enlaces =
    perfil?.rol === "responsable"
      ? ENLACES.filter((e) => ENLACES_RESPONSABLE.includes(e.a))
      : perfil?.rol === "almacen"
        ? // Almacén entra a inventario y a poner precio de material en los PU.
          ENLACES.filter((e) => ["/", "/inventario", "/requisiciones", "/precios", "/tareas", "/proyectos"].includes(e.a))
        : perfil?.rol === "rh_documentos"
          ? // Sólo el inicio: desde ahí llega a RH, que es su único módulo.
            ENLACES.filter((e) => e.a === "/")
          : ENLACES;

  // "Inicio" siempre visible y directo; el resto (más los extras condicio-
  // nados por rol) va dentro del desplegable -- la barra ya no alcanza a
  // mostrar todos los módulos en una sola fila conforme se agregan más.
  const enlacesMenu = enlaces.filter((e) => e.a !== "/");
  // El checador es para todo mundo, sin importar el rol -- por eso se agrega
  // aparte de ENLACES en vez de vivir en la lista que cada rol filtra.
  enlacesMenu.push({ a: "/checador", etiqueta: "Checador" });
  if (veSaldos) enlacesMenu.push({ a: "/saldos", etiqueta: "Saldos" });
  if (veRH) enlacesMenu.push({ a: "/rh", etiqueta: "RH" });
  if (esAdmin) enlacesMenu.push({ a: "/admin", etiqueta: "Admin" });

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
              <MenuModulos enlaces={enlacesMenu} />
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

function MenuModulos({ enlaces }: { enlaces: { a: string; etiqueta: string }[] }) {
  const [abierto, setAbierto] = useState(false);
  const location = useLocation();
  const contenedorRef = useRef<HTMLDivElement>(null);

  const activo = enlaces.some((e) => location.pathname === e.a || location.pathname.startsWith(`${e.a}/`));

  useEffect(() => {
    function onClickFuera(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", onClickFuera);
    return () => document.removeEventListener("mousedown", onClickFuera);
  }, []);

  useEffect(() => setAbierto(false), [location.pathname]);

  if (enlaces.length === 0) return null;

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
        <div className="absolute left-0 z-20 mt-1 w-56 rounded border border-slate-200 bg-white py-1 shadow-lg">
          {enlaces.map((e) => (
            <NavLink
              key={e.a}
              to={e.a}
              className={({ isActive }) => `block px-3 py-1.5 text-sm ${isActive ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {e.etiqueta}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
