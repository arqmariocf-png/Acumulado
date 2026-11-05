import { test } from "node:test";
import assert from "node:assert/strict";
import { DECISIONES_PENDIENTES, PLAN_IMPLEMENTACION, htmlPresentacionRh } from "./presentacionRh.ts";
import { indicadoresDe } from "./historicoRh.ts";
import type { ReporteRh } from "./reporteRhDirector.ts";
import type { PersonaTiempos, ReporteTiempos } from "./reporteRhTiempos.ts";

function director(): ReporteRh {
  return {
    desde: "2026-10-06", hasta: "2026-11-04", dias: 30, habiles: 26,
    plantilla: {
      activos: 52, con_cuenta: 38, checan: 29, antiguedad_meses: 20,
      altas: [{ nombre: "Pedro Pérez López", puesto: "Ayudante", fecha: "2026-10-20", empresa: "CSC" }],
      bajas: [{ nombre: "Ana Ruiz Gómez", puesto: "Auxiliar", fecha: "2026-10-07", cuenta_activa: true }],
      bajas_con_cuenta: [{ nombre: "Ana Ruiz Gómez", fecha: "2026-10-07" }],
      por_empresa: [{ empresa: "CSC", n: 7 }, { empresa: "Sin empresa", n: 38 }],
      por_area: [{ area: "operativo", n: 30 }, { area: "administrativo", n: 22 }],
      por_puesto: [], sin_cuenta: [{ nombre: "Juan Sin Cuenta", puesto: null }], expedientes_incompletos: [{ nombre: "Delia Farfán", faltan: "INE, CURP" }], sin_jefe: 22,
      rotacion: [{ mes: "2026-09-01", altas: 3, bajas: 1, plantilla_fin: 50, rotacion_pct: 2 }, { mes: "2026-10-01", altas: 9, bajas: 2, plantilla_fin: 52, rotacion_pct: 4.1 }],
    },
    asistencia: { personas: 38, dias_con_entrada: 517, retardos: 306, pct_asistencia: 81, pct_puntualidad: 41, no_checan: [{ nombre: "Erik Cervantes", puesto: null }], mas_faltas: [{ nombre: "Erik Cervantes Díaz", puesto: null, dias: 0, faltas: 26, retardos: 0 }], mas_retardos: [{ nombre: "Belén Vergara", puesto: null, dias: 20, retardos: 18 }] },
    tareas: { tableros: 89, abiertas: 44, vencidas: 16, periodo: { total: 76, hechas: 57, a_tiempo: 33, vencidas: 16, pct_cumplimiento: 75, pct_a_tiempo: 58, cambios_fecha: 9 }, por_area: [{ area: "operacion", total: 41, hechas: 25, vencidas: 11 }, { area: "rh", total: 24, hechas: 21, vencidas: 1 }], por_persona: [{ nombre: "Belén Vergara", total: 8, hechas: 4, a_tiempo: 2, vencidas: 3 }, { nombre: "Raúl Molina", total: 10, hechas: 9, a_tiempo: 8, vencidas: 0 }] },
    evaluaciones: { firmadas_12m: 0, borradores: 0, promedio: null, por_nivel: [], sin_evaluacion_6m: 38, ultimas: [] },
    nomina: {
      semanal: [{ empresa: "CSC", semana: "44", fin: "2026-10-31", personas: 18, total: 28895.23 }, { empresa: "VBB", semana: "44", fin: "2026-10-31", personas: 3, total: 0 }],
      quincenal: [{ empresa: "CSC", fin: "2026-10-31", personas: 16, total: 59250 }],
      mano_obra: [{ empresa: "ERG", fin: "2026-10-24", personas: 27, total: 118332.85 }],
      semanal_tendencia: [{ fin: "2026-09-12", total: 63909.84, personas: 51 }, { fin: "2026-10-24", total: 69696.63, personas: 40 }, { fin: "2026-10-31", total: 71685.61, personas: 41 }],
      sin_empresa: [],
    },
    epp: { entregadas: 3, vencidas: 0, por_vencer_30: 0, por_surtir: 0, perdidas_por_descontar: 0, solicitudes_pendientes: 1, vencidas_lista: [] },
    herramienta: { asignadas: 0, regreso_vencido: 0, extraviadas: 0, reparacion: 0, vencidas_lista: [] },
    financiamiento: { cuentas: 0, con_linea: 0, linea_total: 0, con_sueldo: 0, saldo_vigente: 0, cargos_vigentes: 0, con_atraso: 0, por_firmar: 0 },
    accesos: { activas: 49, con_push: 24, sin_push: [{ nombre: "Juan Sin Push", rol: "operativo" }], pendientes: [], por_rol: [{ rol: "operativo", n: 18 }] },
  };
}

function persona(p: Partial<PersonaTiempos> & { nombre: string }): PersonaTiempos {
  return {
    personal_id: "a", profile_id: "b", puesto: null, area: null, empresa: null, jornada: "base", hora_entrada: "08:00", tolerancia: 15, horas_semana: 48, dias_semana: 6,
    habiles: 26, dias_con_entrada: 20, faltas: 6, retardos: 3, retardo_min_total: 40, entrada_prom: "08:10", salida_prom: "17:30", minutos_total: 9000, dias_completos: 18, minutos_esperados: 8640,
    dias_sin_salida: 2, dias_con_comida: 10, comida_prom_min: 60, manuales: 0, offline: 0, anuladas: 0, ubicacion: null, ...p,
  };
}

function tiempos(): ReporteTiempos {
  return {
    desde: "2026-10-06", hasta: "2026-11-04",
    resumen: { personas: 38, checan: 29, dias_con_entrada: 518, faltas: 236, retardos: 307, minutos_total: 200053, dias_sin_salida: 84, manuales: 2, offline: 0, anuladas: 0 },
    personas: [persona({ nombre: "Belén Vergara Soto" }), persona({ nombre: "Jonathan Sánchez Olivera", comida_prom_min: 180, dias_sin_salida: 5 }), persona({ nombre: "Erik Cervantes Díaz", dias_con_entrada: 0, minutos_total: 0, dias_completos: 0, entrada_prom: null })],
    detalle: [],
    por_dia: [{ fecha: "2026-10-23", entradas: 27, retardos: 9, minutos: 9000 }, { fecha: "2026-10-24", entradas: 12, retardos: 3, minutos: 3000 }, { fecha: "2026-10-25", entradas: 1, retardos: 0, minutos: 100 }],
  };
}

test("presentación: 11 láminas con los datos del periodo, sin texto fijo de otro periodo", () => {
  const html = htmlPresentacionRh(director(), tiempos(), { organizacion: "Grupo Loma", hoy: "2026-11-05" });
  assert.equal((html.match(/<section class="slide/g) ?? []).length, 11);
  assert.match(html, /06\/10 – 04\/11\/2026/);
  assert.match(html, /generado el 05\/11\/2026/);
  assert.match(html, /26 días hábiles/);
  // Datos, no texto pegado: la baja con cuenta activa, el día con más gente, la comida larga y la empresa en $0.
  assert.match(html, /Ana Ruiz Gómez/);
  assert.match(html, /el vie 23\/10: 27 entradas/);
  assert.match(html, /Los sábados vienen de 12 a 12 personas/);
  assert.match(html, /Jonathan Sánchez registra comidas de 3 h/);
  assert.match(html, /VBB aparece con personas y \$0/);
  assert.match(html, /De \$ 63,910 \(12\/09\) a \$ 71,686 \(31\/10\): \+12 % en 3 semanas/);
  assert.match(html, /operacion concentra 41 de 76 tareas y 11 de las 16 vencidas/);
  assert.match(html, /38 personas no tienen empresa registrada/);
  assert.doesNotMatch(html, /29\/10\/2026|12-oct/);
  assert.ok(DECISIONES_PENDIENTES.length >= 5 && PLAN_IMPLEMENTACION.some((x) => /hecho/i.test(x.cuando)));
});

test("con histórico guardado aparece la lámina de evolución", () => {
  const previo = { desde: "2026-09-30", hasta: "2026-10-29", dias: 30, generado_en: "2026-10-29T12:00:00Z", indicadores: { ...indicadoresDe(director(), tiempos()), pct_asistencia: 70, tareas_vencidas: 20 } };
  const html = htmlPresentacionRh(director(), tiempos(), { organizacion: "Grupo Loma", hoy: "2026-11-05", historico: [previo] });
  assert.equal((html.match(/<section class="slide/g) ?? []).length, 12);
  assert.match(html, /Evolución contra los reportes anteriores/);
  assert.match(html, /29\/10\/26/);
  assert.match(html, /\+11 pts/);
  assert.match(html, /Tareas vencidas: 16 \(−4 contra el reporte anterior, mejora\)/);
});

test("presentación sin reporte de tiempos: 10 láminas y sin la de horas", () => {
  const html = htmlPresentacionRh(director(), null, { organizacion: "Grupo Loma", hoy: "2026-11-05" });
  assert.equal((html.match(/<section class="slide/g) ?? []).length, 10);
  assert.doesNotMatch(html, /Tiempos: horas activas/);
  assert.match(html, /Sin el reporte de tiempos no hay detalle por día/);
});
