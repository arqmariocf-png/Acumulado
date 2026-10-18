import { CLASE_SEMAFORO, ETIQUETA_AREA, ETIQUETA_RESULTADO, SEMAFORO_RESULTADO, estadoFlujo, etiquetaPeriodo, periodosHasta, ultimaPrueba } from "../../lib/cumplimientoNormativo";
import { useControles, usePruebas } from "./datos";
import { hoyMexico } from "./comun";

const ESTADO = {
  revisado: { texto: "Revisado", clase: "bg-emerald-50 text-emerald-700" },
  por_revisar: { texto: "Por revisar este periodo", clase: "bg-amber-50 text-amber-700" },
  atrasado: { texto: "Atrasado", clase: "bg-red-50 text-red-700" },
};

/** Paso 5: los mismos controles cada periodo. Qué toca revisar ahora, quién, y
 * el histórico de cada control para ver si mejora o empeora. */
export function Flujos() {
  const controles = useControles();
  const pruebas = usePruebas();
  const hoy = hoyMexico();
  const activos = (controles.data ?? []).filter((c) => c.activo);
  const filas = activos.map((c) => ({ c, flujo: estadoFlujo(c, pruebas.data ?? [], hoy) }));
  const pendientes = filas.filter((f) => f.flujo.estado !== "revisado");

  if (controles.isLoading || pruebas.isLoading) return <p className="text-sm text-slate-400">Cargando…</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Los controles automáticos se prueban solos el día 1 de cada mes (los trimestrales al cerrar marzo, junio, septiembre y diciembre). Los manuales le tocan a su
        responsable: aquí se ve qué falta.
      </p>
      <div>
        <h3 className="mb-1 font-medium text-slate-800">
          Por revisar ({pendientes.length} de {filas.length})
        </h3>
        {!pendientes.length ? (
          <p className="text-sm text-emerald-700">Todo revisado en el periodo actual.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
            {pendientes.map(({ c, flujo }) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                <span>
                  <span className="mr-2 font-mono text-xs text-slate-500">{c.clave}</span>
                  {c.nombre}
                  <span className="ml-2 text-xs text-slate-500">
                    {etiquetaPeriodo(flujo.periodo)} · {c.prueba ? "automático (o «Probar ahora»)" : c.responsable_nombre ?? "sin responsable"}
                  </span>
                </span>
                <span className={`rounded px-2 py-0.5 text-xs ${ESTADO[flujo.estado].clase}`}>{ESTADO[flujo.estado].texto}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {(["mensual", "trimestral"] as const).map((frecuencia) => {
        const deEsta = activos.filter((c) => c.frecuencia === frecuencia);
        if (!deEsta.length) return null;
        const periodos = periodosHasta(hoy, frecuencia, frecuencia === "mensual" ? 6 : 4);
        return (
          <div key={frecuencia} className="overflow-x-auto">
            <h3 className="mb-1 font-medium text-slate-800">Histórico {frecuencia}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 pr-2">Control</th>
                  {periodos.map((p) => (
                    <th key={p} className="px-1 py-1 text-center">
                      {etiquetaPeriodo(p).replace(" trimestre", " trim.")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deEsta.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="py-1 pr-2">
                      <span className="mr-1 font-mono text-xs text-slate-500">{c.clave}</span>
                      {c.nombre}
                      <span className="ml-1 text-xs text-slate-400">{ETIQUETA_AREA[c.area]}</span>
                    </td>
                    {periodos.map((p) => {
                      const pr = ultimaPrueba(pruebas.data ?? [], c.id, p);
                      return (
                        <td key={p} className="px-1 py-1 text-center">
                          {pr ? (
                            <span
                              className={`inline-block min-w-[2.5rem] rounded px-1 text-xs ${CLASE_SEMAFORO[SEMAFORO_RESULTADO[pr.resultado]]}`}
                              title={`${ETIQUETA_RESULTADO[pr.resultado]}${pr.excepciones != null ? ` · ${pr.excepciones} de ${pr.poblacion ?? "?"}` : ""}`}
                            >
                              {pr.resultado === "cumple" ? "✓" : pr.excepciones ?? "✕"}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="text-xs text-slate-500">✓ cumple · número = casos con falla · · sin revisar</p>
    </div>
  );
}
