import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlRemisionProduccion, idRemisionProduccionDesdeCodigo, urlRemisionProduccion } from "./remisionProduccion.ts";

const ID = "3f2b9c1e-1234-4abc-9def-0123456789ab";

test("url e id de remisión de producción son inversas", () => {
  const url = urlRemisionProduccion("https://acumulado-nine.vercel.app", ID);
  assert.equal(idRemisionProduccionDesdeCodigo(url), ID);
  assert.equal(idRemisionProduccionDesdeCodigo("7501234567890"), null);
});

test("htmlRemisionProduccion: membrete por empresa, cliente y sello de entrega", () => {
  const base = {
    folio: "RM-000003",
    tipo: "salida" as const,
    fecha: "2026-09-23",
    empresa_nombre: "Mallas y Clavos Clavicón",
    empresa_rfc: "MCC123456ABC",
    empresa_codigo: "MCC",
    contraparte: "Ferretería <El Tornillo>",
    proyecto_nombre: null,
    referencia: "OV 14701",
    observaciones: null,
    estatus: "emitida" as const,
    emitida_por_nombre: "Jaime",
    recibio_nombre: null,
    entregada_en: null,
  };
  const html = htmlRemisionProduccion(base, [{ descripcion: "Clavo 2½\" caja 25 kg", cantidad: 40, unidad: "caja" }], "<svg></svg>", "u", "/logos/mcc.png");
  assert.match(html, /REMISIÓN DE ENTREGA/);
  assert.match(html, /#b91c1c/);
  assert.match(html, /Ferretería &lt;El Tornillo&gt;/);
  assert.match(html, /RFC MCC123456ABC/);
  assert.match(html, /logos\/mcc\.png/);
  assert.match(html, /23 de septiembre de 2026/);
  assert.doesNotMatch(html, /ENTREGADA/);
  const entregada = htmlRemisionProduccion({ ...base, tipo: "entrada", estatus: "entregada", recibio_nombre: "Luis", entregada_en: "2026-09-23T18:00:00Z" }, [], "<svg></svg>", "u", null);
  assert.match(entregada, /REMISIÓN DE RECEPCIÓN/);
  assert.match(entregada, /ENTREGADA/);
  assert.match(entregada, /Luis/);
});

test("la remisión de salida muestra contado o crédito", async () => {
  const { htmlRemisionProduccion } = await import("./remisionProduccion.ts");
  const base = {
    folio: "MCC-R-0001", tipo: "salida" as const, fecha: "2026-09-30", empresa_nombre: "Clavicón", empresa_rfc: null, empresa_codigo: "MCC",
    contraparte: "Cliente", proyecto_nombre: null, referencia: null, observaciones: null, estatus: "emitida" as const,
    emitida_por_nombre: null, recibio_nombre: null, entregada_en: null,
  };
  assert.match(htmlRemisionProduccion({ ...base, condicion_pago: "credito", dias_credito: 30 }, [], "<svg/>", "https://x", null), /Crédito a 30 días/);
  assert.match(htmlRemisionProduccion({ ...base, condicion_pago: "contado" }, [], "<svg/>", "https://x", null), /Contado/);
});
