import { test } from "node:test";
import assert from "node:assert/strict";
import { PATRONES_128, anchosCode128, controlCode128, svgCode128, valoresCode128B } from "./code128.ts";

test("cada símbolo mide 11 módulos y el de fin 13", () => {
  assert.equal(PATRONES_128.length, 107);
  PATRONES_128.slice(0, 106).forEach((p) => assert.equal([...p].reduce((s, d) => s + Number(d), 0), 11, p));
  assert.equal([...PATRONES_128[106]].reduce((s, d) => s + Number(d), 0), 13);
  assert.equal(new Set(PATRONES_128).size, 107);
});

test("valores del juego B y dígito de control", () => {
  assert.deepEqual(valoresCode128B("PJJ123C"), [48, 42, 42, 17, 18, 19, 35]);
  assert.equal(controlCode128(valoresCode128B("PJJ123C")), 55);
  assert.throws(() => valoresCode128B("Ñ"));
});

test("anchos y SVG del folio de una venta", () => {
  const folio = "PV-AEP-0001";
  const anchos = anchosCode128(folio);
  // inicio + 11 caracteres + control + fin = 14 símbolos; los 13 primeros de 6 anchos y el fin de 7.
  assert.equal(anchos.length, 13 * 6 + 7);
  assert.equal(anchos.reduce((s, w) => s + w, 0), 13 * 11 + 13);
  const svg = svgCode128(folio, { modulo: 1, alto: 40 });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes(folio));
  assert.equal((svg.match(/<rect x=/g) ?? []).length, Math.ceil(anchos.length / 2));
});
