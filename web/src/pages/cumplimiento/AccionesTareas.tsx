import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../lib/auth";
import {
  boton,
  botonSuave,
  campo,
  crearTareas,
  fechaCorta,
  recordarTablero,
  tableroRecordado,
  useAcciones,
  useDirectorio,
  useTablerosVisibles,
  type AccionParaTarea,
} from "./comun";

/** Lista de acciones ya convertidas en tarjetas, con su avance. */
export function AccionesRegistradas({ normaId, incidenciaId }: { normaId?: string; incidenciaId?: string }) {
  const acciones = useAcciones({ norma_id: normaId, incidencia_id: incidenciaId });
  if (acciones.isLoading) return <p className="text-sm text-slate-400">Cargando tareas…</p>;
  const lista = acciones.data ?? [];
  if (!lista.length) return <p className="text-sm text-slate-400">Todavía no hay tareas.</p>;
  const hechas = lista.filter((a) => a.terminada).length;
  return (
    <div>
      <p className="mb-1 text-xs text-slate-500">
        {hechas} de {lista.length} terminadas
      </p>
      <ul className="divide-y divide-slate-100 rounded border border-slate-200 text-sm">
        {lista.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5">
            <span className={a.terminada ? "text-slate-400 line-through" : ""}>{a.texto}</span>
            <span className="flex items-center gap-2 text-xs text-slate-500">
              {a.responsable_nombre ?? "—"} · {fechaCorta(a.fecha)}
              {a.tarjeta_id && a.tablero_id ? (
                <Link className="text-sky-700 underline" to={`/tareas/${a.tablero_id}?tarjeta=${a.tarjeta_id}`}>
                  {a.terminada ? "hecha" : a.tarjeta_cerrada ? "archivada" : "ver tarjeta"}
                </Link>
              ) : (
                <span className="text-slate-400">sin tarjeta</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Editor de acciones → tarjetas del tablero que se elija. */
export function NuevasTareas({
  inicial,
  origen,
  prefijo,
  descripcion,
  alTerminar,
}: {
  inicial: AccionParaTarea[];
  origen: { norma_id?: string; incidencia_id?: string };
  prefijo: string;
  descripcion: string;
  alTerminar?: () => void;
}) {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const personas = useDirectorio();
  const tableros = useTablerosVisibles();
  const [filas, setFilas] = useState<AccionParaTarea[]>(inicial.length ? inicial : [{ texto: "", responsable_id: null, fecha: null }]);
  const [tableroId, setTableroId] = useState(tableroRecordado);
  const elegido = tableroId && tableros.data?.some((t) => t.id === tableroId) ? tableroId : "";

  const crear = useMutation({
    mutationFn: async () => {
      if (!perfil) throw new Error("Sin sesión.");
      if (!elegido) throw new Error("Elige el tablero donde van las tareas.");
      return crearTareas({ acciones: filas, tableroId: elegido, creadorId: perfil.id, origen, prefijo, descripcion });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cumplimiento-acciones"] });
      setFilas([{ texto: "", responsable_id: null, fecha: null }]);
      alTerminar?.();
    },
  });

  const cambiar = (i: number, cambio: Partial<AccionParaTarea>) => setFilas((f) => f.map((x, j) => (j === i ? { ...x, ...cambio } : x)));

  return (
    <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
      {filas.map((f, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_12rem_9rem_auto]">
          <input className={campo} value={f.texto} placeholder="Qué hay que hacer" onChange={(e) => cambiar(i, { texto: e.target.value })} />
          <select className={campo} value={f.responsable_id ?? ""} onChange={(e) => cambiar(i, { responsable_id: e.target.value || null })}>
            <option value="">Responsable: yo</option>
            {(personas.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          <input type="date" className={campo} value={f.fecha ?? ""} onChange={(e) => cambiar(i, { fecha: e.target.value || null })} />
          <button type="button" className={botonSuave} onClick={() => setFilas((x) => x.filter((_, j) => j !== i))} aria-label="Quitar">
            ✕
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={botonSuave} onClick={() => setFilas((x) => [...x, { texto: "", responsable_id: null, fecha: null }])}>
          + Otra acción
        </button>
        <select
          className={`${campo} max-w-xs`}
          value={elegido}
          onChange={(e) => {
            setTableroId(e.target.value);
            recordarTablero(e.target.value);
          }}
        >
          <option value="">{tableros.isLoading ? "Cargando tableros…" : "Tablero donde van…"}</option>
          {(tableros.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
        <button type="button" className={boton} disabled={crear.isPending || !filas.some((f) => f.texto.trim())} onClick={() => crear.mutate()}>
          {crear.isPending ? "Creando…" : `Crear ${filas.filter((f) => f.texto.trim()).length} tarea(s)`}
        </button>
      </div>
      <p className="text-xs text-slate-500">Cada acción queda como tarjeta con su responsable y fecha: le llega el aviso, el recordatorio diario y el semáforo de tareas.</p>
      {crear.error && <p className="text-sm text-red-600">{(crear.error as Error).message}</p>}
      {crear.isSuccess && <p className="text-sm text-emerald-700">Listo: {crear.data} tarea(s) creadas.</p>}
    </div>
  );
}
