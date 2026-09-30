import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlCotizacionPlanta, sinIva, totalesCotizacion } from "./cotizacionPlanta.ts";

test("precio con IVA incluido a sin IVA", () => {
  assert.equal(sinIva(1740), 1500);
});

test("totales y margen interno", () => {
  const t = totalesCotizacion([
    { descripcion: "Malla 66-10/10", cantidad: 10, unidad: "Rollo", precio_unitario: 1500, costo_unitario: 1683.0711 },
    { descripcion: "Flete", cantidad: 1, unidad: "servicio", precio_unitario: 800 },
  ]);
  assert.equal(t.subtotal, 15800);
  assert.equal(t.iva, 2528);
  assert.equal(t.total, 18328);
  assert.equal(t.costo, 16830.71);
  assert.equal(t.margen, -1830.71);
  assert.equal(t.margenPct, -12.2);
  assert.equal(t.sinCosto, 1);
});

test("la cotización impresa no lleva costos", () => {
  const html = htmlCotizacionPlanta(
    { folio: "COT-MCC-0001", fecha: "2026-09-30", empresa_nombre: "Mallas y Clavos Clavicón", empresa_rfc: null, contraparte: "Prefabricados <PIL>", obra: null, vigencia_dias: 15, condicion_pago: "credito", dias_credito: 30, notas: null, elaboro: "Mario" },
    [{ descripcion: "Malla", cantidad: 2, unidad: "Rollo", precio_unitario: 1500, costo_unitario: 1683.07 }],
    null,
  );
  assert.match(html, /COT-MCC-0001/);
  assert.match(html, /Prefabricados &lt;PIL&gt;/);
  assert.match(html, /Crédito a 30 días/);
  assert.match(html, /\$3,480\.00/);
  assert.doesNotMatch(html, /1,683/);
});
