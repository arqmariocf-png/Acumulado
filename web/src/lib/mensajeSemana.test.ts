import { test } from "node:test";
import assert from "node:assert/strict";
import { FRASES_AGRADECIMIENTO, LIMITE_MENSAJE, fraseSugerida, frasesSinUsar, proximoSabado, sabadosSiguientes, yaPasoEnvio } from "./mensajeSemana.ts";

test("sábado de envío: hoy si es sábado, si no el siguiente", () => {
  assert.equal(proximoSabado("2026-10-17"), "2026-10-17");
  assert.equal(proximoSabado("2026-10-18"), "2026-10-24");
  assert.equal(proximoSabado("2026-10-23"), "2026-10-24");
  assert.deepEqual(sabadosSiguientes("2026-10-19", 3), ["2026-10-24", "2026-10-31", "2026-11-07"]);
});

test("la 1 p. m. de México es 19:00 UTC", () => {
  assert.equal(yaPasoEnvio("2026-10-24", new Date("2026-10-24T18:59:00Z")), false);
  assert.equal(yaPasoEnvio("2026-10-24", new Date("2026-10-24T19:00:00Z")), true);
});

test("frases: caben en la notificación, sin repetir, una por semana", () => {
  assert.ok(FRASES_AGRADECIMIENTO.length >= 30);
  assert.equal(new Set(FRASES_AGRADECIMIENTO).size, FRASES_AGRADECIMIENTO.length);
  assert.ok(FRASES_AGRADECIMIENTO.every((f) => f.length <= LIMITE_MENSAJE));
  assert.notEqual(fraseSugerida("2026-10-24"), fraseSugerida("2026-10-31"));
  assert.equal(frasesSinUsar([`  ${FRASES_AGRADECIMIENTO[0].toUpperCase()} `]).length, FRASES_AGRADECIMIENTO.length - 1);
});
