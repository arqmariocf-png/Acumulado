import { test } from "node:test";
import assert from "node:assert/strict";
import { METODOS_PAGO, cuentasDeEmpresa, etiquetaMetodo, fechaSugerida, metodoSugerido, revisarCambioMetodo, textoCambioMetodo } from "./cambiarMetodoPago.ts";

const cuentas = [
  { id: "c1", empresa_id: "erg", banco: "Banorte", ultimos_4: "7022", activo: true },
  { id: "c2", empresa_id: "erg", banco: "Santander", ultimos_4: "7153", activo: false },
  { id: "c3", empresa_id: "aep", banco: "BBVA", ultimos_4: "5859", activo: true },
];

test("cuentas de la empresa: solo activas y de esa empresa", () => {
  assert.deepEqual(cuentasDeEmpresa(cuentas, "erg").map((c) => c.id), ["c1"]);
  assert.deepEqual(cuentasDeEmpresa(null, "erg"), []);
});

test("el método sugerido es el contrario del actual", () => {
  assert.equal(metodoSugerido("efectivo"), "transferencia");
  assert.equal(metodoSugerido("transferencia"), "efectivo");
  assert.equal(METODOS_PAGO.map((m) => m.clave).join(","), "transferencia,cheque,efectivo");
  assert.equal(etiquetaMetodo("cheque"), "Cheque");
  assert.equal(etiquetaMetodo(null), "—");
});

test("revisar: método distinto y cuenta de la misma empresa cuando no es efectivo", () => {
  const erg = cuentasDeEmpresa(cuentas, "erg");
  assert.equal(revisarCambioMetodo("efectivo", "", null, erg), "Elige el método de pago.");
  assert.equal(revisarCambioMetodo("efectivo", "efectivo", null, erg), "El pago ya está en efectivo.");
  assert.equal(revisarCambioMetodo("efectivo", "transferencia", null, erg), "Elige de qué cuenta sale el pago.");
  assert.equal(revisarCambioMetodo("efectivo", "transferencia", "c3", erg), "Esa cuenta no es de la empresa del pago.");
  assert.equal(revisarCambioMetodo("efectivo", "transferencia", "c1", erg), null);
  // Empresa sin cuentas: se deja sin cuenta (dirección la pone después).
  assert.equal(revisarCambioMetodo("efectivo", "transferencia", null, []), null);
  assert.equal(revisarCambioMetodo("transferencia", "efectivo", null, erg), null);
});

test("fecha sugerida: la programada si no ha pasado, si no hoy", () => {
  assert.equal(fechaSugerida("2026-11-13", "2026-11-25"), "2026-11-25");
  assert.equal(fechaSugerida("2026-11-28", "2026-11-25"), "2026-11-28");
  assert.equal(fechaSugerida(null, "2026-11-25"), "2026-11-25");
});

test("texto del cambio", () => {
  assert.equal(textoCambioMetodo("CHUBB", "transferencia", cuentas[0], "2026-11-25"), "Pago a CHUBB: ahora transferencia desde Banorte 7022 para el 25/11. Ya lo ve tesorería.");
  assert.equal(textoCambioMetodo("CHUBB", "efectivo", cuentas[0], null), "Pago a CHUBB: ahora efectivo. Se confirma en Efectivo por confirmar.");
});
