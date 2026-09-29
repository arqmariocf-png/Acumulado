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

import { textoVencimiento, vencimientoCredito } from "./pagosOc.ts";

test("vencimientoCredito: vencida, por vencer (≤7 días) y vigente", () => {
  assert.equal(vencimientoCredito(null, "2026-09-29"), null);
  assert.deepEqual(vencimientoCredito("2026-09-25", "2026-09-29"), { estado: "vencida", dias: -4 });
  assert.deepEqual(vencimientoCredito("2026-09-29", "2026-09-29"), { estado: "por_vencer", dias: 0 });
  assert.deepEqual(vencimientoCredito("2026-10-06", "2026-09-29"), { estado: "por_vencer", dias: 7 });
  assert.deepEqual(vencimientoCredito("2026-10-07", "2026-09-29"), { estado: "vigente", dias: 8 });
});

test("textoVencimiento", () => {
  assert.equal(textoVencimiento(vencimientoCredito("2026-09-25", "2026-09-29")), "vencida hace 4 días");
  assert.equal(textoVencimiento(vencimientoCredito("2026-09-28", "2026-09-29")), "vencida ayer");
  assert.equal(textoVencimiento(vencimientoCredito("2026-09-29", "2026-09-29")), "vence hoy");
  assert.equal(textoVencimiento(vencimientoCredito("2026-09-30", "2026-09-29")), "vence mañana");
  assert.equal(textoVencimiento(vencimientoCredito("2026-10-10", "2026-09-29")), "vence en 11 días");
});
