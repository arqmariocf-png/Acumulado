import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { BarrasPorcentaje, COLOR, GraficaApilada, GraficaLinea } from "./graficas";

// Pestañas 6, 7 y 8 del módulo de RH (solo RH directivo o admin). Cada una
// llama una función SQL que devuelve el jsonb ya agregado
// (20260926130000_rh_kpis_directivo.sql); aquí solo se pinta.

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function etiquetaDia(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MESES[Number(m) - 1]}`;
}
function etiquetaMes(iso: string): string {
  const [a, m] = iso.split("-");
  return `${MESES[Number(m) - 1]} ${a.slice(2)}`;
}

function Tarjeta({ etiqueta, valor, detalle, tono }: { etiqueta: string; valor: string; detalle?: string; tono?: "bueno" | "advertencia" | "critico" }) {
  const color = tono === "bueno" ? COLOR.bueno : tono === "advertencia" ? COLOR.advertencia : tono === "critico" ? COLOR.critico : COLOR.texto;
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="text-xs uppercase text-slate-500">{etiqueta}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color }}>
        {valor}
      </div>
      {detalle && <div className="text-xs text-slate-500">{detalle}</div>}
    </div>
  );
}

function tonoPct(pct: number | null): "bueno" | "advertencia" | "critico" | undefined {
  if (pct === null) return undefined;
  return pct >= 90 ? "bueno" : pct >= 75 ? "advertencia" : "critico";
}

function Estado({ cargando, error }: { cargando: boolean; error: unknown }) {
  if (cargando) return <p className="text-sm text-slate-500">Calculando…</p>;
  if (error) return <p className="text-sm text-red-600">No se pudo calcular: {error instanceof Error ? error.message : String(error)}</p>;
  return null;
}

// ── 6. Checador ───────────────────────────────────────────────────────────

interface KpiChecadorDatos {
  desde: string;
  hasta: string;
  plantilla: number;
  resumen: { asistencias: number; retardos: number; pct_puntualidad: number | null };
  por_dia: { d: string; a_tiempo: number; retardos: number }[];
  por_persona: { nombre: string; asistencias: number; retardos: number }[];
}

export function KpiChecador() {
  const [dias, setDias] = useState(30);
  const q = useQuery({
    queryKey: ["rh", "kpi_checador", dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_rh_kpi_checador", { p_dias: dias });
      if (error) throw error;
      return data as unknown as KpiChecadorDatos;
    },
  });
  const d = q.data;
  const sinMarcar = d ? d.por_persona.filter((p) => p.asistencias === 0).length : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Asistencias y retardos del personal activo con cuenta. Retardo: la primera entrada del día llega después de la hora de entrada más la tolerancia de su perfil de jornada.</p>
        <div className="flex gap-1">
          {[7, 14, 30, 60].map((n) => (
            <button key={n} onClick={() => setDias(n)} className={`rounded border px-2 py-1 text-xs ${dias === n ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
              {n} días
            </button>
          ))}
        </div>
      </div>
      <Estado cargando={q.isPending} error={q.error} />
      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tarjeta etiqueta="Puntualidad" valor={d.resumen.pct_puntualidad === null ? "—" : `${d.resumen.pct_puntualidad}%`} detalle={`${d.resumen.asistencias} entradas del ${etiquetaDia(d.desde)} al ${etiquetaDia(d.hasta)}`} tono={tonoPct(d.resumen.pct_puntualidad)} />
            <Tarjeta etiqueta="Retardos" valor={String(d.resumen.retardos)} detalle="entradas fuera de tolerancia" tono={d.resumen.retardos === 0 ? "bueno" : d.resumen.retardos <= 3 ? "advertencia" : "critico"} />
            <Tarjeta etiqueta="Plantilla con checador" valor={String(d.plantilla)} detalle="personal activo con cuenta" />
            <Tarjeta etiqueta="Sin registrar" valor={String(sinMarcar)} detalle="personas sin ninguna entrada en el periodo" tono={sinMarcar === 0 ? "bueno" : "advertencia"} />
          </div>
          <GraficaApilada
            titulo="Entradas por día"
            barras={d.por_dia.map((p) => ({
              etiqueta: etiquetaDia(p.d),
              segmentos: [
                { clave: "a_tiempo", etiqueta: "A tiempo", valor: p.a_tiempo, color: COLOR.serie1 },
                { clave: "retardos", etiqueta: "Retardos", valor: p.retardos, color: COLOR.serie2 },
              ],
            }))}
          />
          <div className="rounded border border-slate-200 bg-white p-3">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Por persona</h4>
            {d.por_persona.length === 0 ? (
              <p className="text-xs text-slate-400">Nadie del personal activo tiene cuenta todavía.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-left uppercase text-slate-500">
                  <tr>
                    <th className="py-1">Persona</th>
                    <th className="py-1 text-right">Asistencias</th>
                    <th className="py-1 text-right">Retardos</th>
                    <th className="py-1 text-right">Puntualidad</th>
                  </tr>
                </thead>
                <tbody>
                  {d.por_persona.map((p) => {
                    const pct = p.asistencias === 0 ? null : Math.round((100 * (p.asistencias - p.retardos)) / p.asistencias);
                    return (
                      <tr key={p.nombre} className="border-t border-slate-100">
                        <td className="py-1">{p.nombre}</td>
                        <td className="py-1 text-right tabular-nums">{p.asistencias}</td>
                        <td className="py-1 text-right tabular-nums" style={{ color: p.retardos > 0 ? COLOR.critico : COLOR.texto }}>
                          {p.retardos}
                        </td>
                        <td className="py-1 text-right tabular-nums">{pct === null ? "—" : `${pct}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── 7. Vacantes y rotación ────────────────────────────────────────────────

interface KpiVacantesDatos {
  rotacion: { mes: string; altas: number; bajas: number; plantilla_inicio: number; plantilla_fin: number; rotacion_pct: number | null }[];
  vacantes_por_estatus: { estatus: string; n: number }[];
  abiertas_por_area: { area: string; n: number; dias_promedio: number | null }[];
  abiertas: { n: number; dias_promedio: number | null };
  cubiertas: { n: number; dias_promedio_cobertura: number | null };
  plantilla_activa: number;
}

export function KpiVacantes() {
  const q = useQuery({
    queryKey: ["rh", "kpi_vacantes"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_rh_kpi_vacantes");
      if (error) throw error;
      return data as unknown as KpiVacantesDatos;
    },
  });
  const d = q.data;
  const ultimo = d?.rotacion[d.rotacion.length - 1];
  const bajas12 = d ? d.rotacion.reduce((s, r) => s + r.bajas, 0) : 0;
  const altas12 = d ? d.rotacion.reduce((s, r) => s + r.altas, 0) : 0;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Altas y bajas por mes con la rotación (bajas entre plantilla promedio), y el estado de las vacantes abiertas.</p>
      <Estado cargando={q.isPending} error={q.error} />
      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tarjeta etiqueta="Plantilla activa" valor={String(d.plantilla_activa)} detalle={`${altas12} altas · ${bajas12} bajas en 12 meses`} />
            <Tarjeta etiqueta="Rotación del mes" valor={ultimo?.rotacion_pct == null ? "—" : `${ultimo.rotacion_pct}%`} detalle={ultimo ? etiquetaMes(ultimo.mes) : undefined} tono={ultimo?.rotacion_pct == null ? undefined : ultimo.rotacion_pct <= 3 ? "bueno" : ultimo.rotacion_pct <= 8 ? "advertencia" : "critico"} />
            <Tarjeta etiqueta="Vacantes abiertas" valor={String(d.abiertas.n)} detalle={d.abiertas.dias_promedio == null ? "sin vacantes abiertas" : `${d.abiertas.dias_promedio} días abiertas en promedio`} tono={d.abiertas.n === 0 ? undefined : (d.abiertas.dias_promedio ?? 0) > 30 ? "critico" : "advertencia"} />
            <Tarjeta etiqueta="Tiempo de cobertura" valor={d.cubiertas.dias_promedio_cobertura == null ? "—" : `${d.cubiertas.dias_promedio_cobertura} días`} detalle={`${d.cubiertas.n} vacantes cubiertas`} />
          </div>
          <GraficaApilada
            titulo="Altas y bajas por mes"
            barras={d.rotacion.map((r) => ({
              etiqueta: etiquetaMes(r.mes),
              segmentos: [
                { clave: "altas", etiqueta: "Altas", valor: r.altas, color: COLOR.serie1 },
                { clave: "bajas", etiqueta: "Bajas", valor: r.bajas, color: COLOR.serie2 },
              ],
            }))}
          />
          <GraficaLinea titulo="Rotación mensual" sufijo="%" puntos={d.rotacion.map((r) => ({ etiqueta: etiquetaMes(r.mes), valor: r.rotacion_pct }))} />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-slate-200 bg-white p-3">
              <h4 className="mb-2 text-sm font-semibold text-slate-700">Vacantes abiertas por área</h4>
              {d.abiertas_por_area.length === 0 ? (
                <p className="text-xs text-slate-400">No hay vacantes abiertas.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left uppercase text-slate-500">
                    <tr>
                      <th className="py-1">Área</th>
                      <th className="py-1 text-right">Vacantes</th>
                      <th className="py-1 text-right">Días abiertas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.abiertas_por_area.map((a) => (
                      <tr key={a.area} className="border-t border-slate-100">
                        <td className="py-1">{a.area}</td>
                        <td className="py-1 text-right tabular-nums">{a.n}</td>
                        <td className="py-1 text-right tabular-nums">{a.dias_promedio ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="rounded border border-slate-200 bg-white p-3">
              <h4 className="mb-2 text-sm font-semibold text-slate-700">Vacantes por estatus</h4>
              {d.vacantes_por_estatus.length === 0 ? (
                <p className="text-xs text-slate-400">Todavía no se ha registrado ninguna vacante (pestaña "Vacantes y rotación").</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {d.vacantes_por_estatus.map((v) => (
                    <li key={v.estatus} className="flex justify-between border-t border-slate-100 py-1">
                      <span className="capitalize">{v.estatus}</span>
                      <span className="tabular-nums">{v.n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── 8. Cumplimiento de actividades ────────────────────────────────────────

interface KpiActividadesDatos {
  resumen: { total: number; hechas: number; a_tiempo: number; vencidas: number; pendientes: number; pct_cumplimiento?: number | null; pct_a_tiempo?: number | null };
  por_semana: { semana: string; total: number; hechas: number; a_tiempo: number; vencidas: number }[];
  por_persona: { nombre: string; total: number; hechas: number; a_tiempo: number; vencidas: number }[];
}

export function KpiActividades() {
  const q = useQuery({
    queryKey: ["rh", "kpi_actividades"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_rh_kpi_actividades");
      if (error) throw error;
      return data as unknown as KpiActividadesDatos;
    },
  });
  const d = q.data;
  const pct = d?.resumen.pct_cumplimiento ?? null;
  const pctTiempo = d?.resumen.pct_a_tiempo ?? null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Actividades del tablero "RH · Actividades": hechas, a tiempo (cerradas antes de su fecha límite) y vencidas (sin cerrar y con la fecha pasada).</p>
      <Estado cargando={q.isPending} error={q.error} />
      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tarjeta etiqueta="Cumplimiento" valor={pct === null ? "—" : `${pct}%`} detalle={`${d.resumen.hechas} de ${d.resumen.total} actividades hechas`} tono={tonoPct(pct)} />
            <Tarjeta etiqueta="A tiempo" valor={pctTiempo === null ? "—" : `${pctTiempo}%`} detalle={`${d.resumen.a_tiempo} hechas antes de su límite`} tono={tonoPct(pctTiempo)} />
            <Tarjeta etiqueta="Vencidas" valor={String(d.resumen.vencidas)} detalle="sin cerrar y con fecha pasada" tono={d.resumen.vencidas === 0 ? "bueno" : d.resumen.vencidas <= 2 ? "advertencia" : "critico"} />
            <Tarjeta etiqueta="Pendientes" valor={String(d.resumen.pendientes)} detalle="en curso, dentro de plazo" />
          </div>
          <GraficaApilada
            titulo="Actividades por semana (por fecha límite)"
            barras={d.por_semana.map((s) => ({
              etiqueta: etiquetaDia(s.semana),
              segmentos: [
                { clave: "a_tiempo", etiqueta: "A tiempo", valor: s.a_tiempo, color: COLOR.serie1 },
                { clave: "tarde", etiqueta: "Hechas tarde", valor: s.hechas - s.a_tiempo, color: COLOR.serie2 },
                { clave: "vencidas", etiqueta: "Vencidas", valor: s.vencidas, color: COLOR.critico },
                { clave: "pendientes", etiqueta: "Pendientes", valor: s.total - s.hechas - s.vencidas, color: COLOR.neutro },
              ],
            }))}
          />
          <BarrasPorcentaje
            titulo="Cumplimiento por persona"
            filas={d.por_persona.map((p) => ({
              etiqueta: p.nombre,
              pct: p.total === 0 ? 0 : Math.round((100 * p.hechas) / p.total),
              detalle: `${p.hechas} de ${p.total} hechas · ${p.a_tiempo} a tiempo · ${p.vencidas} vencidas`,
            }))}
          />
        </>
      )}
    </div>
  );
}
