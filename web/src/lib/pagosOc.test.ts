import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoPagoOc, fechaPagoSugerida, montoPagoSugerido, saldoOc } from "./pagosOc.ts";

const oc = { total: 1160, pagado: 0, fecha_creacion: "2026-09-01", dias_credito: 30 };

test("saldoOc resta lo pagado y no baja de cero", () => {
  assert.equal(saldoOc(oc), 1160);
  assert.equal(saldoOc({ ...oc, pagado: 500 }), 660);
  assert.equal(saldoOc({ ...oc, pagado: 2000 }), 0);
  assert.equal(saldoOc({ ...oc, total: null }), 0);
});

test("fechaPagoSugerida: crédito suma los días del proveedor, contado/anticipo hoy", () => {
  assert.equal(fechaPagoSugerida("credito", oc, "2026-09-10"), "2026-10-01");
  assert.equal(fechaPagoSugerida("credito", { ...oc, dias_credito: null }, "2026-09-10"), "2026-10-01");
  assert.equal(fechaPagoSugerida("credito", oc, "2026-11-15"), "2026-11-15");
  assert.equal(fechaPagoSugerida("contado", oc, "2026-09-29"), "2026-09-29");
  assert.equal(fechaPagoSugerida("anticipo", oc, "2026-09-29"), "2026-09-29");
});

test("montoPagoSugerido: saldo completo salvo anticipo (mitad)", () => {
  assert.equal(montoPagoSugerido("contado", oc), 1160);
  assert.equal(montoPagoSugerido("credito", { ...oc, pagado: 160 }), 1000);
  assert.equal(montoPagoSugerido("anticipo", oc), 580);
});

test("estadoPagoOc", () => {
  assert.equal(estadoPagoOc(oc), "sin_programar");
  assert.equal(estadoPagoOc({ ...oc, programado: 1160 }), "programada");
  assert.equal(estadoPagoOc({ ...oc, pagado: 500 }), "parcial");
  assert.equal(estadoPagoOc({ ...oc, pagado: 1160 }), "pagada");
});
