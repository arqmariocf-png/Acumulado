import test from "node:test";
import assert from "node:assert/strict";
import { compararConteo, conteoInicial, estadoSalida, filtrarMonitor, interpretarCodigoSalida, resumenMonitor, revisarConteo, rutaRemisionSalida, textoResultado, type FilaMonitor } from "./controlSalidas.ts";

const ID = "26f8c2d1-b510-4d36-8803-33686a8403a1";

test("interpretarCodigoSalida: liga del QR de almacén y de planta", () => {
  assert.deepEqual(interpretarCodigoSalida(`https://acumulado-nine.vercel.app/inventario/remisiones/${ID}`), { tipo: "liga", origen: "almacen", id: ID });
  assert.deepEqual(interpretarCodigoSalida(`https://x.mx/produccion/remisiones/${ID.toUpperCase()}`), { tipo: "liga", origen: "planta", id: ID });
});

test("interpretarCodigoSalida: id suelto, folio y basura", () => {
  assert.deepEqual(interpretarCodigoSalida(` ${ID} `), { tipo: "id", id: ID });
  assert.deepEqual(interpretarCodigoSalida("rem-vbb-000001"), { tipo: "folio", folio: "REM-VBB-000001" });
  assert.deepEqual(interpretarCodigoSalida("REM MCC 000004"), null);
  assert.equal(interpretarCodigoSalida(""), null);
  assert.equal(interpretarCodigoSalida("ACU1:abc"), null);
});

test("conteoInicial y compararConteo", () => {
  const c = conteoInicial([{ descripcion: "Vigueta", unidad: "pza", cantidad: 10 }, { descripcion: "Bovedilla", unidad: "pza", cantidad: 200 }]);
  assert.equal(c[1].cantidad_contada, 200);
  assert.equal(compararConteo(c).resultado, "coincide");
  c[0].cantidad_contada = 9;
  const r = compararConteo(c);
  assert.equal(r.resultado, "diferencia");
  assert.equal(r.totalRemision, 210);
  assert.equal(r.totalContado, 209);
  assert.deepEqual(r.diferencias, [{ descripcion: "Vigueta", remision: 10, contado: 9, diferencia: -1 }]);
  assert.match(textoResultado(r), /Vigueta: remisión 10, contado 9 \(-1\)/);
  assert.match(textoResultado(compararConteo(conteoInicial([{ descripcion: "x", unidad: null, cantidad: 3 }]))), /Coincide/);
});

test("revisarConteo bloquea vacíos y negativos", () => {
  assert.equal(revisarConteo([]), "La remisión no tiene partidas que contar.");
  assert.match(revisarConteo([{ descripcion: "Malla", unidad: "rollo", cantidad_remision: 2, cantidad_contada: Number.NaN }]) ?? "", /Malla/);
  assert.equal(revisarConteo([{ descripcion: "Malla", unidad: "rollo", cantidad_remision: 2, cantidad_contada: 0 }]), null);
});

const fila = (x: Partial<FilaMonitor>): FilaMonitor => ({
  origen: "planta", remision_id: ID, folio: "REM-VBB-000001", fecha: "2026-11-20", empresa_codigo: "VBB", empresa_nombre: "Balken", cliente: "Cliente",
  destino: null, estatus: "emitida", emitida_por_nombre: null, partidas: 2, cantidad_total: 210, verificacion_id: null, verificado_en: null,
  verificado_por_nombre: null, resultado: null, total_contado: null, verificaciones: 0, ...x,
});

test("estadoSalida, resumenMonitor y filtrarMonitor", () => {
  const filas = [
    fila({}),
    fila({ folio: "REM-MCC-000006", empresa_codigo: "MCC", verificacion_id: "v1", resultado: "coincide", verificado_por_nombre: "Seguridad" }),
    fila({ folio: "REM-MCC-000007", empresa_codigo: "MCC", verificacion_id: "v2", resultado: "diferencia" }),
  ];
  assert.equal(estadoSalida(filas[0]), "pendiente");
  assert.equal(estadoSalida(filas[2]), "diferencia");
  const r = resumenMonitor(filas);
  assert.equal(r.salidas, 3);
  assert.equal(r.verificadas, 2);
  assert.equal(r.pendientes, 1);
  assert.equal(r.conDiferencia, 1);
  assert.deepEqual(r.porEmpresa, [{ codigo: "MCC", salidas: 2, pendientes: 0 }, { codigo: "VBB", salidas: 1, pendientes: 1 }]);
  assert.equal(filtrarMonitor(filas, "pendiente", "").length, 1);
  assert.equal(filtrarMonitor(filas, "todas", "seguridad").length, 1);
  assert.equal(filtrarMonitor(filas, "diferencia", "mcc").length, 1);
});

test("rutaRemisionSalida", () => {
  assert.equal(rutaRemisionSalida("almacen", ID), `/seguridad/salidas?codigo=${ID}`);
  assert.equal(rutaRemisionSalida("planta", ID), `/produccion/remisiones/${ID}`);
});
