import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";
import { contarSemaforoPu } from "../../lib/puSemaforo";
import { type EtapaRequisicion } from "../../lib/requisicionEtapa";
import { calcularResumenObra } from "../../lib/resumenObra";
import type { Proyecto, ProyectoControl, PuEstado, Tablero, TableroColumna, Tarjeta } from "../../types/database";

// Resumen físico-financiero de la obra (Mario, 26-sep-2026): pestaña
// principal para el rol empresa hacia arriba; los supervisores no la ven.
// Físico = tareas hechas en los tableros del proyecto, suministro de
// requerimientos y circuito de precios unitarios. Financiero = presupuesto
// contratado de los controles de obra contra lo ejercido: OC/OS de la obra +
// mano de obra pagada por semana (backoffice, 19-oct-2026) + compras
// capturadas sin OC (fn_obra_gasto). Cada cifra lleva su liga (Mario,
// 23-oct-2026: "hipervínculos para ver cada gráfica y cada gasto que incluye,
// e irnos a los presupuestos y avances en un solo clic"): tarjetas y barras a
// su pestaña o a Avance financiero, y cada OC/OS de la obra (fn_obra_ordenes)
// con "Ver orden" y la lista completa en Órdenes.

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);

interface OrdenObra {
  id: string;
  id_orden: string;
  tipo: string;
  empresa_codigo: string;
  proveedor: string | null;
  fecha_creacion: string | null;
  total: number;
  pagado: number;
  saldo: number;
  pagada: boolean;
  estatus: string | null;
  fuente: string;
}

interface GastoObra {
  oc_num: number;
  oc_total: number;
  oc_pagado: number;
  mo_total: number;
  mo_semanas: { anio: number; semana: number; inicio: string; fin: string; monto: number }[];
  mo_partidas: { partida: string; monto: number }[];
}

function useResumenObra(proyectoId: string) {
  return useQuery({
    queryKey: ["resumen-obra", proyectoId],
    queryFn: async () => {
      const [controles, tableros, pu, req, gasto, ordenes, presupuestoCat] = await Promise.all([
        supabase.from("proyecto_controles").select("*").eq("proyecto_id", proyectoId).order("created_at"),
        supabase.from("tableros").select("*").eq("proyecto_id", proyectoId).eq("archivado", false),
        supabase.from("pu_analisis").select("estado, cliente_autorizado_en").eq("proyecto_id", proyectoId),
        supabase.from("requisiciones").select("id, etapa, estado").eq("proyecto_id", proyectoId),
        supabase.rpc("fn_obra_gasto", { p_proyecto: proyectoId }),
        supabase.rpc("fn_obra_ordenes", { p_proyecto: proyectoId }),
        supabase.from("obra_presupuesto").select("monto").eq("proyecto_id", proyectoId),
      ]);
      for (const r of [controles, tableros, pu, req, gasto, ordenes, presupuestoCat]) if (r.error) throw r.error;
      const ctrl = (controles.data ?? []) as ProyectoControl[];
      const ids = ctrl.map((c) => c.id);
      const [compras, nomina] = ids.length
        ? await Promise.all([
            supabase.from("proyecto_control_compras").select("control_id, importe, estatus, orden_compra_id").in("control_id", ids),
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
      const reqIds = (req.data ?? []).map((r) => r.id as string);
      const { data: av } = reqIds.length ? await supabase.from("v_requisicion_avance").select("requisicion_id, avance_pct").in("requisicion_id", reqIds) : { data: [] };
      const avancePct = new Map((av ?? []).map((a) => [a.requisicion_id as string, Number(a.avance_pct)]));
      return {
        controles: ctrl,
        // Presupuesto capturado por categoría (Finanzas › Avance financiero); manda sobre el de los controles.
        presupuestoCategorias: (presupuestoCat.data ?? []).reduce((s, r) => s + Number((r as { monto: number }).monto), 0),
        compras: (compras.data ?? []) as { control_id: string; importe: number; estatus: "pagado" | "pendiente"; orden_compra_id: string | null }[],
        gasto: ((gasto.data ?? []) as GastoObra[])[0] ?? null,
        ordenes: (ordenes.data ?? []) as OrdenObra[],
        nomina: (nomina.data ?? []) as { control_id: string; sueldo: number; semana: number }[],
        tableros: tabs,
        columnas: (columnas.data ?? []) as TableroColumna[],
        tarjetas: (tarjetas.data ?? []) as Tarjeta[],
        pu: (pu.data ?? []) as { estado: PuEstado; cliente_autorizado_en: string | null }[],
        requisiciones: ((req.data ?? []) as { id: string; etapa: EtapaRequisicion; estado: string }[]).map((r) => ({ ...r, avance_pct: avancePct.get(r.id) ?? null })),
      };
    },
  });
}

export function ResumenObra({ proyecto }: { proyecto: Proyecto }) {
  const q = useResumenObra(proyecto.id);
  const d = q.data;
  if (q.isPending) return <p className="text-sm text-slate-500">Calculando…</p>;
  if (q.error || !d) return <p className="text-sm text-red-600">{(q.error as Error)?.message ?? "Sin datos"}</p>;

  // Financiero y físico: misma regla que el panel del director general (lib/resumenObra.ts)
  // y los mismos números que Finanzas › Avance financiero (23-oct-2026, Mario: "no cuadra y
  // debería ser el mismo"): OC/OS a subtotal sin IVA (fn_avance_financiero_real), mano de
  // obra de la API, compras del control sin OC; presupuesto por categoría y, si no, controles.
  const presupuestoControles = d.controles.reduce((s, c) => s + Number(c.presupuesto), 0);
  const presupuesto = d.presupuestoCategorias > 0 ? d.presupuestoCategorias : presupuestoControles;
  const materiales = d.compras.reduce((s, c) => s + Number(c.importe), 0);
  // Las compras ligadas a una OC ya cuentan en las OC de la obra.
  const comprasSinOc = d.compras.filter((c) => !c.orden_compra_id).reduce((s, c) => s + Number(c.importe), 0);
  const g = d.gasto;
  const materialesPagados = d.compras.filter((c) => c.estatus === "pagado").reduce((s, c) => s + Number(c.importe), 0);
  const nominaTotal = d.nomina.reduce((s, n) => s + Number(n.sueldo), 0);
  const ultimaColumna = new Map<string, string>();
  for (const c of d.columnas) ultimaColumna.set(c.tablero_id, c.id);
  const hechas = d.tarjetas.filter((t) => ultimaColumna.get(t.tablero_id) === t.columna_id).length;
  const conteoPu = contarSemaforoPu(d.pu);
  const { ejercido, desglose, disponible, avanceFinanciero, avanceTareas, avanceSuministro, avancePu, avanceFisico, desfase } = calcularResumenObra({
    presupuesto,
    materiales: comprasSinOc,
    nomina: nominaTotal,
    oc: Number(g?.oc_total ?? 0),
    manoObra: Number(g?.mo_total ?? 0),
    tarjetas: d.tarjetas.length,
    hechas,
    requisiciones: d.requisiciones,
    pu: d.pu,
  });

  const tonoDesfase = desfase === null ? "" : desfase > 10 ? "text-red-700" : desfase > 0 ? "text-amber-700" : "text-emerald-700";

  const base = `/proyectos/${proyecto.id}`;
  const avanceFin = `/finanzas/avance-financiero?obra=${proyecto.id}&empresa=${proyecto.empresa_id ?? ""}`;
  const barras: { etiqueta: string; valor: number | null; detalle: string; ruta: string; abre: string }[] = [
    { etiqueta: "Avance físico (promedio)", valor: avanceFisico, detalle: "tareas, suministro y precios unitarios", ruta: `${base}?tab=avance`, abre: "tablero de seguimiento" },
    { etiqueta: "Tareas hechas", valor: avanceTareas, detalle: `${hechas} de ${d.tarjetas.length} tarjetas en ${d.tableros.length} tablero(s)`, ruta: `${base}?tab=avance`, abre: "tablero de seguimiento" },
    { etiqueta: "Suministro de requerimientos", valor: avanceSuministro, detalle: `${d.requisiciones.filter((r) => r.estado !== "cancelada").length} requerimiento(s)`, ruta: `/requisiciones?obra=${proyecto.id}`, abre: "requerimientos de la obra" },
    { etiqueta: "Precios unitarios autorizados", valor: avancePu, detalle: `${conteoPu.autorizado} de ${d.pu.length} con el cliente`, ruta: `${base}?tab=precios`, abre: "precios unitarios" },
    { etiqueta: "Avance financiero (ejercido)", valor: avanceFinanciero, detalle: `${mxn.format(ejercido)} de ${mxn.format(presupuesto)}`, ruta: avanceFin, abre: "avance financiero por categoría y mes" },
  ];
  const liga = "text-sky-700 hover:underline";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta etiqueta="Presupuesto contratado" valor={mxn.format(presupuesto)} detalle={d.presupuestoCategorias > 0 ? "capturado por categoría (Avance financiero)" : `${d.controles.length} control(es) de obra`} ligas={[{ a: `${base}?tab=control`, texto: "control de obra" }, { a: `${avanceFin}&vista=capturar`, texto: "presupuesto por categoría" }]} />
        <Tarjeta
          etiqueta="Ejercido"
          valor={mxn.format(ejercido)}
          detalle={`OC ${mxn.format(desglose.oc)} · mano de obra ${mxn.format(desglose.manoObra)}${desglose.compras ? ` · otras compras ${mxn.format(desglose.compras)}` : ""}`}
          ligas={[{ a: "#gastos", texto: "cada OC/OS" }, { a: "#mano-obra", texto: "mano de obra" }, { a: avanceFin, texto: "avance financiero" }]}
        />
        <Tarjeta etiqueta="Disponible" valor={mxn.format(disponible)} detalle={presupuesto > 0 ? `margen ${pct((100 * disponible) / presupuesto)}` : "sin presupuesto capturado"} tono={disponible < 0 ? "text-red-700" : ""} ligas={[{ a: `${avanceFin}&vista=periodo`, texto: "por mes" }]} />
        <Tarjeta etiqueta="Físico vs financiero" valor={desfase === null ? "—" : `${desfase > 0 ? "+" : ""}${Math.round(desfase)} pts`} detalle={desfase === null ? "faltan datos" : desfase > 0 ? "se ha gastado más de lo avanzado" : "gasto por debajo del avance"} tono={tonoDesfase} ligas={[{ a: `${base}?tab=avance`, texto: "tablero" }, { a: avanceFin, texto: "financiero" }]} />
      </div>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Avance físico contra financiero</h3>
        <ul className="space-y-2">
          {barras.map((b) => (
            <li key={b.etiqueta} className="text-sm">
              <div className="flex items-center justify-between">
                <Link to={b.ruta} className={`${liga} text-slate-700`} title={`Abrir ${b.abre}`}>{b.etiqueta}</Link>
                <span className="tabular-nums text-slate-900">{pct(b.valor)}</span>
              </div>
              <Link to={b.ruta} className="mt-0.5 block h-2.5 w-full rounded bg-slate-100" title={`Abrir ${b.abre}`}>
                <div className={`h-2.5 rounded ${b.etiqueta.startsWith("Avance financiero") ? "bg-orange-500" : "bg-blue-600"}`} style={{ width: `${Math.min(100, Math.max(0, b.valor ?? 0))}%` }} />
              </Link>
              <div className="text-[11px] text-slate-400">{b.detalle} · <Link to={b.ruta} className={liga}>ver {b.abre}</Link></div>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section id="gastos" className="rounded border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Órdenes de compra y de servicio</h3>
          {g && g.oc_num > 0 ? (
            <div className="text-sm text-slate-700">
              <p>
                <b>{g.oc_num}</b> orden(es) por <b>{mxn.format(Number(g.oc_total))}</b>
                <Link to={`/ordenes?tipo=OC&buscar=${encodeURIComponent(proyecto.nombre)}&backoffice=1`} className={`ml-2 text-xs ${liga}`}>ver la lista en Órdenes</Link>
              </p>
              <p className="text-xs text-slate-500">
                pagado {mxn.format(Number(g.oc_pagado))} · por pagar {mxn.format(Number(g.oc_total) - Number(g.oc_pagado))}
                {" · "}
                <Link to={`${avanceFin}`} className={liga}>pendientes de pago con vencimiento</Link>
              </p>
              <div className="mt-2 h-2.5 w-full rounded bg-slate-100">
                <div className="h-2.5 rounded bg-emerald-500" style={{ width: `${Number(g.oc_total) > 0 ? Math.min(100, (100 * Number(g.oc_pagado)) / Number(g.oc_total)) : 0}%` }} />
              </div>
              <div className="mt-2 max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-slate-500">
                    <tr><th className="py-0.5 pr-2">Orden</th><th className="py-0.5 pr-2">Proveedor</th><th className="py-0.5 pr-2">Fecha</th><th className="py-0.5 pr-2 text-right">Total</th><th className="py-0.5 pr-2 text-right">Saldo</th><th className="py-0.5" /></tr>
                  </thead>
                  <tbody>
                    {d.ordenes.map((o) => (
                      <tr key={o.id} className="border-t border-slate-100">
                        <td className="py-0.5 pr-2 font-medium text-slate-800">{o.tipo} {o.id_orden} <span className="font-normal text-slate-400">{o.empresa_codigo}</span></td>
                        <td className="py-0.5 pr-2 text-slate-600">{o.proveedor}</td>
                        <td className="py-0.5 pr-2 text-slate-500">{o.fecha_creacion?.split("-").reverse().join("/")}</td>
                        <td className="py-0.5 pr-2 text-right tabular-nums">{mxn.format(Number(o.total))}</td>
                        <td className={`py-0.5 pr-2 text-right tabular-nums ${o.pagada ? "text-emerald-700" : "text-amber-700"}`}>{o.pagada ? "pagada" : mxn.format(Number(o.saldo))}</td>
                        <td className="py-0.5 text-right"><BotonVerOc ocId={o.id} etiqueta="Ver orden" className={liga} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Las que en el backoffice o aquí llevan el nombre de esta obra; sin canceladas.</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No hay órdenes con el nombre de esta obra.</p>
          )}
        </section>
        <section id="mano-obra" className="rounded border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            Mano de obra pagada por semana <Link to="/rh/mano-de-obra" className={`ml-2 text-xs font-normal ${liga}`}>ver el módulo de mano de obra</Link>
          </h3>
          {g && g.mo_semanas.length > 0 ? (
            <>
              <p className="text-sm text-slate-700">
                <b>{mxn.format(Number(g.mo_total))}</b> en {g.mo_semanas.length} semana(s)
              </p>
              <div className="mt-2 max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {g.mo_semanas.map((w) => (
                      <tr key={`${w.anio}-${w.semana}`} className="border-t border-slate-100">
                        <td className="py-0.5 pr-2">Sem {w.semana}</td>
                        <td className="py-0.5 pr-2 text-slate-500">
                          {w.inicio?.split("-").reverse().join("/")} – {w.fin?.split("-").reverse().join("/")}
                        </td>
                        <td className="py-0.5 text-right tabular-nums">{mxn.format(Number(w.monto))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h4 className="mt-3 text-xs font-semibold uppercase text-slate-500">Por partida</h4>
              <ul className="text-xs">
                {g.mo_partidas.map((x) => (
                  <li key={x.partida} className="flex justify-between border-t border-slate-100 py-0.5">
                    <span>{x.partida}</span>
                    <span className="tabular-nums">{mxn.format(Number(x.monto))}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-400">El módulo de mano de obra del backoffice no tiene pagos para esta obra.</p>
          )}
        </section>
      </div>

      <section id="controles" className="rounded border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          Por control de obra <Link to={`${base}?tab=control`} className={`ml-2 text-xs font-normal ${liga}`}>abrir control de obra</Link>
          {" · "}
          <Link to={`${avanceFin}&vista=capturar`} className={`text-xs font-normal ${liga}`}>presupuesto por categoría</Link>
        </h3>
        {d.controles.length === 0 ? (
          <p className="text-sm text-slate-400">Sin control de obra: el presupuesto y lo ejercido salen de ahí (<Link to={`${base}?tab=control`} className={liga}>pestaña Control de obra</Link>).</p>
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
                      <td className="py-1 pr-3"><Link to={`${base}?tab=control`} className={liga}>{c.especialidad}</Link></td>
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

function Tarjeta({ etiqueta, valor, detalle, tono = "", ligas = [] }: { etiqueta: string; valor: string; detalle?: string; tono?: string; ligas?: { a: string; texto: string }[] }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="text-[11px] uppercase text-slate-500">{etiqueta}</div>
      <div className={`text-xl font-semibold tabular-nums ${tono || "text-slate-900"}`}>{valor}</div>
      {detalle && <div className="text-[11px] text-slate-500">{detalle}</div>}
      {ligas.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-2 text-[11px]">
          {ligas.map((l) => (l.a.startsWith("#") ? <a key={l.a} href={l.a} className="text-sky-700 hover:underline">{l.texto}</a> : <Link key={l.a} to={l.a} className="text-sky-700 hover:underline">{l.texto}</Link>))}
        </div>
      )}
    </div>
  );
}
