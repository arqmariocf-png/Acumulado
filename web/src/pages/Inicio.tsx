import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useInstalable } from "../lib/useInstalable";
import type { Empresa, Modulo, ModuloClave } from "../types/database";

// Página base de una organización: existe siempre, tenga o no módulos
// abiertos. Es lo primero que ve una organización nueva (ARSSA hoy) y el
// lugar donde se ve de un golpe qué hay contratado y qué falta configurar.

const RUTA_DEL_MODULO: Record<ModuloClave, string> = {
  conciliacion: "/",
  proyectos: "/proyectos",
  inventario: "/inventario",
  rh: "/rh",
};

export function Inicio() {
  const { grupo, perfil, tieneModulo, esAdminGlobal } = useAuth();
  const { sePuedeInstalar, instalada, esIos, instalar } = useInstalable();
  const esAdmin = perfil?.rol === "admin";

  const { data: empresas } = useQuery({
    queryKey: ["inicio-empresas", grupo?.id],
    enabled: !!grupo,
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("*").order("nombre");
      if (error) throw error;
      return data as Empresa[];
    },
  });

  const { data: modulos } = useQuery({
    queryKey: ["catalogo-modulos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("modulos").select("*").order("orden");
      if (error) throw error;
      return data as Modulo[];
    },
  });

  if (!grupo) return null;

  const abiertos = (modulos ?? []).filter((m) => tieneModulo(m.clave));
  const cerrados = (modulos ?? []).filter((m) => !tieneModulo(m.clave));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{grupo.marca_comercial ?? grupo.nombre}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Organización <span className="font-mono">{grupo.codigo}</span>
          {grupo.es_maestro && " · organización maestra de la plataforma"}
        </p>
      </div>

      {!instalada && (sePuedeInstalar || esIos) && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-white p-4">
          <div>
            <h2 className="font-medium text-slate-900">Tenla en tu teléfono</h2>
            <p className="mt-1 text-sm text-slate-500">
              {esIos
                ? "Desde Safari: Compartir → Agregar a pantalla de inicio. Queda con el ícono de tu organización, como cualquier app."
                : "Se instala desde el navegador, sin pasar por ninguna tienda. Queda con el ícono de tu organización."}
            </p>
          </div>
          {sePuedeInstalar && (
            <button onClick={instalar} className="shrink-0 rounded bg-slate-900 px-4 py-2 text-sm text-white">
              Instalar
            </button>
          )}
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium text-slate-900">Entidades</h2>
          {esAdmin && (
            <Link to="/admin/empresas" className="text-sm text-slate-500 underline hover:text-slate-700">
              Administrar
            </Link>
          )}
        </div>
        {empresas && empresas.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {empresas.map((e) => (
              <li key={e.id} className="rounded border border-slate-100 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-slate-400">{e.codigo}</span>{" "}
                <span className={e.activo ? "text-slate-800" : "text-slate-400 line-through"}>{e.nombre}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            Todavía no hay razones sociales dadas de alta.{" "}
            {esAdmin ? (
              <Link to="/admin/empresas" className="underline">
                Darlas de alta
              </Link>
            ) : (
              "Un administrador tiene que darlas de alta."
            )}
          </p>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium text-slate-900">Módulos</h2>
          {esAdminGlobal && (
            <Link to="/admin/organizaciones" className="text-sm text-slate-500 underline hover:text-slate-700">
              Abrir o cerrar módulos
            </Link>
          )}
        </div>

        <ul className="space-y-2">
          {abiertos.map((m) => (
            <li key={m.clave} className="flex items-start justify-between gap-4 rounded border border-emerald-100 bg-emerald-50/50 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-slate-900">{m.nombre}</p>
                <p className="text-xs text-slate-500">{m.descripcion}</p>
              </div>
              <Link to={RUTA_DEL_MODULO[m.clave]} className="shrink-0 text-sm text-emerald-700 underline">
                Entrar
              </Link>
            </li>
          ))}
          {cerrados.map((m) => (
            <li key={m.clave} className="flex items-start justify-between gap-4 rounded border border-slate-100 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-slate-500">{m.nombre}</p>
                <p className="text-xs text-slate-400">{m.descripcion}</p>
              </div>
              <span className="shrink-0 text-xs text-slate-400">Sin abrir</span>
            </li>
          ))}
        </ul>

        {abiertos.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">
            Esta organización todavía opera solo con la base: entidades, usuarios y administración. Los módulos se van abriendo conforme se ocupen.
          </p>
        )}
      </section>
    </div>
  );
}
