import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { Unidad } from "../../lib/logistica";
import type { Gasto, Viaje } from "../../lib/volteo";
import { TIPOS_GASTO } from "../../lib/volteo";
import { enPeriodoVolteo, movimientosVolteo, nombreMaterial, recuperacion, serie, sumaPor, totales, type Agrupacion, type DatosVolteo, type Periodo } from "../../lib/volteoTablero";
import { descargarCsv } from "../../lib/descargarArchivo";

// Tablero de volteo (27-nov-2026, Laura). El "Dash volteo.xlsx" dentro de
// Logística: inversión, ingresos, costo del material, chofer, operación,
// utilidad por mes y por semana y recuperación de la inversión. Junta lo
// capturado aquí (con el histórico 2024-2025 del Excel) y lo del backoffice
// que no se capturó en Logística (OV de material y OC de "Volteo International").

const dinero = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
const COLOR_ING = "#2a78d6";
const COLOR_EGR = "#eb6834";
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const etiquetaMes = (k: string) => `${MES[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
const etiquetaSemana = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(2, 4)}`;
const etiquetaGasto = (t: string) => TIPOS_GASTO.find((x) => x.clave === t)?.etiqueta ?? t;

function hoyMx(): string {
  return new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
}

export function TableroVolteo({ unidades, viajes, gastos }: { unidades: Unidad[]; viajes: Viaje[]; gastos: Gasto[] }) {
  const volteos = useMemo(() => unidades.filter((u) => u.tipo === "volteo" && u.estado !== "baja"), [unidades]);
  const [unidadSel, setUnidadSel] = useState<string>("");
  const [periodo, setPeriodo] = useState<Periodo>("todo");
  const [por, setPor] = useState<Agrupacion>("mes");
  const hoy = hoyMx();

  const backoffice = useQuery({
    queryKey: ["volteo-backoffice"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_volteo_backoffice");
      if (error) throw error;
      return (data ?? null) as DatosVolteo["backoffice"];
    },
  });

  const elegidas = useMemo(() => new Set((unidadSel ? volteos.filter((u) => u.id === unidadSel) : volteos).map((u) => u.id)), [volteos, unidadSel]);
  // Las OV del backoffice no traen unidad: van a la unidad elegida solo si hay una sola de volteo.
  const conOv = !unidadSel || volteos.length === 1;
  const todo = useMemo(
    () => movimientosVolteo({ viajes, gastos, backoffice: backoffice.data ? { ...backoffice.data, ingresos: conOv ? backoffice.data.ingresos : [] } : null }, elegidas),
    [viajes, gastos, backoffice.data, elegidas, conOv],
  );
  const ingresos = useMemo(() => todo.ingresos.filter((i) => enPeriodoVolteo(i.fecha, periodo, hoy)), [todo, periodo, hoy]);
  const egresos = useMemo(() => todo.egresos.filter((e) => enPeriodoVolteo(e.fecha, periodo, hoy)), [todo, periodo, hoy]);
  const t = totales(ingresos, egresos);
  const tTodo = totales(todo.ingresos, todo.egresos);
  const mensualTodo = serie(todo.ingresos, todo.egresos, "mes");
  const inversion = [...elegidas].reduce((s, id) => s + Number(volteos.find((u) => u.id === id)?.inversion ?? 0), 0);
  const rec = recuperacion(inversion, tTodo.utilidad, mensualTodo);
  const filas = serie(ingresos, egresos, por);
  const visibles = por === "semana" ? filas.slice(-26) : filas;
  const anios = useMemo(() => [...new Set([...todo.ingresos, ...todo.egresos].map((x) => x.fecha.slice(0, 4)))].sort().reverse(), [todo]);
  const semanasConViaje = new Set(ingresos.map((i) => i.fecha)).size;
  const mesesActivos = serie(ingresos, [], "mes").length;

  const clientes = sumaPor(ingresos, (i) => i.cliente ?? "", (i) => i.importe).slice(0, 10);
  const materiales = sumaPor(ingresos, (i) => nombreMaterial(i.material), (i) => i.importe).slice(0, 10);
  const porTipo = sumaPor(egresos, (e) => etiquetaGasto(e.tipo), (e) => e.monto);

  if (volteos.length === 0) {
    return <p className="text-sm text-slate-500">No hay unidades de tipo volteo. Dalas de alta en la pestaña Unidades (tipo "volteo").</p>;
  }

  function excel() {
    const enc = ["Periodo", "Viajes", "Ingresos", "Costo material", "Chofer (mano de obra)", "Operación", "Egresos", "Utilidad", "% utilidad"];
    const celda = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const renglones = [enc, ...filas.map((f) => [f.clave, f.viajes, f.ingresos, f.material, f.mano_obra, f.operacion, f.egresos, f.utilidad, f.margen_pct ?? ""])];
    descargarCsv(`volteo-${por}-${periodo}.csv`, renglones.map((r) => r.map(celda).join(",")).join("\n"));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {volteos.length > 1 && (
          <select value={unidadSel} onChange={(e) => setUnidadSel(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
            <option value="">Todos los volteos ({volteos.length})</option>
            {volteos.map((u) => (
              <option key={u.id} value={u.id}>
                {u.folio} · {u.nombre}
              </option>
            ))}
          </select>
        )}
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
          <option value="todo">Desde que opera</option>
          <option value="12m">Últimos 12 meses</option>
          {anios.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded border border-slate-300 text-xs">
          {(["mes", "semana"] as Agrupacion[]).map((x) => (
            <button key={x} type="button" onClick={() => setPor(x)} className={`px-2.5 py-1 ${por === x ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>
              Por {x}
            </button>
          ))}
        </div>
        <button type="button" onClick={excel} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
          Descargar Excel
        </button>
        {backoffice.isLoading && <span className="text-xs text-slate-400">trayendo el backoffice…</span>}
        {backoffice.error && <span className="text-xs text-red-600">No se pudo leer el backoffice: {(backoffice.error as Error).message}</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tarjeta etiqueta="Inversión" valor={dinero(inversion)} sub={volteos.filter((u) => elegidas.has(u.id) && u.inversion_desde).map((u) => `desde ${u.inversion_desde}`)[0] ?? "captúrala en la unidad"} />
        <Tarjeta etiqueta="Ingresos" valor={dinero(t.ingresos)} sub={`${t.viajes} renglones · ${mesesActivos} mes(es)`} a="/logistica?tab=viajes" />
        <Tarjeta etiqueta="Egresos" valor={dinero(t.egresos)} sub={`material ${dinero(t.material)} · chofer ${dinero(t.mano_obra)} · operación ${dinero(t.operacion)}`} a="/logistica?tab=gastos" />
        <Tarjeta etiqueta="Utilidad" valor={dinero(t.utilidad)} sub={t.margen_pct == null ? "—" : `${t.margen_pct} % de los ingresos`} tono={t.utilidad >= 0 ? "text-emerald-700" : "text-red-700"} />
        <Tarjeta
          etiqueta="Inversión recuperada"
          valor={rec.pct == null ? "—" : `${rec.pct} %`}
          sub={rec.meses_faltan === 0 ? "ya se recuperó" : rec.meses_faltan == null ? `faltan ${dinero(rec.falta)}; al ritmo actual no se recupera` : `faltan ${dinero(rec.falta)} · ≈ ${rec.meses_faltan} meses a ${dinero(rec.ritmo)}/mes`}
          tono={rec.pct != null && rec.pct >= 100 ? "text-emerald-700" : "text-amber-700"}
        />
        <Tarjeta etiqueta="Días con viajes" valor={String(semanasConViaje)} sub={mesesActivos ? `≈ ${Math.round((t.viajes / mesesActivos) * 10) / 10} renglones al mes` : "—"} />
      </div>

      <Barras filas={visibles} etiqueta={por === "mes" ? etiquetaMes : etiquetaSemana} titulo={por === "mes" ? "Ingresos contra egresos por mes" : "Ingresos contra egresos por semana (últimas 26)"} />

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">{por === "mes" ? "Mes" : "Semana (lunes)"}</th>
              <th className="px-3 py-2 text-right">Renglones</th>
              <th className="px-3 py-2 text-right">Ingresos</th>
              <th className="px-3 py-2 text-right">Material</th>
              <th className="px-3 py-2 text-right">Chofer</th>
              <th className="px-3 py-2 text-right">Operación</th>
              <th className="px-3 py-2 text-right">Utilidad</th>
              <th className="px-3 py-2 text-right">% utilidad</th>
            </tr>
          </thead>
          <tbody>
            {[...visibles].reverse().map((f) => (
              <tr key={f.clave} className="border-t border-slate-100">
                <td className="px-3 py-1.5">{por === "mes" ? etiquetaMes(f.clave) : etiquetaSemana(f.clave)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{f.viajes}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{dinero(f.ingresos)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{dinero(f.material)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{dinero(f.mano_obra)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{dinero(f.operacion)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${f.utilidad < 0 ? "text-red-700" : ""}`}>{dinero(f.utilidad)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${f.margen_pct != null && f.margen_pct < 0 ? "text-red-700" : ""}`}>{f.margen_pct == null ? "—" : `${f.margen_pct} %`}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td className="px-3 py-1.5">Total</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{t.viajes}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{dinero(t.ingresos)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{dinero(t.material)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{dinero(t.mano_obra)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{dinero(t.operacion)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{dinero(t.utilidad)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{t.margen_pct == null ? "—" : `${t.margen_pct} %`}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Lista titulo="Clientes (ingresos)" filas={clientes} total={t.ingresos} />
        <Lista titulo="Materiales (ingresos)" filas={materiales} total={t.ingresos} />
        <Lista titulo="Egresos por tipo" filas={porTipo} total={t.egresos} />
      </div>

      <p className="text-xs text-slate-500">
        De dónde sale: viajes y gastos de Logística (los folios H-… son el histórico de ago-2024 a jun-2025 del "Dash volteo.xlsx"; ver{" "}
        <Link to="/logistica?tab=viajes" className="underline">viajes</Link> y <Link to="/logistica?tab=gastos" className="underline">gastos</Link>) más, del backoffice, las OV de material
        (arena, grava, piedra, tepetate, escombro…) de la empresa del volteo y las OC/OS de la obra "{volteos[0]?.proyecto_backoffice ?? "Volteo International"}" que no se han capturado aquí
        ({backoffice.data?.ingresos?.length ?? 0} partidas de OV y {backoffice.data?.gastos?.length ?? 0} OC/OS; ver en{" "}
        <Link to={`/ordenes?tipo=OC&buscar=${encodeURIComponent(volteos[0]?.proyecto_backoffice ?? "Volteo International")}&backoffice=1`} className="underline">Órdenes</Link>). Importes como en el Excel (OV
        partida × precio; OC total). La inversión no cuenta como egreso: se recupera con la utilidad acumulada.
      </p>
    </div>
  );
}

function Tarjeta({ etiqueta, valor, sub, tono = "text-slate-900", a }: { etiqueta: string; valor: string; sub: string; tono?: string; a?: string }) {
  const cuerpo = (
    <>
      <div className="text-[11px] uppercase text-slate-500">{etiqueta}</div>
      <div className={`text-lg font-semibold tabular-nums ${tono}`}>{valor}</div>
      <div className="text-[11px] text-slate-500">{sub}</div>
    </>
  );
  return a ? (
    <Link to={a} title="ver de dónde sale" className="rounded border border-slate-200 bg-white p-3 hover:border-slate-400">
      {cuerpo}
    </Link>
  ) : (
    <div className="rounded border border-slate-200 bg-white p-3">{cuerpo}</div>
  );
}

function Lista({ titulo, filas, total }: { titulo: string; filas: { clave: string; total: number; n: number }[]; total: number }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-sm font-semibold text-slate-800">{titulo}</h3>
      {filas.length === 0 && <p className="text-xs text-slate-400">Sin datos en el periodo.</p>}
      <ul className="space-y-1.5">
        {filas.map((f) => (
          <li key={f.clave} className="text-xs">
            <div className="flex justify-between gap-2">
              <span className="truncate text-slate-700" title={f.clave}>
                {f.clave} <span className="text-slate-400">({f.n})</span>
              </span>
              <span className="tabular-nums text-slate-900">{dinero(f.total)}</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded bg-slate-100">
              <div className="h-1.5 rounded bg-slate-400" style={{ width: `${total > 0 ? Math.min(100, (100 * f.total) / total) : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Barras({ filas, etiqueta, titulo }: { filas: { clave: string; ingresos: number; egresos: number; utilidad: number }[]; etiqueta: (k: string) => string; titulo: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const alto = 200;
  const ancho = Math.max(640, filas.length * 34);
  const m = { izq: 8, der: 8, arr: 10, abajo: 30 };
  const maximo = Math.max(1, ...filas.map((f) => Math.max(f.ingresos, f.egresos)));
  const paso = (ancho - m.izq - m.der) / Math.max(1, filas.length);
  const barra = Math.max(3, Math.min(14, paso / 2 - 3));
  const y = (v: number) => m.arr + (alto - m.arr - m.abajo) * (1 - v / maximo);
  const h = hover != null ? filas[hover] : null;
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
        <div className="flex items-center gap-3 text-xs text-slate-600">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_ING }} /> Ingresos</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_EGR }} /> Egresos</span>
        </div>
      </div>
      <p className="mb-1 h-4 text-xs text-slate-600">
        {h ? `${etiqueta(h.clave)}: ingresos ${dinero(h.ingresos)} · egresos ${dinero(h.egresos)} · utilidad ${dinero(h.utilidad)}` : "Pasa el cursor por una barra."}
      </p>
      <div className="overflow-x-auto">
        <svg width={ancho} height={alto} role="img" aria-label={titulo} onMouseLeave={() => setHover(null)}>
          <line x1={m.izq} x2={ancho - m.der} y1={alto - m.abajo} y2={alto - m.abajo} stroke="#e7e6e2" />
          {filas.map((f, i) => {
            const x = m.izq + i * paso + paso / 2;
            return (
              <g key={f.clave} onMouseEnter={() => setHover(i)}>
                <rect x={x - paso / 2} y={m.arr} width={paso} height={alto - m.arr - m.abajo} fill={hover === i ? "#f1f5f9" : "transparent"} />
                <rect x={x - barra - 1} y={y(f.ingresos)} width={barra} height={Math.max(0, alto - m.abajo - y(f.ingresos))} rx={2} fill={COLOR_ING} />
                <rect x={x + 1} y={y(f.egresos)} width={barra} height={Math.max(0, alto - m.abajo - y(f.egresos))} rx={2} fill={COLOR_EGR} />
                {(filas.length <= 18 || i % Math.ceil(filas.length / 18) === 0) && (
                  <text x={x} y={alto - m.abajo + 14} textAnchor="middle" fontSize={10} fill="#52514e">
                    {etiqueta(f.clave)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
