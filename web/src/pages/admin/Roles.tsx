import { useState } from "react";
import { Link } from "react-router-dom";
import { DESCRIPCION_ROL, ETIQUETA_ROL, NIVELES_ROLES, accesosDelRol, esRolPersonal } from "../../lib/accesosRoles";
import type { AppRol } from "../../types/database";

// Organigrama vertical de roles (Mario, 26-sep-2026): por nivel, cada rol
// con los menús que ve y lo que puede editar. "Ve" sale del catálogo del
// menú; "Edita" es el resumen de las policies (lib/accesosRoles.ts).

export function Roles() {
  const [abierto, setAbierto] = useState<AppRol | null>("admin");
  const [busqueda, setBusqueda] = useState("");
  const q = busqueda.trim().toLowerCase();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Organigrama de accesos por rol</h2>
          <p className="text-xs text-slate-500">De arriba hacia abajo, del que más ve al que menos. Da clic en un rol para ver sus menús y lo que edita. Los roles de personal reciben módulos extra desde RH → Accesos al sistema.</p>
        </div>
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Filtrar por menú (ej. inventario)" className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </div>

      <ol className="relative ml-3 border-l-2 border-slate-200 pl-6">
        {NIVELES_ROLES.map((nivel, i) => (
          <li key={nivel.titulo} className="mb-6">
            <span className="absolute -left-[9px] mt-1.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-slate-300 bg-white text-[9px] text-slate-500">{i + 1}</span>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{nivel.titulo}</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {nivel.roles.map((rol) => {
                const accesos = accesosDelRol(rol).filter((a) => !q || a.etiqueta.toLowerCase().includes(q) || a.seccion.toLowerCase().includes(q) || a.ruta.includes(q));
                const expandido = abierto === rol || !!q;
                const secciones = [...new Set(accesos.map((a) => a.seccion))];
                return (
                  <div key={rol} className={`rounded border bg-white ${expandido ? "border-slate-900" : "border-slate-200"}`}>
                    <button onClick={() => setAbierto(abierto === rol ? null : rol)} className="w-full px-3 py-2 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">{ETIQUETA_ROL[rol]}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{accesos.length} menús</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{DESCRIPCION_ROL[rol]}</div>
                      {esRolPersonal(rol) && <div className="mt-0.5 text-[11px] text-indigo-700">Rol de personal: módulos extra por RH.</div>}
                    </button>
                    {expandido && (
                      <div className="border-t border-slate-100 px-3 py-2">
                        {accesos.length === 0 && <p className="text-xs text-slate-400">No ve ningún menú{q ? " con ese filtro" : ""}.</p>}
                        {secciones.map((s) => (
                          <div key={s} className="mb-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{s}</div>
                            <ul className="mt-0.5 space-y-0.5">
                              {accesos
                                .filter((a) => a.seccion === s)
                                .map((a) => (
                                  <li key={a.ruta} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                                    <Link to={a.ruta} className="font-medium text-slate-800 hover:underline">
                                      {a.etiqueta}
                                    </Link>
                                    {a.conModulo && <span className="rounded bg-indigo-50 px-1 text-[10px] text-indigo-700">con módulo</span>}
                                    <span className={a.edita ? "text-emerald-700" : "text-slate-400"}>{a.edita ? `edita: ${a.edita}` : "solo ve"}</span>
                                  </li>
                                ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
