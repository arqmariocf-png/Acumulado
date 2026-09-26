import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { contarSemaforoPu } from "../../lib/puSemaforo";
import { avanceRequisiciones, type EtapaRequisicion } from "../../lib/requisicionEtapa";
import type { Proyecto, ProyectoControl, PuEstado, Tablero, TableroColumna, Tarjeta } from "../../types/database";

// Resumen físico-financiero de la obra (Mario, 26-sep-2026): pestaña
// principal para el rol empresa hacia arriba; los supervisores no la ven.
// Físico = tareas hechas en los tableros del proyecto, suministro de
// requerimientos y circuito de precios unitarios. Financiero = presupuesto
// contratado de los controles de obra contra lo ejercido (compras + nómina).

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);

function useResumenObra(proyectoId: string) {
  return useQuery({
    queryKey: ["resumen-obra", proyectoId],
    queryFn: async () => {
      const [controles, tableros, pu, req] = await Promise.all([
        supabase.from("proyecto_controles").select("*").eq("proyecto_id", proyectoId).order("created_at"),
        supabase.from("tableros").select("*").eq("proyecto_id", proyectoId).eq("archivado", false),
        supabase.from("pu_analisis").select("estado, cliente_autorizado_en").eq("proyecto_id", proyectoId),
        supabase.from("requisiciones").select("etapa, estado").eq("proyecto_id", proyectoId),
      ]);
      for (const r of [controles, tableros, pu, req]) if (r.error) throw r.error;
      const ctrl = (controles.data ?? []) as ProyectoControl[];
      const ids = ctrl.map((c) => c.id);
      const [compras, nomina] = ids.length
        ? await Promise.all([
            supabase.from("proyecto_control_compras").select("control_id, importe, estatus").in("control_id", ids),
            supabase.from("proyecto_control_nomina").select("control_id, sueldo, semana").in("control_id", ids),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (compras.error) throw compras.error;
      if (nomina.error) throw nomina.error;
      const tabs = (tableros.data ?? []) as Tablero[];
      const tabIds = tabs.map((t) => t.id);
      const [columnas, tarjetas] = tabIds.length
        ? await Promise.all([
            supabase.from("tablero_columnas").select("*").in("tablero_id", tabIds).order("orden"),
            supabase.from("tarjetas").select("*").in("tablero_id", tabIds).eq("archivada", false),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (columnas.error) throw columnas.error;
      if (tarjetas.error) throw tarjetas.error;
      return {
        controles: ctrl,
        compras: (compras.data ?? []) as { control_id: string; importe: number; estatus: "pagado" | "pendiente" }[],
        nomina: (nomina.data ?? []) as { control_id: string; sueldo: number; semana: number }[],
        tableros: tabs,
        columnas: (columnas.data ?? []) as TableroColumna[],
        tarjetas: (tarjetas.data ?? []) as Tarjeta[],
        pu: (pu.data ?? []) as { estado: PuEstado; cliente_autorizado_en: string | null }[],
        requisiciones: (req.data ?? []) as { etapa: EtapaRequisicion; estado: string }[],
      };
    },
  });
}

export function ResumenObra({ proyecto }: { proyecto: Proyecto }) {
  const q = useResumenObra(proyecto.id);
  const d = q.data;
  if (q.isPending) return <p className="text-sm text-slate-500">Calculando…</p>;
  if (q.error || !d) return <p className="text-sm text-red-600">{(q.error as Error)?.message ?? "Sin datos"}</p>;

  // Financiero
  const presupuesto = d.controles.reduce((s, c) => s + Number(c.presupuesto), 0);
  const materiales = d.compras.reduce((s, c) => s + Number(c.importe), 0);
  const materialesPagados = d.compras.filter((c) => c.estatus === "pagado").reduce((s, c) => s + Number(c.importe), 0);
  const nominaTotal = d.nomina.reduce((s, n) => s + Number(n.sueldo), 0);
  const ejercido = materiales + nominaTotal;
  const disponible = presupuesto - ejercido;
  const avanceFinanciero = presupuesto > 0 ? (100 * ejercido) / presupuesto : null;

  // Físico
  const ultimaColumna = new Map<string, string>();
  for (const c of d.columnas) ultimaColumna.set(c.tablero_id, c.id);
  const hechas = d.tarjetas.filter((t) => ultimaColumna.get(t.tablero_id) === t.columna_id).length;
  const avanceTareas = d.tarjetas.length > 0 ? (100 * hechas) / d.tarjetas.length : null;
  const conteoPu = contarSemaforoPu(d.pu);
  const avancePu = d.pu.length > 0 ? conteoPu.avance_pct : null;
  const avanceSuministro = avanceRequisiciones(d.requisiciones);
  const fisicos = [avanceTareas, avanceSuministro, avancePu].filter((x): x is number => x !== null);
  const avanceFisico = fisicos.length > 0 ? fisicos.reduce((s, x) => s + x, 0) / fisicos.length : null;

  const desfase = avanceFisico !== null && avanceFinanciero !== null ? avanceFinanciero - avanceFisico : null;
  const tonoDesfase = desfase === null ? "" : desfase > 10 ? "text-red-700" : desfase > 0 ? "text-amber-700" : "text-emerald-700";

  const barras: { etiqueta: string; valor: number | null; detalle: string }[] = [
    { etiqueta: "Avance físico (promedio)", valor: avanceFisico, detalle: "tareas, suministro y precios unitarios" },
    { etiqueta: "Tareas hechas", valor: avanceTareas, detalle: `${hechas} de ${d.tarjetas.length} tarjetas en ${d.tableros.length} tablero(s)` },
    { etiqueta: "Suministro de requerimientos", valor: avanceSuministro, detalle: `${d.requisiciones.filter((r) => r.estado !== "cancelada").length} requerimiento(s)` },
    { etiqueta: "Precios unitarios autorizados", valor: avancePu, detalle: `${conteoPu.autorizado} de ${d.pu.length} con el cliente` },
    { etiqueta: "Avance financiero (ejercido)", valor: avanceFinanciero, detalle: `${mxn.format(ejercido)} de ${mxn.format(presupuesto)}` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta etiqueta="Presupuesto contratado" valor={mxn.format(presupuesto)} detalle={`${d.controles.length} control(es) de obra`} />
        <Tarjeta etiqueta="Ejercido" valor={mxn.format(ejercido)} detalle={`materiales ${mxn.format(materiales)} · nómina ${mxn.format(nominaTotal)}`} />
        <Tarjeta etiqueta="Disponible" valor={mxn.format(disponible)} detalle={presupuesto > 0 ? `margen ${pct((100 * disponible) / presupuesto)}` : "sin presupuesto capturado"} tono={disponible < 0 ? "text-red-700" : ""} />
        <Tarjeta etiqueta="Físico vs financiero" valor={desfase === null ? "—" : `${desfase > 0 ? "+" : ""}${Math.round(desfase)} pts`} detalle={desfase === null ? "faltan datos" : desfase > 0 ? "se ha gastado más de lo avanzado" : "gasto por debajo del avance"} tono={tonoDesfase} />
      </div>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Avance físico contra financiero</h3>
        <ul className="space-y-2">
          {barras.map((b) => (
            <li key={b.etiqueta} className="text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-700">{b.etiqueta}</span>
                <span className="tabular-nums text-slate-900">{pct(b.valor)}</span>
              </div>
              <div className="mt-0.5 h-2.5 w-full rounded bg-slate-100" title={b.detalle}>
                <div className={`h-2.5 rounded ${b.etiqueta.startsWith("Avance financiero") ? "bg-orange-500" : "bg-blue-600"}`} style={{ width: `${Math.min(100, Math.max(0, b.valor ?? 0))}%` }} />
              </div>
              <div className="text-[11px] text-slate-400">{b.detalle}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Por control de obra</h3>
        {d.controles.length === 0 ? (
          <p className="text-sm text-slate-400">Sin control de obra: el presupuesto y lo ejercido salen de ahí (pestaña Control de obra).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Especialidad</th>
                  <th className="py-1 pr-3 text-right">Presupuesto</th>
                  <th className="py-1 pr-3 text-right">Materiales</th>
                  <th className="py-1 pr-3 text-right">Nómina</th>
                  <th className="py-1 pr-3 text-right">Ejercido</th>
                  <th className="py-1 pr-3 text-right">Semanas</th>
                  <th className="py-1">Estatus</th>
                </tr>
              </thead>
              <tbody>
                {d.controles.map((c) => {
                  const mat = d.compras.filter((x) => x.control_id === c.id).reduce((s, x) => s + Number(x.importe), 0);
                  const nom = d.nomina.filter((x) => x.control_id === c.id).reduce((s, x) => s + Number(x.sueldo), 0);
                  const semanas = d.nomina.filter((x) => x.control_id === c.id).reduce((m, x) => Math.max(m, x.semana), 0);
                  const p = Number(c.presupuesto);
                  const ej = p > 0 ? (100 * (mat + nom)) / p : null;
                  return (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="py-1 pr-3">{c.especialidad}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{mxn.format(p)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{mxn.format(mat)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{mxn.format(nom)}</td>
                      <td className={`py-1 pr-3 text-right tabular-nums ${ej !== null && ej > 100 ? "text-red-700" : ""}`}>
                        {mxn.format(mat + nom)} <span className="text-xs text-slate-400">({pct(ej)})</span>
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">{semanas}</td>
                      <td className="py-1 capitalize text-slate-600">{c.estatus.replace("_", " ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">Compras pagadas: {mxn.format(materialesPagados)} de {mxn.format(materiales)}.</p>
      </section>
    </div>
  );
}

function Tarjeta({ etiqueta, valor, detalle, tono = "" }: { etiqueta: string; valor: string; detalle?: string; tono?: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="text-[11px] uppercase text-slate-500">{etiqueta}</div>
      <div className={`text-xl font-semibold tabular-nums ${tono || "text-slate-900"}`}>{valor}</div>
      {detalle && <div className="text-[11px] text-slate-500">{detalle}</div>}
    </div>
  );
}
