import { test } from "node:test";
import assert from "node:assert/strict";
import {
  conPerfilBase,
  csvDetalle,
  csvTiempos,
  detalleDe,
  diferenciaHoras,
  filtrarPersonas,
  horas,
  htmlReporteTiempos,
  minutosPorDia,
  ordenarPersonas,
  pctAsistencia,
  pctPuntualidad,
  resumenTiempos,
  semaforoPersona,
  type PersonaTiempos,
  type ReporteTiempos,
} from "./reporteRhTiempos.ts";

function persona(p: Partial<PersonaTiempos>): PersonaTiempos {
  return {
    personal_id: "x", profile_id: "p", nombre: "Alguien", puesto: "Ayudante", area: "operativo", empresa: "CSC",
    jornada: "base", hora_entrada: "08:00", tolerancia: 15, horas_semana: 48, dias_semana: 6,
    habiles: 26, dias_con_entrada: 24, faltas: 2, retardos: 2, retardo_min_total: 40,
    entrada_prom: "07:58", salida_prom: "16:50", minutos_total: 11040, dias_completos: 23, minutos_esperados: 11040,
    dias_sin_salida: 1, dias_con_comida: 10, comida_prom_min: 60, manuales: 0, offline: 20, anuladas: 0, ubicacion: "Oficina Central Loma",
    ...p,
  };
}

test("formato de horas", () => {
  assert.equal(horas(465), "7 h 45 m");
  assert.equal(horas(0), "0 h 00 m");
  assert.equal(horas(-90), "−1 h 30 m");
  assert.equal(horas(null), "—");
});

test("asistencia, puntualidad, horas por día y diferencia contra la jornada", () => {
  const p = persona({});
  assert.equal(pctAsistencia(p), 92);
  assert.equal(pctPuntualidad(p), 92);
  assert.equal(minutosPorDia(p), 480);
  assert.equal(diferenciaHoras(p), 0);
  const sin = persona({ dias_con_entrada: 0, dias_completos: 0, minutos_total: 0, faltas: 26, retardos: 0 });
  assert.equal(pctAsistencia(sin), null);
  assert.equal(pctPuntualidad(sin), null);
  assert.equal(minutosPorDia(sin), null);
});

test("semáforo por persona", () => {
  assert.deepEqual(semaforoPersona(persona({})), { s: "verde", motivo: "cumple" });
  assert.equal(semaforoPersona(persona({ dias_con_entrada: 0 })).s, "rojo");
  // Luis Fernando: 26 de 26 días, 25 retardos → rojo por puntualidad.
  const lf = semaforoPersona(persona({ dias_con_entrada: 26, faltas: 0, retardos: 25 }));
  assert.equal(lf.s, "rojo");
  assert.match(lf.motivo, /25 retardos/);
  // Mauro: 2 días de 26 → rojo por faltas.
  assert.match(semaforoPersona(persona({ dias_con_entrada: 2, faltas: 24, retardos: 2, dias_completos: 0, minutos_total: 0 })).motivo, /24 faltas/);
  // Raúl: 22 días, 14 retardos (36 % puntual) → rojo.
  assert.equal(semaforoPersona(persona({ dias_con_entrada: 22, faltas: 4, retardos: 14 })).s, "rojo");
  // 22 días, 5 retardos (77 %), 6 sin salida → ámbar con los tres motivos.
  const r = semaforoPersona(persona({ dias_con_entrada: 22, faltas: 4, retardos: 5, dias_sin_salida: 6, dias_completos: 16, minutos_total: 8790, minutos_esperados: 7680 }));
  assert.equal(r.s, "ambar");
  assert.match(r.motivo, /4 faltas, 5 retardos, 6 días sin salida/);
  // Menos de una hora por día que su jornada → ámbar con la diferencia.
  const corto = semaforoPersona(persona({ minutos_total: 9000, minutos_esperados: 11040 }));
  assert.equal(corto.s, "ambar");
  assert.match(corto.motivo, /34 h 00 m menos que su jornada/);
});

test("orden, filtro y perfil base", () => {
  const a = persona({ nombre: "Ana", dias_con_entrada: 0, faltas: 26, retardos: 0 });
  const b = persona({ nombre: "Beto" });
  const c = persona({ nombre: "Carlos", retardos: 23, dias_con_entrada: 24, jornada: "Oficina 9-18" });
  assert.deepEqual(ordenarPersonas([b, c, a]).map((x) => x.nombre), ["Ana", "Carlos", "Beto"]);
  assert.deepEqual(ordenarPersonas([b, c, a], "nombre").map((x) => x.nombre), ["Ana", "Beto", "Carlos"]);
  assert.deepEqual(ordenarPersonas([b, c, a], "retardos").map((x) => x.nombre), ["Carlos", "Beto", "Ana"]);
  assert.deepEqual(filtrarPersonas([a, b, c], "carlós").map((x) => x.nombre), ["Carlos"]);
  assert.equal(filtrarPersonas([a, b, c], "").length, 3);
  assert.equal(conPerfilBase([a, b, c]), 2);
});

function reporte(): ReporteTiempos {
  const p1 = persona({ profile_id: "p1", nombre: "Ana" });
  const p2 = persona({ profile_id: "p2", nombre: "Beto", dias_con_entrada: 0, faltas: 26, retardos: 0, dias_completos: 0, minutos_total: 0, minutos_esperados: 0 });
  return {
    desde: "2026-09-30",
    hasta: "2026-10-29",
    resumen: { personas: 2, checan: 1, dias_con_entrada: 24, faltas: 2, retardos: 2, minutos_total: 11040, dias_sin_salida: 1, manuales: 2, offline: 20, anuladas: 0 },
    personas: [p1, p2],
    detalle: [
      { profile_id: "p1", fecha: "2026-10-02", entrada: "07:55", comida_inicio: "13:00", comida_fin: "14:00", salida: "17:00", minutos: 485, comida_min: 60, retardo_min: 0, manuales: 0, offline: 1, anuladas: 0 },
      { profile_id: "p1", fecha: "2026-10-01", entrada: "08:40", comida_inicio: null, comida_fin: null, salida: null, minutos: null, comida_min: null, retardo_min: 40, manuales: 0, offline: 0, anuladas: 0 },
    ],
    por_dia: [{ fecha: "2026-10-01", entradas: 1, retardos: 1, minutos: 0 }, { fecha: "2026-10-02", entradas: 1, retardos: 0, minutos: 485 }],
  };
}

test("resumen, CSV y HTML", () => {
  const d = reporte();
  const f = resumenTiempos(d);
  assert.match(f[0], /2 personas con cuenta; 1 marcaron/);
  assert.match(f[1], /Asistencia 92 % y puntualidad 92 %/);
  assert.match(f[3], /1 en rojo, 0 en ámbar, 1 en verde/);
  assert.match(f[4], /jornada base \(08:00 \+ 15 min, 48 h en 6 días\)/);
  assert.match(f[5], /corregidas a mano: 2/);
  const csv = csvTiempos(ordenarPersonas(d.personas));
  assert.match(csv.split("\n")[0], /^Nombre,Puesto,Empresa/);
  assert.match(csv, /Beto,.*,rojo$/m);
  assert.deepEqual(detalleDe(d, "p1").map((x) => x.fecha), ["2026-10-01", "2026-10-02"]);
  const det = csvDetalle(d);
  assert.match(det, /Ana,2026-10-01,jue,08:40,,,,,,40,0,0/);
  const html = htmlReporteTiempos(d, "Grupo Loma", "Eréndira", true);
  assert.match(html, /<title>Tiempos y checador · Grupo Loma<\/title>/);
  assert.match(html, /Beto/);
  assert.match(html, /sin salida/);
  assert.match(html, /Detalle por persona y día/);
  assert.doesNotMatch(htmlReporteTiempos(d, "Grupo Loma", null), /Detalle por persona y día/);
});
