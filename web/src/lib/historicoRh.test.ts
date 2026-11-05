import { test } from "node:test";
import assert from "node:assert/strict";
import { cambiosDestacados, formatoValor, indicadoresDe, renglonesEvolucion, serieEvolucion, textoDelta, tiemposParaGuardar, type HistoricoRh, type IndicadoresRh } from "./historicoRh.ts";
import type { ReporteRh } from "./reporteRhDirector.ts";
import type { ReporteTiempos } from "./reporteRhTiempos.ts";

function director(): ReporteRh {
  return {
    desde: "2026-10-06", hasta: "2026-11-04", dias: 30, habiles: 26,
    plantilla: { activos: 52, con_cuenta: 38, checan: 29, antiguedad_meses: 20, altas: [{ nombre: "A", puesto: null, fecha: "2026-10-20", empresa: null }], bajas: [], bajas_con_cuenta: [{ nombre: "B", fecha: null }], por_empresa: [], por_area: [], por_puesto: [], sin_cuenta: [{ nombre: "C", puesto: null }], expedientes_incompletos: [], sin_jefe: 22, rotacion: [] },
    asistencia: { personas: 38, dias_con_entrada: 517, retardos: 306, pct_asistencia: 81, pct_puntualidad: 41, no_checan: [{ nombre: "E", puesto: null }], mas_faltas: [], mas_retardos: [] },
    tareas: { tableros: 89, abiertas: 44, vencidas: 16, periodo: { total: 76, hechas: 57, a_tiempo: 33, vencidas: 16, pct_cumplimiento: 75, pct_a_tiempo: 58, cambios_fecha: 9 }, por_area: [], por_persona: [] },
    evaluaciones: { firmadas_12m: 0, borradores: 0, promedio: null, por_nivel: [], sin_evaluacion_6m: 38, ultimas: [] },
    nomina: { semanal: [{ empresa: "CSC", semana: "44", fin: "2026-10-31", personas: 18, total: 28895.23 }], quincenal: [{ empresa: "CSC", fin: "2026-10-31", personas: 16, total: 59250 }], mano_obra: [{ empresa: "ERG", fin: "2026-10-24", personas: 27, total: 118332.85 }], semanal_tendencia: [], sin_empresa: [] },
    epp: { entregadas: 3, vencidas: 0, por_vencer_30: 0, por_surtir: 0, perdidas_por_descontar: 0, solicitudes_pendientes: 1, vencidas_lista: [] },
    herramienta: { asignadas: 0, regreso_vencido: 0, extraviadas: 0, reparacion: 0, vencidas_lista: [] },
    financiamiento: { cuentas: 0, con_linea: 0, linea_total: 0, con_sueldo: 0, saldo_vigente: 0, cargos_vigentes: 0, con_atraso: 0, por_firmar: 0 },
    accesos: { activas: 49, con_push: 24, sin_push: [], pendientes: [], por_rol: [] },
  };
}
const tiempos: ReporteTiempos = { desde: "2026-10-06", hasta: "2026-11-04", resumen: { personas: 38, checan: 29, dias_con_entrada: 518, faltas: 236, retardos: 307, minutos_total: 200053, dias_sin_salida: 84, manuales: 2, offline: 0, anuladas: 0 }, personas: [], detalle: [{ profile_id: "x", fecha: "2026-10-06", entrada: null, comida_inicio: null, comida_fin: null, salida: null, minutos: null, comida_min: null, retardo_min: 0, manuales: 0, offline: 0, anuladas: 0 }], por_dia: [] };

test("indicadores de un reporte y tiempos sin detalle", () => {
  const i = indicadoresDe(director(), tiempos);
  assert.equal(i.activos, 52);
  assert.equal(i.bajas_con_cuenta, 1);
  assert.equal(i.nomina_fiscal, 88145.23);
  assert.equal(i.horas_activas, 3334.2);
  assert.equal(i.dias_sin_salida, 84);
  assert.equal(indicadoresDe(director(), null).horas_activas, null);
  const t = tiemposParaGuardar(tiempos);
  assert.ok(t && !("detalle" in t) && t.resumen.checan === 29);
});

function foto(hasta: string, cambios: Partial<IndicadoresRh>, generado_en = `${hasta}T12:00:00Z`): HistoricoRh {
  return { desde: "2026-10-01", hasta, dias: 30, generado_en, indicadores: { ...indicadoresDe(director(), tiempos), ...cambios } };
}

test("serie de evolución: por fecha de corte, el último del mismo corte gana, máximo N, el actual al final", () => {
  const h = [foto("2026-10-29", { pct_asistencia: 70 }), foto("2026-10-29", { pct_asistencia: 72 }, "2026-10-29T18:00:00Z"), foto("2026-10-15", { pct_asistencia: 60 })];
  const serie = serieEvolucion(h, foto("2026-11-04", { pct_asistencia: 81 }));
  assert.deepEqual(serie.map((s) => [s.hasta, s.indicadores.pct_asistencia]), [["2026-10-15", 60], ["2026-10-29", 72], ["2026-11-04", 81]]);
  assert.equal(serieEvolucion([foto("2026-09-01", {}), foto("2026-09-08", {}), foto("2026-09-15", {})], null, 2).length, 2);
});

test("renglones con delta, tendencia y cambios destacados", () => {
  const serie = serieEvolucion([foto("2026-10-29", { pct_asistencia: 70, tareas_vencidas: 20, nomina_fiscal: 90000, con_push: 24 })], foto("2026-11-04", { pct_asistencia: 81, tareas_vencidas: 16, nomina_fiscal: 88145.23, con_push: 24 }));
  const r = renglonesEvolucion(serie);
  const asis = r.find((x) => x.clave === "pct_asistencia")!;
  assert.equal(asis.delta, 11);
  assert.equal(asis.tendencia, "sube_bien");
  assert.equal(textoDelta(asis), "+11 pts");
  const venc = r.find((x) => x.clave === "tareas_vencidas")!;
  assert.equal(venc.tendencia, "baja_bien");
  assert.equal(textoDelta(venc), "−4");
  const push = r.find((x) => x.clave === "con_push")!;
  assert.equal(push.tendencia, "igual");
  assert.equal(textoDelta(push), "=");
  assert.equal(formatoValor(88145.23, "money"), "$ 88,145");
  assert.equal(formatoValor(null, "n"), "—");
  const cambios = cambiosDestacados(r, 3);
  assert.equal(cambios.length, 3);
  assert.match(cambios[0], /Tareas vencidas: 16 \(−4 contra el reporte anterior, mejora\)/);
  // Un solo reporte: sin deltas
  assert.ok(renglonesEvolucion(serieEvolucion([], foto("2026-11-04", {}))).every((x) => x.delta === null && x.tendencia === "sin_dato"));
});
