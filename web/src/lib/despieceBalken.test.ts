import { test } from "node:test";
import assert from "node:assert/strict";
import { PARAMETROS_BASE, PRECIOS_BASE, cotizar, despiezar, despiezarTablero, htmlCotizacionBalken, redondearArriba } from "./despieceBalken.ts";

test("redondearArriba sube al múltiplo siguiente", () => {
  assert.equal(redondearArriba(3.2, 0.1), 3.2);
  assert.equal(Number(redondearArriba(3.21, 0.1).toFixed(2)), 3.3);
  assert.equal(redondearArriba(3.21, 0), 3.21);
});

test("tablero 4.00 × 3.50: 6 viguetas de 4.20 y 80 bovedillas", () => {
  const d = despiezarTablero({ nombre: "Recámara", claro: 4, ancho: 3.5, cantidad: 1 }, { ...PARAMETROS_BASE, peralteVigueta: 15 });
  assert.equal(d.clarosPorTablero, 5); // 3.50 / 0.70
  assert.equal(d.viguetasPorTablero, 6);
  assert.equal(d.longitudVigueta, 4.2); // 4.00 + 0.10 + 0.10
  assert.equal(d.bovedillasPorClaro, 16); // 4.00 / 0.25
  assert.equal(d.bovedillas, 80);
  assert.equal(d.area, 14);
  assert.equal(d.excedeClaro, false);
});

test("ancho no múltiplo de la separación redondea claros hacia arriba", () => {
  const d = despiezarTablero({ nombre: "Sala", claro: 3, ancho: 3.6, cantidad: 2 }, PARAMETROS_BASE);
  assert.equal(d.clarosPorTablero, 6); // 3.6 / 0.7 = 5.14 → 6
  assert.equal(d.viguetasPorTablero, 7);
  assert.equal(d.viguetas, 14);
  assert.equal(d.bovedillas, 6 * 12 * 2);
});

test("claro mayor al máximo del peralte se marca", () => {
  const d = despiezarTablero({ nombre: "Cochera", claro: 4.2, ancho: 3, cantidad: 1 }, { ...PARAMETROS_BASE, peralteVigueta: 12 });
  assert.equal(d.excedeClaro, true);
});

test("despiezar agrupa viguetas por longitud, suma concreto, malla y desperdicio", () => {
  const d = despiezar(
    [
      { nombre: "A", claro: 4, ancho: 3.5, cantidad: 1 },
      { nombre: "B", claro: 4, ancho: 2.1, cantidad: 1 },
      { nombre: "C", claro: 3, ancho: 2.8, cantidad: 1 },
      { nombre: "vacío", claro: 0, ancho: 2, cantidad: 1 },
    ],
    PARAMETROS_BASE,
  );
  assert.equal(d.tableros.length, 3);
  assert.deepEqual(
    d.viguetasPorLongitud.map((v) => [v.longitud, v.piezas]),
    [
      [3.2, 5],
      [4.2, 10],
    ],
  );
  assert.equal(d.viguetas, 15);
  assert.equal(d.area, 14 + 8.4 + 8.4);
  assert.equal(d.bovedillas, 80 + 48 + 48);
  assert.equal(d.bovedillasConDesperdicio, Math.ceil(176 * 1.03));
  assert.equal(d.concretoM3, Number((30.8 * 0.07).toFixed(3)));
  assert.equal(d.mallaM2, Number((30.8 * 1.1).toFixed(2)));
});

test("cotizar arma líneas, IVA y precio por m²", () => {
  const d = despiezar([{ nombre: "A", claro: 4, ancho: 3.5, cantidad: 1 }], { ...PARAMETROS_BASE, peralteVigueta: 15 });
  const c = cotizar(d, { ...PARAMETROS_BASE, peralteVigueta: 15 }, { ...PRECIOS_BASE, viguetaPorMetro: 100, bovedillaPorPieza: 20, flete: 500, concretoPorM3: 0, mallaPorM2: 0, manoObraPorM2: 0 });
  assert.deepEqual(
    c.lineas.map((l) => [l.concepto, l.cantidad, l.importe]),
    [
      ["Vigueta pretensada 15 cm × 4.20 m", 6, 2520],
      ["Bovedilla de cemento 15×25×56", 83, 1660],
      ["Flete a obra", 1, 500],
    ],
  );
  assert.equal(c.subtotal, 4680);
  assert.equal(c.iva, 748.8);
  assert.equal(c.total, 5428.8);
  assert.equal(c.precioPorM2, Number((4680 / 14).toFixed(2)));
});

test("htmlCotizacionBalken escapa y muestra totales", () => {
  const p = { ...PARAMETROS_BASE, peralteVigueta: 15 };
  const t = [{ nombre: "Recámara <1>", claro: 4, ancho: 3.5, cantidad: 1 }];
  const d = despiezar(t, p);
  const c = cotizar(d, p, { ...PRECIOS_BASE, viguetaPorMetro: 100, bovedillaPorPieza: 20 });
  const html = htmlCotizacionBalken({ empresa: "Balken", cliente: "Cliente & Cía", obra: "Casa", fecha: "22/09/2026", vigencia: "15 días", elaboro: "Jaime", notas: "" }, p, d, c);
  assert.match(html, /Recámara &lt;1&gt;/);
  assert.match(html, /Cliente &amp; Cía/);
  assert.match(html, /Vigueta pretensada 15 cm × 4\.20 m/);
  assert.match(html, /Precio por m²/);
});
