import { test } from "node:test";
import assert from "node:assert/strict";
import { alertasReporte, htmlReporteRh, resumenEjecutivo, semaforoConteo, semaforoPct, totalesNomina, variacionSemanal, type ReporteRh } from "./reporteRhDirector.ts";

function base(): ReporteRh {
  return {
    desde: "2026-09-30",
    hasta: "2026-10-29",
    dias: 30,
    habiles: 22,
    plantilla: {
      activos: 52, con_cuenta: 38, checan: 29, antiguedad_meses: 20.2,
      altas: [{ nombre: "Nuevo", puesto: "Ayudante", fecha: "2026-10-20", empresa: "CSC" }],
      bajas: [], bajas_con_cuenta: [], por_empresa: [{ empresa: "CSC", n: 7 }], por_area: [], por_puesto: [],
      sin_cuenta: [], expedientes_incompletos: [], sin_jefe: 3,
      rotacion: [{ mes: "2026-10-01", altas: 9, bajas: 2, plantilla_fin: 52, rotacion_pct: 4.1 }],
    },
    asistencia: { personas: 38, dias_con_entrada: 517, retardos: 306, pct_asistencia: 81, pct_puntualidad: 41, no_checan: [], mas_faltas: [], mas_retardos: [] },
    tareas: { tableros: 89, abiertas: 44, vencidas: 0, periodo: { total: 76, hechas: 57, a_tiempo: 33, vencidas: 16, pct_cumplimiento: 75, pct_a_tiempo: 58, cambios_fecha: 9 }, por_area: [], por_persona: [] },
    evaluaciones: { firmadas_12m: 0, borradores: 0, promedio: null, por_nivel: [], sin_evaluacion_6m: 0, ultimas: [] },
    nomina: {
      semanal: [{ empresa: "CSC", semana: "44", fin: "2026-10-31", personas: 18, total: 28895.23 }, { empresa: "ERG", semana: "44", fin: "2026-10-31", personas: 13, total: 23040.73 }],
      quincenal: [{ empresa: "CSC", fin: "2026-10-31", personas: 16, total: 59250 }],
      mano_obra: [{ empresa: "ERG", fin: "2026-10-24", personas: 27, total: 118332.85 }],
      semanal_tendencia: [{ fin: "2026-10-24", total: 69696.63, personas: 40 }, { fin: "2026-10-31", total: 71685.61, personas: 41 }],
      sin_empresa: [],
    },
    epp: { entregadas: 3, vencidas: 0, por_vencer_30: 0, por_surtir: 0, perdidas_por_descontar: 0, solicitudes_pendientes: 0, vencidas_lista: [] },
    herramienta: { asignadas: 0, regreso_vencido: 0, extraviadas: 0, reparacion: 0, vencidas_lista: [] },
    financiamiento: { cuentas: 0, con_linea: 0, linea_total: 0, con_sueldo: 0, saldo_vigente: 0, cargos_vigentes: 0, con_atraso: 0, por_firmar: 0 },
    accesos: { activas: 49, con_push: 40, sin_push: [], pendientes: [], por_rol: [{ rol: "operativo", n: 18 }] },
  };
}

test("semáforos: porcentaje (más es mejor) y conteo (menos es mejor)", () => {
  assert.equal(semaforoPct(92, 90, 75), "verde");
  assert.equal(semaforoPct(80, 90, 75), "ambar");
  assert.equal(semaforoPct(41, 90, 75), "rojo");
  assert.equal(semaforoPct(null, 90, 75), "gris");
  assert.equal(semaforoConteo(0, 5), "verde");
  assert.equal(semaforoConteo(3, 5), "ambar");
  assert.equal(semaforoConteo(16, 5), "rojo");
});

test("totales de nómina y variación semanal", () => {
  const t = totalesNomina(base().nomina);
  assert.equal(t.semanal, 51935.96);
  assert.equal(t.quincenal, 59250);
  assert.equal(t.fiscal, 111185.96);
  assert.equal(t.manoObra, 118332.85);
  assert.equal(t.personasSemanal, 31);
  const v = variacionSemanal(base().nomina.semanal_tendencia)!;
  assert.equal(v.ultima, 71685.61);
  assert.equal(v.pct, 2.85);
  assert.equal(variacionSemanal([{ fin: "2026-10-31", total: 1, personas: 1 }]), null);
});

test("alertas: rojas primero y cada una con su pantalla", () => {
  const d = base();
  d.plantilla.bajas_con_cuenta = [{ nombre: "Daissy", fecha: "2026-09-30" }, { nombre: "Josafat", fecha: "2026-10-07" }];
  d.tareas.vencidas = 16;
  d.asistencia.no_checan = [{ nombre: "Javier", puesto: "Subdirector" }];
  d.plantilla.expedientes_incompletos = [{ nombre: "Delia", faltan: "INE, CURP" }];
  d.evaluaciones.sin_evaluacion_6m = 38;
  d.accesos.pendientes = [{ nombre: "Carlos" }];
  d.accesos.con_push = 24;
  const a = alertasReporte(d);
  assert.equal(a[0].nivel, "rojo");
  assert.match(a[0].texto, /Daissy, Josafat/);
  assert.equal(a[0].ruta, "/rh?tab=accesos");
  assert.equal(a[1].nivel, "rojo");
  assert.match(a[1].texto, /16 tarea/);
  // Puntualidad 41 % es roja; asistencia 81 % ámbar.
  assert.ok(a.some((x) => x.nivel === "rojo" && /Puntualidad de 41 %/.test(x.texto)));
  assert.ok(a.some((x) => x.nivel === "ambar" && /Asistencia de 81 %/.test(x.texto)));
  assert.ok(a.some((x) => /Javier/.test(x.texto) && x.ruta === "/rh?tab=checador"));
  assert.ok(a.some((x) => /Delia/.test(x.texto) && x.ruta === "/rh?tab=documentos"));
  assert.ok(a.some((x) => /38 persona/.test(x.texto) && x.ruta === "/rh/evaluacion"));
  assert.ok(a.some((x) => /Carlos/.test(x.texto)));
  assert.ok(a.some((x) => /25 de 49 cuentas activas no tienen notificaciones/.test(x.texto)));
  // Las rojas van antes que cualquier ámbar.
  const primeraAmbar = a.findIndex((x) => x.nivel === "ambar");
  assert.ok(a.slice(primeraAmbar).every((x) => x.nivel === "ambar"));
});

test("sin pendientes no hay alertas", () => {
  const d = base();
  d.asistencia.pct_asistencia = 95;
  d.asistencia.pct_puntualidad = 90;
  assert.deepEqual(alertasReporte(d), []);
});

test("resumen ejecutivo y HTML imprimible", () => {
  const f = resumenEjecutivo(base());
  assert.match(f[0], /Plantilla activa: 52 personas \(38 con cuenta, 29 checan\)/);
  assert.match(f[1], /1 alta\(s\) y 0 baja\(s\)/);
  assert.match(f[3], /57 de 76 hechas \(75 %\), 58 % a tiempo/);
  assert.match(f[4], /subió 2.85 % contra la semana anterior/);
  assert.match(f[5], /Todavía no hay evaluaciones/);
  const html = htmlReporteRh(base(), "Grupo Loma", "Mario Contreras Farfán");
  assert.match(html, /<title>Reporte de recursos humanos · Grupo Loma<\/title>/);
  assert.match(html, /del 30\/09\/2026 al 29\/10\/2026 \(22 días hábiles\)/);
  assert.match(html, /generado por Mario Contreras Farfán/);
  assert.match(html, /\$ 111,185\.96/);
  assert.match(html, /Sin pendientes\.|<li class="(rojo|ambar)">/);
  assert.doesNotMatch(html, /<script/);
});
