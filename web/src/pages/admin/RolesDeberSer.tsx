import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { SECCIONES, seccionesPara } from "../../lib/menu";
import { modulosEfectivos } from "../../lib/modulos";
import { ETIQUETA_ROL } from "../../lib/accesosRoles";
import { APLICAR_ROLES_DEBER_SER, PUESTOS, TODOS_LOS_MENUS, equivalencia, menusQueSeQuitan, nombrePuestos, type Puesto } from "../../lib/rolesDeberSer";
import type { Profile } from "../../types/database";

// Roles del deber ser, para validar antes de aplicarlos (21-oct-2026, Mario:
// "sí, con tu propuesta de equivalencias"): por cada persona activa, a qué
// puesto del Excel equivale su rol de hoy y qué menús dejaría de ver. Nada se
// esconde hasta que Mario lo valide (APLICAR_ROLES_DEBER_SER).

const titulo = (clave: string) => SECCIONES.find((s) => s.clave === clave)?.titulo ?? clave;

export function RolesDeberSer() {
  const { alcanceOrganizacion, perfilReal } = useAuth();
  const [soloCambios, setSoloCambios] = useState(true);
  const personas = useQuery({
    queryKey: ["roles-deber-ser", perfilReal?.grupo_id],
    enabled: perfilReal?.rol === "admin",
    queryFn: async () => {
      const [{ data: perfiles, error }, { data: permisos, error: e2 }] = await Promise.all([
        supabase.from("profiles").select("*").eq("activo", true).neq("rol", "pendiente").order("nombre"),
        supabase.from("permisos_modulo").select("profile_id, modulo"),
      ]);
      if (error) throw error;
      if (e2) throw e2;
      const porPersona = new Map<string, string[]>();
      for (const p of permisos ?? []) porPersona.set(p.profile_id, [...(porPersona.get(p.profile_id) ?? []), p.modulo]);
      return ((perfiles ?? []) as Profile[])
        .filter((p) => !p.espectador && (!perfilReal?.grupo_id || p.grupo_id === perfilReal.grupo_id))
        .map((p) => ({ ...p, modulos: modulosEfectivos(p.rol, porPersona.get(p.id) ?? []) }));
    },
  });

  const filas = useMemo(
    () =>
      (personas.data ?? [])
        .map((p) => {
          const hoy = seccionesPara(p, alcanceOrganizacion).map((s) => s.clave);
          const eq = equivalencia(p);
          return { p, hoy, eq, quita: menusQueSeQuitan(p, hoy) };
        })
        .sort((a, b) => b.quita.length - a.quita.length || a.p.nombre.localeCompare(b.p.nombre, "es")),
    [personas.data, alcanceOrganizacion],
  );
  const conCambios = filas.filter((f) => f.quita.length > 0);
  const lista = soloCambios ? conCambios : filas;

  if (perfilReal?.rol !== "admin") return <p className="text-sm text-slate-500">Solo el director general revisa los roles.</p>;

  return (
    <div className="space-y-6">
      <div className={`rounded border px-3 py-2 text-sm ${APLICAR_ROLES_DEBER_SER ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        {APLICAR_ROLES_DEBER_SER
          ? "Los roles del deber ser ya se aplican: cada quien ve solo los menús de su puesto."
          : `Propuesta sin aplicar: hoy nadie pierde nada. Con la matriz, ${conCambios.length} de ${filas.length} personas dejarían de ver algún menú. Revisa la tabla y dime qué cambiar o "aplícalo".`}
      </div>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Persona por persona</h2>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={soloCambios} onChange={(e) => setSoloCambios(e.target.checked)} /> solo quien dejaría de ver algo
          </label>
        </div>
        {personas.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
        {personas.error && <p className="text-sm text-red-600">{(personas.error as Error).message}</p>}
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Persona</th>
                <th className="px-3 py-2">Rol de hoy</th>
                <th className="px-3 py-2">Puesto del deber ser</th>
                <th className="px-3 py-2 text-right">Menús hoy</th>
                <th className="px-3 py-2">Dejaría de ver</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(({ p, hoy, eq, quita }) => (
                <tr key={p.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">{p.nombre}</td>
                  <td className="px-3 py-2 text-xs">
                    {ETIQUETA_ROL[p.rol] ?? p.rol}
                    {p.modulos.filter((m) => m !== "tareas").length > 0 && <div className="text-slate-400">permisos: {p.modulos.filter((m) => m !== "tareas").join(", ")}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {nombrePuestos(eq)}
                    {eq.nota && <div className="text-slate-400">{eq.nota}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{hoy.length}</td>
                  <td className="px-3 py-2 text-xs">{quita.length ? <span className="text-red-700">{quita.map(titulo).join(", ")}</span> : <span className="text-emerald-700">nada</span>}</td>
                </tr>
              ))}
              {lista.length === 0 && !personas.isLoading && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    Nadie pierde menús con la propuesta.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">La matriz del Excel (qué menú ve cada puesto)</h2>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="sticky left-0 bg-slate-50 px-2 py-1 text-left">Puesto</th>
                {TODOS_LOS_MENUS.map((m) => (
                  <th key={m} className="px-1 py-1 font-normal [writing-mode:vertical-rl]">
                    {titulo(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(PUESTOS) as Puesto[]).map((k) => (
                <tr key={k} className="border-t border-slate-100">
                  <td className="sticky left-0 whitespace-nowrap bg-white px-2 py-1">{PUESTOS[k].nombre}</td>
                  {TODOS_LOS_MENUS.map((m) => (
                    <td key={m} className="px-1 py-1 text-center">
                      {PUESTOS[k].menus.includes(m) ? "●" : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Equivalencias propuestas: director general → Dirección general · dirección (Laura) → Finanzas y tesorería + Catálogos · corporativo con tesorería (Delia)
          → Finanzas y tesorería · corporativo (Belén, Allison) → Contabilidad · RH → Recursos humanos · almacén (Alma) → Almacenista + Compras · producción (Jaime) →
          Jefe de producción + Ventas · responsable o supervisor BBVA (Christian, cuadrillas) → Coordinador BBVA · responsable, supervisor, directivo y administrativo
          con obras → Residente · operativo → Mi día · permisos por persona suman su menú (legal, compras, cotizador, requisiciones, herramienta…) · rol empresa (Jorge)
          se queda como hoy.
        </p>
      </section>
    </div>
  );
}
