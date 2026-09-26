import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { CLASE_ETAPA, avanceRequisiciones, semaforoEtapa, type ColorEtapa, type EtapaRequisicion } from "../../lib/requisicionEtapa";

// Estadística de almacén por proyecto (Mario, 26-sep-2026): el semáforo de
// suministro de los requerimientos, proyecto por proyecto, en el área de
// Proyectos. La ve quien ve los proyectos (Jorge incluido).

export interface FilaReq {
  proyecto_id: string;
  etapa: EtapaRequisicion;
  estado: string;
}

export function useRequisicionesPorProyecto(ids: string[]) {
  return useQuery({
    queryKey: ["req-semaforo-proyectos", ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("requisiciones").select("proyecto_id, etapa, estado").in("proyecto_id", ids);
      if (error) throw error;
      const por = new Map<string, FilaReq[]>();
      for (const f of (data ?? []) as FilaReq[]) {
        const lista = por.get(f.proyecto_id) ?? [];
        lista.push(f);
        por.set(f.proyecto_id, lista);
      }
      return por;
    },
  });
}

const ETIQUETA_COLOR: Record<ColorEtapa, string> = { rojo: "Por autorizar / pagar", ambar: "En suministro", azul: "En bodega / tránsito", verde: "Recibidos", gris: "Cancelados" };

function conteoPorColor(filas: FilaReq[]): Record<ColorEtapa, number> {
  const c: Record<ColorEtapa, number> = { rojo: 0, ambar: 0, azul: 0, verde: 0, gris: 0 };
  for (const f of filas) c[semaforoEtapa(f.etapa, f.estado === "cancelada").color]++;
  return c;
}

/** Puntos con conteo para la tarjeta de un proyecto en la lista. */
export function PuntosAlmacen({ filas }: { filas: FilaReq[] }) {
  const vivas = filas.filter((f) => f.estado !== "cancelada");
  if (vivas.length === 0) return <p className="mt-1 text-xs text-slate-400">Sin requerimientos.</p>;
  const c = conteoPorColor(filas);
  const avance = avanceRequisiciones(filas);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span className="text-slate-500">Almacén {avance ?? 0}%</span>
      {(["rojo", "ambar", "azul", "verde"] as ColorEtapa[])
        .filter((k) => c[k] > 0)
        .map((k) => (
          <span key={k} className="flex items-center gap-1" title={ETIQUETA_COLOR[k]}>
            <span className={`h-2.5 w-2.5 rounded-full ${CLASE_ETAPA[k].punto}`} />
            {c[k]}
          </span>
        ))}
    </div>
  );
}

/** Tabla "Almacén por proyecto": un renglón por proyecto con requerimientos,
 * ordenada por lo que más urge (rojos primero). */
export function AlmacenPorProyecto({ proyectos, porProyecto }: { proyectos: { id: string; nombre: string; empresa?: string | null }[]; porProyecto: Map<string, FilaReq[]> }) {
  const [abierto, setAbierto] = useState(true);
  const filas = useMemo(
    () =>
      proyectos
        .map((p) => {
          const reqs = porProyecto.get(p.id) ?? [];
          const vivas = reqs.filter((f) => f.estado !== "cancelada");
          return { ...p, n: vivas.length, c: conteoPorColor(reqs), avance: avanceRequisiciones(reqs) };
        })
        .filter((p) => p.n > 0)
        .sort((a, b) => b.c.rojo - a.c.rojo || b.c.ambar - a.c.ambar || (a.avance ?? 0) - (b.avance ?? 0)),
    [proyectos, porProyecto],
  );
  const total = filas.reduce((s, f) => s + f.n, 0);
  const totales = filas.reduce(
    (acc, f) => {
      for (const k of ["rojo", "ambar", "azul", "verde"] as const) acc[k] += f.c[k];
      return acc;
    },
    { rojo: 0, ambar: 0, azul: 0, verde: 0 } as Record<"rojo" | "ambar" | "azul" | "verde", number>,
  );

  return (
    <section className="mb-4 rounded border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium text-slate-900">Almacén · suministro por proyecto</h2>
          <p className="text-xs text-slate-500">Semáforo de los requerimientos: rojo por autorizar o pagar, ámbar en suministro, azul en bodega o en tránsito, verde recibido en obra.</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {(["rojo", "ambar", "azul", "verde"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1 text-slate-600" title={ETIQUETA_COLOR[k]}>
              <span className={`h-2.5 w-2.5 rounded-full ${CLASE_ETAPA[k].punto}`} /> {totales[k]}
            </span>
          ))}
          <span className="text-slate-400">· {total} en {filas.length} proyecto(s)</span>
          <button onClick={() => setAbierto((v) => !v)} className="text-slate-500 underline">
            {abierto ? "ocultar" : "ver tabla"}
          </button>
        </div>
      </div>
      {abierto && (
        <div className="mt-3 overflow-x-auto">
          {filas.length === 0 ? (
            <p className="text-sm text-slate-400">Ningún proyecto de esta vista tiene requerimientos todavía.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Proyecto</th>
                  <th className="py-1 pr-3 text-right">Requerimientos</th>
                  <th className="py-1 pr-3 text-right"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 align-middle" /> Por autorizar / pagar</th>
                  <th className="py-1 pr-3 text-right"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500 align-middle" /> Suministro</th>
                  <th className="py-1 pr-3 text-right"><span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-500 align-middle" /> Bodega / tránsito</th>
                  <th className="py-1 pr-3 text-right"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 align-middle" /> Recibidos</th>
                  <th className="py-1 text-right">Avance</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} className="border-t border-slate-100">
                    <td className="py-1 pr-3">
                      <Link to={`/proyectos/${f.id}`} className="font-medium text-slate-800 hover:underline">
                        {f.nombre}
                      </Link>
                      {f.empresa && <span className="ml-1 text-xs text-slate-400">{f.empresa}</span>}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">{f.n}</td>
                    <td className={`py-1 pr-3 text-right tabular-nums ${f.c.rojo > 0 ? "font-medium text-red-700" : "text-slate-400"}`}>{f.c.rojo}</td>
                    <td className={`py-1 pr-3 text-right tabular-nums ${f.c.ambar > 0 ? "text-amber-700" : "text-slate-400"}`}>{f.c.ambar}</td>
                    <td className={`py-1 pr-3 text-right tabular-nums ${f.c.azul > 0 ? "text-sky-700" : "text-slate-400"}`}>{f.c.azul}</td>
                    <td className={`py-1 pr-3 text-right tabular-nums ${f.c.verde > 0 ? "text-emerald-700" : "text-slate-400"}`}>{f.c.verde}</td>
                    <td className="py-1 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-24 rounded bg-slate-100">
                          <div className="h-1.5 rounded bg-blue-600" style={{ width: `${f.avance ?? 0}%` }} />
                        </div>
                        <span className="w-10 tabular-nums">{f.avance ?? 0}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
