import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { avanceFisicoDe, type DatosResumenObra } from "../../lib/resumenObra";
import { useAuth } from "../../lib/auth";
import {
  CATEGORIAS_OBRA,
  FILTRO_INICIAL,
  SEMAFOROS,
  TITULO_CATEGORIA,
  calcularAvance,
  repartoMensual,
  revisarPresupuesto,
  type CategoriaObra,
  type FiltroAvance,
  type ObraAvance,
  type PresupuestoObra,
  type RealMes,
  type Reparto,
} from "../../lib/avanceFinanciero";

// Avance financiero de obras (22-oct-2026, Laura: "se puede crear un módulo
// de avance financiero con estos puntos y visual"). Presupuesto contra real
// (OC, OS y mano de obra), lo pagado y lo pendiente de pago, por obra,
// empresa, periodo y categoría. Solo el presupuesto se captura aquí; lo demás
// sale de lo que Acumulado ya registra (fn_avance_financiero).

type Vista = "obra" | "empresa" | "categoria" | "periodo" | "capturar";

const tarjeta = "rounded-xl border border-slate-200 bg-white";
const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "text-xs text-slate-600";
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function dinero(n: number | null | undefined, decimales = 0): string {
  return (Number(n) || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}
function nombreMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}
function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MESES[m - 1]} ${a}`;
}

function Barra({ pct, alerta }: { pct: number | null; alerta?: boolean }) {
  const v = Math.max(0, Math.min(pct ?? 0, 100));
  return (
    <div className="h-1.5 w-20 rounded-full bg-slate-100">
      <div className={`h-1.5 rounded-full ${alerta ? "bg-red-600" : "bg-slate-800"}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function AvanceFinanciero() {
  const { perfil, soloConsulta } = useAuth();
  const [params, setParams] = useSearchParams();
  const vista = (["obra", "empresa", "categoria", "periodo", "capturar"].includes(params.get("vista") ?? "") ? params.get("vista") : "obra") as Vista;
  const irA = (v: Vista) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("vista", v);
        return n;
      },
      { replace: true },
    );
  // Desde el resumen de la obra (23-oct-2026): ?obra=<id>&empresa=<id> llega con esa obra abierta.
  const [filtro, setFiltro] = useState<FiltroAvance>({ ...FILTRO_INICIAL, obraId: params.get("obra") || null, empresaId: params.get("empresa") || null });
  const [elegida, setElegida] = useState<string | null>(params.get("obra") || null);
  const puedeCapturar = !soloConsulta && !!perfil && ["admin", "direccion", "empresa"].includes(perfil.rol);

  const datos = useQuery({
    queryKey: ["avance-financiero"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_avance_financiero");
      if (error) throw error;
      type ObraCruda = ObraAvance & { requisiciones?: DatosResumenObra["requisiciones"]; pu?: DatosResumenObra["pu"] };
      const d = (data ?? {}) as { obras?: ObraCruda[]; real?: RealMes[] };
      // El físico se calcula con la MISMA fórmula que el resumen físico-financiero
      // de la obra (tareas + suministro de requerimientos + precios unitarios).
      const obras: ObraAvance[] = (d.obras ?? []).map((o) => ({
        ...o,
        fisico_pct: avanceFisicoDe({ tarjetas: o.tareas, hechas: o.hechas, requisiciones: o.requisiciones ?? [], pu: o.pu ?? [] }).avanceFisico,
      }));
      return { obras, real: (d.real ?? []).map((r) => ({ ...r, real: Number(r.real) || 0, pagado: Number(r.pagado) || 0 })) };
    },
  });
  const presupuestos = useQuery({
    queryKey: ["avance-financiero", "presupuestos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("obra_presupuesto").select("proyecto_id, categoria, monto, mes_inicio, mes_fin, reparto");
      if (error) throw error;
      return (data ?? []).map((p) => ({ ...p, monto: Number(p.monto) || 0 })) as PresupuestoObra[];
    },
  });

  const obras = useMemo(() => datos.data?.obras ?? [], [datos.data]);
  const res = useMemo(() => calcularAvance(obras, datos.data?.real ?? [], presupuestos.data ?? [], filtro), [obras, datos.data, presupuestos.data, filtro]);
  const empresas = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of obras) m.set(o.empresa_id, `${o.empresa_codigo ?? ""}${o.empresa_nombre ? ` · ${o.empresa_nombre}` : ""}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [obras]);
  const obrasFiltro = obras.filter((o) => !filtro.empresaId || o.empresa_id === filtro.empresaId);
  const cambiar = (c: Partial<FiltroAvance>) => setFiltro((f) => ({ ...f, ...c }));
  const hayFiltro = JSON.stringify(filtro) !== JSON.stringify(FILTRO_INICIAL);
  const cargando = datos.isLoading || presupuestos.isLoading;
  const error = (datos.error ?? presupuestos.error) as Error | null;
  const sinPresupuesto = res.porObra.filter((o) => o.semaforo === "sin_presupuesto").length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">Finanzas / Presupuestos</p>
          <h1 className="text-2xl font-semibold text-slate-900">Avance financiero de obras</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            Presupuesto contra real (OC, OS, mano de obra y compras del control de obra sin OC), lo pagado y lo pendiente de pago, por obra, empresa, periodo y categoría. Importes sin IVA; el mismo cálculo que el resumen físico-financiero de cada obra. Sin presupuesto por categoría vale el de los controles de obra. El avance físico es el del resumen de la obra: promedio de tareas hechas, suministro de requerimientos y precios unitarios. Lo real
            sale solo de lo que Acumulado registra; aquí solo se captura el presupuesto.
          </p>
        </div>
      </div>

      <section className={`${tarjeta} mb-4 p-4`}>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className={etiqueta}>
            Empresa
            <select className={campo} value={filtro.empresaId ?? ""} onChange={(e) => cambiar({ empresaId: e.target.value || null, obraId: null })}>
              <option value="">Todas</option>
              {empresas.map(([id, t]) => (
                <option key={id} value={id}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className={`${etiqueta} lg:col-span-2`}>
            Obra
            <select className={campo} value={filtro.obraId ?? ""} onChange={(e) => cambiar({ obraId: e.target.value || null })}>
              <option value="">Todas las obras</option>
              {obrasFiltro.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className={etiqueta}>
            Año
            <select className={campo} value={filtro.anio ?? ""} onChange={(e) => cambiar({ anio: e.target.value ? Number(e.target.value) : null, periodo: "todo" })}>
              <option value="">Toda la obra</option>
              {res.anios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className={etiqueta}>
            Periodo
            <select className={campo} value={filtro.periodo} disabled={filtro.anio == null} onChange={(e) => cambiar({ periodo: e.target.value })}>
              <option value="todo">Todo el año</option>
              {["T1", "T2", "T3", "T4"].map((t) => (
                <option key={t} value={t}>
                  {t.replace("T", "Trimestre ")}
                </option>
              ))}
              {MESES.map((m, i) => (
                <option key={m} value={String(i + 1).padStart(2, "0")}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className={etiqueta}>
            Categoría
            <select className={campo} value={filtro.categoria ?? ""} onChange={(e) => cambiar({ categoria: (e.target.value || null) as CategoriaObra | null })}>
              <option value="">Todas</option>
              {CATEGORIAS_OBRA.map((c) => (
                <option key={c.clave} value={c.clave}>
                  {c.titulo}
                </option>
              ))}
            </select>
          </label>
        </div>
        {hayFiltro && (
          <button type="button" onClick={() => setFiltro(FILTRO_INICIAL)} className="mt-2 text-xs text-sky-700 underline">
            Quitar filtros
          </button>
        )}
      </section>

      {error && <p className="mb-3 text-sm text-red-700">{error.message}</p>}
      {cargando && <p className="text-sm text-slate-500">Cargando…</p>}

      {!cargando && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Indicador titulo="Presupuesto" valor={dinero(res.total.presupuesto)} detalle={`${res.porObra.length} obras${sinPresupuesto ? ` · ${sinPresupuesto} sin presupuesto` : ""}`} />
            <Indicador titulo="Real (ejercido)" valor={dinero(res.total.real)} detalle={res.total.ejercidoPct != null ? `${res.total.ejercidoPct}% del presupuesto` : "sin presupuesto"} />
            <Indicador titulo="Pagado" valor={dinero(res.total.pagado)} detalle={res.total.real > 0 ? `${Math.round((res.total.pagado / res.total.real) * 100)}% de lo ejercido` : undefined} />
            <Indicador titulo="Pendiente de pago" valor={dinero(res.total.pendiente)} detalle="ejercido aún sin pagar" tono={res.total.pendiente > 0 ? "text-amber-700" : undefined} />
            <Indicador titulo="Disponible" valor={dinero(res.total.disponible)} detalle="presupuesto menos real" tono={res.total.disponible < 0 ? "text-red-700" : undefined} />
            <Indicador titulo="Obras con alerta" valor={String(res.obrasConAlerta)} detalle="desfase o presupuesto rebasado" tono={res.obrasConAlerta ? "text-red-700" : undefined} />
          </div>

          <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 text-sm">
            {(
              [
                ["obra", "Por obra"],
                ["empresa", "Por empresa"],
                ["categoria", "Por categoría"],
                ["periodo", "Por periodo"],
                ...(puedeCapturar ? [["capturar", "Capturar presupuesto"]] : []),
              ] as [Vista, string][]
            ).map(([v, t]) => (
              <button key={v} type="button" onClick={() => irA(v)} className={`rounded-lg px-3 py-1.5 ${vista === v ? "bg-white font-semibold text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
                {t}
              </button>
            ))}
          </div>

          {vista === "obra" && (
            <PorObra
              res={res}
              elegida={elegida}
              onElegir={(id) => setElegida((x) => (x === id ? null : id))}
              detalle={(id) => calcularAvance(obras, datos.data?.real ?? [], presupuestos.data ?? [], { ...filtro, obraId: id, empresaId: null })}
            />
          )}
          {vista === "empresa" && <PorEmpresa res={res} />}
          {vista === "categoria" && <PorCategoria res={res} />}
          {vista === "periodo" && <PorPeriodo res={res} />}
          {vista === "capturar" && puedeCapturar && <CapturarPresupuesto obras={obras} presupuestos={presupuestos.data ?? []} obraInicial={filtro.obraId ?? elegida} />}
        </>
      )}
      <p className="mt-4 text-xs text-slate-500">
        Real = OC y OS de la obra (mismo nombre de proyecto) en el mes en que se emiten, a subtotal sin IVA, repartidas por categoría según sus partidas (flete,
        renta, combustible/viáticos…), más la mano de obra pagada por semana. Pagado = lo ya pagado de esas órdenes (aquí o en el backoffice) y la mano de obra.
        El semáforo compara lo ejercido de toda la obra contra su avance físico (tareas hechas de su tablero).
      </p>
    </div>
  );
}

function Indicador({ titulo, valor, detalle, tono }: { titulo: string; valor: string; detalle?: string; tono?: string }) {
  return (
    <div className={`${tarjeta} p-4`}>
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className={`text-xl font-semibold tabular-nums ${tono ?? "text-slate-900"}`}>{valor}</p>
      {detalle && <p className="text-xs text-slate-500">{detalle}</p>}
    </div>
  );
}

type Res = ReturnType<typeof calcularAvance>;

function PorObra({ res, elegida, onElegir, detalle }: { res: Res; elegida: string | null; onElegir: (id: string) => void; detalle: (id: string) => Res }) {
  if (!res.porObra.length) return <p className={`${tarjeta} p-6 text-center text-sm text-slate-400`}>No hay obras con presupuesto ni gasto con estos filtros.</p>;
  return (
    <section className={`${tarjeta} p-4`}>
      <h2 className="text-lg font-semibold text-slate-900">Por obra</h2>
      <p className="mb-3 text-xs text-slate-500">El semáforo compara el avance financiero acumulado de toda la obra contra su avance físico. Clic en una obra para ver su detalle.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-2 pr-2">Obra</th>
              <th className="px-2 text-right">Presupuesto</th>
              <th className="px-2 text-right">Real</th>
              <th className="px-2 text-right">Pagado</th>
              <th className="px-2 text-right">Pendiente de pago</th>
              <th className="px-2 text-right">Disponible</th>
              <th className="px-2">% ejercido</th>
              <th className="px-2 text-right">Físico</th>
              <th className="px-2">Semáforo</th>
            </tr>
          </thead>
          <tbody>
            {res.porObra.map((o) => (
              <FilaObraTabla key={o.obra.id} o={o} abierta={elegida === o.obra.id} onClick={() => onElegir(o.obra.id)} detalle={elegida === o.obra.id ? detalle(o.obra.id) : null} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FilaObraTabla({ o, abierta, onClick, detalle }: { o: Res["porObra"][number]; abierta: boolean; onClick: () => void; detalle: Res | null }) {
  return (
    <>
      <tr onClick={onClick} className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${abierta ? "bg-slate-50" : ""}`}>
        <td className="py-2 pr-2">
          <span className="font-medium text-slate-900 underline decoration-slate-300">{o.obra.nombre}</span>
          <span className="block text-xs text-slate-500">{o.obra.empresa_codigo}</span>
        </td>
        <td className="px-2 text-right tabular-nums">{dinero(o.presupuesto)}</td>
        <td className="px-2 text-right tabular-nums">{dinero(o.real)}</td>
        <td className="px-2 text-right tabular-nums">{dinero(o.pagado)}</td>
        <td className={`px-2 text-right tabular-nums ${o.pendiente > 0 ? "text-amber-700" : ""}`}>{dinero(o.pendiente)}</td>
        <td className={`px-2 text-right tabular-nums ${o.disponible < 0 ? "text-red-700" : ""}`}>{o.presupuesto > 0 ? dinero(o.disponible) : "—"}</td>
        <td className="px-2">
          <div className="flex items-center gap-2">
            <Barra pct={o.ejercidoPct} alerta={(o.ejercidoPct ?? 0) > 100} />
            <span className="text-xs tabular-nums text-slate-600">{o.ejercidoPct != null ? `${o.ejercidoPct}%` : "—"}</span>
          </div>
        </td>
        <td className="px-2 text-right text-xs tabular-nums text-slate-600">{o.fisicoPct != null ? `${o.fisicoPct}%` : "sin avance"}</td>
        <td className="px-2">
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${SEMAFOROS[o.semaforo].clase}`}>{SEMAFOROS[o.semaforo].texto}</span>
        </td>
      </tr>
      {abierta && detalle && (
        <tr>
          <td colSpan={9} className="bg-slate-50 px-3 pb-4">
            <DetalleObra obraId={o.obra.id} nombre={o.obra.nombre} res={detalle} total={o.obraTotal} fisicoPct={o.fisicoPct} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetalleObra({ obraId, nombre, res, total, fisicoPct }: { obraId: string; nombre: string; res: Res; total: Res["total"]; fisicoPct: number | null }) {
  const pendientes = useQuery({
    queryKey: ["avance-financiero", "pendientes", obraId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_avance_financiero_pendientes", { p_proyecto: obraId });
      if (error) throw error;
      return (data ?? []) as { orden_compra_id: string; folio: string; tipo: string; proveedor: string | null; fecha: string | null; total: number; saldo: number; pendiente_sin_iva: number; vence: string | null; programado: number | null }[];
    },
  });
  const hoy = new Date().toISOString().slice(0, 10);
  const lista = pendientes.data ?? [];
  return (
    <div className="grid gap-4 pt-3 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <p className="mb-1 text-sm font-semibold text-slate-800">
          {nombre} · por categoría
          <span className="ml-2 text-xs font-normal text-slate-500">
            toda la obra: {dinero(total.real)} de {dinero(total.presupuesto)}
            {total.ejercidoPct != null ? ` (${total.ejercidoPct}%)` : ""} · físico {fisicoPct != null ? `${fisicoPct}%` : "sin avance"}
          </span>
        </p>
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Categoría</th>
              <th className="text-right">Presupuesto</th>
              <th className="text-right">Real</th>
              <th className="text-right">Pagado</th>
              <th className="text-right">Pendiente</th>
              <th className="text-right">Disponible</th>
            </tr>
          </thead>
          <tbody>
            {res.porCategoria.map((c) => (
              <tr key={c.categoria} className="border-t border-slate-200">
                <td className="py-1">{c.titulo}</td>
                <td className="text-right tabular-nums">{dinero(c.presupuesto)}</td>
                <td className="text-right tabular-nums">{dinero(c.real)}</td>
                <td className="text-right tabular-nums">{dinero(c.pagado)}</td>
                <td className="text-right tabular-nums">{dinero(c.pendiente)}</td>
                <td className={`text-right tabular-nums ${c.disponible < 0 ? "text-red-700" : ""}`}>{c.presupuesto > 0 ? dinero(c.disponible) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="lg:col-span-2">
        <p className="mb-1 text-sm font-semibold text-slate-800">
          Pendiente de pago de la obra
          {lista.length > 0 && (
            <span className="ml-2 text-xs font-normal text-slate-500">
              {lista.length} órdenes por {dinero(lista.reduce((s, x) => s + Number(x.pendiente_sin_iva || 0), 0))} s/IVA
            </span>
          )}
        </p>
        {pendientes.isLoading && <p className="text-xs text-slate-500">Cargando…</p>}
        {pendientes.error && <p className="text-xs text-red-700">{(pendientes.error as Error).message}</p>}
        {!pendientes.isLoading && !lista.length && <p className="text-xs text-slate-500">Sin órdenes con saldo.</p>}
        <ul className="max-h-64 space-y-1 overflow-auto">
          {lista.map((x) => {
            const vencida = !!x.vence && x.vence < hoy;
            return (
              <li key={x.orden_compra_id} className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-slate-800">
                    {x.tipo} {x.folio} · {x.proveedor ?? "sin proveedor"}
                  </span>
                  <span className="tabular-nums font-semibold">{dinero(x.saldo, 2)}</span>
                </div>
                <div className="flex justify-between gap-2 text-slate-500">
                  <span>
                    emitida {fechaCorta(x.fecha)}
                    {Number(x.programado) > 0 ? ` · programado ${dinero(x.programado, 2)}` : ""}
                  </span>
                  <span className={vencida ? "font-medium text-red-700" : ""}>{x.vence ? `${vencida ? "venció" : "vence"} ${fechaCorta(x.vence)}` : "sin vencimiento"}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <Link to="/finanzas/pagos" className="mt-2 inline-block text-xs text-sky-700 underline">
          Ir a Programación de pagos
        </Link>
      </div>
    </div>
  );
}

function PorEmpresa({ res }: { res: Res }) {
  if (!res.porEmpresa.length) return <p className={`${tarjeta} p-6 text-center text-sm text-slate-400`}>Sin datos con estos filtros.</p>;
  return (
    <section className={`${tarjeta} overflow-x-auto p-4`}>
      <h2 className="mb-3 text-lg font-semibold text-slate-900">Por empresa</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-2">Empresa</th>
            <th className="px-2 text-right">Obras</th>
            <th className="px-2 text-right">Presupuesto</th>
            <th className="px-2 text-right">Real</th>
            <th className="px-2 text-right">Pagado</th>
            <th className="px-2 text-right">Pendiente de pago</th>
            <th className="px-2 text-right">Disponible</th>
            <th className="px-2">% ejercido</th>
            <th className="px-2 text-right">Con alerta</th>
          </tr>
        </thead>
        <tbody>
          {res.porEmpresa.map((e) => (
            <tr key={e.empresa_id} className="border-t border-slate-100">
              <td className="py-2 font-medium text-slate-900">
                {e.codigo}
                {e.nombre && <span className="block text-xs font-normal text-slate-500">{e.nombre}</span>}
              </td>
              <td className="px-2 text-right tabular-nums">{e.obras}</td>
              <td className="px-2 text-right tabular-nums">{dinero(e.presupuesto)}</td>
              <td className="px-2 text-right tabular-nums">{dinero(e.real)}</td>
              <td className="px-2 text-right tabular-nums">{dinero(e.pagado)}</td>
              <td className="px-2 text-right tabular-nums">{dinero(e.pendiente)}</td>
              <td className={`px-2 text-right tabular-nums ${e.disponible < 0 ? "text-red-700" : ""}`}>{dinero(e.disponible)}</td>
              <td className="px-2">
                <div className="flex items-center gap-2">
                  <Barra pct={e.ejercidoPct} alerta={(e.ejercidoPct ?? 0) > 100} />
                  <span className="text-xs tabular-nums text-slate-600">{e.ejercidoPct != null ? `${e.ejercidoPct}%` : "—"}</span>
                </div>
              </td>
              <td className={`px-2 text-right tabular-nums ${e.alertas ? "font-semibold text-red-700" : ""}`}>{e.alertas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Leyenda() {
  return (
    <div className="mb-3 flex gap-4 text-xs text-slate-600">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-300" /> Presupuesto
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-800" /> Real
      </span>
    </div>
  );
}

function PorCategoria({ res }: { res: Res }) {
  const maximo = Math.max(...res.porCategoria.map((c) => Math.max(c.presupuesto, c.real)), 0);
  return (
    <section className={`${tarjeta} p-4`}>
      <h2 className="text-lg font-semibold text-slate-900">Por categoría</h2>
      <p className="mb-2 text-xs text-slate-500">Presupuesto contra real en cada categoría.</p>
      <Leyenda />
      {maximo === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Sin datos con estos filtros.</p>
      ) : (
        <div className="space-y-4">
          {res.porCategoria.map((c) => (
            <div key={c.categoria} title={`${c.titulo}: presupuesto ${dinero(c.presupuesto)} · real ${dinero(c.real)} · pagado ${dinero(c.pagado)}`}>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-slate-800">{c.titulo}</span>
                <span className="text-xs tabular-nums text-slate-600">
                  {dinero(c.real)} de {dinero(c.presupuesto)}
                  {c.ejercidoPct != null && <span className={c.ejercidoPct > 100 ? "font-semibold text-red-700" : ""}> · {c.ejercidoPct}%</span>}
                </span>
              </div>
              <div className="space-y-0.5">
                <div className="h-2.5 rounded-r bg-slate-300" style={{ width: `${(c.presupuesto / maximo) * 100}%` }} />
                <div className={`h-2.5 rounded-r ${c.presupuesto > 0 && c.real > c.presupuesto ? "bg-red-600" : "bg-slate-800"}`} style={{ width: `${(c.real / maximo) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PorPeriodo({ res }: { res: Res }) {
  const meses = res.porMes;
  const maximo = Math.max(...meses.map((m) => Math.max(m.presupuesto, m.real)), 0);
  return (
    <section className={`${tarjeta} p-4`}>
      <h2 className="text-lg font-semibold text-slate-900">Por periodo</h2>
      <p className="mb-2 text-xs text-slate-500">Presupuesto contra real por mes, con acumulados y la diferencia acumulada.</p>
      <Leyenda />
      {maximo === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Sin datos con estos filtros.</p>
      ) : (
        <div className="mb-4 overflow-x-auto">
          <div className="flex h-48 items-end gap-2" style={{ minWidth: `${meses.length * 34}px` }} role="img" aria-label="Presupuesto contra real por mes">
            {meses.map((m) => (
              <div key={m.mes} className="flex h-full min-w-6 flex-1 flex-col items-center justify-end" title={`${nombreMes(m.mes)}: presupuesto ${dinero(m.presupuesto)} · real ${dinero(m.real)}`}>
                <div className="flex h-full w-full items-end justify-center gap-0.5">
                  <div className="w-1/2 max-w-4 rounded-t bg-slate-300" style={{ height: `${(m.presupuesto / maximo) * 100}%` }} />
                  <div className={`w-1/2 max-w-4 rounded-t ${m.real > m.presupuesto && m.presupuesto > 0 ? "bg-red-600" : "bg-slate-800"}`} style={{ height: `${(m.real / maximo) * 100}%` }} />
                </div>
                <span className="mt-1 whitespace-nowrap text-[10px] text-slate-500">{nombreMes(m.mes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {meses.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-2">Mes</th>
                <th className="px-2 text-right">Presupuesto</th>
                <th className="px-2 text-right">Real</th>
                <th className="px-2 text-right">Pagado</th>
                <th className="px-2 text-right">Presupuesto acumulado</th>
                <th className="px-2 text-right">Real acumulado</th>
                <th className="px-2 text-right">Diferencia acumulada</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m.mes} className="border-t border-slate-100">
                  <td className="py-1.5 capitalize">{nombreMes(m.mes)}</td>
                  <td className="px-2 text-right tabular-nums">{dinero(m.presupuesto)}</td>
                  <td className="px-2 text-right tabular-nums">{dinero(m.real)}</td>
                  <td className="px-2 text-right tabular-nums">{dinero(m.pagado)}</td>
                  <td className="px-2 text-right tabular-nums">{dinero(m.presupuestoAcum)}</td>
                  <td className="px-2 text-right tabular-nums">{dinero(m.realAcum)}</td>
                  <td className={`px-2 text-right font-medium tabular-nums ${m.diferenciaAcum < 0 ? "text-red-700" : "text-slate-800"}`}>{dinero(m.diferenciaAcum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CapturarPresupuesto({ obras, presupuestos, obraInicial }: { obras: ObraAvance[]; presupuestos: PresupuestoObra[]; obraInicial: string | null }) {
  const qc = useQueryClient();
  const [obraId, setObraId] = useState(obraInicial ?? "");
  const [aviso, setAviso] = useState<string | null>(null);
  const actuales = presupuestos.filter((p) => p.proyecto_id === obraId);
  const primero = actuales[0];
  const [inicio, setInicio] = useState(primero?.mes_inicio.slice(0, 7) ?? "");
  const [fin, setFin] = useState(primero?.mes_fin.slice(0, 7) ?? "");
  const [reparto, setReparto] = useState<Reparto>(primero?.reparto ?? "curva_s");
  const [montos, setMontos] = useState<Record<string, string>>(() => Object.fromEntries(actuales.map((p) => [p.categoria, String(p.monto)])));

  function elegirObra(id: string) {
    setObraId(id);
    setAviso(null);
    const ps = presupuestos.filter((p) => p.proyecto_id === id);
    setInicio(ps[0]?.mes_inicio.slice(0, 7) ?? "");
    setFin(ps[0]?.mes_fin.slice(0, 7) ?? "");
    setReparto(ps[0]?.reparto ?? "curva_s");
    setMontos(Object.fromEntries(ps.map((p) => [p.categoria, String(p.monto)])));
  }

  const numero = (t: string | undefined) => (t == null || t.trim() === "" ? null : Number(t.replace(/[$,\s]/g, "")));
  const total = CATEGORIAS_OBRA.reduce((s, c) => s + (numero(montos[c.clave]) || 0), 0);
  const vistaPrevia = useMemo(() => {
    if (!inicio || !fin || fin < inicio || !(total > 0)) return [];
    return [...repartoMensual(total, inicio, fin, reparto).entries()];
  }, [inicio, fin, reparto, total]);

  const guardar = useMutation({
    mutationFn: async () => {
      const valores = Object.fromEntries(CATEGORIAS_OBRA.map((c) => [c.clave, numero(montos[c.clave])])) as Record<CategoriaObra, number | null>;
      const problema = revisarPresupuesto(valores, inicio, fin);
      if (problema) throw new Error(problema);
      const obra = obras.find((o) => o.id === obraId);
      if (!obra) throw new Error("Elige la obra.");
      const filas = CATEGORIAS_OBRA.filter((c) => (valores[c.clave] ?? 0) > 0).map((c) => ({
        proyecto_id: obraId,
        empresa_id: obra.empresa_id,
        categoria: c.clave,
        monto: valores[c.clave],
        mes_inicio: `${inicio}-01`,
        mes_fin: `${fin}-01`,
        reparto,
      }));
      if (filas.length) {
        const { error } = await supabase.from("obra_presupuesto").upsert(filas, { onConflict: "proyecto_id,categoria" });
        if (error) throw error;
      }
      const quitar = actuales.filter((p) => !((valores[p.categoria] ?? 0) > 0)).map((p) => p.categoria);
      if (quitar.length) {
        const { error } = await supabase.from("obra_presupuesto").delete().eq("proyecto_id", obraId).in("categoria", quitar);
        if (error) throw error;
      }
      return filas.length;
    },
    onSuccess: () => {
      setAviso("Presupuesto guardado. El semáforo de la obra ya lo toma en cuenta.");
      qc.invalidateQueries({ queryKey: ["avance-financiero"] });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  return (
    <section className={`${tarjeta} p-4`}>
      <h2 className="text-lg font-semibold text-slate-900">Capturar presupuesto</h2>
      <p className="mb-3 text-xs text-slate-500">
        Montos sin IVA por categoría, meses de inicio y término y cómo se reparte por mes (parejo o curva S: poco al arrancar y al cerrar, más a la mitad).
        Al guardar, la obra cambia de semáforo de inmediato. Una categoría en blanco o en cero se quita.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={`${etiqueta} lg:col-span-2`}>
          Obra
          <select className={campo} value={obraId} onChange={(e) => elegirObra(e.target.value)}>
            <option value="">Elige la obra…</option>
            {obras.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nombre} · {o.empresa_codigo}
                {presupuestos.some((p) => p.proyecto_id === o.id) ? " · con presupuesto" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={etiqueta}>
          Mes de inicio
          <input type="month" className={campo} value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </label>
        <label className={etiqueta}>
          Mes de término
          <input type="month" className={campo} value={fin} onChange={(e) => setFin(e.target.value)} />
        </label>
        <label className={etiqueta}>
          Reparto por mes
          <select className={campo} value={reparto} onChange={(e) => setReparto(e.target.value as Reparto)}>
            <option value="curva_s">Curva S</option>
            <option value="parejo">Parejo</option>
          </select>
        </label>
      </div>
      {obraId && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {CATEGORIAS_OBRA.map((c) => (
              <label key={c.clave} className={etiqueta}>
                {c.titulo}
                <input inputMode="decimal" className={`${campo} text-right`} value={montos[c.clave] ?? ""} placeholder="0" onChange={(e) => setMontos((m) => ({ ...m, [c.clave]: e.target.value }))} />
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-slate-700">
            Total de la obra: <span className="font-semibold tabular-nums">{dinero(total, 2)}</span>
          </p>
          {vistaPrevia.length > 0 && (
            <div className="mt-2 overflow-x-auto rounded border border-slate-200">
              <table className="text-xs">
                <tbody>
                  <tr className="bg-slate-50 text-slate-500">
                    {vistaPrevia.map(([mes]) => (
                      <th key={mes} className="whitespace-nowrap px-2 py-1 text-right font-normal">
                        {nombreMes(mes)}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {vistaPrevia.map(([mes, v]) => (
                      <td key={mes} className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                        {dinero(v)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {aviso && <p className="mt-2 rounded bg-slate-50 px-3 py-2 text-xs text-slate-700">{aviso}</p>}
          <button type="button" disabled={guardar.isPending} onClick={() => guardar.mutate()} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {guardar.isPending ? "Guardando…" : "Guardar presupuesto"}
          </button>
          {actuales.length > 0 && <p className="mt-1 text-xs text-slate-500">Ya tiene presupuesto en: {actuales.map((p) => TITULO_CATEGORIA[p.categoria]).join(", ")}.</p>}
        </>
      )}
    </section>
  );
}
