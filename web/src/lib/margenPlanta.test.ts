import { test } from "node:test";
import assert from "node:assert/strict";
import { margenSobreVenta, precioParaMargen, precioPromedio } from "./margenPlanta.ts";

test("margen sobre la venta con costo PEPS", () => {
  assert.equal(margenSobreVenta(1500, 1200), 0.2);
  assert.ok((margenSobreVenta(1500, 1576.18) ?? 0) < 0);
  assert.equal(margenSobreVenta(null, 100), null);
  assert.equal(margenSobreVenta(0, 100), null);
});

test("precio para un margen deseado", () => {
  assert.equal(precioParaMargen(1200, 20), 1500);
  assert.equal(precioParaMargen(1576.1826, 25), 2101.58);
  assert.equal(precioParaMargen(null, 20), null);
  assert.equal(precioParaMargen(100, 100), null);
});

test("precio promedio ponderado ignora partidas sin precio", () => {
  assert.equal(precioPromedio([{ cantidad: 1, precio_unitario: 1500 }, { cantidad: 3, precio_unitario: 1700 }, { cantidad: 5, precio_unitario: null }]), 1650);
  assert.equal(precioPromedio([]), null);
});
