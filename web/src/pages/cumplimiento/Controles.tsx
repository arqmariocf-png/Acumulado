import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import {
  CLASE_SEMAFORO,
  ETIQUETA_AREA,
  ETIQUETA_RESULTADO,
  SEMAFORO_RESULTADO,
  estadoFlujo,
  etiquetaPeriodo,
  periodoDe,
  type Frecuencia,
  type ResultadoPrueba,
} from "../../lib/cumplimientoNormativo";
import { FormIncidencia } from "./Incidencias";
import { useControles, usePruebas, type Control, type Prueba } from "./datos";
import { boton, botonSuave, campo, fechaCorta, hoyMexico, operaCumplimiento, useDirectorio, veCumplimiento } from "./comun";





export function ChipResultado({ resultado }: { resultado: ResultadoPrueba | null }) {
  if (!resultado) return <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Sin revisar</span>;
  return <span className={`rounded px-2 py-0.5 text-xs ${CLASE_SEMAFORO[SEMAFORO_RESULTADO[resultado]]}`}>{ETIQUETA_RESULTADO[resultado]}</span>;
}

/** Paso 2: revisar controles. Los automáticos se prueban contra los datos del
 * sistema en segundos; los manuales se registran con evidencia. */
export function Controles() {
  const { perfil, soloConsulta } = useAuth();
  const opera = operaCumplimiento(perfil) && !soloConsulta;
  const controles = useControles();
  const pruebas = usePruebas();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [area, setArea] = useState("");
  const [inactivos, setInactivos] = useState(false);
  const hoy = hoyMexico();
  const lista = (controles.data ?? []).filter((c) => (c.activo || inactivos) && (!area || c.area === area));

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Cada control responde una pregunta («¿todo pago lleva su comprobante?»). Los marcados <b>automático</b> se prueban solos contra lo que ya está en Acumulado y
        dicen exactamente qué casos fallan; el día 1 de cada mes corren solos para el periodo que cerró.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${campo} max-w-xs`} value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">Todas las áreas</option>
          {Object.entries(ETIQUETA_AREA).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-600">
          <input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} /> ver desactivados
        </label>
        {opera && (
          <button className={botonSuave} onClick={() => setNuevo((v) => !v)}>
            {nuevo ? "Cerrar" : "+ Control manual"}
          </button>
        )}
      </div>
      {nuevo && <FormControl alGuardar={() => setNuevo(false)} />}
      {controles.isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      <ul className="space-y-2">
        {lista.map((c) => {
          const flujo = estadoFlujo(c, pruebas.data ?? [], hoy);
          const actual = (pruebas.data ?? []).find((p) => p.control_id === c.id && p.periodo === flujo.periodo) ?? null;
          return (
            <li key={c.id} className="rounded border border-slate-200 bg-white">
              <button className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => setAbierto(abierto === c.id ? null : c.id)}>
                <span>
                  <span className="mr-2 font-mono text-xs text-slate-500">{c.clave}</span>
                  <span className={`font-medium ${c.activo ? "text-slate-900" : "text-slate-400 line-through"}`}>{c.nombre}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {ETIQUETA_AREA[c.area] ?? c.area} · {c.frecuencia} · {c.prueba ? "automático" : "manual"}
                    {c.responsable_nombre ? ` · ${c.responsable_nombre}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  {actual?.excepciones ? `${actual.excepciones} de ${actual.poblacion ?? "?"}` : ""}
                  <ChipResultado resultado={actual?.resultado ?? null} />
                </span>
              </button>
              {abierto === c.id && <DetalleControl control={c} pruebas={(pruebas.data ?? []).filter((p) => p.control_id === c.id)} opera={opera} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DetalleControl({ control, pruebas, opera }: { control: Control; pruebas: Prueba[]; opera: boolean }) {
  const { perfil, soloConsulta } = useAuth();
  const qc = useQueryClient();
  const [verId, setVerId] = useState<string | null>(pruebas[0]?.id ?? null);
  const [manual, setManual] = useState(false);
  const [editar, setEditar] = useState(false);
  const [incidencia, setIncidencia] = useState<Prueba | null>(null);
  const probar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("fn_cumplimiento_probar", { p_control: control.id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["cumplimiento-pruebas"] });
      setVerId(id);
    },
  });
  const ver = pruebas.find((p) => p.id === verId) ?? null;

  return (
    <div className="space-y-3 border-t border-slate-100 p-3 text-sm">
      {control.objetivo && (
        <p>
          <b>Para qué:</b> {control.objetivo}
        </p>
      )}
      {control.como_se_prueba && (
        <p>
          <b>Cómo se prueba:</b> {control.como_se_prueba}
          {control.prueba && <span className="text-slate-500"> Tolerancia: {control.tolerancia_pct}% de los casos.</span>}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {control.prueba && veCumplimiento(perfil) && !soloConsulta && (
          <button className={boton} disabled={probar.isPending} onClick={() => probar.mutate()}>
            {probar.isPending ? "Probando…" : "Probar ahora"}
          </button>
        )}
        {opera && (
          <button className={botonSuave} onClick={() => setManual((v) => !v)}>
            Registrar revisión
          </button>
        )}
        {opera && (
          <button className={botonSuave} onClick={() => setEditar((v) => !v)}>
            Responsable y frecuencia
          </button>
        )}
      </div>
      {probar.error && <p className="text-red-600">{(probar.error as Error).message}</p>}
      {editar && <FormControl control={control} alGuardar={() => setEditar(false)} />}
      {manual && <FormRevision control={control} alGuardar={() => setManual(false)} />}

      {pruebas.length > 0 && (
        <div>
          <h4 className="mb-1 font-medium text-slate-800">Historial</h4>
          <div className="flex flex-wrap gap-1">
            {pruebas.slice(0, 12).map((p) => (
              <button
                key={p.id}
                onClick={() => setVerId(p.id)}
                className={`rounded border px-2 py-0.5 text-xs ${p.id === verId ? "border-slate-900" : "border-slate-200"} ${CLASE_SEMAFORO[SEMAFORO_RESULTADO[p.resultado]]}`}
              >
                {etiquetaPeriodo(p.periodo)} · {fechaCorta(p.created_at)}
              </button>
            ))}
          </div>
        </div>
      )}
      {ver && (
        <div className="rounded border border-slate-200 p-2">
          <p className="mb-1">
            <ChipResultado resultado={ver.resultado} />{" "}
            <span className="text-slate-600">
              {etiquetaPeriodo(ver.periodo)} ({fechaCorta(ver.desde)} a {fechaCorta(ver.hasta)}) ·{" "}
              {ver.poblacion != null ? `${ver.excepciones ?? 0} excepciones de ${ver.poblacion} casos · ` : ""}
              {ver.automatica ? "automática" : "manual"}
              {ver.probado_por_nombre ? ` · ${ver.probado_por_nombre}` : ""}
            </span>
          </p>
          {ver.comentario && <p className="text-slate-700">{ver.comentario}</p>}
          {ver.evidencia && <p className="text-xs text-slate-500">Evidencia: {ver.evidencia}</p>}
          {ver.detalle.length > 0 && (
            <table className="mt-1 w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-2">Empresa</th>
                  <th className="py-1 pr-2">Caso</th>
                  <th className="py-1">Qué falla</th>
                </tr>
              </thead>
              <tbody>
                {ver.detalle.map((d, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1 pr-2">{d.empresa ?? "—"}</td>
                    <td className="py-1 pr-2">{d.ref}</td>
                    <td className="py-1">{d.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {ver.detalle.length >= 50 && <p className="text-xs text-slate-500">Se muestran los primeros 50.</p>}
          {ver.resultado !== "cumple" && veCumplimiento(perfil) && !soloConsulta && (
            <button className={`${botonSuave} mt-2`} onClick={() => setIncidencia(incidencia ? null : ver)}>
              {incidencia ? "Cerrar" : "Registrar incidencia"}
            </button>
          )}
        </div>
      )}
      {incidencia && (
        <FormIncidencia
          inicial={{
            titulo: `${control.nombre}: ${incidencia.excepciones ?? ""} excepciones`.trim(),
            area: control.area,
            que_paso: `La revisión de ${etiquetaPeriodo(incidencia.periodo)} encontró ${incidencia.excepciones ?? 0} caso(s) de ${incidencia.poblacion ?? "?"}: ${incidencia.detalle
              .slice(0, 5)
              .map((d) => `${d.ref} (${d.detalle})`)
              .join("; ")}${incidencia.detalle.length > 5 ? "…" : ""}`,
            control_id: control.id,
            prueba_id: incidencia.id,
          }}
          alGuardar={() => setIncidencia(null)}
        />
      )}
    </div>
  );
}

function FormRevision({ control, alGuardar }: { control: Control; alGuardar: () => void }) {
  const qc = useQueryClient();
  const hoy = hoyMexico();
  const [periodo, setPeriodo] = useState(periodoDe(hoy, control.frecuencia));
  const [resultado, setResultado] = useState<ResultadoPrueba>("cumple");
  const [poblacion, setPoblacion] = useState("");
  const [excepciones, setExcepciones] = useState("");
  const [comentario, setComentario] = useState("");
  const [evidencia, setEvidencia] = useState("");
  const guardar = useMutation({
    mutationFn: async () => {
      const { data: rango, error: e1 } = await supabase.rpc("fn_cumplimiento_rango", { p_periodo: periodo });
      if (e1) throw new Error("Periodo no válido: usa 2026-10 o 2026-T4.");
      const r = (Array.isArray(rango) ? rango[0] : rango) as { desde: string; hasta: string };
      if (resultado !== "cumple" && !comentario.trim()) throw new Error("Explica qué se encontró.");
      const { error } = await supabase.from("cumplimiento_pruebas").insert({
        control_id: control.id,
        periodo,
        desde: r.desde,
        hasta: r.hasta,
        resultado,
        poblacion: poblacion ? Number(poblacion) : null,
        excepciones: excepciones ? Number(excepciones) : null,
        comentario: comentario.trim() || null,
        evidencia: evidencia.trim() || null,
        automatica: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cumplimiento-pruebas"] });
      alGuardar();
    },
  });
  return (
    <form
      className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        guardar.mutate();
      }}
    >
      <label className="text-sm">
        Periodo
        <input className={campo} value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
      </label>
      <label className="text-sm">
        Resultado
        <select className={campo} value={resultado} onChange={(e) => setResultado(e.target.value as ResultadoPrueba)}>
          {Object.entries(ETIQUETA_RESULTADO).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          Casos revisados
          <input type="number" min={0} className={campo} value={poblacion} onChange={(e) => setPoblacion(e.target.value)} />
        </label>
        <label className="text-sm">
          Con falla
          <input type="number" min={0} className={campo} value={excepciones} onChange={(e) => setExcepciones(e.target.value)} />
        </label>
      </div>
      <label className="text-sm sm:col-span-3">
        Qué se revisó y qué se encontró
        <textarea className={campo} rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} />
      </label>
      <label className="text-sm sm:col-span-2">
        Evidencia (dónde está: carpeta, folio, liga)
        <input className={campo} value={evidencia} onChange={(e) => setEvidencia(e.target.value)} />
      </label>
      <div className="flex items-end gap-2">
        <button className={boton} disabled={guardar.isPending}>
          Guardar revisión
        </button>
      </div>
      {guardar.error && <p className="text-sm text-red-600 sm:col-span-3">{(guardar.error as Error).message}</p>}
    </form>
  );
}

function FormControl({ control, alGuardar }: { control?: Control; alGuardar: () => void }) {
  const qc = useQueryClient();
  const personas = useDirectorio();
  const [f, setF] = useState({
    clave: control?.clave ?? "",
    nombre: control?.nombre ?? "",
    objetivo: control?.objetivo ?? "",
    como_se_prueba: control?.como_se_prueba ?? "",
    area: control?.area ?? "otro",
    frecuencia: control?.frecuencia ?? ("mensual" as Frecuencia),
    tolerancia_pct: String(control?.tolerancia_pct ?? 5),
    responsable_id: control?.responsable_id ?? "",
    activo: control?.activo ?? true,
  });
  const set = (c: Partial<typeof f>) => setF((x) => ({ ...x, ...c }));
  const guardar = useMutation({
    mutationFn: async () => {
      if (!f.clave.trim() || !f.nombre.trim()) throw new Error("Pon clave y nombre al control.");
      const fila = {
        clave: f.clave.trim().toUpperCase(),
        nombre: f.nombre.trim(),
        objetivo: f.objetivo.trim() || null,
        como_se_prueba: f.como_se_prueba.trim() || null,
        area: f.area,
        frecuencia: f.frecuencia,
        tolerancia_pct: Number(f.tolerancia_pct) || 0,
        responsable_id: f.responsable_id || null,
        activo: f.activo,
      };
      const { error } = control
        ? await supabase.from("cumplimiento_controles").update(fila).eq("id", control.id)
        : await supabase.from("cumplimiento_controles").insert(fila);
      if (error) throw error.code === "23505" ? new Error("Ya existe un control con esa clave.") : error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cumplimiento-controles"] });
      alGuardar();
    },
  });
  return (
    <form
      className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4"
      data-sin-borrador={control ? "" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        guardar.mutate();
      }}
    >
      <label className="text-sm">
        Clave
        <input className={campo} value={f.clave} disabled={!!control} placeholder="ej. OBR-01" onChange={(e) => set({ clave: e.target.value })} />
      </label>
      <label className="text-sm sm:col-span-3">
        Control (en forma de regla)
        <input className={campo} value={f.nombre} disabled={!!control?.prueba} placeholder="ej. Toda obra arranca con contrato firmado" onChange={(e) => set({ nombre: e.target.value })} />
      </label>
      {!control?.prueba && (
        <>
          <label className="text-sm sm:col-span-2">
            Para qué
            <input className={campo} value={f.objetivo} onChange={(e) => set({ objetivo: e.target.value })} />
          </label>
          <label className="text-sm sm:col-span-2">
            Cómo se prueba
            <input className={campo} value={f.como_se_prueba} onChange={(e) => set({ como_se_prueba: e.target.value })} />
          </label>
          <label className="text-sm">
            Área
            <select className={campo} value={f.area} onChange={(e) => set({ area: e.target.value })}>
              {Object.entries(ETIQUETA_AREA).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="text-sm">
        Frecuencia
        <select className={campo} value={f.frecuencia} onChange={(e) => set({ frecuencia: e.target.value as Frecuencia })}>
          <option value="mensual">Mensual</option>
          <option value="trimestral">Trimestral</option>
        </select>
      </label>
      {control?.prueba && (
        <label className="text-sm">
          Tolerancia (% de casos)
          <input type="number" min={0} max={100} className={campo} value={f.tolerancia_pct} onChange={(e) => set({ tolerancia_pct: e.target.value })} />
        </label>
      )}
      <label className="text-sm">
        Responsable
        <select className={campo} value={f.responsable_id} onChange={(e) => set({ responsable_id: e.target.value })}>
          <option value="">—</option>
          {(personas.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </label>
      {control && (
        <label className="flex items-end gap-1 pb-2 text-sm">
          <input type="checkbox" checked={f.activo} onChange={(e) => set({ activo: e.target.checked })} /> activo
        </label>
      )}
      <div className="flex items-end gap-2">
        <button className={boton} disabled={guardar.isPending}>
          Guardar
        </button>
      </div>
      {guardar.error && <p className="text-sm text-red-600 sm:col-span-4">{(guardar.error as Error).message}</p>}
    </form>
  );
}
