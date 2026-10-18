import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import {
  ETIQUETA_AREA,
  ETIQUETA_AUTORIDAD,
  ETIQUETA_ESTATUS_NORMA,
  accionesSugeridas,
  diasParaVigor,
  type EstatusNorma,
} from "../../lib/cumplimientoNormativo";
import { AccionesRegistradas, NuevasTareas } from "./AccionesTareas";
import { useNormas, type Norma } from "./datos";
import { boton, botonSuave, campo, fechaCorta, hoyMexico, operaCumplimiento, useDirectorio } from "./comun";


const CLASE_ESTATUS: Record<EstatusNorma, string> = {
  por_analizar: "bg-sky-50 text-sky-700",
  en_implementacion: "bg-amber-100 text-amber-800",
  cumplida: "bg-emerald-50 text-emerald-700",
  no_aplica: "bg-slate-100 text-slate-500",
};


/** Paso 1: cambios normativos → tareas del lunes. */
export function Normas() {
  const { perfil, soloConsulta } = useAuth();
  const opera = operaCumplimiento(perfil) && !soloConsulta;
  const normas = useNormas();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [verTodas, setVerTodas] = useState(false);
  const hoy = hoyMexico();
  const lista = (normas.data ?? []).filter((n) => verTodas || n.estatus === "por_analizar" || n.estatus === "en_implementacion");

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Da de alta la norma nueva (SAT, IMSS, STPS, NOM, contrato de un cliente…) y vuélvela tareas con responsable y fecha. El sistema propone cinco pasos: el
        primero, el lunes.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {opera && (
          <button className={boton} onClick={() => setNueva((v) => !v)}>
            {nueva ? "Cerrar" : "+ Nueva norma o cambio"}
          </button>
        )}
        <label className="flex items-center gap-1 text-sm text-slate-600">
          <input type="checkbox" checked={verTodas} onChange={(e) => setVerTodas(e.target.checked)} /> ver también cumplidas y que no aplican
        </label>
      </div>
      {nueva && <FormNorma alGuardar={(id) => { setNueva(false); setAbierta(id); }} />}
      {normas.isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {!normas.isLoading && !lista.length && <p className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">No hay cambios normativos pendientes.</p>}
      <ul className="space-y-2">
        {lista.map((n) => {
          const dias = diasParaVigor(n.fecha_vigor, hoy);
          return (
            <li key={n.id} className="rounded border border-slate-200 bg-white">
              <button className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => setAbierta(abierta === n.id ? null : n.id)}>
                <span>
                  <span className="font-medium text-slate-900">{n.titulo}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {ETIQUETA_AUTORIDAD[n.autoridad] ?? n.autoridad}
                    {n.responsable_nombre ? ` · ${n.responsable_nombre}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {n.fecha_vigor && (
                    <span className={dias != null && dias < 0 && n.estatus !== "cumplida" ? "text-red-700" : dias != null && dias <= 30 ? "text-amber-700" : "text-slate-500"}>
                      en vigor {fechaCorta(n.fecha_vigor)}
                      {dias != null && dias >= 0 && n.estatus !== "cumplida" ? ` (en ${dias} días)` : ""}
                    </span>
                  )}
                  <span className={`rounded px-2 py-0.5 ${CLASE_ESTATUS[n.estatus]}`}>{ETIQUETA_ESTATUS_NORMA[n.estatus]}</span>
                </span>
              </button>
              {abierta === n.id && <DetalleNorma norma={n} opera={opera} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FormNorma({ norma, alGuardar }: { norma?: Norma; alGuardar: (id: string) => void }) {
  const qc = useQueryClient();
  const personas = useDirectorio();
  const [f, setF] = useState({
    titulo: norma?.titulo ?? "",
    autoridad: norma?.autoridad ?? "sat",
    referencia: norma?.referencia ?? "",
    fecha_publicacion: norma?.fecha_publicacion ?? "",
    fecha_vigor: norma?.fecha_vigor ?? "",
    resumen: norma?.resumen ?? "",
    que_cambia: norma?.que_cambia ?? "",
    areas: norma?.areas ?? ([] as string[]),
    responsable_id: norma?.responsable_id ?? "",
  });
  const guardar = useMutation({
    mutationFn: async () => {
      if (!f.titulo.trim()) throw new Error("Escribe el nombre de la norma o el cambio.");
      const fila = {
        titulo: f.titulo.trim(),
        autoridad: f.autoridad,
        referencia: f.referencia.trim() || null,
        fecha_publicacion: f.fecha_publicacion || null,
        fecha_vigor: f.fecha_vigor || null,
        resumen: f.resumen.trim() || null,
        que_cambia: f.que_cambia.trim() || null,
        areas: f.areas,
        responsable_id: f.responsable_id || null,
      };
      const r = norma
        ? await supabase.from("cumplimiento_normas").update(fila).eq("id", norma.id).select("id").single()
        : await supabase.from("cumplimiento_normas").insert(fila).select("id").single();
      if (r.error) throw r.error;
      return r.data.id as string;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["cumplimiento-normas"] });
      alGuardar(id);
    },
  });
  const set = (c: Partial<typeof f>) => setF((x) => ({ ...x, ...c }));
  return (
    <form
      className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2"
      data-sin-borrador={norma ? "" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        guardar.mutate();
      }}
    >
      <label className="text-sm sm:col-span-2">
        Norma o cambio
        <input className={campo} value={f.titulo} placeholder="Ej. Reforma LFT jornada de 40 horas; NOM-035; nuevo CFDI 4.1" onChange={(e) => set({ titulo: e.target.value })} />
      </label>
      <label className="text-sm">
        Autoridad
        <select className={campo} value={f.autoridad} onChange={(e) => set({ autoridad: e.target.value })}>
          {Object.entries(ETIQUETA_AUTORIDAD).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Referencia (DOF, oficio, liga)
        <input className={campo} value={f.referencia} onChange={(e) => set({ referencia: e.target.value })} />
      </label>
      <label className="text-sm">
        Publicada el
        <input type="date" className={campo} value={f.fecha_publicacion} onChange={(e) => set({ fecha_publicacion: e.target.value })} />
      </label>
      <label className="text-sm">
        Entra en vigor el
        <input type="date" className={campo} value={f.fecha_vigor} onChange={(e) => set({ fecha_vigor: e.target.value })} />
      </label>
      <label className="text-sm sm:col-span-2">
        De qué trata (en una o dos frases)
        <textarea className={campo} rows={2} value={f.resumen} onChange={(e) => set({ resumen: e.target.value })} />
      </label>
      <label className="text-sm sm:col-span-2">
        Qué cambia para nosotros
        <textarea className={campo} rows={2} value={f.que_cambia} onChange={(e) => set({ que_cambia: e.target.value })} />
      </label>
      <div className="text-sm sm:col-span-2">
        Áreas afectadas
        <div className="mt-1 flex flex-wrap gap-2">
          {Object.entries(ETIQUETA_AREA).map(([k, v]) => (
            <label key={k} className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5">
              <input
                type="checkbox"
                checked={f.areas.includes(k)}
                onChange={(e) => set({ areas: e.target.checked ? [...f.areas, k] : f.areas.filter((a) => a !== k) })}
              />
              {v}
            </label>
          ))}
        </div>
      </div>
      <label className="text-sm">
        Responsable de implementarla
        <select className={campo} value={f.responsable_id} onChange={(e) => set({ responsable_id: e.target.value })}>
          <option value="">—</option>
          {(personas.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-2">
        <button className={boton} disabled={guardar.isPending}>
          {guardar.isPending ? "Guardando…" : "Guardar"}
        </button>
        {guardar.error && <span className="text-sm text-red-600">{(guardar.error as Error).message}</span>}
      </div>
    </form>
  );
}

function DetalleNorma({ norma, opera }: { norma: Norma; opera: boolean }) {
  const qc = useQueryClient();
  const [editar, setEditar] = useState(false);
  const [proponer, setProponer] = useState(false);
  const hoy = hoyMexico();
  const estatus = useMutation({
    mutationFn: async (e: EstatusNorma) => {
      const { error } = await supabase.from("cumplimiento_normas").update({ estatus: e }).eq("id", norma.id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cumplimiento-normas"] }),
  });
  if (editar) return <div className="border-t border-slate-100 p-3"><FormNorma norma={norma} alGuardar={() => setEditar(false)} /></div>;
  return (
    <div className="space-y-3 border-t border-slate-100 p-3 text-sm">
      {norma.resumen && <p>{norma.resumen}</p>}
      {norma.que_cambia && (
        <p>
          <b>Qué cambia para nosotros:</b> {norma.que_cambia}
        </p>
      )}
      <p className="text-xs text-slate-500">
        {norma.referencia ? `${norma.referencia} · ` : ""}
        {norma.fecha_publicacion ? `publicada ${fechaCorta(norma.fecha_publicacion)} · ` : ""}
        {norma.areas.length ? norma.areas.map((a) => ETIQUETA_AREA[a] ?? a).join(", ") : "sin áreas"}
      </p>
      {opera && (
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${campo} max-w-xs`} value={norma.estatus} onChange={(e) => estatus.mutate(e.target.value as EstatusNorma)}>
            {Object.entries(ETIQUETA_ESTATUS_NORMA).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className={botonSuave} onClick={() => setEditar(true)}>
            Editar
          </button>
        </div>
      )}
      <div>
        <h4 className="mb-1 font-medium text-slate-800">Tareas</h4>
        <AccionesRegistradas normaId={norma.id} />
      </div>
      {opera &&
        (proponer ? (
          <NuevasTareas
            inicial={accionesSugeridas(norma, hoy).map((a) => ({ texto: a.texto, fecha: a.fecha, responsable_id: norma.responsable_id }))}
            origen={{ norma_id: norma.id }}
            prefijo="Norma"
            descripcion={`Cambio normativo: ${norma.titulo}${norma.fecha_vigor ? ` (en vigor ${fechaCorta(norma.fecha_vigor)})` : ""}. ${norma.que_cambia ?? ""}`.trim()}
            alTerminar={() => {
              setProponer(false);
              if (norma.estatus === "por_analizar") estatus.mutate("en_implementacion");
            }}
          />
        ) : (
          <button className={boton} onClick={() => setProponer(true)}>
            Volverla tareas
          </button>
        ))}
    </div>
  );
}
