// Histórico de la presentación de RH (5-nov-2026, Mario: "guarda el
// histórico de la presentación de RH para que se vea la evolución conforme
// pasa el tiempo"). De cada reporte generado se guardan los indicadores
// clave; con varios guardados se arma la lámina "Evolución" (tabla de
// indicadores por fecha con barras y la diferencia contra el anterior).
// Puro, sin DOM: se prueba en node.

import { totalesNomina, type ReporteRh } from "./reporteRhDirector.ts";
import type { ReporteTiempos } from "./reporteRhTiempos.ts";

export interface IndicadoresRh {
  activos: number;
  con_cuenta: number;
  checan: number;
  altas: number;
  bajas: number;
  bajas_con_cuenta: number;
  sin_cuenta: number;
  expedientes_incompletos: number;
  sin_jefe: number;
  pct_asistencia: number | null;
  pct_puntualidad: number | null;
  retardos: number;
  no_checan: number;
  dias_sin_salida: number | null;
  horas_activas: number | null;
  tareas_total: number;
  tareas_hechas: number;
  pct_cumplimiento: number | null;
  pct_a_tiempo: number | null;
  tareas_vencidas: number;
  evaluaciones_firmadas: number;
  sin_evaluacion: number;
  nomina_fiscal: number;
  nomina_semanal: number;
  nomina_quincenal: number;
  mano_obra: number;
  epp_vencidas: number;
  epp_solicitudes: number;
  cuentas_nomina: number;
  accesos_activas: number;
  con_push: number;
}

export interface HistoricoRh {
  id?: string;
  desde: string;
  hasta: string;
  dias: number;
  indicadores: IndicadoresRh;
  generado_en?: string;
  generado_por_nombre?: string | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Los indicadores que se guardan de cada reporte. */
export function indicadoresDe(d: ReporteRh, t: ReporteTiempos | null): IndicadoresRh {
  const n = totalesNomina(d.nomina);
  return {
    activos: d.plantilla.activos,
    con_cuenta: d.plantilla.con_cuenta,
    checan: d.plantilla.checan,
    altas: d.plantilla.altas.length,
    bajas: d.plantilla.bajas.length,
    bajas_con_cuenta: d.plantilla.bajas_con_cuenta.length,
    sin_cuenta: d.plantilla.sin_cuenta.length,
    expedientes_incompletos: d.plantilla.expedientes_incompletos.length,
    sin_jefe: d.plantilla.sin_jefe,
    pct_asistencia: d.asistencia.pct_asistencia,
    pct_puntualidad: d.asistencia.pct_puntualidad,
    retardos: d.asistencia.retardos,
    no_checan: d.asistencia.no_checan.length,
    dias_sin_salida: t ? t.resumen.dias_sin_salida : null,
    horas_activas: t ? r1(t.resumen.minutos_total / 60) : null,
    tareas_total: d.tareas.periodo.total,
    tareas_hechas: d.tareas.periodo.hechas,
    pct_cumplimiento: d.tareas.periodo.pct_cumplimiento,
    pct_a_tiempo: d.tareas.periodo.pct_a_tiempo,
    tareas_vencidas: d.tareas.vencidas,
    evaluaciones_firmadas: d.evaluaciones.firmadas_12m,
    sin_evaluacion: d.evaluaciones.sin_evaluacion_6m,
    nomina_fiscal: n.fiscal,
    nomina_semanal: n.semanal,
    nomina_quincenal: n.quincenal,
    mano_obra: n.manoObra,
    epp_vencidas: d.epp.vencidas,
    epp_solicitudes: d.epp.solicitudes_pendientes,
    cuentas_nomina: d.financiamiento.cuentas,
    accesos_activas: d.accesos.activas,
    con_push: d.accesos.con_push,
  };
}

/** `tiempos` sin el detalle por persona y día (pesa demasiado y no se usa en la presentación). */
export function tiemposParaGuardar(t: ReporteTiempos | null): Omit<ReporteTiempos, "detalle"> | null {
  if (!t) return null;
  const { detalle: _detalle, ...resto } = t;
  void _detalle;
  return resto;
}

export type Tendencia = "sube_bien" | "sube_mal" | "baja_bien" | "baja_mal" | "igual" | "sin_dato";

export interface RenglonEvolucion {
  clave: keyof IndicadoresRh;
  etiqueta: string;
  /** "n" conteo, "pct" porcentaje, "money" pesos, "h" horas. */
  formato: "n" | "pct" | "money" | "h";
  /** Si subir es bueno (asistencia) o malo (vencidas). */
  masEsMejor: boolean;
  valores: (number | null)[];
  /** Diferencia del último contra el anterior (null si no hay con qué comparar). */
  delta: number | null;
  tendencia: Tendencia;
}

export const RENGLONES_EVOLUCION: { clave: keyof IndicadoresRh; etiqueta: string; formato: RenglonEvolucion["formato"]; masEsMejor: boolean }[] = [
  { clave: "activos", etiqueta: "Plantilla activa", formato: "n", masEsMejor: true },
  { clave: "con_cuenta", etiqueta: "Con cuenta en el sistema", formato: "n", masEsMejor: true },
  { clave: "checan", etiqueta: "Personas que checan", formato: "n", masEsMejor: true },
  { clave: "sin_cuenta", etiqueta: "Activos sin cuenta", formato: "n", masEsMejor: false },
  { clave: "bajas_con_cuenta", etiqueta: "Bajas con cuenta activa", formato: "n", masEsMejor: false },
  { clave: "pct_asistencia", etiqueta: "Asistencia", formato: "pct", masEsMejor: true },
  { clave: "pct_puntualidad", etiqueta: "Puntualidad", formato: "pct", masEsMejor: true },
  { clave: "no_checan", etiqueta: "Con cuenta y sin entradas", formato: "n", masEsMejor: false },
  { clave: "dias_sin_salida", etiqueta: "Días sin salida", formato: "n", masEsMejor: false },
  { clave: "horas_activas", etiqueta: "Horas activas registradas", formato: "h", masEsMejor: true },
  { clave: "pct_cumplimiento", etiqueta: "Tareas hechas", formato: "pct", masEsMejor: true },
  { clave: "pct_a_tiempo", etiqueta: "Tareas a tiempo", formato: "pct", masEsMejor: true },
  { clave: "tareas_vencidas", etiqueta: "Tareas vencidas", formato: "n", masEsMejor: false },
  { clave: "evaluaciones_firmadas", etiqueta: "Evaluaciones firmadas (12 m)", formato: "n", masEsMejor: true },
  { clave: "nomina_fiscal", etiqueta: "Nómina fiscal (última)", formato: "money", masEsMejor: false },
  { clave: "mano_obra", etiqueta: "Mano de obra (última semana)", formato: "money", masEsMejor: false },
  { clave: "con_push", etiqueta: "Cuentas con notificaciones", formato: "n", masEsMejor: true },
];

/** Los últimos `maximo` reportes guardados (del más viejo al más reciente,
 * uno por fecha de corte) con el actual al final si no está guardado aún. */
export function serieEvolucion(historico: HistoricoRh[], actual: HistoricoRh | null, maximo = 6): HistoricoRh[] {
  const porFecha = new Map<string, HistoricoRh>();
  for (const h of [...historico].sort((a, b) => (a.generado_en ?? "").localeCompare(b.generado_en ?? ""))) porFecha.set(`${h.dias}:${h.hasta}`, h);
  if (actual) porFecha.set(`${actual.dias}:${actual.hasta}`, actual);
  return [...porFecha.values()].sort((a, b) => a.hasta.localeCompare(b.hasta) || (a.generado_en ?? "").localeCompare(b.generado_en ?? "")).slice(-maximo);
}

export function renglonesEvolucion(serie: HistoricoRh[]): RenglonEvolucion[] {
  return RENGLONES_EVOLUCION.map((r) => {
    const valores = serie.map((h) => (h.indicadores[r.clave] == null ? null : Number(h.indicadores[r.clave])));
    const ultimo = valores[valores.length - 1] ?? null;
    const previos = valores.slice(0, -1).filter((v): v is number => v != null);
    const anterior = previos.length ? previos[previos.length - 1] : null;
    const delta = ultimo != null && anterior != null ? Math.round((ultimo - anterior) * 100) / 100 : null;
    let tendencia: Tendencia = "sin_dato";
    if (delta != null) {
      if (Math.abs(delta) < 0.005) tendencia = "igual";
      else if (delta > 0) tendencia = r.masEsMejor ? "sube_bien" : "sube_mal";
      else tendencia = r.masEsMejor ? "baja_mal" : "baja_bien";
    }
    return { ...r, valores, delta, tendencia };
  });
}

export function formatoValor(v: number | null, formato: RenglonEvolucion["formato"]): string {
  if (v == null) return "—";
  if (formato === "pct") return `${Math.round(v)} %`;
  if (formato === "money") return `$ ${Math.round(v).toLocaleString("es-MX")}`;
  if (formato === "h") return `${Math.round(v).toLocaleString("es-MX")} h`;
  return Math.round(v).toLocaleString("es-MX");
}

export function textoDelta(r: RenglonEvolucion): string {
  if (r.delta == null) return "";
  if (r.tendencia === "igual") return "=";
  const signo = r.delta > 0 ? "+" : "−";
  const abs = Math.abs(r.delta);
  const v = r.formato === "pct" ? `${Math.round(abs)} pts` : r.formato === "money" ? `$ ${Math.round(abs).toLocaleString("es-MX")}` : r.formato === "h" ? `${Math.round(abs)} h` : `${Math.round(abs)}`;
  return `${signo}${v}`;
}

/** Resumen en frases de lo que más cambió contra el reporte anterior (hasta 5). */
export function cambiosDestacados(renglones: RenglonEvolucion[], maximo = 5): string[] {
  const con = renglones.filter((r) => r.delta != null && r.tendencia !== "igual");
  const peso = (r: RenglonEvolucion) => {
    const prev = r.valores.slice(0, -1).filter((v): v is number => v != null);
    const base = prev.length ? Math.abs(prev[prev.length - 1]) : 0;
    return r.formato === "pct" ? Math.abs(r.delta ?? 0) / 100 : base > 0 ? Math.abs(r.delta ?? 0) / base : 1;
  };
  return con
    .sort((a, b) => peso(b) - peso(a))
    .slice(0, maximo)
    .map((r) => `${r.etiqueta}: ${formatoValor(r.valores[r.valores.length - 1] ?? null, r.formato)} (${textoDelta(r)} contra el reporte anterior${r.tendencia.endsWith("bien") ? ", mejora" : ", empeora"})`);
}
