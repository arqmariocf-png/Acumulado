import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { calcularResumenObra, semaforoDesfase } from "../../lib/resumenObra";
import type { EtapaRequisicion } from "../../lib/requisicionEtapa";
import type { PuEstado } from "../../types/database";

// Resumen físico-financiero de todas las obras para el director general y,
// desde el 19-oct-2026, también para dirección/finanzas (Laura) y desde el 20-oct para el rol empresa (Jorge, solo sus empresas) (Mario, 6-oct:
// "el resumen por obra en tema físico-financiero"; 19-oct: "agrégalas [las
// OC] y la mano de obra"). Una sola consulta (fn_resumen_obras_director) y el
// mismo cálculo que la pestaña de cada obra (lib/resumenObra.ts).

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
  oc_num: number;
  oc_total: number;
  oc_pagado: number;
  mo_total: number;
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
      const datos = {
        ...o,
        presupuesto: Number(o.presupuesto),
        materiales: Number(o.materiales),
        nomina: Number(o.nomina),
        oc: Number(o.oc_total),
        manoObra: Number(o.mo_total),
      };
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
                    {/* Cada gráfica y cifra abre lo que la explica (Mario, 23-oct-2026). */}
                    <td className="pr-2">
                      <Link to={`/proyectos/${o.proyecto_id}?tab=avance`} title="Abrir el tablero de seguimiento" className="flex items-center gap-2 hover:underline">
                        <Barra valor={r.avanceFisico} color="bg-blue-600" />
                        <span className="tabular-nums text-xs">{pct(r.avanceFisico)}</span>
                      </Link>
                    </td>
                    <td className="pr-2">
                      <Link to={`/finanzas/avance-financiero?obra=${o.proyecto_id}`} title="Abrir el avance financiero de la obra" className="flex items-center gap-2 hover:underline">
                        <Barra valor={r.avanceFinanciero} color="bg-orange-500" />
                        <span className="tabular-nums text-xs">{pct(r.avanceFinanciero)}</span>
                      </Link>
                    </td>
                    <td className="pr-2 text-right tabular-nums">
                      {o.presupuesto > 0 ? <Link to={`/proyectos/${o.proyecto_id}?tab=control`} title="Abrir el control de obra" className="hover:underline">{mxn.format(o.presupuesto)}</Link> : <Link to={`/finanzas/avance-financiero?obra=${o.proyecto_id}&vista=capturar`} className="text-xs text-sky-700 hover:underline">capturar</Link>}
                    </td>
                    <td className="pr-2 text-right tabular-nums" title={`OC ${mxn.format(r.desglose.oc)} · mano de obra ${mxn.format(r.desglose.manoObra)} · otras compras ${mxn.format(r.desglose.compras)}`}>
                      {r.ejercido > 0 ? <Link to={`/proyectos/${o.proyecto_id}?tab=resumen#gastos`} title="Ver cada OC/OS y la mano de obra" className="hover:underline">{mxn.format(r.ejercido)}</Link> : "—"}
                      {r.ejercido > 0 && (
                        <div className="text-[10px] text-slate-500">
                          <Link to={`/proyectos/${o.proyecto_id}?tab=resumen#gastos`} className="hover:underline">OC {mxn.format(r.desglose.oc)}</Link> · <Link to={`/proyectos/${o.proyecto_id}?tab=resumen#mano-obra`} className="hover:underline">MO {mxn.format(r.desglose.manoObra)}</Link>
                        </div>
                      )}
                    </td>
                    <td className={`pr-2 text-right tabular-nums ${o.presupuesto > 0 && r.disponible < 0 ? "text-red-700" : ""}`}>
                      {o.presupuesto > 0 ? <Link to={`/finanzas/avance-financiero?obra=${o.proyecto_id}&vista=periodo`} title="Presupuesto contra real por mes" className="hover:underline">{mxn.format(r.disponible)}</Link> : "—"}
                    </td>
                    <td className={`pr-2 text-right tabular-nums ${semaforo === "rojo" ? "text-red-700" : semaforo === "ambar" ? "text-amber-700" : ""}`}>
                      <Link to={`/proyectos/${o.proyecto_id}?tab=resumen`} title="Abrir el resumen físico-financiero de la obra" className="hover:underline">{r.desfase === null ? "—" : `${r.desfase > 0 ? "+" : ""}${Math.round(r.desfase)} pts`}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-slate-400">
            Físico = promedio de tareas hechas, suministro de requerimientos y precios unitarios. Ejercido = órdenes de compra y de servicio de la obra (sin
            canceladas, a subtotal sin IVA) + mano de obra pagada por semana (backoffice) + compras capturadas en el control de obra sin OC: el mismo
            cálculo que Finanzas › Avance financiero de obras. Financiero = ejercido entre el presupuesto capturado por categoría o, si no hay, el de los
            controles de obra (sin presupuesto no hay %). Desfase en rojo: se ha gastado más de 10 puntos por encima de lo
            avanzado o se rebasó el presupuesto.
          </p>
        </div>
      )}
    </section>
  );
}
