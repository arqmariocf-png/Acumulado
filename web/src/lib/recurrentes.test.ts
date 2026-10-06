import { test } from "node:test";
import assert from "node:assert/strict";
import { proximaFecha, textoFrecuencia, type Recurrente } from "./recurrentes.ts";

const r = (x: Partial<Recurrente>): Recurrente => ({ frecuencia: "semanal", dias_semana: [5], dia_mes: null, fecha_unica: null, activa: true, ...x });

test("texto de la frecuencia", () => {
  assert.equal(textoFrecuencia(r({ dias_semana: [5] })), "cada vie");
  assert.equal(textoFrecuencia(r({ dias_semana: [1, 2, 3, 4, 5] })), "de lunes a viernes");
  assert.equal(textoFrecuencia(r({ dias_semana: [1, 2, 3, 4, 5, 6, 7] })), "todos los días");
  assert.equal(textoFrecuencia(r({ frecuencia: "mensual", dia_mes: 15 })), "cada mes, el día 15");
  assert.equal(textoFrecuencia(r({ frecuencia: "unica", fecha_unica: "2026-10-20" })), "una vez, el 20/10/2026");
});

test("próxima fecha: viernes, mensual con mes corto y única", () => {
  assert.equal(proximaFecha(r({ dias_semana: [5] }), "2026-10-06"), "2026-10-09");
  assert.equal(proximaFecha(r({ dias_semana: [2] }), "2026-10-06"), "2026-10-06"); // hoy martes
  assert.equal(proximaFecha(r({ frecuencia: "mensual", dia_mes: 31 }), "2026-11-02"), "2026-11-30");
  assert.equal(proximaFecha(r({ frecuencia: "unica", fecha_unica: "2026-10-01" }), "2026-10-06"), null);
  assert.equal(proximaFecha(r({ activa: false }), "2026-10-06"), null);
});
