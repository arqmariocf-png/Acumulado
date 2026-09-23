import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearPaginasBBVA } from "./pdf-estado-cuenta-bbva.ts";
import { POSICIONES_REAL_BBVA_WEB_ACEROS_1226_AGOSTO_2026 } from "./pdf-estado-cuenta-bbva-1226.fixture.ts";

test("parsea el PDF real de BBVA 'Detalle de movimientos' con saldos de 7 cifras (Aceros, cuenta 1226, agosto 2026) sin bloquearse por la columna Saldo", () => {
  const r = parsearPaginasBBVA(POSICIONES_REAL_BBVA_WEB_ACEROS_1226_AGOSTO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  assert.equal(r.movimientos.length, 55);
});

test("clasifica correctamente un depósito cuyo saldo (7 cifras, $1,805,436.58) cae fuera de la tolerancia de posición fija anterior", () => {
  const r = parsearPaginasBBVA(POSICIONES_REAL_BBVA_WEB_ACEROS_1226_AGOSTO_2026);
  const primero = r.movimientos[0];
  assert.equal(primero.fechaPago, "2026-08-25");
  assert.equal(primero.abonoTotal, 831320.96);
  assert.equal(primero.cargoTotal, null);
  assert.equal(primero.saldo, 1805436.58);
});

test("sigue clasificando correctamente un cargo normal (saldo de menos cifras)", () => {
  const r = parsearPaginasBBVA(POSICIONES_REAL_BBVA_WEB_ACEROS_1226_AGOSTO_2026);
  const ultimo = r.movimientos[r.movimientos.length - 1];
  assert.equal(ultimo.cargoTotal, 830);
  assert.equal(ultimo.abonoTotal, null);
  assert.equal(ultimo.saldo, 10233.87);
});
