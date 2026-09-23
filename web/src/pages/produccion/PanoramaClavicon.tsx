import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { abrirParaImprimir } from "../../lib/imprimir";
import { cargaPorMaquina } from "../../lib/programacionMaquinas";
import { htmlReporteClavicon, resumenLotes, type LoteReporte, type OperacionReporte } from "../../lib/reporteClavicon";
import type { CosteoMensualPlanta, StockMateriaPrima, StockProductoTerminado } from "../../types/database";

const CODIGO = "MCC";

interface Lote {
  id: string;
  folio: string;
  cantidad_planeada: number;
  cantidad_producida: number;
  fecha_inicio: string;
  fecha_estimada_embarque: string | null;
  estado: string;
  productos_produccion: { nombre: string } | null;
  proyectos: { nombre: string } | null;
}
interface Operacion {
  id: string;
  equipo_id: string | null;
  equipo_nombre: string | null;
  lote_folio: string;
  nombre_paso: string;
  inicio_programado: string;
  fin_programado: string;
  estado: string;
  minutos_programados: number;
  minutos_reales: number | null;
}

function lunesDe(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}
function isoDia(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}
function money(n: number | null | undefined): string {
  return n == null ? "—" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
}
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** Ventana "Clavicón" del Dashboard de dirección (solo admin): panorama de
 * la planta con calendario de procesos y el reporte oficial imprimible. */
export function PanoramaClavicon() {
  const { perfil } = useAuth();
  const [semana, setSemana] = useState(() => lunesDe(new Date()));
  const [aviso, setAviso] = useState<string | null>(null);
  const finSemana = useMemo(() => { const f = new Date(semana); f.setDate(f.getDate() + 7); return f; }, [semana]);
  const hoy = isoDia(new Date());

  const { data: empresa } = useQuery({
    queryKey: ["empresa-codigo", CODIGO],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre, rfc").eq("codigo", CODIGO).single();
      if (error) throw error;
      return data as { id: string; nombre: string; rfc: string | null };
    },
  });
  const empresaId = empresa?.id;

  const { data: lotes } = useQuery({
    queryKey: ["clavicon-lotes", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("ordenes_produccion").select("id, folio, cantidad_planeada, cantidad_producida, fecha_inicio, fecha_estimada_embarque, estado, productos_produccion(nombre), proyectos(nombre)").eq("empresa_id", empresaId!).neq("estado", "cancelada").order("fecha_inicio", { ascending: false }).limit(60);
      if (error) throw error;
      return data as unknown as Lote[];
    },
  });
  const { data: operaciones } = useQuery({
    queryKey: ["clavicon-operaciones", empresaId, isoDia(semana)],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_operaciones_programadas").select("*").eq("empresa_id", empresaId!).gte("inicio_programado", semana.toISOString()).lt("inicio_programado", finSemana.toISOString()).neq("estado", "cancelada").order("inicio_programado");
      if (error) throw error;
      return data as Operacion[];
    },
  });
  const { data: equipos } = useQuery({
    queryKey: ["equipos-produccion", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("equipos_produccion").select("id, nombre, activo").eq("empresa_id", empresaId!).eq("activo", true).order("nombre");
      if (error) throw error;
      return data as { id: string; nombre: string; activo: boolean }[];
    },
  });
  const { data: stockMp } = useQuery({
    queryKey: ["stock-materia-prima", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_stock_materia_prima").select("*").eq("empresa_id", empresaId!).order("nombre");
      if (error) throw error;
      return data as StockMateriaPrima[];
    },
  });
  const { data: stockPt } = useQuery({
    queryKey: ["stock-producto-terminado", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_stock_producto_terminado").select("*").eq("empresa_id", empresaId!).order("nombre");
      if (error) throw error;
      return data as StockProductoTerminado[];
    },
  });
  const { data: costeoMes } = useQuery({
    queryKey: ["clavicon-costeo-mes", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const d = new Date();
      const { data, error } = await supabase.from("v_costeo_mensual_planta").select("*").eq("empresa_id", empresaId!).eq("anio", d.getFullYear()).eq("mes", d.getMonth() + 1);
      if (error) throw error;
      return data as CosteoMensualPlanta[];
    },
  });
  const { data: pendientes } = useQuery({
    queryKey: ["clavicon-pendientes", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const inicioMes = `${hoy.slice(0, 7)}-01`;
      const [{ data: materias }, { data: rem }] = await Promise.all([
        supabase.from("materias_primas").select("id").eq("empresa_id", empresaId!),
        supabase.from("remisiones_produccion").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId!).gte("fecha", inicioMes),
      ]);
      const ids = (materias ?? []).map((m) => m.id);
      let sinOc = 0;
      if (ids.length > 0) {
        const { count } = await supabase.from("movimientos_materia_prima").select("id", { count: "exact", head: true }).eq("tipo", "entrada").is("orden_compra_id", null).in("materia_prima_id", ids);
        sinOc = count ?? 0;
      }
      return { sinOc, remisionesMes: (rem as unknown as { count?: number } | null)?.count ?? 0 };
    },
  });

  const lotesReporte: LoteReporte[] = useMemo(
    () =>
      (lotes ?? []).map((l) => ({
        folio: l.folio,
        producto: l.productos_produccion?.nombre ?? "",
        proyecto: l.proyectos?.nombre ?? null,
        cantidad_planeada: Number(l.cantidad_planeada),
        cantidad_producida: Number(l.cantidad_producida),
        fecha_inicio: l.fecha_inicio,
        fecha_estimada_embarque: l.fecha_estimada_embarque,
        estado: l.estado,
        avance_pct: l.estado === "terminada" ? 100 : Number(l.cantidad_planeada) > 0 ? Math.round((Number(l.cantidad_producida) / Number(l.cantidad_planeada)) * 100) : 0,
      })),
    [lotes],
  );
  const resumen = resumenLotes(lotesReporte);
  const carga = useMemo(() => cargaPorMaquina(operaciones ?? [], semana, finSemana), [operaciones, semana, finSemana]);
  const dias = useMemo(() => Array.from({ length: 6 }, (_, i) => { const d = new Date(semana); d.setDate(d.getDate() + i); return d; }), [semana]);

  function generarReporte() {
    if (!empresa) return;
    const ops: OperacionReporte[] = (operaciones ?? []).map((o) => ({
      fecha: isoDia(new Date(o.inicio_programado)),
      inicio: hora(o.inicio_programado),
      fin: hora(o.fin_programado),
      maquina: o.equipo_nombre ?? "sin máquina",
      lote: o.lote_folio,
      paso: o.nombre_paso,
      estado: o.estado,
      minutos_programados: Number(o.minutos_programados),
      minutos_reales: o.minutos_reales == null ? null : Number(o.minutos_reales),
    }));
    const finSem = new Date(semana);
    finSem.setDate(finSem.getDate() + 5);
    const html = htmlReporteClavicon({
      empresa: empresa.nombre,
      rfc: empresa.rfc,
      fecha: hoy,
      semanaInicio: isoDia(semana),
      semanaFin: isoDia(finSem),
      elaboro: perfil?.nombre ?? null,
      lotes: lotesReporte.filter((l) => l.estado !== "terminada" || l.fecha_inicio >= `${hoy.slice(0, 7)}-01`),
      operaciones: ops,
      carga: (equipos ?? []).map((e) => ({ maquina: e.nombre, minutos: carga.get(e.id)?.minutos ?? 0, pct: carga.get(e.id)?.pct ?? 0 })),
      stockMateria: (stockMp ?? []).map((s) => ({ nombre: s.nombre, unidad: s.unidad_medida, stock: Number(s.stock_actual), costo_promedio: s.costo_promedio_ponderado })),
      stockProducto: (stockPt ?? []).map((s) => ({ nombre: s.nombre, unidad: s.unidad_medida, stock: Number(s.stock_actual), costo_promedio: s.costo_promedio_ponderado })),
      costeoMes: (costeoMes ?? []).map((c) => ({ producto: c.producto_nombre, lotes: c.lotes, cantidad: Number(c.cantidad_producida), costo_total: Number(c.costo_total), costo_unitario: c.costo_unitario_promedio })),
      entradasSinOc: pendientes?.sinOc ?? 0,
      remisionesMes: pendientes?.remisionesMes ?? 0,
    });
    setAviso(abrirParaImprimir(html) ? null : "El navegador bloqueó la ventana. Permite ventanas emergentes.");
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-red-800">Clavicón · panorama de planta</h1>
          <p className="text-sm text-slate-500">{empresa?.nombre ?? "Mallas y Clavos Clavicón"} · lotes, procesos por máquina, inventario y costeo.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/produccion/clavicon" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
            Abrir Producción Clavicón
          </Link>
          <button onClick={generarReporte} disabled={!empresa} className="rounded bg-red-800 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Generar reporte oficial
          </button>
        </div>
      </div>
      {aviso && <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi etiqueta="Lotes abiertos" valor={String(resumen.abiertos)} />
        <Kpi etiqueta="Lotes atrasados" valor={String(resumen.atrasados)} rojo={resumen.atrasados > 0} />
        <Kpi etiqueta="Operaciones esta semana" valor={String(operaciones?.length ?? 0)} />
        <Kpi etiqueta="Entradas MP sin OC" valor={String(pendientes?.sinOc ?? 0)} rojo={(pendientes?.sinOc ?? 0) > 0} />
        <Kpi etiqueta="Remisiones del mes" valor={String(pendientes?.remisionesMes ?? 0)} />
      </div>

      <section className="mb-4 rounded border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
          <p className="text-sm font-semibold text-slate-700">Calendario de procesos por máquina</p>
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => setSemana((s) => { const d = new Date(s); d.setDate(d.getDate() - 7); return d; })} className="rounded border border-slate-300 px-2 py-1 text-xs">◀</button>
            <span className="text-slate-700">Semana del {semana.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}</span>
            <button onClick={() => setSemana((s) => { const d = new Date(s); d.setDate(d.getDate() + 7); return d; })} className="rounded border border-slate-300 px-2 py-1 text-xs">▶</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">Máquina</th>
                {dias.map((d) => (
                  <th key={d.toISOString()} className={`px-2 py-2 ${isoDia(d) === hoy ? "text-slate-900" : ""}`}>
                    {DIAS[d.getDay()]} {d.getDate()}
                  </th>
                ))}
                <th className="px-2 py-2 text-right">Carga</th>
              </tr>
            </thead>
            <tbody>
              {(equipos ?? []).map((e) => (
                <tr key={e.id} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-2 font-medium text-slate-800">{e.nombre}</td>
                  {dias.map((d) => (
                    <td key={d.toISOString()} className="px-1 py-1">
                      {(operaciones ?? [])
                        .filter((o) => o.equipo_id === e.id && isoDia(new Date(o.inicio_programado)) === isoDia(d))
                        .map((o) => (
                          <div key={o.id} className={`mb-1 rounded border px-1.5 py-1 ${o.estado === "terminada" ? "border-emerald-300 bg-emerald-50" : o.estado === "en_proceso" ? "border-amber-300 bg-amber-50" : "border-sky-300 bg-sky-50"}`}>
                            <div className="font-medium">{hora(o.inicio_programado)}–{hora(o.fin_programado)}</div>
                            <div className="truncate">{o.lote_folio} · {o.nombre_paso}</div>
                          </div>
                        ))}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right tabular-nums">{carga.get(e.id)?.pct ?? 0}%</td>
                </tr>
              ))}
              {(equipos ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                    La planta todavía no da de alta máquinas ni rutas. Se capturan en Producción Clavicón → Calendario de máquinas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">Lotes</p>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1.5">Lote</th>
                <th className="px-2 py-1.5">Producto</th>
                <th className="px-2 py-1.5">Embarque</th>
                <th className="px-2 py-1.5">Estado</th>
                <th className="px-2 py-1.5 text-right">Avance</th>
              </tr>
            </thead>
            <tbody>
              {lotesReporte.slice(0, 20).map((l) => (
                <tr key={l.folio} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 font-medium">{l.folio}</td>
                  <td className="px-2 py-1.5">{l.producto}{l.proyecto ? <span className="text-slate-400"> · {l.proyecto}</span> : null}</td>
                  <td className={`px-2 py-1.5 ${l.fecha_estimada_embarque && l.fecha_estimada_embarque < hoy && l.estado !== "terminada" ? "text-red-700" : ""}`}>{l.fecha_estimada_embarque ?? "—"}</td>
                  <td className="px-2 py-1.5">{l.estado.replace("_", " ")}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.avance_pct}%</td>
                </tr>
              ))}
              {lotesReporte.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-400">Sin lotes.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="rounded border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">Inventario y costeo del mes</p>
          <div className="grid grid-cols-1 gap-3 p-3 text-xs sm:grid-cols-2">
            <div>
              <p className="mb-1 font-medium text-slate-600">Producto terminado</p>
              {(stockPt ?? []).slice(0, 8).map((s) => (
                <div key={s.producto_id} className="flex justify-between border-b border-slate-100 py-0.5"><span>{s.nombre}</span><span className="tabular-nums">{Number(s.stock_actual).toLocaleString("es-MX")} {s.unidad_medida}</span></div>
              ))}
              {(stockPt ?? []).length === 0 && <p className="text-slate-400">Sin existencias.</p>}
            </div>
            <div>
              <p className="mb-1 font-medium text-slate-600">Materia prima</p>
              {(stockMp ?? []).slice(0, 8).map((s) => (
                <div key={s.materia_prima_id} className="flex justify-between border-b border-slate-100 py-0.5"><span>{s.nombre}</span><span className="tabular-nums">{Number(s.stock_actual).toLocaleString("es-MX")} {s.unidad_medida}</span></div>
              ))}
              {(stockMp ?? []).length === 0 && <p className="text-slate-400">Sin existencias.</p>}
            </div>
            <div className="sm:col-span-2">
              <p className="mb-1 font-medium text-slate-600">Costeo de lotes terminados este mes</p>
              {(costeoMes ?? []).map((c) => (
                <div key={c.producto_id} className="flex justify-between border-b border-slate-100 py-0.5"><span>{c.producto_nombre} · {c.lotes} lote(s)</span><span className="tabular-nums">{money(c.costo_total)} · {money(c.costo_unitario_promedio)}/u</span></div>
              ))}
              {(costeoMes ?? []).length === 0 && <p className="text-slate-400">Sin lotes terminados este mes.</p>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({ etiqueta, valor, rojo }: { etiqueta: string; valor: string; rojo?: boolean }) {
  return (
    <div className={`rounded border bg-white p-3 ${rojo ? "border-red-200" : "border-slate-200"}`}>
      <p className="text-[11px] uppercase text-slate-500">{etiqueta}</p>
      <p className={`text-2xl font-semibold tabular-nums ${rojo ? "text-red-700" : "text-slate-900"}`}>{valor}</p>
    </div>
  );
}
