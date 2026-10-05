import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { seccionesPara, type NivelMenu, type SeccionMenu } from "../lib/menu";
import { useEsSocio } from "../lib/socio";
import { AvisoVersion } from "./AvisoVersion";
import { AvisoSuscripcion } from "./AvisoSuscripcion";
import { desuscribirsePush, estaSuscrito, pushSoportado, suscribirsePush } from "../lib/push";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { SelectorEmpresa, useEmpresasAlcance } from "./SelectorEmpresa";
import { ETIQUETA_ROL, NIVELES_ROLES } from "../lib/accesosRoles";
import type { AppRol } from "../types/database";
import { IrAlAncla } from "./FiltroDesdeTablero";

export function Layout() {
  const { perfil, perfilReal, vistaComo, setVistaComo, grupo, alcanceOrganizacion, logoUrl, cerrarSesion, cambiarContrasena, eligeEmpresa, empresaActiva, setEmpresaActiva } = useAuth();
  const espectador = !!perfilReal?.espectador;
  // Menú por áreas con orientación de uso: la visibilidad por rol vive en
  // lib/menu.ts (misma fuente que el inicio y la guía).
  const secciones = seccionesPara(perfil, alcanceOrganizacion);
  const { data: socio } = useEsSocio(perfil?.rol === "admin" ? undefined : perfil?.id);
  const esSocio = (socio?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 sm:gap-6">
            {/* Cada organización se ve a sí misma: su logotipo si lo subió, si
                no su marca. Sin organización cargada (sin señal) se queda el
                nombre de siempre. */}
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={grupo?.marca_comercial ?? grupo?.nombre ?? "Organización"}
                className="h-9 w-auto max-w-[180px] object-contain"
              />
            ) : (
              <span className="text-lg font-semibold text-slate-900">
                {grupo?.marca_comercial ?? grupo?.nombre ?? "Acumulado"}
              </span>
            )}
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
              {esSocio && (
                <NavLink to="/socio" className={({ isActive }) => `rounded px-2 py-1 ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                  Socio
                </NavLink>
              )}
              {/* Comedor a la vista (Mario, 30-sep-2026): dentro de Recursos
                  humanos quedaba al fondo y no se encontraba. */}
              {secciones.some((s) => s.entradas.some((e) => e.ruta === "/comedor")) && (
                <NavLink to="/comedor" className={({ isActive }) => `rounded px-2 py-1 ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                  Comedor
                </NavLink>
              )}
              {/* Escritorio: un submenú por área. Celular: un solo "Módulos"
                  agrupado, porque no caben siete botones. */}
              <div className="hidden items-center gap-1 lg:flex">
                {secciones.map((s) => (
                  <MenuModulos key={s.clave} secciones={[s]} titulo={s.titulo} />
                ))}
              </div>
              <div className="lg:hidden">
                <MenuModulos secciones={secciones} titulo="Módulos" />
              </div>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            {/* Empresa activa (28-sep-2026): quien maneja varias elige aquí y
                todas las pantallas se filtran por ella. */}
            {eligeEmpresa && !espectador && <SelectorEmpresa value={empresaActiva ?? ""} onChange={(v) => setEmpresaActiva(v || null)} compacto vacio="Todas" className="max-w-[140px] rounded border border-slate-300 px-2 py-1 text-xs" />}
            {perfilReal?.rol === "admin" && !espectador && <VerComo vistaComo={vistaComo} onCambiar={setVistaComo} />}
            <span className="hidden sm:inline">
              {perfil?.nombre} · <span className="text-slate-400">{perfil?.rol === "admin" && alcanceOrganizacion?.esMaestra ? "director general" : perfil?.rol}</span>
            </span>
            {perfil && <BotonNotificaciones profileId={perfil.id} />}
            <button onClick={cambiarContrasena} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100" title="Cambiar mi contraseña">
              Contraseña
            </button>
            <button onClick={cerrarSesion} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
              Salir
            </button>
          </div>
        </div>
      </header>
      {vistaComo && <BannerVistaComo vistaComo={vistaComo} onSalir={() => setVistaComo(null)} />}
      <AvisoSuscripcion />
      <AvisoVersion />
      <main className="mx-auto max-w-7xl px-4 py-6">
        {/* Espectador (2-oct-2026, Mario): solo la barra y los menús, ninguna
            pantalla con información. La base tampoco le devuelve datos
            (20261002090000_espectador_sin_datos.sql). */}
        <IrAlAncla />
        {espectador ? <PantallaEspectador /> : <Outlet />}
      </main>
    </div>
  );
}

function PantallaEspectador() {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-lg border border-sky-200 bg-sky-50 p-6 text-center text-sky-900">
      <h1 className="mb-2 text-lg font-semibold">Cuenta de espectador</h1>
      <p className="text-sm">
        Puedes recorrer los menús para conocer la plataforma. La información de las empresas se habilita cuando tu
        organización active su suscripción.
      </p>
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

function MenuModulos({ secciones, titulo }: { secciones: SeccionMenu[]; titulo: string }) {
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

  useEffect(() => setAbierto(false), [location.pathname, location.search]);

  if (secciones.length === 0) return null;

  return (
    <div ref={contenedorRef} className="relative">
      <button
        onClick={() => setAbierto((v) => !v)}
        className={`flex items-center gap-1 rounded px-2 py-1 ${activo ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
      >
        {titulo}
        <span className="text-xs">▾</span>
      </button>
      {abierto && (
        <div className={`absolute left-0 z-20 mt-1 max-h-[80vh] overflow-y-auto rounded border border-slate-200 bg-white py-1 shadow-lg ${secciones.some((s) => s.entradas.some((e) => e.niveles?.length)) ? "w-[26rem] max-w-[92vw]" : "w-80"}`}>
          {secciones.map((s) => (
            <div key={s.clave} className="py-1">
              <div className={`px-3 pt-1 text-[11px] text-slate-400 ${secciones.length > 1 ? "font-semibold uppercase tracking-wide" : "normal-case"}`} title={s.proposito}>
                {secciones.length > 1 ? s.titulo : s.proposito}
              </div>
              {s.entradas.map((e) => (
                <div key={e.ruta}>
                <NavLink
                  to={e.ruta}
                  title={e.uso}
                  className={({ isActive }) => `block px-3 py-1.5 ${isActive ? "bg-slate-100" : "hover:bg-slate-50"}`}
                >
                  <span className={`block text-sm ${location.pathname.startsWith(e.ruta) ? "font-medium text-slate-900" : "text-slate-700"}`}>{e.etiqueta}</span>
                  <span className="block text-[11px] leading-tight text-slate-400">{e.descripcion}</span>
                </NavLink>
                {e.niveles && e.niveles.length > 0 && <Niveles niveles={e.niveles} actual={`${location.pathname}${location.search}`} />}
              </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Submenú de una entrada: niveles en vertical; dentro de cada uno, sus
 * pestañas en horizontal y, si una pestaña tiene tercer nivel, también en
 * horizontal a continuación. `actual` = ruta + query de la página abierta. */
function Niveles({ niveles, actual }: { niveles: NivelMenu[]; actual: string }) {
  const enRuta = (n: NivelMenu): boolean => actual === n.ruta || (n.hijos ?? []).some(enRuta);
  return (
    <div className="ml-3 mb-1 border-l border-slate-200 pl-3">
      {niveles.map((n) => {
        const activoNivel = enRuta(n);
        return (
          <div key={n.ruta} className="py-1">
            <NavLink to={n.ruta} className={`block text-xs ${activoNivel ? "font-semibold text-slate-900" : "font-medium text-slate-700 hover:text-slate-900"}`}>
              {n.etiqueta}
            </NavLink>
            {n.hijos && n.hijos.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {n.hijos.map((h) => (
                  <span key={h.ruta} className="flex flex-wrap items-center gap-1">
                    <NavLink
                      to={h.ruta}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${enRuta(h) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"}`}
                    >
                      {h.etiqueta}
                    </NavLink>
                    {h.hijos && h.hijos.length > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                        {h.hijos.map((t, i) => (
                          <span key={t.ruta} className="flex items-center gap-0.5">
                            {i > 0 && <span>·</span>}
                            <NavLink to={t.ruta} className={`rounded px-1 ${actual === t.ruta ? "bg-slate-200 text-slate-900" : "hover:bg-slate-100 hover:text-slate-700"}`}>
                              {t.etiqueta}
                            </NavLink>
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const ROLES_VISTA: AppRol[] = NIVELES_ROLES.flatMap((n) => n.roles).filter((r) => r !== "pendiente");

/** Solo admin: "ver como" otro rol y empresa (Mario, 28-sep-2026) para
 * revisar menús y pantallas sin cambiar de cuenta. Es interfaz: RLS sigue
 * siendo la del admin, así que los datos no se acotan. */
function VerComo({ vistaComo, onCambiar }: { vistaComo: { rol: AppRol; empresaId: string | null } | null; onCambiar: (v: { rol: AppRol; empresaId: string | null } | null) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [rol, setRol] = useState<AppRol>(vistaComo?.rol ?? "direccion");
  const [empresaId, setEmpresaId] = useState<string>(vistaComo?.empresaId ?? "");
  // Todas las empresas de la organización (RLS del admin), no solo las del
  // alcance simulado: si no, al ver como "empresa" ya no podría cambiar.
  const { data: empresas } = useQuery({
    queryKey: ["empresas-todas-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw error;
      return (data ?? []) as { id: string; nombre: string }[];
    },
  });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    function fuera(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setAbierto((v) => !v)} className={`rounded border px-2 py-1 text-xs ${vistaComo ? "border-amber-400 bg-amber-50 text-amber-900" : "border-slate-300 hover:bg-slate-100"}`} title="Navegar la app como otro rol y empresa">
        {vistaComo ? `Viendo como ${ETIQUETA_ROL[vistaComo.rol]}` : "Ver como…"}
      </button>
      {abierto && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded border border-slate-200 bg-white p-3 text-xs shadow-lg">
          <p className="mb-2 font-semibold text-slate-800">Ver la app como</p>
          <label className="mb-1 block text-slate-500">Rol</label>
          <select value={rol} onChange={(e) => setRol(e.target.value as AppRol)} className="mb-2 w-full rounded border border-slate-300 px-2 py-1">
            {ROLES_VISTA.map((r) => (
              <option key={r} value={r}>
                {ETIQUETA_ROL[r]}
              </option>
            ))}
          </select>
          <label className="mb-1 block text-slate-500">Empresa</label>
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="mb-3 w-full rounded border border-slate-300 px-2 py-1">
            <option value="">Todas (sin empresa principal)</option>
            {empresas?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onCambiar({ rol, empresaId: empresaId || null });
                setAbierto(false);
              }}
              className="rounded bg-slate-900 px-3 py-1 font-medium text-white"
            >
              Aplicar
            </button>
            {vistaComo && (
              <button
                type="button"
                onClick={() => {
                  onCambiar(null);
                  setAbierto(false);
                }}
                className="rounded border border-slate-300 px-3 py-1"
              >
                Volver a admin
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Cambia menús y pantallas; los datos siguen siendo los del administrador. Los roles de personal se ven con todos los módulos.</p>
        </div>
      )}
    </div>
  );
}

function BannerVistaComo({ vistaComo, onSalir }: { vistaComo: { rol: AppRol; empresaId: string | null }; onSalir: () => void }) {
  const { data: empresas } = useEmpresasAlcance();
  const empresa = vistaComo.empresaId ? (empresas?.find((e) => e.id === vistaComo.empresaId)?.nombre ?? "una empresa") : "todas las empresas";
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900">
      Estás viendo la app como <b>{ETIQUETA_ROL[vistaComo.rol]}</b> · {empresa}. Solo cambia lo que se muestra.{" "}
      <button type="button" onClick={onSalir} className="underline">
        Volver a mi vista
      </button>
    </div>
  );
}
