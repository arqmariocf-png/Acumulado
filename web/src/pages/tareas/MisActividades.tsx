import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
  const { perfil } = useAuth();
  const q = useMisTarjetas(perfil?.id);
  const [verHechas, setVerHechas] = useState(false);
  const [papelFiltro, setPapelFiltro] = useState<Papel | "">("");
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
    <section className="mb-6 rounded border border-slate-200 bg-white p-4">
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
        </div>
      </div>

      {q.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {q.error && <p className="text-sm text-red-600">{(q.error as Error).message}</p>}

      {q.data && (
        <>
          <div className={`mb-4 grid gap-2 ${compacto ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-5"}`}>
            <Indicador etiqueta="Cumplimiento" valor={pct === null ? "—" : `${pct}%`} tono={pct === null ? "" : pct >= 90 ? "text-emerald-700" : pct >= 75 ? "text-amber-700" : "text-red-700"} />
            <Indicador etiqueta="Pendientes" valor={String(resumen.pendientes)} />
            <Indicador etiqueta="Vencidas" valor={String(resumen.vencidas)} tono={resumen.vencidas > 0 ? "text-red-700" : "text-emerald-700"} />
            <Indicador etiqueta="Hechas" valor={String(resumen.hechas)} />
            <Indicador etiqueta="A tiempo" valor={resumen.hechas === 0 ? "—" : `${Math.round((100 * resumen.aTiempo) / resumen.hechas)}%`} />
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
