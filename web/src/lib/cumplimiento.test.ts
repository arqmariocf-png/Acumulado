import { test } from "node:test";
import assert from "node:assert/strict";
import { clasificar, lunesDe, porPersona, porSemana, type ActividadBase } from "./cumplimiento.ts";

const HOY = "2026-09-22";
const base = (x: Partial<ActividadBase> & { id: string }): ActividadBase => ({
  titulo: x.id,
  asignado_a: null,
  fecha_limite: null,
  hecha: false,
  hecha_en: null,
  created_at: "2026-09-01T10:00:00Z",
  ...x,
});

test("clasificar cubre los cinco estados", () => {
  assert.equal(clasificar(base({ id: "1", fecha_limite: "2026-09-20", hecha: true, hecha_en: "2026-09-19T15:00:00Z" }), HOY), "a_tiempo");
  assert.equal(clasificar(base({ id: "2", fecha_limite: "2026-09-20", hecha: true, hecha_en: "2026-09-21T09:00:00Z" }), HOY), "tarde");
  assert.equal(clasificar(base({ id: "3", fecha_limite: "2026-09-20" }), HOY), "vencida");
  assert.equal(clasificar(base({ id: "4", fecha_limite: "2026-09-25" }), HOY), "pendiente");
  assert.equal(clasificar(base({ id: "5" }), HOY), "sin_fecha");
  assert.equal(clasificar(base({ id: "6", hecha: true }), HOY), "a_tiempo");
  // hecha sin hora registrada: se toma hoy como fecha de cierre
  assert.equal(clasificar(base({ id: "7", fecha_limite: "2026-09-20", hecha: true }), HOY), "tarde");
});

test("lunesDe regresa el lunes ISO", () => {
  assert.equal(lunesDe("2026-09-22"), "2026-09-21"); // martes
  assert.equal(lunesDe("2026-09-21"), "2026-09-21"); // lunes
  assert.equal(lunesDe("2026-09-27"), "2026-09-21"); // domingo
});

test("porSemana agrupa por semana de la fecha límite", () => {
  const filas = porSemana(
    [
      base({ id: "a", fecha_limite: "2026-09-22", hecha: true, hecha_en: "2026-09-22T10:00:00Z" }),
      base({ id: "b", fecha_limite: "2026-09-23" }),
      base({ id: "c", fecha_limite: "2026-09-16" }),
      base({ id: "d", fecha_limite: "2026-09-29" }),
      base({ id: "e" }),
    ],
    HOY,
    2,
  );
  assert.deepEqual(
    filas.map((f) => [f.semana, f.total]),
    [
      ["2026-09-07", 0],
      ["2026-09-14", 1],
      ["2026-09-21", 2],
      ["2026-09-28", 1],
    ],
  );
  const actual = filas.find((f) => f.semana === "2026-09-21")!;
  assert.equal(actual.a_tiempo, 1);
  assert.equal(actual.pendiente, 1);
  assert.equal(filas.find((f) => f.semana === "2026-09-14")!.vencida, 1);
});

test("porPersona calcula el % de cumplimiento sobre lo cerrado", () => {
  const filas = porPersona(
    [
      base({ id: "1", asignado_a: "ana", fecha_limite: "2026-09-10", hecha: true, hecha_en: "2026-09-09T00:00:00Z" }),
      base({ id: "2", asignado_a: "ana", fecha_limite: "2026-09-10", hecha: true, hecha_en: "2026-09-12T00:00:00Z" }),
      base({ id: "3", asignado_a: "ana", fecha_limite: "2026-09-15" }),
      base({ id: "4", asignado_a: "ana", fecha_limite: "2026-09-30" }),
      base({ id: "5", asignado_a: null, fecha_limite: "2026-09-30" }),
    ],
    HOY,
  );
  const ana = filas.find((f) => f.asignado_a === "ana")!;
  assert.equal(ana.total, 4);
  assert.equal(ana.hechas, 2);
  assert.equal(ana.vencidas, 1);
  assert.equal(ana.pendientes, 1);
  assert.equal(ana.cumplimiento_pct, 33); // 1 a tiempo de 3 cerradas
  assert.equal(filas[0].asignado_a, "ana");
});
