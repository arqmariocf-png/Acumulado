import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, filasAObjetos } from "./csv.ts";
import { construirIndiceCamposCfdi, encabezadosFaltantesCfdi, mapearFilaCfdi, normalizarEncabezadoCfdi } from "./cfdi.ts";

function procesar(csv: string, tipo: "recibido" | "emitido") {
  const objetos = filasAObjetos(parseCsv(csv), normalizarEncabezadoCfdi);
  const indice = construirIndiceCamposCfdi(Object.keys(objetos[0] ?? {}));
  return objetos.map((o, i) => mapearFilaCfdi(o, indice, tipo, i + 1));
}

// Encabezados reales tomados de RecibidosAEL131023CS1202607.xls (hoja Sheet1,
// export de Compac): XML, Rfc Emisor, Nombre Emisor, ..., Folio, Fecha,
// ..., Total, ..., UUID, ...
test("mapea un CFDI normal (hoja Sheet1) usando el UUID como identificador, no el Folio de negocio", () => {
  const csv = "UUID,Total,Fecha,Rfc Emisor,Nombre Emisor,Folio\n0026a84e-245e-4c14-a832-6e06532a155c,28683.6,2026-07-01,VBB180123665,VIGUETA BOVEDILLA Y BLOQUES BALKEN,159";
  const [r] = procesar(csv, "recibido");
  assert.deepEqual(r.errores, []);
  assert.equal(r.registro!.folio, "0026a84e-245e-4c14-a832-6e06532a155c");
  assert.equal(r.registro!.total, 28683.6);
  assert.equal(r.registro!.rfcContraparte, "VBB180123665");
  assert.equal(r.registro!.nombreContraparte, "VIGUETA BOVEDILLA Y BLOQUES BALKEN");
});

test("una factura real con Total=0 se acepta -- no todo 0 es un complemento de pago", () => {
  // Caso real: 3 de 154 filas de Sheet1 en el archivo de referencia tienen
  // Tipo=ingreso y Total=0 (facturas legítimas de monto cero).
  const csv = "UUID,Total,Rfc Emisor,Nombre Emisor\n8DC85291-6C41-4E57-8F66-B3FEF6C1A830,0,ABC010101AAA,Proveedor Cero";
  const [r] = procesar(csv, "recibido");
  assert.deepEqual(r.errores, []);
  assert.equal(r.registro!.total, 0);
});

test("un complemento de pago (hoja RecibosDePago) usa ImpPagado, no la columna Total propia", () => {
  // La hoja RecibosDePago no tiene columna "Total" -- solo "Monto total"
  // (que no se mapea a nada) e "ImpPagado" (el monto real pagado).
  const csv = "UUID,ImpPagado,FechaPago,Rfc Emisor,Nombre Emisor\n0735DB1E-559C-4089-A348-AC86186CF2DD,1690.00,2026-07-09,VPU860913EB0,LOS VOLCANES DE PUEBLA";
  const [r] = procesar(csv, "recibido");
  assert.deepEqual(r.errores, []);
  assert.equal(r.registro!.total, 1690);
  assert.equal(r.registro!.fecha, "2026-07-09");
});

test("ImpPagado manda sobre Total cuando ambas columnas existen en la misma hoja", () => {
  const csv = "UUID,Total,ImpPagado\nAAA,0,1690.00";
  const [r] = procesar(csv, "recibido");
  assert.equal(r.registro!.total, 1690);
});

test("fila sin UUID se omite en silencio (relleno del Excel), no se reporta como error", () => {
  // Caso real: filas al final de RecibosDePago con todas las celdas de
  // texto vacías pero 0.0 en las numéricas -- no son CFDI reales.
  const csv = "UUID,ImpPagado,Rfc Emisor\n,0,";
  const [r] = procesar(csv, "recibido");
  assert.equal(r.registro, null);
  assert.equal(r.omitida, true);
  assert.deepEqual(r.errores, []);
});

test("fila con UUID pero sin Total ni ImpPagado sí es un error real", () => {
  const csv = "UUID,Total\nAAA-BBB-CCC,";
  const [r] = procesar(csv, "recibido");
  assert.equal(r.registro, null);
  assert.equal(r.omitida, undefined);
  assert.match(r.errores.join(" "), /Total\/ImpPagado inválido/);
});

test("mapea un CFDI emitido usando RFC/Nombre Receptor como contraparte", () => {
  const csv = "UUID,Total,RFC Receptor,Nombre Receptor\nXYZ-1,1000,CLI010101XYZ,Cliente Uno";
  const [r] = procesar(csv, "emitido");
  assert.equal(r.registro!.rfcContraparte, "CLI010101XYZ");
});

test("encabezadosFaltantesCfdi exige UUID y al menos una columna de monto (Total o ImpPagado)", () => {
  const objetos = filasAObjetos(parseCsv("Rfc Emisor\nABC"), normalizarEncabezadoCfdi);
  const indice = construirIndiceCamposCfdi(Object.keys(objetos[0]));
  assert.deepEqual(encabezadosFaltantesCfdi(indice), ["uuid", "total"]);
});

test("encabezadosFaltantesCfdi acepta ImpPagado solo, sin exigir también Total", () => {
  const objetos = filasAObjetos(parseCsv("UUID,ImpPagado\nA,1"), normalizarEncabezadoCfdi);
  const indice = construirIndiceCamposCfdi(Object.keys(objetos[0]));
  assert.deepEqual(encabezadosFaltantesCfdi(indice), []);
});
