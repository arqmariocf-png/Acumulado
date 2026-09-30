import { test } from "node:test";
import assert from "node:assert/strict";
import { avanceComprobantes, textoComprobantes } from "./comprobantesPago.ts";

test("todos sin comprobante (los 6 de Aceros y Envasados del 29-sep)", () => {
  const a = avanceComprobantes(6, 6);
  assert.equal(a.porcentajeSin, 100);
  assert.equal(a.color, "rojo");
  assert.equal(textoComprobantes(a), "Al 100 % de los pagos les falta el comprobante (6 de 6).");
});

test("pocos faltantes: ámbar; ninguno: verde", () => {
  assert.equal(avanceComprobantes(20, 1).color, "ambar");
  assert.equal(avanceComprobantes(20, 1).porcentajeSin, 5);
  const v = avanceComprobantes(20, 0);
  assert.equal(v.color, "verde");
  assert.equal(textoComprobantes(v), "Los 20 pagos tienen comprobante.");
});

test("sin pagos: gris", () => {
  assert.equal(avanceComprobantes(0, 0).color, "gris");
  assert.equal(avanceComprobantes(3, 9).sinComprobante, 3);
});
