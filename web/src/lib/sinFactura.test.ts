import { test } from "node:test";
import assert from "node:assert/strict";
import { etiquetaSinFactura, palabraClaveSugerida, puedeMarcarSinFactura, textoAlcanceRegla } from "./sinFactura.ts";

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

test("aviso del alcance de una regla por palabra", () => {
  assert.match(textoAlcanceRegla(0, []), /Ningún otro movimiento pendiente/);
  assert.equal(
    textoAlcanceRegla(373, [{ codigo: "AEP", n: 300 }, { codigo: "MCF", n: 73 }]),
    "Esta regla marcará ahora 373 movimientos pendientes más (AEP 300, MCF 73) y todos los que lleguen con esa palabra.",
  );
  assert.match(textoAlcanceRegla(1, [{ codigo: "CSC", n: 1 }]), /1 movimiento pendiente más \(CSC 1\)/);
});
