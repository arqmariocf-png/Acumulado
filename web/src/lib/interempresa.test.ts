import { test } from "node:test";
import assert from "node:assert/strict";
import { costoSinIva, partidasDesdeOrigen, partidasVenta, precioConComision, resumenInterempresa, revisarInterempresa } from "./interempresa.ts";

test("costo sin IVA: backoffice trae IVA en la partida, las propias no", () => {
  assert.equal(costoSinIva({ costo: 116, iva: true }, "api"), 100);
  assert.equal(costoSinIva({ costo: 116, iva: false }, "api"), 116);
  assert.equal(costoSinIva({ costo: 100, iva: true }, "acumulado"), 100);
  assert.equal(costoSinIva({ costo: 100, iva: true }, "requisicion"), 100);
});

test("precio con comisión redondeado al centavo", () => {
  assert.equal(precioConComision(100, 15), 115);
  assert.equal(precioConComision(33.33, 10), 36.66);
  assert.equal(precioConComision(100, Number.NaN), 100);
});

test("partidas de la orden original: sin vacías, costo s/IVA", () => {
  const ps = partidasDesdeOrigen(
    [
      { item: "Alambrón 5.5", unidad: "kg", cantidad: "5695", costo: 18.64, iva: true },
      { item: "", unidad: null, cantidad: 1, costo: 1, iva: true },
      { item: "Flete", unidad: null, cantidad: 0, costo: 500, iva: true },
    ],
    "api",
  );
  assert.equal(ps.length, 1);
  assert.equal(ps[0].costo, 16.07);
  assert.equal(ps[0].cantidad, "5695");
});

test("precio corregido a mano gana sobre la comisión; resumen y % real", () => {
  const ps = partidasDesdeOrigen(
    [
      { item: "Varilla", unidad: "pza", cantidad: 10, costo: 100, iva: true },
      { item: "Cemento", unidad: "bulto", cantidad: 2, costo: 200, iva: true },
    ],
    "acumulado",
  );
  ps[1].precio = "250";
  const venta = partidasVenta(ps, 10);
  assert.deepEqual(venta.map((v) => v.costo), [110, 250]);
  const r = resumenInterempresa(ps, 10);
  assert.deepEqual(r, { costo: 1400, venta: 1600, comision: 200, pct: 14.29 });
  ps[0].incluir = false;
  assert.equal(partidasVenta(ps, 10).length, 1);
  assert.equal(resumenInterempresa(ps, 10).venta, 500);
});

test("revisarInterempresa", () => {
  const ps = partidasDesdeOrigen([{ item: "Varilla", unidad: "pza", cantidad: 1, costo: 1, iva: true }], "acumulado");
  assert.deepEqual(revisarInterempresa({ empresaVende: "a", empresaCompra: "b", formaPago: "Transferencia", partidas: ps }), []);
  assert.match(revisarInterempresa({ empresaVende: "a", empresaCompra: "a", formaPago: "x", partidas: ps })[0], /otra/);
  assert.match(revisarInterempresa({ empresaVende: "a", empresaCompra: "", formaPago: "x", partidas: ps })[0], /empresa/);
  assert.match(revisarInterempresa({ empresaVende: "a", empresaCompra: "b", formaPago: "", partidas: ps })[0], /forma de pago/);
  ps[0].incluir = false;
  assert.match(revisarInterempresa({ empresaVende: "a", empresaCompra: "b", formaPago: "x", partidas: ps })[0], /partida/);
});
