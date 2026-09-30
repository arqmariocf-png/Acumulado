import { test } from "node:test";
import assert from "node:assert/strict";
import { resumenCosteo } from "./costeoObra.ts";
import { htmlReporteObra } from "./reporteObra.ts";

test("reporte de obra: bloques, montos y escapes", () => {
  const contrato = {
    folio_contrato: "OC <Neto>",
    fecha_inicio: "2026-10-01",
    fecha_fin: "2026-10-31",
    subtotal: 500000,
    iva: 80000,
    m2: 250,
    ubicacion: "Río Frío",
    latitud: 19.35,
    longitud: -98.67,
    km: 60,
    plano_id: null,
    indirectos_pct: 12,
    notas: null,
  };
  const directos = [{ tipo: "contratista" as const, nombre: "Pintor", especialidad: "Pintura", cantidad: 1, unidad: "obra", costo_unitario: 100000, notas: null }];
  const resumen = resumenCosteo(contrato, [], directos, 5000, [], null);
  const html = htmlReporteObra({
    obra: "Abarrotes Neto Rio Frio",
    empresa: "Constructora",
    cliente: "Abarrotes Neto",
    responsable: "Miguel Angel Tepal",
    plano: "Arquitectónico",
    fechaCorte: "2026-09-30",
    contrato,
    presupuesto: [],
    directos,
    imss: { monto: 5000, por: "Belén Vergara", en: "2026-09-30" },
    resumen,
    real: null,
    ocs: [],
  });
  assert.match(html, /1\. Contrato u orden de compra del cliente/);
  assert.match(html, /OC &lt;Neto&gt;/);
  assert.match(html, /31 días/);
  assert.match(html, /\$580,000\.00/);
  assert.match(html, /google\.com\/maps\?q=19\.35,-98\.67/);
  assert.match(html, /capturó Belén Vergara/);
  assert.match(html, /Utilidad pronóstico/);
  assert.match(html, /Sin presupuesto cargado/);
  assert.match(html, /Confidencial/);
});
