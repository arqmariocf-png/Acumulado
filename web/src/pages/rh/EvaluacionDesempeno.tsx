import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { abrirParaImprimir, abrirVentanaImpresion, cerrarVentanaImpresion } from "../../lib/imprimir";
import { logoDeEmpresa } from "../../lib/logoEmpresaCargar";
import {
  CRITERIOS,
  ESCALA,
  ETIQUETA_NIVEL,
  calificar,
  criteriosCompletos,
  htmlEvaluacion,
  periodoSugerido,
  type DatosEvaluacion,
} from "../../lib/evaluacionDesempeno";

// Evaluación de desempeño (23-oct-2026, Mario: "un formato de evaluación de
// desempeño del personal dentro de la aplicación con las tareas cumplidas").
// RH, dirección, admin y el jefe directo eligen persona y periodo; el sistema
// trae las tareas (hechas, a tiempo, vencidas), los cambios de fecha y los
// días con entrada; el evaluador califica 6 criterios de 1 a 5 y escribe
// fortalezas, mejoras y acuerdos. Se guarda como borrador o firmada (ya no se
// edita) y se imprime con firmas. La persona ve las suyas firmadas en Mi perfil.

interface Persona {
  personal_id: string;
  profile_id: string;
  nombre: string;
  puesto: string | null;
  empresa: string | null;
  area: string | null;
  jefe: string | null;
  fecha_ingreso: string | null;
}

interface Evaluacion {
  id: string;
  profile_id: string;
  personal_id: string | null;
  nombre: string;
  puesto: string | null;
  periodo_desde: string;
  periodo_hasta: string;
  datos: DatosEvaluacion;
  criterios: Record<string, number>;
  fortalezas: string | null;
  mejoras: string | null;
  acuerdos: string | null;
  calificacion: number | null;
  nivel: string | null;
  estatus: "borrador" | "firmada";
  firmada_en: string | null;
  evaluador_nombre: string | null;
  created_at: string;
}

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "text-xs text-slate-600";
const tarjeta = "rounded-xl border border-slate-200 bg-white";
const btnPrimario = "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50";
const btnSecundario = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 disabled:opacity-50";

function hoyIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}
function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}
const COLOR_NIVEL: Record<string, string> = { sobresaliente: "bg-emerald-50 text-emerald-700", bueno: "bg-sky-50 text-sky-700", regular: "bg-amber-50 text-amber-800", bajo: "bg-red-50 text-red-700", sin_datos: "bg-slate-100 text-slate-600" };

export function EvaluacionDesempeno() {
  const { perfil, soloConsulta } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const hoy = hoyIso();
  const [profileId, setProfileId] = useState(params.get("persona") ?? "");
  const [periodo, setPeriodo] = useState(() => periodoSugerido(hoy, "trimestre"));
  const [criterios, setCriterios] = useState<Record<string, number>>({});
  const [fortalezas, setFortalezas] = useState("");
  const [mejoras, setMejoras] = useState("");
  const [acuerdos, setAcuerdos] = useState("");
  const [editando, setEditando] = useState<Evaluacion | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const personas = useQuery({
    queryKey: ["evaluacion-personas"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_evaluacion_personas");
      if (error) throw error;
      return (data ?? []) as Persona[];
    },
  });
  const persona = personas.data?.find((p) => p.profile_id === profileId) ?? null;
  const datos = useQuery({
    queryKey: ["evaluacion-datos", profileId, periodo.desde, periodo.hasta],
    enabled: !!profileId && !!periodo.desde && !!periodo.hasta && periodo.hasta >= periodo.desde && !editando,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_evaluacion_datos", { p_profile: profileId, p_desde: periodo.desde, p_hasta: periodo.hasta });
      if (error) throw error;
      return data as DatosEvaluacion;
    },
  });
  const historial = useQuery({
    queryKey: ["evaluaciones", profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase.from("evaluaciones_desempeno").select("*").eq("profile_id", profileId).order("periodo_hasta", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Evaluacion[];
    },
  });
  useEffect(() => {
    const p = new URLSearchParams(params);
    if (profileId) p.set("persona", profileId);
    else p.delete("persona");
    setParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const d = editando ? editando.datos : datos.data;
  const calif = useMemo(() => (d ? calificar(d.resumen, criterios) : null), [d, criterios]);
  const puedeEditar = !soloConsulta && !!perfil && (!editando || editando.estatus === "borrador");

  function limpiar() {
    setEditando(null);
    setCriterios({});
    setFortalezas("");
    setMejoras("");
    setAcuerdos("");
    setErr(null);
  }
  function abrirGuardada(e: Evaluacion) {
    setEditando(e);
    setPeriodo({ desde: e.periodo_desde, hasta: e.periodo_hasta });
    setCriterios(e.criterios ?? {});
    setFortalezas(e.fortalezas ?? "");
    setMejoras(e.mejoras ?? "");
    setAcuerdos(e.acuerdos ?? "");
    setErr(null);
    setOk(null);
  }

  const guardar = useMutation({
    mutationFn: async (firmar: boolean) => {
      if (!persona || !d) throw new Error("Elige a la persona y carga sus datos.");
      if (firmar && !criteriosCompletos(criterios)) throw new Error("Para firmar califica los 6 criterios.");
      const c = calificar(d.resumen, criterios);
      const fila = {
        profile_id: persona.profile_id,
        personal_id: persona.personal_id,
        nombre: persona.nombre,
        puesto: persona.puesto,
        periodo_desde: periodo.desde,
        periodo_hasta: periodo.hasta,
        datos: d,
        criterios,
        fortalezas: fortalezas.trim() || null,
        mejoras: mejoras.trim() || null,
        acuerdos: acuerdos.trim() || null,
        calificacion: c.calificacion,
        nivel: c.nivel,
        estatus: firmar ? "firmada" : "borrador",
      };
      if (editando) {
        const { data, error } = await supabase.from("evaluaciones_desempeno").update(fila).eq("id", editando.id).select("*").single();
        if (error) throw error;
        return data as Evaluacion;
      }
      const { data, error } = await supabase.from("evaluaciones_desempeno").insert(fila).select("*").single();
      if (error) throw error;
      return data as Evaluacion;
    },
    onSuccess: (e) => {
      setEditando(e);
      setErr(null);
      setOk(e.estatus === "firmada" ? "Evaluación firmada. Ya no se edita; imprímela para las firmas." : "Borrador guardado.");
      qc.invalidateQueries({ queryKey: ["evaluaciones", profileId] });
    },
    onError: (e) => { setOk(null); setErr((e as Error).message); },
  });

  async function imprimir() {
    if (!persona || !d) return;
    const ventana = abrirVentanaImpresion();
    try {
      const html = htmlEvaluacion(
        {
          nombre: persona.nombre, puesto: persona.puesto, empresa: persona.empresa, area: persona.area, jefe: persona.jefe, fecha_ingreso: persona.fecha_ingreso,
          periodo_desde: periodo.desde, periodo_hasta: periodo.hasta, evaluador: editando?.evaluador_nombre ?? perfil?.nombre ?? null, fecha: hoy,
          datos: d, criterios, fortalezas, mejoras, acuerdos, firmada: editando?.estatus === "firmada",
        },
        await logoDeEmpresa(persona.empresa ?? ""),
      );
      if (!abrirParaImprimir(html, ventana)) setErr("El navegador bloqueó la ventana. Permite ventanas emergentes.");
    } catch (e) {
      cerrarVentanaImpresion(ventana);
      setErr((e as Error).message);
    }
  }

  const r = d?.resumen;
  return (
    <div className="mx-auto max-w-6xl px-4 py-5">
      <p className="text-xs text-slate-500">Recursos humanos / Evaluación de desempeño</p>
      <h1 className="text-2xl font-bold text-slate-900">Evaluación de desempeño</h1>
      <p className="mb-4 text-sm text-slate-600">Lo que el sistema sabe de cada persona en el periodo (tareas hechas, a tiempo y vencidas, cambios de fecha, asistencia) más la calificación de quien evalúa. Calificación = 40 % tareas + 60 % criterios.</p>

      <section className={`${tarjeta} mb-4 p-4`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={`${etiqueta} lg:col-span-2`}>
            Persona
            <select value={profileId} onChange={(e) => { setProfileId(e.target.value); limpiar(); }} className={campo}>
              <option value="">Elige…</option>
              {(personas.data ?? []).map((p) => (
                <option key={p.profile_id} value={p.profile_id}>{p.nombre}{p.puesto ? ` · ${p.puesto}` : ""}{p.empresa ? ` · ${p.empresa}` : ""}</option>
              ))}
            </select>
          </label>
          <label className={etiqueta}>Del<input type="date" value={periodo.desde} disabled={!!editando} onChange={(e) => setPeriodo((p) => ({ ...p, desde: e.target.value }))} className={campo} /></label>
          <label className={etiqueta}>Al<input type="date" value={periodo.hasta} disabled={!!editando} onChange={(e) => setPeriodo((p) => ({ ...p, hasta: e.target.value }))} className={campo} /></label>
        </div>
        {!editando && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {(["mes", "trimestre", "semestre"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setPeriodo(periodoSugerido(hoy, t))} className="rounded-full border border-slate-300 px-2.5 py-0.5 text-slate-700 hover:bg-slate-100">
                {t === "mes" ? "Mes anterior" : t === "trimestre" ? "Últimos 3 meses" : "Últimos 6 meses"}
              </button>
            ))}
          </div>
        )}
        {persona && (
          <p className="mt-2 text-xs text-slate-600">
            {[persona.puesto, persona.empresa, persona.area, persona.jefe ? `jefe directo: ${persona.jefe}` : null, persona.fecha_ingreso ? `ingreso ${fechaCorta(persona.fecha_ingreso)}` : null].filter(Boolean).join(" · ")}
            {editando && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 font-semibold">{editando.estatus === "firmada" ? `Firmada el ${fechaCorta(editando.firmada_en)}` : "Borrador guardado"} · <button type="button" onClick={limpiar} className="underline">nueva evaluación</button></span>}
          </p>
        )}
        {personas.data && personas.data.length === 0 && <p className="mt-2 text-sm text-slate-500">No hay personal activo con cuenta que puedas evaluar. RH evalúa a toda la organización; un jefe directo, a su gente (RH › Accesos › Supervisor).</p>}
      </section>

      {datos.error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{(datos.error as Error).message}</p>}
      {profileId && datos.isLoading && !editando && <p className="text-sm text-slate-500">Cargando lo que hizo en el periodo…</p>}

      {d && r && (
        <div className="space-y-4">
          <section className={`${tarjeta} p-4`}>
            <h2 className="text-lg font-semibold text-slate-900">Cumplimiento de tareas <span className="text-xs font-normal text-slate-500">(del sistema)</span></h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi t="Asignadas" v={String(r.total)} n={`${r.como_responsable} como responsable`} />
              <Kpi t="Hechas" v={String(r.hechas)} n={r.total ? `${Math.round((100 * r.hechas) / r.total)}%` : "—"} />
              <Kpi t="A tiempo" v={String(r.a_tiempo)} n={r.hechas ? `${Math.round((100 * r.a_tiempo) / r.hechas)}% de las hechas` : "—"} />
              <Kpi t="Vencidas" v={String(r.vencidas)} n={`${r.pendientes} pendientes`} rojo={r.vencidas > 0} />
              <Kpi t="Cambios de fecha" v={String(r.cambios_fecha)} n="pedidos en sus tareas" />
              <Kpi t="Días con entrada" v={String(r.dias_con_entrada)} n={`de ${r.dias_habiles} hábiles`} />
            </div>
            <div className="mt-3 max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500"><tr><th className="px-2 py-1">Tarea</th><th className="px-2 py-1">Tablero</th><th className="px-2 py-1">Fecha límite</th><th className="px-2 py-1">Terminada</th><th className="px-2 py-1">Resultado</th></tr></thead>
                <tbody>
                  {d.tareas.map((t) => (
                    <tr key={t.id} className="border-t border-slate-100">
                      <td className="px-2 py-1"><Link to={`/tareas/${t.tablero_id}?tarjeta=${t.id}`} className="text-sky-700 hover:underline">{t.titulo}</Link>{!t.responsable && <span className="ml-1 text-[10px] text-slate-400">corresponsable</span>}</td>
                      <td className="px-2 py-1 text-slate-600">{t.tablero}</td>
                      <td className="px-2 py-1">{fechaCorta(t.fecha_limite)}</td>
                      <td className="px-2 py-1">{t.hecha ? fechaCorta(t.hecha_en) : "—"}</td>
                      <td className="px-2 py-1">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.hecha ? (t.a_tiempo ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800") : t.vencida ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                          {t.hecha ? (t.a_tiempo ? "A tiempo" : "Tarde") : t.vencida ? "Vencida" : "Pendiente"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {d.tareas.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-slate-500">Sin tareas asignadas en el periodo.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`${tarjeta} p-4`}>
            <h2 className="text-lg font-semibold text-slate-900">Criterios del evaluador <span className="text-xs font-normal text-slate-500">1 deficiente · 3 cumple · 5 sobresaliente</span></h2>
            <div className="mt-2 divide-y divide-slate-100">
              {CRITERIOS.map((c) => (
                <div key={c.clave} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">{c.etiqueta}</div>
                    <div className="text-xs text-slate-500">{c.descripcion}</div>
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" disabled={!puedeEditar} title={ESCALA[n]} onClick={() => setCriterios((cr) => ({ ...cr, [c.clave]: n }))} className={`h-9 w-9 rounded-full border text-sm font-semibold ${criterios[c.clave] === n ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"} disabled:opacity-60`}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <label className={etiqueta}>Fortalezas<textarea value={fortalezas} disabled={!puedeEditar} onChange={(e) => setFortalezas(e.target.value)} rows={4} className={campo} /></label>
              <label className={etiqueta}>Áreas de mejora<textarea value={mejoras} disabled={!puedeEditar} onChange={(e) => setMejoras(e.target.value)} rows={4} className={campo} /></label>
              <label className={etiqueta}>Acuerdos y compromisos<textarea value={acuerdos} disabled={!puedeEditar} onChange={(e) => setAcuerdos(e.target.value)} rows={4} className={campo} /></label>
            </div>
          </section>

          <section className={`${tarjeta} flex flex-wrap items-center justify-between gap-3 p-4`}>
            <div>
              <div className="text-xs text-slate-500">Calificación</div>
              <div className="text-3xl font-bold text-slate-900">{calif?.calificacion ?? "—"}<span className="text-base font-normal text-slate-500"> / 100</span></div>
              <div className="text-xs text-slate-500">tareas {calif?.tareas ?? "—"} × 40 % + criterios {calif?.criterios ?? "—"} × 60 %</div>
            </div>
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${COLOR_NIVEL[calif?.nivel ?? "sin_datos"]}`}>{ETIQUETA_NIVEL[calif?.nivel ?? "sin_datos"]}</span>
            <div className="flex flex-wrap gap-2">
              {puedeEditar && <button type="button" onClick={() => guardar.mutate(false)} disabled={guardar.isPending} className={btnSecundario}>Guardar borrador</button>}
              {puedeEditar && <button type="button" onClick={() => guardar.mutate(true)} disabled={guardar.isPending} className={btnPrimario}>Guardar y firmar</button>}
              <button type="button" onClick={imprimir} className={btnSecundario}>Imprimir / PDF</button>
            </div>
            {err && <p className="w-full text-sm text-red-700">{err}</p>}
            {ok && <p className="w-full text-sm text-emerald-700">{ok}</p>}
          </section>
        </div>
      )}

      {profileId && (historial.data?.length ?? 0) > 0 && (
        <section className={`${tarjeta} mt-4 p-4`}>
          <h2 className="text-lg font-semibold text-slate-900">Evaluaciones anteriores</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="px-2 py-1">Periodo</th><th className="px-2 py-1 text-right">Calificación</th><th className="px-2 py-1">Nivel</th><th className="px-2 py-1">Estatus</th><th className="px-2 py-1">Evaluó</th><th className="px-2 py-1" /></tr></thead>
            <tbody>
              {historial.data!.map((e) => (
                <tr key={e.id} className={`border-t border-slate-100 ${editando?.id === e.id ? "bg-slate-50" : ""}`}>
                  <td className="px-2 py-1.5">{fechaCorta(e.periodo_desde)} – {fechaCorta(e.periodo_hasta)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{e.calificacion ?? "—"}</td>
                  <td className="px-2 py-1.5"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${COLOR_NIVEL[e.nivel ?? "sin_datos"]}`}>{ETIQUETA_NIVEL[(e.nivel ?? "sin_datos") as keyof typeof ETIQUETA_NIVEL]}</span></td>
                  <td className="px-2 py-1.5">{e.estatus === "firmada" ? `Firmada ${fechaCorta(e.firmada_en)}` : "Borrador"}</td>
                  <td className="px-2 py-1.5">{e.evaluador_nombre ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right"><button type="button" onClick={() => abrirGuardada(e)} className="text-xs text-sky-700 underline">{e.estatus === "firmada" ? "ver / imprimir" : "seguir editando"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Kpi({ t, v, n, rojo = false }: { t: string; v: string; n: string; rojo?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2">
      <div className="text-[11px] text-slate-500">{t}</div>
      <div className={`text-xl font-bold ${rojo ? "text-red-700" : "text-slate-900"}`}>{v}</div>
      <div className="text-[11px] text-slate-500">{n}</div>
    </div>
  );
}
