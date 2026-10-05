import { test } from "node:test";
import assert from "node:assert/strict";
import { clabeLegible, htmlCotizacionPlanta, sinIva, totalesCotizacion } from "./cotizacionPlanta.ts";

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

test("hoja membretada con datos bancarios", () => {
  assert.equal(clabeLegible("012650001127363818"), "012 650 00112736381 8");
  const html = htmlCotizacionPlanta(
    {
      folio: "COT-MCC-0001", fecha: "2026-10-05", empresa_nombre: "Mallas y Clavos Clavicón", empresa_rfc: "MCC1801231U3",
      contraparte: "CONSORCIO CONTINENTAL DE INFRAESTRUCTURA, S.A. DE C.V.", obra: null, vigencia_dias: 15, condicion_pago: null, dias_credito: null,
      notas: "Libre a bordo en planta.", elaboro: "Mario", cliente_rfc: "CCI080324F50", firma_nombre: "Mario Contreras Farfán", firma_puesto: "Director General",
      membrete: { razon_social: "MALLAS Y CLAVOS CLAVICON, S.A. DE C.V.", domicilio_fiscal: "Calle 20 de Noviembre No. 911", telefono: "222 762 9385", correo: "x@y.mx", banco: "BBVA", cuenta_bancaria: "0112736381", clabe: "012650001127363818", sucursal_bancaria: "0511" },
    },
    [{ descripcion: "Malla", cantidad: 70, unidad: "pza", precio_unitario: sinIva(1800), costo_unitario: 1683.07 }],
    "/logos/mcc.png",
  );
  assert.match(html, /MALLAS Y CLAVOS CLAVICON, S\.A\. DE C\.V\./);
  assert.match(html, /012 650 00112736381 8/);
  assert.match(html, /CCI080324F50/);
  assert.match(html, /\$1,800\.00/);
  assert.match(html, /\$126,000\.00/);
  assert.match(html, /Director General/);
  assert.doesNotMatch(html, /1,683/);
});
