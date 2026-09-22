import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { ETIQUETA_CUMPLIMIENTO, clasificar, porPersona, porSemana, type ActividadBase, type EstadoCumplimiento } from "../../lib/cumplimiento";
import type { Tablero, TableroColumna, Tarjeta } from "../../types/database";
import { BarrasPorcentaje, COLOR, GraficaApilada } from "./graficas";

const NOMBRE_TABLERO = "RH · Actividades";
const COLUMNA_HECHO = "Hecho";
const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";

const COLOR_ESTADO: Record<EstadoCumplimiento, string> = {
  a_tiempo: COLOR.bueno,
  tarde: COLOR.advertencia,
  vencida: COLOR.critico,
  pendiente: COLOR.serie1,
  sin_fecha: COLOR.neutro,
};
const CHIP_ESTADO: Record<EstadoCumplimiento, string> = {
  a_tiempo: "bg-emerald-100 text-emerald-800",
  tarde: "bg-amber-100 text-amber-800",
  vencida: "bg-red-100 text-red-800",
  pendiente: "bg-sky-100 text-sky-800",
  sin_fecha: "bg-slate-100 text-slate-700",
};

interface Directorio {
  id: string;
  nombre: string;
  rol: string;
  activo: boolean;
}

interface Movimiento {
  tarjeta_id: string;
  detalle: { de?: string; a?: string } | null;
  created_at: string;
}

function useTableroRH() {
  return useQuery({
    queryKey: ["rh-tablero-actividades"],
    queryFn: async () => {
      const { data: tablero, error } = await supabase.from("tableros").select("*").eq("nombre", NOMBRE_TABLERO).maybeSingle();
      if (error) throw error;
      if (!tablero) return null;
      const { data: columnas, error: errCols } = await supabase.from("tablero_columnas").select("*").eq("tablero_id", tablero.id).order("orden");
      if (errCols) throw errCols;
      return { tablero: tablero as Tablero, columnas: (columnas ?? []) as TableroColumna[] };
    },
  });
}

function useActividades(tableroId: string | undefined) {
  return useQuery({
    queryKey: ["rh-actividades", tableroId],
    enabled: !!tableroId,
    queryFn: async () => {
      const { data: tarjetas, error } = await supabase.from("tarjetas").select("*").eq("tablero_id", tableroId!).eq("archivada", false).order("fecha_limite", { ascending: true, nullsFirst: false });
      if (error) throw error;
      const ids = (tarjetas ?? []).map((t) => t.id);
      let movimientos: Movimiento[] = [];
      if (ids.length > 0) {
        const { data, error: errMov } = await supabase.from("tarjeta_actividad").select("tarjeta_id, detalle, created_at").in("tarjeta_id", ids).eq("tipo", "movida").order("created_at");
        if (errMov) throw errMov;
        movimientos = (data ?? []) as Movimiento[];
      }
      return { tarjetas: (tarjetas ?? []) as Tarjeta[], movimientos };
    },
  });
}

function useDirectorio() {
  return useQuery({
    queryKey: ["directorio"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_directorio").select("*").eq("activo", true).order("nombre");
      if (error) throw error;
      return data as Directorio[];
    },
  });
}

async function usuarioActualId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Sesión expirada, vuelve a iniciar sesión.");
  return id;
}

/** Actividades asignadas por RH (tablero "RH · Actividades" del módulo de
 * Tareas) con seguimiento de cumplimiento por semana y por persona. */
export function Actividades() {
  const queryClient = useQueryClient();
  const { data: tab, isLoading: cargandoTablero } = useTableroRH();
  const { data: datos, isLoading } = useActividades(tab?.tablero.id);
  const { data: directorio } = useDirectorio();
  const [filtroPersona, setFiltroPersona] = useState("");
  const [verHechas, setVerHechas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hoy = new Date().toISOString().slice(0, 10);
  const columnaHecho = tab?.columnas.find((c) => c.nombre === COLUMNA_HECHO) ?? tab?.columnas[tab.columnas.length - 1];
  const columnaInicial = tab?.columnas[0];
  const nombrePorId = useMemo(() => new Map((directorio ?? []).map((d) => [d.id, d.nombre])), [directorio]);
  const nombreColumna = useMemo(() => new Map((tab?.columnas ?? []).map((c) => [c.id, c.nombre])), [tab]);

  const actividades: (ActividadBase & { tarjeta: Tarjeta; columna: string })[] = useMemo(() => {
    if (!datos) return [];
    return datos.tarjetas.map((t) => {
      const columna = nombreColumna.get(t.columna_id) ?? "";
      const hecha = !!columnaHecho && t.columna_id === columnaHecho.id;
      const ultimoAHecho = [...datos.movimientos].reverse().find((m) => m.tarjeta_id === t.id && m.detalle?.a === COLUMNA_HECHO);
      return {
        id: t.id,
        titulo: t.titulo,
        asignado_a: t.asignado_a,
        fecha_limite: t.fecha_limite,
        hecha,
        hecha_en: hecha ? (ultimoAHecho?.created_at ?? t.updated_at) : null,
        created_at: t.created_at,
        tarjeta: t,
        columna,
      };
    });
  }, [datos, columnaHecho, nombreColumna]);

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["rh-actividades"] });
    queryClient.invalidateQueries({ queryKey: ["tarjetas"] });
  };

  const crear = useMutation({
    mutationFn: async (p: { titulo: string; descripcion: string | null; asignado_a: string | null; fecha_limite: string | null }) => {
      if (!tab || !columnaInicial) throw new Error("No existe el tablero de actividades de RH.");
      const userId = await usuarioActualId();
      const { data: tarjeta, error: err } = await supabase
        .from("tarjetas")
        .insert({ tablero_id: tab.tablero.id, columna_id: columnaInicial.id, titulo: p.titulo, descripcion: p.descripcion, asignado_a: p.asignado_a, fecha_limite: p.fecha_limite, creado_por: userId })
        .select("id")
        .single();
      if (err) throw err;
      await supabase.from("tarjeta_actividad").insert({ tarjeta_id: tarjeta.id, tipo: "creada", actor_id: userId });
      if (p.asignado_a) await supabase.from("tarjeta_actividad").insert({ tarjeta_id: tarjeta.id, tipo: "asignada", detalle: { nombre: nombrePorId.get(p.asignado_a) }, actor_id: userId });
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  const mover = useMutation({
    mutationFn: async (p: { tarjeta: Tarjeta; columnaId: string }) => {
      const userId = await usuarioActualId();
      const { error: err } = await supabase.from("tarjetas").update({ columna_id: p.columnaId }).eq("id", p.tarjeta.id);
      if (err) throw err;
      await supabase.from("tarjeta_actividad").insert({
        tarjeta_id: p.tarjeta.id,
        tipo: "movida",
        detalle: { de: nombreColumna.get(p.tarjeta.columna_id), a: nombreColumna.get(p.columnaId) },
        actor_id: userId,
      });
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  const reasignar = useMutation({
    mutationFn: async (p: { tarjetaId: string; asignadoA: string | null; fechaLimite?: string | null }) => {
      const userId = await usuarioActualId();
      const cambios: Record<string, unknown> = { asignado_a: p.asignadoA };
      if (p.fechaLimite !== undefined) cambios.fecha_limite = p.fechaLimite;
      const { error: err } = await supabase.from("tarjetas").update(cambios).eq("id", p.tarjetaId);
      if (err) throw err;
      await supabase.from("tarjeta_actividad").insert({ tarjeta_id: p.tarjetaId, tipo: "asignada", detalle: p.asignadoA ? { nombre: nombrePorId.get(p.asignadoA) } : null, actor_id: userId });
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  function onCrear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    crear.mutate({
      titulo: String(fd.get("titulo") ?? "").trim(),
      descripcion: String(fd.get("descripcion") ?? "").trim() || null,
      asignado_a: String(fd.get("asignado_a") ?? "") || null,
      fecha_limite: String(fd.get("fecha_limite") ?? "") || null,
    });
    e.currentTarget.reset();
  }

  const filtradas = actividades.filter((a) => (!filtroPersona || a.asignado_a === filtroPersona) && (verHechas || !a.hecha));
  const semanas = porSemana(actividades.filter((a) => !filtroPersona || a.asignado_a === filtroPersona), hoy, 8);
  const personas = porPersona(actividades, hoy);
  const resumen = actividades.reduce(
    (acc, a) => {
      acc[clasificar(a, hoy)]++;
      return acc;
    },
    { a_tiempo: 0, tarde: 0, vencida: 0, pendiente: 0, sin_fecha: 0 } as Record<EstadoCumplimiento, number>,
  );
  const cerradas = resumen.a_tiempo + resumen.tarde + resumen.vencida;
  const cumplimientoGlobal = cerradas > 0 ? Math.round((resumen.a_tiempo / cerradas) * 100) : null;

  if (cargandoTablero) return <p className="text-sm text-slate-400">Cargando…</p>;
  if (!tab)
    return (
      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        No existe el tablero "{NOMBRE_TABLERO}". Un administrador debe crearlo desde Tareas con columnas Por hacer / En progreso / Hecho.
      </p>
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi etiqueta="Cumplimiento" valor={cumplimientoGlobal != null ? `${cumplimientoGlobal}%` : "—"} detalle="a tiempo entre las cerradas" />
        <Kpi etiqueta="Pendientes" valor={String(resumen.pendiente + resumen.sin_fecha)} />
        <Kpi etiqueta="Vencidas sin hacer" valor={String(resumen.vencida)} tono={resumen.vencida > 0 ? "rojo" : undefined} />
        <Kpi etiqueta="Hechas a tiempo" valor={String(resumen.a_tiempo)} />
        <Kpi etiqueta="Hechas tarde" valor={String(resumen.tarde)} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <GraficaApilada
            titulo="Cumplimiento por semana (según fecha límite)"
            barras={semanas.map((s) => ({
              etiqueta: `${new Date(`${s.semana}T00:00:00`).getDate()}/${new Date(`${s.semana}T00:00:00`).getMonth() + 1}`,
              segmentos: [
                { clave: "a_tiempo", etiqueta: ETIQUETA_CUMPLIMIENTO.a_tiempo, valor: s.a_tiempo, color: COLOR_ESTADO.a_tiempo },
                { clave: "tarde", etiqueta: ETIQUETA_CUMPLIMIENTO.tarde, valor: s.tarde, color: COLOR_ESTADO.tarde },
                { clave: "vencida", etiqueta: ETIQUETA_CUMPLIMIENTO.vencida, valor: s.vencida, color: COLOR_ESTADO.vencida },
                { clave: "pendiente", etiqueta: ETIQUETA_CUMPLIMIENTO.pendiente, valor: s.pendiente, color: COLOR_ESTADO.pendiente },
              ],
            }))}
          />
        </div>
        <BarrasPorcentaje
          titulo="Cumplimiento por persona"
          filas={personas.map((p) => ({
            etiqueta: p.asignado_a ? (nombrePorId.get(p.asignado_a) ?? "Sin nombre") : "Sin asignar",
            pct: p.cumplimiento_pct,
            detalle: `${p.a_tiempo} a tiempo · ${p.hechas - p.a_tiempo} tarde · ${p.vencidas} vencida(s) · ${p.pendientes} pendiente(s)`,
          }))}
        />
      </div>

      <form onSubmit={onCrear} className="grid grid-cols-1 gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-5">
        <div className="sm:col-span-2">
          <label className={etiqueta}>Actividad *</label>
          <input name="titulo" required placeholder="Ej. Entregar contratos firmados de la semana" className={campo} />
        </div>
        <div>
          <label className={etiqueta}>Asignar a</label>
          <select name="asignado_a" className={campo} defaultValue="">
            <option value="">Sin asignar</option>
            {directorio?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiqueta}>Fecha límite</label>
          <input name="fecha_limite" type="date" className={campo} />
        </div>
        <div className="flex items-end">
          <button disabled={crear.isPending} className="w-full rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {crear.isPending ? "Guardando…" : "Asignar actividad"}
          </button>
        </div>
        <div className="sm:col-span-5">
          <input name="descripcion" placeholder="Detalle (opcional)" className={campo} />
        </div>
      </form>

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Actividades</h3>
        <div className="flex flex-wrap items-center gap-3">
          <select value={filtroPersona} onChange={(e) => setFiltroPersona(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs">
            <option value="">Todas las personas</option>
            {directorio?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={verHechas} onChange={(e) => setVerHechas(e.target.checked)} /> ver hechas
          </label>
          <Link to={`/tareas/${tab.tablero.id}`} className="text-xs text-slate-500 underline">
            abrir tablero completo
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Actividad</th>
              <th className="px-3 py-2">Asignada a</th>
              <th className="px-3 py-2">Fecha límite</th>
              <th className="px-3 py-2">Etapa</th>
              <th className="px-3 py-2">Cumplimiento</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((a) => {
              const estado = clasificar(a, hoy);
              return (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    {a.titulo}
                    {a.tarjeta.descripcion && <div className="text-xs text-slate-400">{a.tarjeta.descripcion}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <select value={a.asignado_a ?? ""} onChange={(e) => reasignar.mutate({ tarjetaId: a.id, asignadoA: e.target.value || null })} className="rounded border border-slate-300 px-1 py-0.5 text-xs">
                      <option value="">Sin asignar</option>
                      {directorio?.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="date" value={a.fecha_limite ?? ""} onChange={(e) => reasignar.mutate({ tarjetaId: a.id, asignadoA: a.asignado_a, fechaLimite: e.target.value || null })} className="rounded border border-slate-300 px-1 py-0.5 text-xs" />
                  </td>
                  <td className="px-3 py-2">
                    <select value={a.tarjeta.columna_id} onChange={(e) => mover.mutate({ tarjeta: a.tarjeta, columnaId: e.target.value })} className="rounded border border-slate-300 px-1 py-0.5 text-xs">
                      {tab.columnas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CHIP_ESTADO[estado]}`}>{ETIQUETA_CUMPLIMIENTO[estado]}</span>
                    {a.hecha && a.hecha_en && <div className="text-[10px] text-slate-400">hecha {new Date(a.hecha_en).toLocaleDateString("es-MX")}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                    {!a.hecha && columnaHecho && (
                      <button onClick={() => mover.mutate({ tarjeta: a.tarjeta, columnaId: columnaHecho.id })} className="text-emerald-700 underline">
                        Marcar hecha
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!isLoading && filtradas.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Sin actividades {verHechas ? "" : "pendientes"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ etiqueta, valor, detalle, tono }: { etiqueta: string; valor: string; detalle?: string; tono?: "rojo" }) {
  return (
    <div className={`rounded border bg-white p-3 ${tono === "rojo" ? "border-red-200" : "border-slate-200"}`}>
      <p className="text-[11px] uppercase text-slate-500">{etiqueta}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tono === "rojo" ? "text-red-700" : "text-slate-900"}`}>{valor}</p>
      {detalle && <p className="text-[11px] text-slate-400">{detalle}</p>}
    </div>
  );
}
