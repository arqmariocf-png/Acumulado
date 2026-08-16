import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, filasAObjetos } from "./csv.ts";
import { construirIndiceCamposCfdi, encabezadosFaltantesCfdi, mapearFilaCfdi, normalizarEncabezadoCfdi } from "./cfdi.ts";

function procesar(csv: string, tipo: "recibido" | "emitido") {
  const objetos = filasAObjetos(parseCsv(csv), normalizarEncabezadoCfdi);
  const indice = construirIndiceCamposCfdi(Object.keys(objetos[0] ?? {}));
  return objetos.map((o, i) => mapearFilaCfdi(o, indice, tipo, i + 1));
}

test("mapea un CFDI recibido usando RFC/Nombre Emisor como contraparte", () => {
  const csv = "UUID,Total,Fecha,RFC Emisor,Nombre Emisor\nABC-123,17869.80,7/15/26,CEM850101ABC,CEMEX";
  const [r] = procesar(csv, "recibido");
  assert.deepEqual(r.errores, []);
  assert.equal(r.registro!.folio, "ABC-123");
  assert.equal(r.registro!.total, 17869.8);
  assert.equal(r.registro!.rfcContraparte, "CEM850101ABC");
  assert.equal(r.registro!.nombreContraparte, "CEMEX");
});

test("mapea un CFDI emitido usando RFC/Nombre Receptor como contraparte", () => {
  const csv = "UUID,Total,RFC Receptor,Nombre Receptor\nXYZ-1,1000,CLI010101XYZ,Cliente Uno";
  const [r] = procesar(csv, "emitido");
  assert.equal(r.registro!.rfcContraparte, "CLI010101XYZ");
});

test("fila sin Total se rechaza", () => {
  const csv = "UUID,Total\nABC-1,";
  const [r] = procesar(csv, "recibido");
  assert.equal(r.registro, null);
  assert.match(r.errores.join(" "), /Total inválido/);
});

test("encabezadosFaltantesCfdi detecta ausencia de Total cuando solo hay Folio", () => {
  const objetos = filasAObjetos(parseCsv("Folio\nA1"), normalizarEncabezadoCfdi);
  const indice = construirIndiceCamposCfdi(Object.keys(objetos[0]));
  assert.deepEqual(encabezadosFaltantesCfdi(indice), ["total"]);
});
