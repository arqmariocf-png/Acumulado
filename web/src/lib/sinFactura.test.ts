import { test } from "node:test";
import assert from "node:assert/strict";
import { etiquetaSinFactura, palabraClaveSugerida, puedeMarcarSinFactura } from "./sinFactura.ts";

test("etiqueta siempre N/A - en mayúsculas", () => {
  assert.equal(etiquetaSinFactura("pago a crédito"), "N/A - PAGO A CRÉDITO");
  assert.equal(etiquetaSinFactura("N/A - COMISION BANCARIA"), "N/A - COMISION BANCARIA");
  assert.equal(etiquetaSinFactura("n/a comision"), "N/A - COMISION");
  assert.equal(etiquetaSinFactura("  "), "");
});

test("palabra clave sin fechas ni números", () => {
  assert.equal(palabraClaveSugerida("PENALIZ SDO PROM MIN/01SEP26/30SEP26 POR MANT"), "PENALIZ SDO PROM MIN");
  assert.equal(palabraClaveSugerida("PAGO A INTERES-CAPITAL DEL CREDITO #18229546"), "PAGO A INTERES-CAPITAL DEL CREDITO");
  assert.equal(palabraClaveSugerida("Pago Parcial Crédito por () mxn"), "PAGO PARCIAL CRÉDITO POR");
  assert.equal(palabraClaveSugerida(null), "");
});

test("solo sin factura real", () => {
  assert.equal(puedeMarcarSinFactura(null), true);
  assert.equal(puedeMarcarSinFactura("N/A - RENTA"), true);
  assert.equal(puedeMarcarSinFactura("F- A3E54ADE-8F75"), false);
});
