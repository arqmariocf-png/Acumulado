import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { clasificar, type EstadoCumplimiento } from "../../lib/cumplimiento";
import type { Tarjeta } from "../../types/database";

// Panel personal de tareas (Mario, 26-sep-2026): lo que tengo asignado como
// responsable principal, como supervisor a cargo o como corresponsable, con
// mi cumplimiento arriba (misma regla que RH: hecha = última columna del
// tablero; a tiempo = hecha antes de la fecha límite). Se muestra en /tareas
// y en el inicio del personal básico.

type Papel = "responsable" | "supervisor" | "corresponsable";
const ETIQUETA_PAPEL: Record<Papel, string> = { responsable: "Responsable", supervisor: "Supervisor", corresponsable: "Corresponsable" };
const COLOR_PAPEL: Record<Papel, string> = { responsable: "bg-slate-100 text-slate-700", supervisor: "bg-indigo-50 text-indigo-700", corresponsable: "bg-emerald-50 text-emerald-700" };

interface Fila {
  tarjeta: Tarjeta;
  tablero: string;
  columna: string;
  papel: Papel;
  estado: EstadoCumplimiento;
}

function useMisTarjetas(profileId: string | undefined) {
  return useQuery({
    queryKey: ["mis-tarjetas", profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const me = profileId!;
      const { data: tarjetas, error } = await supabase
        .from("tarjetas")
        .select("*")
        .eq("archivada", false)
        .or(`asignado_a.eq.${me},supervisor_id.eq.${me},corresponsables.cs.{${me}}`)
        .order("fecha_limite", { ascending: true, nullsFirst: false });
      if (error) throw error;
      const lista = (tarjetas ?? []) as Tarjeta[];
      const tableroIds = [...new Set(lista.map((t) => t.tablero_id))];
      if (tableroIds.length === 0) return { tarjetas: lista, tableros: [] as { id: string; nombre: string }[], columnas: [] as { id: string; tablero_id: string; nombre: string; orden: number }[] };
      const [{ data: tableros }, { data: columnas }] = await Promise.all([
        supabase.from("tableros").select("id, nombre").in("id", tableroIds),
        supabase.from("tablero_columnas").select("id, tablero_id, nombre, orden").in("tablero_id", tableroIds).order("orden"),
      ]);
      return { tarjetas: lista, tableros: tableros ?? [], columnas: columnas ?? [] };
    },
  });
}

function fechaCorta(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

export function MisActividades({ compacto = false }: { compacto?: boolean }) {
  const { perfil, soloConsulta } = useAuth();
  const q = useMisTarjetas(perfil?.id);
  const [verHechas, setVerHechas] = useState(false);
  const [papelFiltro, setPapelFiltro] = useState<Papel | "">("");
  const [nuevaPropia, setNuevaPropia] = useState(false);
  const hoy = new Date().toISOString().slice(0, 10);

  const filas: Fila[] = useMemo(() => {
    if (!q.data || !perfil) return [];
    const nombreTablero = new Map(q.data.tableros.map((t) => [t.id, t.nombre]));
    const columnaNombre = new Map(q.data.columnas.map((c) => [c.id, c.nombre]));
    const ultimaColumna = new Map<string, string>();
    for (const c of q.data.columnas) ultimaColumna.set(c.tablero_id, c.id); // vienen ordenadas: la última gana
    return q.data.tarjetas.map((t) => {
      const hecha = ultimaColumna.get(t.tablero_id) === t.columna_id;
      const papel: Papel = t.asignado_a === perfil.id ? "responsable" : t.supervisor_id === perfil.id ? "supervisor" : "corresponsable";
      const estado = clasificar({ id: t.id, titulo: t.titulo, asignado_a: t.asignado_a, fecha_limite: t.fecha_limite, hecha, hecha_en: hecha ? t.updated_at : null, created_at: t.created_at }, hoy);
      return { tarjeta: t, tablero: nombreTablero.get(t.tablero_id) ?? "Tablero", columna: columnaNombre.get(t.columna_id) ?? "", papel, estado };
    });
  }, [q.data, perfil, hoy]);

  const mias = filas.filter((f) => !papelFiltro || f.papel === papelFiltro);
  const propias = filas.filter((f) => f.papel !== "supervisor");
  const resumen = {
    total: propias.length,
    hechas: propias.filter((f) => f.estado === "a_tiempo" || f.estado === "tarde").length,
    aTiempo: propias.filter((f) => f.estado === "a_tiempo").length,
    vencidas: propias.filter((f) => f.estado === "vencida").length,
    pendientes: propias.filter((f) => f.estado === "pendiente" || f.estado === "sin_fecha").length,
  };
  const pct = resumen.total === 0 ? null : Math.round((100 * resumen.hechas) / resumen.total);
  const pendientes = mias.filter((f) => f.estado === "vencida" || f.estado === "pendiente" || f.estado === "sin_fecha");
  const hechas = mias.filter((f) => f.estado === "a_tiempo" || f.estado === "tarde");
  const grupos: { titulo: string; tono: string; filas: Fila[] }[] = [
    { titulo: "Vencidas", tono: "text-red-700", filas: pendientes.filter((f) => f.estado === "vencida") },
    { titulo: "Para hoy", tono: "text-amber-700", filas: pendientes.filter((f) => f.tarjeta.fecha_limite === hoy) },
    { titulo: "Próximas", tono: "text-slate-700", filas: pendientes.filter((f) => f.estado === "pendiente" && f.tarjeta.fecha_limite !== hoy) },
    { titulo: "Sin fecha", tono: "text-slate-500", filas: pendientes.filter((f) => f.estado === "sin_fecha") },
  ].filter((g) => g.filas.length > 0);

  if (!perfil) return null;

  return (
    <section id={compacto ? undefined : "mis-actividades"} className="mb-6 rounded border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Mis actividades</h2>
          <p className="text-xs text-slate-500">Lo que tienes como responsable, supervisor a cargo o corresponsable. Tu cumplimiento cuenta las de responsable y corresponsable.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select value={papelFiltro} onChange={(e) => setPapelFiltro(e.target.value as Papel | "")} className="rounded border border-slate-300 px-2 py-1">
            <option value="">Todos los papeles</option>
            <option value="responsable">Como responsable</option>
            <option value="supervisor">Las que superviso</option>
            <option value="corresponsable">Como corresponsable</option>
          </select>
          <label className="flex items-center gap-1 text-slate-600">
            <input type="checkbox" checked={verHechas} onChange={(e) => setVerHechas(e.target.checked)} /> ver hechas
          </label>
          {!soloConsulta && (
            <button type="button" onClick={() => setNuevaPropia((v) => !v)} className="rounded bg-slate-900 px-2.5 py-1 font-medium text-white">
              {nuevaPropia ? "Cerrar" : "+ Agregarme una actividad"}
            </button>
          )}
        </div>
      </div>
      {nuevaPropia && <NuevaActividadPropia profileId={perfil.id} onListo={() => setNuevaPropia(false)} />}

      {q.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {q.error && <p className="text-sm text-red-600">{(q.error as Error).message}</p>}

      {q.data && (
        <>
          <div className={`mb-4 grid gap-2 ${compacto ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-3 sm:grid-cols-6"}`}>
            <Indicador etiqueta="Cumplimiento" valor={pct === null ? "—" : `${pct}%`} tono={pct === null ? "" : pct >= 90 ? "text-emerald-700" : pct >= 75 ? "text-amber-700" : "text-red-700"} />
            <Indicador etiqueta="Pendientes" valor={String(resumen.pendientes)} />
            <Indicador etiqueta="Vencidas" valor={String(resumen.vencidas)} tono={resumen.vencidas > 0 ? "text-red-700" : "text-emerald-700"} />
            <Indicador etiqueta="Hechas" valor={String(resumen.hechas)} />
            <Indicador etiqueta="A tiempo" valor={resumen.hechas === 0 ? "—" : `${Math.round((100 * resumen.aTiempo) / resumen.hechas)}%`} />
            <Indicador etiqueta="Fechas movidas" valor={String(propias.reduce((s, f) => s + (f.tarjeta.fecha_cambios ?? 0), 0))} tono={propias.some((f) => (f.tarjeta.fecha_cambios ?? 0) > 0) ? "text-amber-700" : ""} />
          </div>

          {grupos.length === 0 && <p className="text-sm text-slate-400">No tienes actividades pendientes.</p>}
          {grupos.map((g) => (
            <div key={g.titulo} className="mb-3">
              <h3 className={`mb-1 text-xs font-semibold uppercase ${g.tono}`}>
                {g.titulo} <span className="font-normal text-slate-400">({g.filas.length})</span>
              </h3>
              <ul className="divide-y divide-slate-100 rounded border border-slate-100">
                {g.filas.map((f) => (
                  <FilaActividad key={f.tarjeta.id} fila={f} />
                ))}
              </ul>
            </div>
          ))}
          {verHechas && hechas.length > 0 && (
            <div className="mb-1">
              <h3 className="mb-1 text-xs font-semibold uppercase text-emerald-700">
                Hechas <span className="font-normal text-slate-400">({hechas.length})</span>
              </h3>
              <ul className="divide-y divide-slate-100 rounded border border-slate-100">
                {hechas.slice(0, compacto ? 5 : 30).map((f) => (
                  <FilaActividad key={f.tarjeta.id} fila={f} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Indicador({ etiqueta, valor, tono = "" }: { etiqueta: string; valor: string; tono?: string }) {
  return (
    <div className="rounded bg-slate-50 px-3 py-2">
      <div className="text-[11px] uppercase text-slate-500">{etiqueta}</div>
      <div className={`text-lg font-semibold tabular-nums ${tono || "text-slate-900"}`}>{valor}</div>
    </div>
  );
}

function FilaActividad({ fila: f }: { fila: Fila }) {
  const t = f.tarjeta;
  return (
    <li>
      <Link to={`/tareas/${t.tablero_id}?tarjeta=${t.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-50">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-slate-900">{t.titulo}</div>
          <div className="text-xs text-slate-500">
            {f.tablero}
            {f.columna && <> · {f.columna}</>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${COLOR_PAPEL[f.papel]}`}>{ETIQUETA_PAPEL[f.papel]}</span>
          {t.fecha_limite && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${f.estado === "vencida" ? "bg-red-50 text-red-700" : f.estado === "tarde" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
              {fechaCorta(t.fecha_limite)}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

const CLAVE_TABLERO = "acumulado.tablero-propio";

/** Actividad para uno mismo (Mario, 16-oct-2026: "que los supervisores
 * puedan asignarse tareas a ellos mismos"): título, tablero (de los que la
 * persona ve; se recuerda el último) y fecha; queda en la primera columna,
 * con la persona como responsable y creadora (así la puede editar). */
function NuevaActividadPropia({ profileId, onListo }: { profileId: string; onListo: () => void }) {
  const queryClient = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const [fecha, setFecha] = useState("");
  const [tableroId, setTableroId] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_TABLERO) ?? "";
    } catch {
      return "";
    }
  });
  const [error, setError] = useState<string | null>(null);
  const tableros = useQuery({
    queryKey: ["tableros-para-mi"],
    queryFn: async () => {
      const { data, error: e } = await supabase.from("tableros").select("id, nombre, archivado").order("nombre");
      if (e) throw e;
      return ((data ?? []) as { id: string; nombre: string; archivado?: boolean | null }[]).filter((t) => !t.archivado);
    },
  });
  const elegido = tableroId && tableros.data?.some((t) => t.id === tableroId) ? tableroId : "";
  const crear = useMutation({
    mutationFn: async () => {
      if (!titulo.trim()) throw new Error("Escribe qué vas a hacer.");
      if (!elegido) throw new Error("Elige el tablero donde va.");
      const { data: col, error: e1 } = await supabase.from("tablero_columnas").select("id").eq("tablero_id", elegido).order("orden").limit(1).maybeSingle();
      if (e1) throw e1;
      if (!col) throw new Error("Ese tablero no tiene columnas.");
      const { count } = await supabase.from("tarjetas").select("id", { count: "exact", head: true }).eq("columna_id", col.id);
      const { data: t, error: e2 } = await supabase
        .from("tarjetas")
        .insert({ tablero_id: elegido, columna_id: col.id, titulo: titulo.trim(), creado_por: profileId, asignado_a: profileId, fecha_limite: fecha || null, orden: count ?? 0 })
        .select("id")
        .single();
      if (e2) throw e2;
      await supabase.from("tarjeta_actividad").insert({ tarjeta_id: t.id, tipo: "creada", actor_id: profileId });
      try {
        localStorage.setItem(CLAVE_TABLERO, elegido);
      } catch {
        // sin almacenamiento local: no pasa nada
      }
    },
    onSuccess: () => {
      setTitulo("");
      setFecha("");
      queryClient.invalidateQueries({ queryKey: ["mis-tarjetas", profileId] });
      onListo();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        crear.mutate();
      }}
      className="mb-4 grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-6"
    >
      <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="¿Qué vas a hacer?" autoFocus className="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-3" />
      <select value={elegido} onChange={(e) => setTableroId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2">
        <option value="">{tableros.isLoading ? "Cargando tableros…" : "Tablero…"}</option>
        {(tableros.data ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.nombre}
          </option>
        ))}
      </select>
      <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} title="Fecha compromiso (la primera la pones tú; cambiarla después la autoriza tu jefe)" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
      <div className="flex items-center gap-3 sm:col-span-6">
        <button type="submit" disabled={crear.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {crear.isPending ? "Guardando…" : "Agregarme la actividad"}
        </button>
        <span className="text-xs text-slate-500">Quedas como responsable; la ves aquí y en el tablero.</span>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  );
}
