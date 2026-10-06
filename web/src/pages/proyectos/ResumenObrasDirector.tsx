import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { calcularResumenObra, semaforoDesfase } from "../../lib/resumenObra";
import type { EtapaRequisicion } from "../../lib/requisicionEtapa";
import type { PuEstado } from "../../types/database";

// Resumen físico-financiero de todas las obras, solo para el director general
// (Mario, 6-oct-2026: "así como me aparecen mis actividades, el resumen por
// obra en tema físico-financiero"). Una sola consulta (fn_resumen_obras_director)
// y el mismo cálculo que la pestaña de cada obra (lib/resumenObra.ts).

interface FilaObra {
  proyecto_id: string;
  nombre: string;
  empresa_codigo: string;
  responsable: string | null;
  presupuesto: number;
  materiales: number;
  materiales_pagados: number;
  nomina: number;
  tarjetas: number;
  hechas: number;
  requisiciones: { etapa: EtapaRequisicion; estado: string; avance_pct: number | null }[];
  pu: { estado: PuEstado; cliente_autorizado_en: string | null }[];
}

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);
const PUNTO: Record<string, string> = { rojo: "bg-red-500", ambar: "bg-amber-500", verde: "bg-emerald-500", gris: "bg-slate-300" };

function Barra({ valor, color }: { valor: number | null; color: string }) {
  return (
    <div className="h-1.5 w-20 rounded bg-slate-100">
      <div className={`h-1.5 rounded ${color}`} style={{ width: `${Math.min(100, Math.max(0, valor ?? 0))}%` }} />
    </div>
  );
}

export function ResumenObrasDirector() {
  const [abierto, setAbierto] = useState(true);
  const [soloConPresupuesto, setSoloConPresupuesto] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["resumen-obras-director"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_resumen_obras_director");
      if (error) throw error;
      return (data ?? []) as FilaObra[];
    },
  });

  const filas = useMemo(() => {
    const lista = (data ?? []).map((o) => {
      const datos = { ...o, presupuesto: Number(o.presupuesto), materiales: Number(o.materiales), nomina: Number(o.nomina) };
      const r = calcularResumenObra(datos);
      return { o: datos, r, semaforo: semaforoDesfase(r, datos.presupuesto) };
    });
    const orden = { rojo: 0, ambar: 1, verde: 2, gris: 3 };
    return lista
      .filter((x) => !soloConPresupuesto || x.o.presupuesto > 0)
      .sort((a, b) => orden[a.semaforo] - orden[b.semaforo] || b.o.presupuesto - a.o.presupuesto || a.o.nombre.localeCompare(b.o.nombre));
  }, [data, soloConPresupuesto]);

  const totales = filas.reduce(
    (t, x) => ({ presupuesto: t.presupuesto + x.o.presupuesto, ejercido: t.ejercido + x.r.ejercido, rojas: t.rojas + (x.semaforo === "rojo" ? 1 : 0) }),
    { presupuesto: 0, ejercido: 0, rojas: 0 },
  );

  return (
    <section id="resumen-obras" className="mb-6 rounded border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-800">Resumen físico-financiero por obra</h2>
        <span className="text-xs text-slate-500">
          {filas.length} obra(s) · presupuesto {mxn.format(totales.presupuesto)} · ejercido {mxn.format(totales.ejercido)}
          {totales.rojas > 0 && <span className="ml-1 font-medium text-red-700">· {totales.rojas} con desfase</span>}
        </span>
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={soloConPresupuesto} onChange={(e) => setSoloConPresupuesto(e.target.checked)} /> solo con presupuesto
        </label>
        <button onClick={() => setAbierto((v) => !v)} className="text-xs text-slate-500 underline">
          {abierto ? "ocultar" : "ver"}
        </button>
      </div>
      {abierto && (
        <div className="mt-3 overflow-x-auto">
          {isLoading && <p className="text-sm text-slate-500">Calculando…</p>}
          {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
          {!isLoading && filas.length === 0 && <p className="text-sm text-slate-500">Ninguna obra tiene todavía controles, tareas, requerimientos ni precios unitarios.</p>}
          {filas.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-2"></th>
                  <th className="pr-2">Obra</th>
                  <th className="pr-2">Físico</th>
                  <th className="pr-2">Financiero</th>
                  <th className="pr-2 text-right">Presupuesto</th>
                  <th className="pr-2 text-right">Ejercido</th>
                  <th className="pr-2 text-right">Disponible</th>
                  <th className="pr-2 text-right">Desfase</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(({ o, r, semaforo }) => (
                  <tr key={o.proyecto_id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${PUNTO[semaforo]}`} />
                    </td>
                    <td className="pr-2">
                      <Link to={`/proyectos/${o.proyecto_id}`} className="font-medium text-slate-900 hover:underline">
                        {o.nombre}
                      </Link>
                      <div className="text-[11px] text-slate-500">
                        {o.empresa_codigo}
                        {o.responsable ? ` · ${o.responsable}` : ""} · {o.hechas}/{o.tarjetas} tareas · {o.requisiciones.length} req.
                      </div>
                    </td>
                    <td className="pr-2">
                      <div className="flex items-center gap-2">
                        <Barra valor={r.avanceFisico} color="bg-blue-600" />
                        <span className="tabular-nums text-xs">{pct(r.avanceFisico)}</span>
                      </div>
                    </td>
                    <td className="pr-2">
                      <div className="flex items-center gap-2">
                        <Barra valor={r.avanceFinanciero} color="bg-orange-500" />
                        <span className="tabular-nums text-xs">{pct(r.avanceFinanciero)}</span>
                      </div>
                    </td>
                    <td className="pr-2 text-right tabular-nums">{o.presupuesto > 0 ? mxn.format(o.presupuesto) : "—"}</td>
                    <td className="pr-2 text-right tabular-nums">{r.ejercido > 0 ? mxn.format(r.ejercido) : "—"}</td>
                    <td className={`pr-2 text-right tabular-nums ${o.presupuesto > 0 && r.disponible < 0 ? "text-red-700" : ""}`}>{o.presupuesto > 0 ? mxn.format(r.disponible) : "—"}</td>
                    <td className={`pr-2 text-right tabular-nums ${semaforo === "rojo" ? "text-red-700" : semaforo === "ambar" ? "text-amber-700" : ""}`}>
                      {r.desfase === null ? "—" : `${r.desfase > 0 ? "+" : ""}${Math.round(r.desfase)} pts`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-slate-400">
            Físico = promedio de tareas hechas, suministro de requerimientos y precios unitarios. Financiero = ejercido (compras + nómina de los controles de obra) entre presupuesto. Desfase en rojo: se ha gastado más de 10 puntos por encima de lo avanzado o se rebasó el presupuesto.
          </p>
        </div>
      )}
    </section>
  );
}
