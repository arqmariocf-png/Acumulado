import { test } from "node:test";
import assert from "node:assert/strict";
import { JORNADA_BASE, cargaPorMaquina, duracionMinutos, programarLote, siguienteHoraLaboral, sumarMinutosLaborales } from "./programacionMaquinas.ts";

const local = (iso: string) => new Date(iso); // sin zona: hora local del proceso

test("duracionMinutos = preparación + por unidad × cantidad", () => {
  assert.equal(duracionMinutos({ orden: 1, nombre_paso: "Corte", equipo_id: null, minutos_preparacion: 30, minutos_por_unidad: 0.5 }, 100), 80);
});

test("siguienteHoraLaboral brinca fuera de horario y domingos", () => {
  // domingo 27-sep-2026 a las 10:00 -> lunes 28 a las 08:00
  const r = siguienteHoraLaboral(local("2026-09-27T10:00:00"), JORNADA_BASE);
  assert.equal(r.getDay(), 1);
  assert.equal(r.getHours(), 8);
  // sábado 26 a las 19:00 -> lunes 28 08:00
  const s = siguienteHoraLaboral(local("2026-09-26T19:00:00"), JORNADA_BASE);
  assert.equal(s.getDate(), 28);
  assert.equal(s.getHours(), 8);
  // dentro de horario se queda igual
  assert.equal(siguienteHoraLaboral(local("2026-09-23T11:30:00"), JORNADA_BASE).getHours(), 11);
});

test("sumarMinutosLaborales continúa al día siguiente", () => {
  // miércoles 23 a las 16:00 + 240 min: quedan 120 hoy, 120 mañana -> jueves 10:00
  const fin = sumarMinutosLaborales(local("2026-09-23T16:00:00"), 240, JORNADA_BASE);
  assert.equal(fin.getDate(), 24);
  assert.equal(fin.getHours(), 10);
});

test("programarLote encadena pasos y respeta máquinas ocupadas", () => {
  const ruta = [
    { orden: 1, nombre_paso: "Enderezado", equipo_id: "m1", minutos_preparacion: 20, minutos_por_unidad: 1 },
    { orden: 2, nombre_paso: "Soldado", equipo_id: "m2", minutos_preparacion: 10, minutos_por_unidad: 2 },
    { orden: 3, nombre_paso: "Empaque", equipo_id: null, minutos_preparacion: 0, minutos_por_unidad: 0.5 },
  ];
  // m2 ocupada hasta el miércoles 23 a las 12:00
  const ops = programarLote(ruta, 100, local("2026-09-23T08:00:00"), [{ equipo_id: "m2", fin_programado: local("2026-09-23T12:00:00").toISOString() }]);
  assert.equal(ops.length, 3);
  assert.equal(ops[0].minutos, 120);
  assert.equal(new Date(ops[0].fin_programado).getHours(), 10); // 08:00 + 120 min
  // el paso 2 esperaría a las 10:00 por secuencia, pero la máquina se libera a las 12:00
  assert.equal(new Date(ops[1].inicio_programado).getHours(), 12);
  assert.equal(ops[1].minutos, 210); // 12:00 + 210 min = 15:30
  assert.equal(new Date(ops[1].fin_programado).getMinutes(), 30);
  assert.equal(new Date(ops[2].inicio_programado).getHours(), 15);
});

test("cargaPorMaquina suma minutos dentro del rango", () => {
  const desde = local("2026-09-21T00:00:00");
  const hasta = local("2026-09-28T00:00:00"); // 6 días laborales × 600 min
  const carga = cargaPorMaquina(
    [
      { equipo_id: "m1", inicio_programado: local("2026-09-23T08:00:00").toISOString(), fin_programado: local("2026-09-23T18:00:00").toISOString(), estado: "programada" },
      { equipo_id: "m1", inicio_programado: local("2026-09-24T08:00:00").toISOString(), fin_programado: local("2026-09-24T09:00:00").toISOString(), estado: "cancelada" },
    ],
    desde,
    hasta,
  );
  assert.equal(carga.get("m1")?.minutos, 600);
  assert.equal(carga.get("m1")?.pct, 17); // 600 / 3600
});
