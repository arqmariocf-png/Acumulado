import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { JORNADA_BASE, cargaPorMaquina, programarLote, type PasoRuta } from "../../lib/programacionMaquinas";

interface Equipo {
  id: string;
  empresa_id: string;
  nombre: string;
  proceso: string | null;
  capacidad_nota: string | null;
  activo: boolean;
}
interface Producto {
  id: string;
  nombre: string;
  tipo: string;
}
interface RutaPaso extends PasoRuta {
  id: string;
  producto_id: string;
  notas: string | null;
}
interface Lote {
  id: string;
  folio: string;
  producto_id: string;
  cantidad_planeada: number;
  fecha_inicio: string;
  estado: string;
  productos_produccion: { nombre: string } | null;
}
interface Operacion {
  id: string;
  orden_produccion_id: string;
  paso: number;
  nombre_paso: string;
  equipo_id: string | null;
  personal_id: string | null;
  inicio_programado: string;
  fin_programado: string;
  inicio_real: string | null;
  fin_real: string | null;
  fuente_real: "manual" | "camara";
  estado: "programada" | "en_proceso" | "terminada" | "cancelada";
  notas: string | null;
  lote_folio: string;
  producto_nombre: string;
  equipo_nombre: string | null;
  minutos_programados: number;
  minutos_reales: number | null;
}

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function lunesDe(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}
function isoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}
function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function minutosTexto(m: number): string {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return h > 0 ? `${h} h ${mm ? `${mm} min` : ""}`.trim() : `${mm} min`;
}

const COLOR_ESTADO: Record<Operacion["estado"], string> = {
  programada: "bg-sky-100 border-sky-300 text-sky-900",
  en_proceso: "bg-amber-100 border-amber-300 text-amber-900",
  terminada: "bg-emerald-100 border-emerald-300 text-emerald-900",
  cancelada: "bg-slate-100 border-slate-300 text-slate-500 line-through",
};

/** Calendarización de tiempos y máquinas por lote. Pensado para Clavicón
 * (la malla pasa por varias máquinas); sirve para las tres plantas. */
export function CalendarioMaquinas({ empresaId }: { empresaId: string }) {
  const queryClient = useQueryClient();
  const [semana, setSemana] = useState(() => lunesDe(new Date()));
  const [error, setError] = useState<string | null>(null);

  const { data: equipos } = useQuery({
    queryKey: ["equipos-produccion", empresaId],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("equipos_produccion").select("*").eq("empresa_id", empresaId).order("nombre");
      if (err) throw err;
      return data as Equipo[];
    },
  });
  const { data: productos } = useQuery({
    queryKey: ["productos-produccion", empresaId],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("productos_produccion").select("id, nombre, tipo").eq("empresa_id", empresaId).eq("activo", true).order("nombre");
      if (err) throw err;
      return data as Producto[];
    },
  });
  const { data: rutas } = useQuery({
    queryKey: ["rutas-producto", empresaId],
    enabled: !!productos,
    queryFn: async () => {
      const ids = (productos ?? []).map((p) => p.id);
      if (ids.length === 0) return [] as RutaPaso[];
      const { data, error: err } = await supabase.from("rutas_producto").select("*").in("producto_id", ids).order("orden");
      if (err) throw err;
      return data as RutaPaso[];
    },
  });
  const { data: lotes } = useQuery({
    queryKey: ["lotes-abiertos", empresaId],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("ordenes_produccion").select("id, folio, producto_id, cantidad_planeada, fecha_inicio, estado, productos_produccion(nombre)").eq("empresa_id", empresaId).in("estado", ["planeada", "en_proceso"]).order("fecha_inicio");
      if (err) throw err;
      return data as unknown as Lote[];
    },
  });
  const { data: operaciones } = useQuery({
    queryKey: ["operaciones-programadas", empresaId],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("v_operaciones_programadas").select("*").eq("empresa_id", empresaId).order("inicio_programado");
      if (err) throw err;
      return data as Operacion[];
    },
  });

  const invalidar = (clave: string) => queryClient.invalidateQueries({ queryKey: [clave, empresaId] });

  // ── Máquinas ────────────────────────────────────────────────────────────
  const guardarEquipo = useMutation({
    mutationFn: async (p: { id?: string; valores: Partial<Equipo> }) => {
      const { error: err } = p.id
        ? await supabase.from("equipos_produccion").update(p.valores).eq("id", p.id)
        : await supabase.from("equipos_produccion").insert({ ...p.valores, empresa_id: empresaId });
      if (err) throw err;
    },
    onSuccess: () => invalidar("equipos-produccion"),
    onError: (err) => setError((err as Error).message),
  });

  // ── Rutas ───────────────────────────────────────────────────────────────
  const guardarPaso = useMutation({
    mutationFn: async (p: { id?: string; valores: Partial<RutaPaso> }) => {
      const { error: err } = p.id ? await supabase.from("rutas_producto").update(p.valores).eq("id", p.id) : await supabase.from("rutas_producto").insert(p.valores);
      if (err) throw err;
    },
    onSuccess: () => invalidar("rutas-producto"),
    onError: (err) => setError((err as Error).message),
  });
  const borrarPaso = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await supabase.from("rutas_producto").delete().eq("id", id);
      if (err) throw err;
    },
    onSuccess: () => invalidar("rutas-producto"),
    onError: (err) => setError((err as Error).message),
  });

  // ── Programación ────────────────────────────────────────────────────────
  const programar = useMutation({
    mutationFn: async (p: { lote: Lote; inicio: string }) => {
      const ruta = (rutas ?? []).filter((r) => r.producto_id === p.lote.producto_id);
      if (ruta.length === 0) throw new Error("Este producto no tiene ruta de pasos. Captúrala en 'Rutas por producto'.");
      const ocupacion = (operaciones ?? []).filter((o) => o.estado !== "cancelada" && o.estado !== "terminada").map((o) => ({ equipo_id: o.equipo_id, fin_programado: o.fin_programado }));
      const generadas = programarLote(ruta, Number(p.lote.cantidad_planeada), new Date(p.inicio), ocupacion, JORNADA_BASE);
      await supabase.from("operaciones_programadas").delete().eq("orden_produccion_id", p.lote.id).eq("estado", "programada");
      const { error: err } = await supabase.from("operaciones_programadas").insert(
        generadas.map((g) => ({ orden_produccion_id: p.lote.id, paso: g.paso, nombre_paso: g.nombre_paso, equipo_id: g.equipo_id, inicio_programado: g.inicio_programado, fin_programado: g.fin_programado })),
      );
      if (err) throw err;
    },
    onSuccess: () => invalidar("operaciones-programadas"),
    onError: (err) => setError((err as Error).message),
  });
  const actualizarOp = useMutation({
    mutationFn: async (p: { id: string; cambios: Partial<Operacion> }) => {
      const { error: err } = await supabase.from("operaciones_programadas").update(p.cambios).eq("id", p.id);
      if (err) throw err;
    },
    onSuccess: () => invalidar("operaciones-programadas"),
    onError: (err) => setError((err as Error).message),
  });

  const nombreEquipo = useMemo(() => new Map((equipos ?? []).map((e) => [e.id, e.nombre])), [equipos]);
  const finSemana = useMemo(() => {
    const f = new Date(semana);
    f.setDate(f.getDate() + 7);
    return f;
  }, [semana]);
  const carga = useMemo(() => cargaPorMaquina(operaciones ?? [], semana, finSemana), [operaciones, semana, finSemana]);
  const dias = useMemo(() => Array.from({ length: 6 }, (_, i) => { const d = new Date(semana); d.setDate(d.getDate() + i); return d; }), [semana]);

  return (
    <div className="space-y-6">
      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Calendario semanal por máquina */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Calendario por máquina</h3>
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => setSemana((s) => { const d = new Date(s); d.setDate(d.getDate() - 7); return d; })} className="rounded border border-slate-300 px-2 py-1 text-xs">◀</button>
            <span className="text-slate-700">Semana del {semana.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}</span>
            <button onClick={() => setSemana((s) => { const d = new Date(s); d.setDate(d.getDate() + 7); return d; })} className="rounded border border-slate-300 px-2 py-1 text-xs">▶</button>
            <button onClick={() => setSemana(lunesDe(new Date()))} className="text-xs text-slate-500 underline">hoy</button>
          </div>
        </div>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">Máquina</th>
                {dias.map((d) => (
                  <th key={d.toISOString()} className={`px-2 py-2 ${d.toDateString() === new Date().toDateString() ? "text-slate-900" : ""}`}>
                    {DIAS[d.getDay()]} {d.getDate()}
                  </th>
                ))}
                <th className="px-2 py-2 text-right">Carga</th>
              </tr>
            </thead>
            <tbody>
              {(equipos ?? []).filter((e) => e.activo).map((e) => {
                const c = carga.get(e.id);
                return (
                  <tr key={e.id} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-2 font-medium text-slate-800">
                      {e.nombre}
                      {e.proceso && <div className="text-[10px] font-normal text-slate-400">{e.proceso}</div>}
                    </td>
                    {dias.map((d) => {
                      const delDia = (operaciones ?? []).filter((o) => o.equipo_id === e.id && o.estado !== "cancelada" && new Date(o.inicio_programado).toDateString() === d.toDateString());
                      return (
                        <td key={d.toISOString()} className="px-1 py-1">
                          {delDia.map((o) => (
                            <div key={o.id} className={`mb-1 rounded border px-1.5 py-1 ${COLOR_ESTADO[o.estado]}`} title={`${o.lote_folio} · ${o.producto_nombre} · ${o.nombre_paso}`}>
                              <div className="font-medium">{hora(o.inicio_programado)}–{hora(o.fin_programado)}</div>
                              <div className="truncate">{o.lote_folio} · {o.nombre_paso}</div>
                            </div>
                          ))}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-right tabular-nums">
                      {c ? (
                        <span className={c.pct > 100 ? "font-medium text-red-700" : c.pct > 80 ? "text-amber-700" : "text-slate-700"}>{c.pct}%</span>
                      ) : (
                        <span className="text-slate-300">0%</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(equipos ?? []).filter((e) => e.activo).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                    Da de alta las máquinas de la planta abajo para ver el calendario.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">Jornada base 08:00–18:00, lunes a sábado. Carga = minutos programados en la semana ÷ capacidad de la máquina. Azul programada, ámbar en proceso, verde terminada.</p>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SeccionEquipos equipos={equipos ?? []} onGuardar={(id, valores) => guardarEquipo.mutate({ id, valores })} />
        <SeccionRutas productos={productos ?? []} equipos={(equipos ?? []).filter((e) => e.activo)} rutas={rutas ?? []} onGuardar={(id, valores) => guardarPaso.mutate({ id, valores })} onBorrar={(id) => borrarPaso.mutate(id)} />
      </div>

      <SeccionProgramacion
        lotes={lotes ?? []}
        rutas={rutas ?? []}
        operaciones={operaciones ?? []}
        equipos={(equipos ?? []).filter((e) => e.activo)}
        nombreEquipo={nombreEquipo}
        programando={programar.isPending}
        onProgramar={(lote, inicio) => programar.mutate({ lote, inicio })}
        onActualizar={(id, cambios) => actualizarOp.mutate({ id, cambios })}
      />
    </div>
  );
}

function SeccionEquipos({ equipos, onGuardar }: { equipos: Equipo[]; onGuardar: (id: string | undefined, valores: Partial<Equipo>) => void }) {
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onGuardar(undefined, { nombre: String(fd.get("nombre") ?? "").trim(), proceso: String(fd.get("proceso") ?? "").trim() || null, capacidad_nota: String(fd.get("capacidad_nota") ?? "").trim() || null });
    e.currentTarget.reset();
  }
  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-sm font-semibold text-slate-800">Máquinas y estaciones</h3>
      <form onSubmit={onSubmit} className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <input name="nombre" required placeholder="Ej. Soldadora de malla 1" className={`${campo} sm:col-span-2`} />
        <input name="proceso" placeholder="Proceso (soldado, corte…)" className={campo} />
        <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">+ Máquina</button>
        <input name="capacidad_nota" placeholder="Nota de capacidad (opcional)" className={`${campo} sm:col-span-4`} />
      </form>
      <ul className="divide-y divide-slate-100 text-sm">
        {equipos.map((e) => (
          <li key={e.id} className={`flex items-center justify-between py-1.5 ${e.activo ? "" : "text-slate-400"}`}>
            <span>
              {e.nombre}
              {e.proceso && <span className="text-slate-400"> · {e.proceso}</span>}
              {e.capacidad_nota && <div className="text-[11px] text-slate-400">{e.capacidad_nota}</div>}
            </span>
            <button onClick={() => onGuardar(e.id, { activo: !e.activo })} className="text-xs text-slate-500 underline">
              {e.activo ? "Desactivar" : "Activar"}
            </button>
          </li>
        ))}
        {equipos.length === 0 && <li className="py-2 text-slate-400">Sin máquinas todavía.</li>}
      </ul>
    </section>
  );
}

function SeccionRutas({
  productos,
  equipos,
  rutas,
  onGuardar,
  onBorrar,
}: {
  productos: Producto[];
  equipos: Equipo[];
  rutas: RutaPaso[];
  onGuardar: (id: string | undefined, valores: Partial<RutaPaso>) => void;
  onBorrar: (id: string) => void;
}) {
  const [productoId, setProductoId] = useState("");
  const pasos = rutas.filter((r) => r.producto_id === productoId).sort((a, b) => a.orden - b.orden);
  const nombreEquipo = new Map(equipos.map((e) => [e.id, e.nombre]));

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!productoId) return;
    const fd = new FormData(e.currentTarget);
    onGuardar(undefined, {
      producto_id: productoId,
      orden: (pasos[pasos.length - 1]?.orden ?? 0) + 1,
      nombre_paso: String(fd.get("nombre_paso") ?? "").trim(),
      equipo_id: String(fd.get("equipo_id") ?? "") || null,
      minutos_preparacion: Number(fd.get("minutos_preparacion")) || 0,
      minutos_por_unidad: Number(fd.get("minutos_por_unidad")) || 0,
    });
    e.currentTarget.reset();
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-sm font-semibold text-slate-800">Rutas por producto (pasos y máquina)</h3>
      <select value={productoId} onChange={(e) => setProductoId(e.target.value)} className={`${campo} mb-2`}>
        <option value="">Elige un producto…</option>
        {productos.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
      {productoId && (
        <>
          <ol className="mb-2 space-y-1 text-sm">
            {pasos.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded border border-slate-100 px-2 py-1">
                <span>
                  <span className="mr-1 inline-block w-5 rounded bg-slate-900 text-center text-[10px] font-bold text-white">{p.orden}</span>
                  {p.nombre_paso}
                  <span className="text-slate-400"> · {p.equipo_id ? nombreEquipo.get(p.equipo_id) ?? "máquina" : "sin máquina"} · {p.minutos_preparacion} min prep + {p.minutos_por_unidad} min/u</span>
                </span>
                <button onClick={() => onBorrar(p.id)} className="text-xs text-red-600 underline">
                  Quitar
                </button>
              </li>
            ))}
            {pasos.length === 0 && <li className="text-slate-400">Este producto no tiene pasos. Agrega el primero.</li>}
          </ol>
          <form onSubmit={onSubmit} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <input name="nombre_paso" required placeholder="Paso (ej. Enderezado)" className={`${campo} col-span-2`} />
            <select name="equipo_id" className={campo} defaultValue="">
              <option value="">Máquina…</option>
              {equipos.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
            <input name="minutos_preparacion" type="number" step="1" min="0" placeholder="Min. prep." className={campo} />
            <input name="minutos_por_unidad" type="number" step="0.01" min="0" placeholder="Min/unidad" className={campo} />
            <button className="col-span-2 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white sm:col-span-5">+ Agregar paso</button>
          </form>
        </>
      )}
    </section>
  );
}

function SeccionProgramacion({
  lotes,
  rutas,
  operaciones,
  equipos,
  nombreEquipo,
  programando,
  onProgramar,
  onActualizar,
}: {
  lotes: Lote[];
  rutas: RutaPaso[];
  operaciones: Operacion[];
  equipos: Equipo[];
  nombreEquipo: Map<string, string>;
  programando: boolean;
  onProgramar: (lote: Lote, inicio: string) => void;
  onActualizar: (id: string, cambios: Partial<Operacion>) => void;
}) {
  const [loteId, setLoteId] = useState("");
  const [inicio, setInicio] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(Math.max(8, d.getHours()));
    return isoLocal(d);
  });
  const lote = lotes.find((l) => l.id === loteId);
  const opsLote = operaciones.filter((o) => o.orden_produccion_id === loteId).sort((a, b) => a.paso - b.paso);
  const tieneRuta = !!lote && rutas.some((r) => r.producto_id === lote.producto_id);
  const ahora = new Date().toISOString();

  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-sm font-semibold text-slate-800">Programar un lote</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <select value={loteId} onChange={(e) => setLoteId(e.target.value)} className={`${campo} sm:col-span-2`}>
          <option value="">Lote abierto…</option>
          {lotes.map((l) => (
            <option key={l.id} value={l.id}>
              {l.folio} · {l.productos_produccion?.nombre} · {Number(l.cantidad_planeada).toLocaleString("es-MX")} u
            </option>
          ))}
        </select>
        <div>
          <label className={etiqueta}>Arranque</label>
          <input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} className={campo} />
        </div>
        <div className="flex items-end">
          <button onClick={() => lote && onProgramar(lote, inicio)} disabled={!lote || !tieneRuta || programando} className="w-full rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {programando ? "Programando…" : opsLote.length > 0 ? "Reprogramar pasos" : "Generar programa"}
          </button>
        </div>
      </div>
      {lote && !tieneRuta && <p className="mt-2 text-xs text-amber-700">Este producto no tiene ruta de pasos todavía: captúrala en "Rutas por producto".</p>}
      <p className="mt-1 text-[11px] text-slate-400">Los pasos se encadenan en orden y cada máquina se ocupa después de su última operación programada. Reprogramar reemplaza solo los pasos aún "programados".</p>

      {opsLote.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Paso</th>
              <th className="px-2 py-2">Máquina</th>
              <th className="px-2 py-2">Programado</th>
              <th className="px-2 py-2">Real</th>
              <th className="px-2 py-2">Estado</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {opsLote.map((o) => (
              <tr key={o.id} className="border-t border-slate-100 align-top">
                <td className="px-2 py-2">
                  <span className="mr-1 inline-block w-5 rounded bg-slate-900 text-center text-[10px] font-bold text-white">{o.paso}</span>
                  {o.nombre_paso}
                </td>
                <td className="px-2 py-2">
                  <select value={o.equipo_id ?? ""} onChange={(e) => onActualizar(o.id, { equipo_id: e.target.value || null })} className="rounded border border-slate-300 px-1 py-0.5 text-xs">
                    <option value="">sin máquina</option>
                    {equipos.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2 text-xs">
                  <input type="datetime-local" value={isoLocal(new Date(o.inicio_programado))} onChange={(e) => onActualizar(o.id, { inicio_programado: new Date(e.target.value).toISOString() })} className="mb-1 block rounded border border-slate-300 px-1 py-0.5" />
                  <input type="datetime-local" value={isoLocal(new Date(o.fin_programado))} onChange={(e) => onActualizar(o.id, { fin_programado: new Date(e.target.value).toISOString() })} className="block rounded border border-slate-300 px-1 py-0.5" />
                  <div className="text-slate-400">{minutosTexto(Number(o.minutos_programados))}</div>
                </td>
                <td className="px-2 py-2 text-xs">
                  {o.inicio_real ? fechaHora(o.inicio_real) : "—"}
                  {" → "}
                  {o.fin_real ? fechaHora(o.fin_real) : "—"}
                  {o.minutos_reales != null && (
                    <div className={Number(o.minutos_reales) > Number(o.minutos_programados) ? "text-red-700" : "text-emerald-700"}>
                      {minutosTexto(Number(o.minutos_reales))} real ({Number(o.minutos_reales) - Number(o.minutos_programados) >= 0 ? "+" : ""}
                      {Math.round(Number(o.minutos_reales) - Number(o.minutos_programados))} min)
                    </div>
                  )}
                  <div className="text-[10px] text-slate-400">{o.fuente_real === "camara" ? "lectura de cámara" : "captura manual"}</div>
                </td>
                <td className="px-2 py-2">
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] ${COLOR_ESTADO[o.estado]}`}>{o.estado.replace("_", " ")}</span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right text-xs">
                  {o.estado === "programada" && (
                    <button onClick={() => onActualizar(o.id, { estado: "en_proceso", inicio_real: ahora })} className="mr-2 text-amber-700 underline">
                      Iniciar
                    </button>
                  )}
                  {o.estado === "en_proceso" && (
                    <button onClick={() => onActualizar(o.id, { estado: "terminada", fin_real: ahora })} className="mr-2 text-emerald-700 underline">
                      Terminar
                    </button>
                  )}
                  {o.estado !== "cancelada" && o.estado !== "terminada" && (
                    <button onClick={() => onActualizar(o.id, { estado: "cancelada" })} className="text-slate-500 underline">
                      Cancelar
                    </button>
                  )}
                  {nombreEquipo.size === 0 && null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
