import { test } from "node:test";
import assert from "node:assert/strict";
import { HORARIO_POR_DEFECTO, horarioAbierto, horarioAplicaA, momentoMx, motivoCerrado, requisicionEditable, revisarHorario, textoHorario } from "./horarioRequisiciones.ts";

// 18-nov-2026 es miércoles. 15:00Z = 09:00 MX; 00:30Z del 19 = 18:30 MX del 18.
const mieAm = new Date("2026-11-18T15:00:00Z");
const mieNoche = new Date("2026-11-19T00:30:00Z");
const dom = new Date("2026-11-22T16:00:00Z");

test("momentoMx: día ISO, minutos y fecha en hora de México", () => {
  assert.deepEqual(momentoMx(mieAm), { dia: 3, minutos: 9 * 60, fecha: "2026-11-18" });
  assert.deepEqual(momentoMx(mieNoche), { dia: 3, minutos: 18 * 60 + 30, fecha: "2026-11-18" });
  assert.equal(momentoMx(dom).dia, 7);
});

test("horarioAbierto: dentro de días y horas; sin horario siempre abierto", () => {
  assert.equal(horarioAbierto(HORARIO_POR_DEFECTO, mieAm), true);
  assert.equal(horarioAbierto(HORARIO_POR_DEFECTO, mieNoche), false);
  assert.equal(horarioAbierto(HORARIO_POR_DEFECTO, dom), false);
  assert.equal(horarioAbierto({ ...HORARIO_POR_DEFECTO, activo: false }, dom), true);
  assert.equal(horarioAbierto(null, dom), true);
  assert.equal(horarioAbierto({ ...HORARIO_POR_DEFECTO, hora_desde: "08:00:00", hora_hasta: "09:00:00" }, mieAm), false);
});

test("textoHorario y motivoCerrado", () => {
  assert.equal(textoHorario(HORARIO_POR_DEFECTO), "lun, mar, mié, jue, vie, sáb de 08:00 a 18:00");
  assert.equal(textoHorario({ ...HORARIO_POR_DEFECTO, dias_semana: [5, 1], hora_hasta: "13:30:00" }), "lun, vie de 08:00 a 13:30");
  assert.equal(textoHorario(null), "sin horario: se reciben a cualquier hora");
  assert.match(motivoCerrado(HORARIO_POR_DEFECTO), /hora de México/);
});

test("horarioAplicaA: los que piden en obra sí; almacén, RH, dirección no", () => {
  assert.equal(horarioAplicaA("supervisor"), true);
  assert.equal(horarioAplicaA("responsable"), true);
  assert.equal(horarioAplicaA("almacen"), false);
  assert.equal(horarioAplicaA("rh"), false);
  assert.equal(horarioAplicaA("direccion"), false);
});

test("requisicionEditable: quien pidió, el mismo día, sin avanzar y con horario abierto; admin siempre", () => {
  const yo = { id: "u", rol: "supervisor" };
  const req = { solicitado_por: "u", estado: "enviada", etapa: "solicitada", created_at: "2026-11-18T14:00:00Z" };
  assert.equal(requisicionEditable(yo, req, HORARIO_POR_DEFECTO, mieAm), true);
  assert.equal(requisicionEditable(yo, req, HORARIO_POR_DEFECTO, mieNoche), false, "cerró el horario");
  assert.equal(requisicionEditable(yo, { ...req, created_at: "2026-11-17T14:00:00Z" }, HORARIO_POR_DEFECTO, mieAm), false, "de ayer");
  assert.equal(requisicionEditable(yo, { ...req, etapa: "autorizada" }, HORARIO_POR_DEFECTO, mieAm), false, "ya avanzó");
  assert.equal(requisicionEditable({ id: "otro", rol: "supervisor" }, req, HORARIO_POR_DEFECTO, mieAm), false);
  assert.equal(requisicionEditable({ id: "a", rol: "admin" }, { ...req, created_at: "2026-10-01T14:00:00Z" }, HORARIO_POR_DEFECTO, mieNoche), true);
  assert.equal(requisicionEditable(null, req, HORARIO_POR_DEFECTO, mieAm), false);
});

test("revisarHorario", () => {
  assert.equal(revisarHorario(HORARIO_POR_DEFECTO), null);
  assert.equal(revisarHorario({ ...HORARIO_POR_DEFECTO, dias_semana: [] }), "Elige al menos un día.");
  assert.equal(revisarHorario({ ...HORARIO_POR_DEFECTO, hora_hasta: "07:00" }), "La hora de cierre debe ser después de la de apertura.");
});
