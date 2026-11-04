import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarRemisiones, folioRemision, ordenarCfdiParaRemision, resumenPorEmpresa, rutaRemision, textoFactura, type RemisionFacturacion } from "./remisionesFacturacion.ts";

function fila(parte: Partial<RemisionFacturacion>): RemisionFacturacion {
  return {
    origen: "almacen", id: "1", empresa_id: "e1", empresa_codigo: "MCC", empresa_nombre: "Clavicón", folio: "REM-MCC-000005", fecha: "2026-11-03",
    cliente: "Prefabricados Industriales", cliente_rfc: "PIL010101AAA", proyecto: null, referencia: null, estatus: "entregada", entregada_en: "2026-11-03T18:00:00Z",
    lineas: 1, importe: 1500, factura_estado: "por_facturar", facturada_en: null, facturada_por_nombre: null, cfdi_id: null, cfdi_folio: null, cfdi_total: null, cfdi_fecha: null,
    factura_folio: null, factura_nota: null,
    ...parte,
  };
}

test("folioRemision: una sola serie por empresa con el código, 6 dígitos", () => {
  assert.equal(folioRemision("mcc", 5), "REM-MCC-000005");
  assert.equal(folioRemision(" AEP ", 17), "REM-AEP-000017");
});

test("rutaRemision lleva a la pantalla de almacén o de planta", () => {
  assert.equal(rutaRemision("almacen", "abc"), "/inventario/remisiones/abc");
  assert.equal(rutaRemision("planta", "abc"), "/produccion/remisiones/abc");
});

test("filtrarRemisiones por estado, empresa y texto sin acentos", () => {
  const filas = [
    fila({ id: "1" }),
    fila({ id: "2", empresa_id: "e2", empresa_codigo: "AEP", folio: "REM-AEP-000017", cliente: "Hugo", factura_estado: "facturada", factura_folio: "A-120" }),
    fila({ id: "3", cliente: "Obra Volcanes", factura_estado: "no_factura" }),
  ];
  assert.deepEqual(filtrarRemisiones(filas, { estado: "por_facturar" }).map((r) => r.id), ["1"]);
  assert.deepEqual(filtrarRemisiones(filas, { estado: "todas", empresaId: "e2" }).map((r) => r.id), ["2"]);
  assert.deepEqual(filtrarRemisiones(filas, { estado: "todas", texto: "volcanes" }).map((r) => r.id), ["3"]);
  assert.deepEqual(filtrarRemisiones(filas, { estado: "todas", texto: "a-120" }).map((r) => r.id), ["2"]);
  assert.deepEqual(filtrarRemisiones(filas, { estado: "todas", texto: "aep" }).map((r) => r.id), ["2"]);
});

test("resumenPorEmpresa cuenta por facturar, entregadas sin factura e importe", () => {
  const r = resumenPorEmpresa([
    fila({ id: "1" }),
    fila({ id: "2", estatus: "emitida", entregada_en: null, importe: null }),
    fila({ id: "3", factura_estado: "facturada" }),
    fila({ id: "4", empresa_id: "e2", empresa_codigo: "AEP", empresa_nombre: "Aceros", factura_estado: "no_factura" }),
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].empresa_codigo, "MCC");
  assert.equal(r[0].por_facturar, 2);
  assert.equal(r[0].entregadas_sin_factura, 1);
  assert.equal(r[0].importe_por_facturar, 1500);
  assert.equal(r[0].facturadas, 1);
  assert.equal(r[1].por_facturar, 0);
});

test("ordenarCfdiParaRemision: mismo RFC primero, luego mismo importe (s/IVA o c/IVA), sin complementos", () => {
  const rem = fila({ importe: 1500, cliente: "Prefabricados Industriales y Logística", cliente_rfc: "PIL010101AAA" });
  const cfdis = [
    { id: "a", folio: "UUID-A", total: 99999, contraparte: "Otro", rfc: "OTR010101AAA", fecha: "2026-11-03" },
    { id: "b", folio: "UUID-B", total: 1740, contraparte: "Alguien más", rfc: "ALG010101AAA", fecha: "2026-11-02" },
    { id: "c", folio: "UUID-C", total: 500, contraparte: "PREFABRICADOS INDUSTRIALES Y LOGISTICA", rfc: "PIL010101AAA", fecha: "2026-10-01" },
    { id: "p", folio: "UUID-P", total: 1740, contraparte: "x", rfc: "PIL010101AAA", fecha: "2026-11-03", es_complemento_pago: true },
    { id: "e", folio: "UUID-E", total: 1740, contraparte: "x", rfc: "PIL010101AAA", fecha: "2026-11-04", tipo_comprobante: "E" },
  ];
  const orden = ordenarCfdiParaRemision(cfdis, rem).map((c) => c.id);
  assert.deepEqual(orden, ["c", "b", "a"]);
});

test("ordenarCfdiParaRemision sin RFC usa el nombre y la fecha más cercana", () => {
  const rem = fila({ importe: null, cliente: "Hugo Pérez", cliente_rfc: null, fecha: "2026-10-07" });
  const cfdis = [
    { id: "lejos", folio: "L", total: 10, contraparte: "Nadie", rfc: null, fecha: "2026-01-01" },
    { id: "cerca", folio: "C", total: 10, contraparte: "Nadie", rfc: null, fecha: "2026-10-08" },
    { id: "hugo", folio: "H", total: 10, contraparte: "HUGO PEREZ", rfc: null, fecha: "2026-09-01" },
  ];
  assert.deepEqual(ordenarCfdiParaRemision(cfdis, rem).map((c) => c.id), ["hugo", "cerca", "lejos"]);
});

test("textoFactura resume el estado", () => {
  assert.equal(textoFactura(fila({})), "Por facturar");
  assert.equal(textoFactura(fila({ factura_estado: "facturada", factura_folio: "A-120", cfdi_total: 1740 })), "Facturada · A-120 · $1,740.00");
  assert.equal(textoFactura(fila({ factura_estado: "no_factura", factura_nota: "venta al público" })), "No lleva factura · venta al público");
  assert.equal(textoFactura(fila({ factura_estado: "no_aplica" })), "No aplica");
});
