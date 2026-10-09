import { test } from "node:test";
import assert from "node:assert/strict";
import { borradorVigente, campoRespaldable, claveBorrador, descriptorCampo, firmaFormulario, VIGENCIA_BORRADOR_MS } from "./borradores.ts";

test("no respalda contraseñas, archivos ni datos de tarjeta", () => {
  assert.equal(campoRespaldable({ tag: "INPUT", type: "password", name: "clave" }), false);
  assert.equal(campoRespaldable({ tag: "INPUT", type: "file", name: "comprobante" }), false);
  assert.equal(campoRespaldable({ tag: "INPUT", type: "text", name: "numero_tarjeta" }), false);
  assert.equal(campoRespaldable({ tag: "INPUT", type: "text", placeholder: "Nueva contraseña" }), false);
  assert.equal(campoRespaldable({ tag: "INPUT", type: "text", name: "concepto" }), true);
  assert.equal(campoRespaldable({ tag: "TEXTAREA", name: "notas" }), true);
  assert.equal(campoRespaldable({ tag: "SELECT", name: "empresa_id" }), true);
});

test("descriptor usa nombre, id o placeholder", () => {
  assert.equal(descriptorCampo({ tag: "INPUT", name: "monto" }), "input|monto");
  assert.equal(descriptorCampo({ tag: "INPUT", placeholder: "Referencia" }), "input|Referencia");
  const f = firmaFormulario(["input|monto", "input|concepto"]);
  assert.equal(f, firmaFormulario(["input|monto", "input|concepto"]));
  assert.notEqual(f, firmaFormulario(["input|monto", "select|empresa_id"]));
  assert.equal(claveBorrador("/finanzas/pagos", f), `borrador:/finanzas/pagos:${f}`);
});

test("borrador vence a las 12 horas y vacío no cuenta", () => {
  const ahora = 1_000_000_000;
  const b = JSON.stringify({ guardado: ahora - 1000, campos: { "input|monto#0": "500" } });
  assert.deepEqual(borradorVigente(b, ahora)?.campos, { "input|monto#0": "500" });
  const viejo = JSON.stringify({ guardado: ahora - VIGENCIA_BORRADOR_MS - 1, campos: { a: "1" } });
  assert.equal(borradorVigente(viejo, ahora), null);
  assert.equal(borradorVigente(JSON.stringify({ guardado: ahora, campos: {} }), ahora), null);
  assert.equal(borradorVigente("{malo", ahora), null);
});
