import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { seccionesPara } from "../lib/menu";

/** Guía de uso: qué hace cada módulo que esta persona puede ver y cuándo
 * usarlo. Misma fuente que el menú (lib/menu.ts). */
export function Guia() {
  const { perfil, alcanceOrganizacion } = useAuth();
  const secciones = seccionesPara(perfil, alcanceOrganizacion);
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900">Guía de uso</h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        Esto es lo que puedes hacer con tu cuenta ({perfil?.rol}). Si necesitas un módulo que no aparece, pídeselo a RH o al administrador.
      </p>
      {secciones.map((s) => (
        <section key={s.clave} className="mb-6">
          <h2 className="text-base font-semibold text-slate-900">{s.titulo}</h2>
          <p className="mb-2 text-sm text-slate-500">{s.proposito}</p>
          <div className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
            {s.entradas.map((e) => (
              <div key={e.ruta} className="grid gap-1 px-3 py-2 sm:grid-cols-[180px_1fr]">
                <Link to={e.ruta} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                  {e.etiqueta}
                </Link>
                <div className="text-sm text-slate-600">
                  <div>{e.descripcion.charAt(0).toUpperCase() + e.descripcion.slice(1)}.</div>
                  <div className="text-xs text-slate-500">{e.uso}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
