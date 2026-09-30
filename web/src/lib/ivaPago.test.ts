import { test } from "node:test";
import assert from "node:assert/strict";
import { desgloseIvaPago } from "./ivaPago.ts";

test("pago completo: igual al desglose de la OC (41054 del backoffice)", () => {
  assert.deepEqual(desgloseIvaPago(612.79, 612.79, 84.52), { subtotal: 528.27, iva: 84.52 });
});

test("pago parcial: IVA en la misma proporción", () => {
  assert.deepEqual(desgloseIvaPago(306.4, 612.79, 84.52), { subtotal: 264.14, iva: 42.26 });
});

test("OC sin IVA", () => {
  assert.deepEqual(desgloseIvaPago(1000, 1000, 0), { subtotal: 1000, iva: 0 });
});

test("sin OC o sin total: no hay desglose", () => {
  assert.equal(desgloseIvaPago(1000, null, null), null);
  assert.equal(desgloseIvaPago(1000, 0, 0), null);
});
