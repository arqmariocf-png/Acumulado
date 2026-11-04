import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlRemision, idRemisionDesdeCodigo, urlRemision, cantidadTexto } from "./remision.ts";

const ID = "3f2b9c1e-1234-4abc-9def-0123456789ab";

test("urlRemision e idRemisionDesdeCodigo son inversas", () => {
  const url = urlRemision("https://acumulado-nine.vercel.app", ID);
  assert.equal(url, `https://acumulado-nine.vercel.app/inventario/remisiones/${ID}`);
  assert.equal(idRemisionDesdeCodigo(url), ID);
  assert.equal(idRemisionDesdeCodigo(` ${url.toUpperCase()} `), ID);
});

test("idRemisionDesdeCodigo ignora códigos de barras normales", () => {
  assert.equal(idRemisionDesdeCodigo("7501234567890"), null);
  assert.equal(idRemisionDesdeCodigo("https://acumulado-nine.vercel.app/inventario/remisiones/no-es-uuid"), null);
});

test("htmlRemision escapa texto y arma folio, líneas y total", () => {
  const html = htmlRemision(
    {
      folio: "REM-000007",
      fecha: "2026-09-21",
      empresa_nombre: "Ergodinova <SA>",
      almacen_nombre: "Almacén principal",
      entregar_a: "Obra & Cía",
      observaciones: null,
      estatus: "emitida",
      emitida_por_nombre: "Mario",
      recibio_nombre: null,
      entregada_en: null,
    },
    [
      { nombre: "Cemento", sku: "CEM-01", unidad: "SACO", cantidad: 10 },
      { nombre: "Varilla 3/8", sku: "VAR-38", unidad: "PZA", cantidad: 2.5 },
    ],
    "<svg></svg>",
    "https://x/inventario/remisiones/abc",
  );
  assert.match(html, /REM-000007/);
  assert.match(html, /Ergodinova &lt;SA&gt;/);
  assert.match(html, /Obra &amp; Cía/);
  assert.match(html, /21 de septiembre de 2026/);
  assert.match(html, /Total de líneas: 2/);
  assert.match(html, new RegExp(cantidadTexto(12.5)));
  assert.doesNotMatch(html, /ENTREGADA/);
});

test("htmlRemision marca la entrega confirmada", () => {
  const html = htmlRemision(
    {
      folio: "REM-000001",
      fecha: "2026-09-21",
      empresa_nombre: "E",
      almacen_nombre: "A",
      entregar_a: "X",
      observaciones: "frágil",
      estatus: "entregada",
      emitida_por_nombre: null,
      recibio_nombre: "Juan",
      entregada_en: "2026-09-21T18:00:00Z",
    },
    [],
    "<svg></svg>",
    "u",
  );
  assert.match(html, /ENTREGADA/);
  assert.match(html, /Juan/);
  assert.match(html, /frágil/);
});

test("htmlRemision lleva el membrete de la empresa: logo, razón social, RFC, domicilio y referencia", () => {
  const html = htmlRemision(
    {
      folio: "REM-MCC-000005",
      fecha: "2026-11-04",
      empresa_nombre: "Clavicón",
      empresa_codigo: "MCC",
      empresa_rfc: "MCC1801231U3",
      empresa_razon_social: "Mallas y Clavos Clavicón, S.A. de C.V.",
      empresa_domicilio: "Carretera federal km 5, Puebla",
      empresa_telefono: "222 123 4567",
      almacen_nombre: "Planta",
      entregar_a: "Prefabricados",
      referencia: "OV 15380",
      observaciones: null,
      estatus: "emitida",
      emitida_por_nombre: "Jaime",
      recibio_nombre: null,
      entregada_en: null,
    },
    [],
    "<svg></svg>",
    "u",
    "data:image/png;base64,AAAA",
  );
  assert.match(html, /REMISIÓN DE SALIDA/);
  assert.match(html, /#b91c1c/);
  assert.match(html, /Mallas y Clavos Clavicón, S\.A\. de C\.V\./);
  assert.match(html, /RFC MCC1801231U3/);
  assert.match(html, /Carretera federal km 5/);
  assert.match(html, /Tel\. 222 123 4567/);
  assert.match(html, /data:image\/png;base64,AAAA/);
  assert.match(html, /OV 15380/);
});
