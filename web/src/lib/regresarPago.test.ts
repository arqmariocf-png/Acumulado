import { test } from "node:test";
import assert from "node:assert/strict";
import { TIPOS_ERROR_PAGO, estaDevuelto, etiquetaTipoError, revisarDevolucion, textoDevolucion, visibleEnTesoreria } from "./regresarPago.ts";

test("la devolución pide tipo, y motivo salvo cuando debe ser en efectivo", () => {
  assert.equal(revisarDevolucion(null, "x"), "Elige qué está mal en el pago.");
  assert.equal(revisarDevolucion("inventado", "x"), "Elige qué está mal en el pago.");
  assert.equal(revisarDevolucion("cuenta", "  "), "Escribe qué está mal para que dirección lo corrija.");
  assert.equal(revisarDevolucion("cuenta", "es la 5859, no la 1273"), null);
  assert.equal(revisarDevolucion("efectivo", ""), null);
  assert.equal(TIPOS_ERROR_PAGO[0].clave, "efectivo");
});

test("texto de la devolución y etiquetas", () => {
  const t = textoDevolucion({ devuelto_en: "2026-11-05T15:00:00Z", devuelto_por_nombre: "Delia", devuelto_tipo: "efectivo", devuelto_motivo: "La orden se paga en efectivo, no por transferencia" });
  assert.match(t, /^Regresado por Delia el 05\/11 · Debe ser en efectivo, no por transferencia: La orden se paga en efectivo/);
  assert.equal(textoDevolucion({ devuelto_en: null }), "");
  assert.equal(textoDevolucion({ devuelto_en: "2026-11-05T15:00:00Z", devuelto_tipo: "otro" }), "Regresado por tesorería el 05/11 · Otro error");
  assert.equal(etiquetaTipoError("monto"), "El monto no corresponde");
  assert.equal(etiquetaTipoError(null), "Error en el pago");
  assert.equal(estaDevuelto({ devuelto_en: "2026-11-05T15:00:00Z" }), true);
  assert.equal(estaDevuelto({}), false);
});

test("tesorería no ve el efectivo ni los pendientes regresados; lo pagado sí", () => {
  assert.equal(visibleEnTesoreria({ estatus: "pendiente", metodo: "transferencia", devuelto_en: null }), true);
  assert.equal(visibleEnTesoreria({ estatus: "pendiente", metodo: "transferencia", devuelto_en: "2026-11-05T15:00:00Z" }), false);
  assert.equal(visibleEnTesoreria({ estatus: "pendiente", metodo: "efectivo", devuelto_en: null }), false);
  assert.equal(visibleEnTesoreria({ estatus: "pagado", metodo: "transferencia", devuelto_en: "2026-11-05T15:00:00Z" }), true);
});
