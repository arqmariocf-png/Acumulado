import { test } from "node:test";
import assert from "node:assert/strict";
import { etapaOrdenCompra, ordenEditable, partidasParaGuardar, partidaVacia, revisarOrden, totalesPartidas, csvOrdenes } from "./ordenesIa.ts";

test("totales sin IVA por partida, con y sin IVA", () => {
  const t = totalesPartidas([
    { item: "Cemento", unidad: "bulto", cantidad: 10, costo: 200, iva: true },
    { item: "Flete", unidad: "", cantidad: "1", costo: "500", iva: false },
    partidaVacia(),
  ]);
  // Mismo resultado que fn_orden_ia_guardar en producción (2,500 + 320 = 2,820).
  assert.deepEqual(t, { subtotal: 2500, iva: 320, total: 2820 });
});

test("revisar la captura antes de guardar", () => {
  assert.deepEqual(revisarOrden({ contraparte: "", empresaId: "", partidas: [partidaVacia()] }, "OV"), ["Elige la empresa.", "Escribe el cliente.", "Agrega al menos una partida."]);
  const e = revisarOrden({ contraparte: "Aceros", empresaId: "x", partidas: [{ item: "", unidad: "", cantidad: 0, costo: "", iva: true }] }, "OC");
  assert.deepEqual(e, ["Partida 1: falta la descripción.", "Partida 1: cantidad inválida.", "Partida 1: falta el costo s/iva."]);
  assert.deepEqual(revisarOrden({ contraparte: "Aceros", empresaId: "x", partidas: [{ item: "Varilla", unidad: "pza", cantidad: 3, costo: 0, iva: true }] }, "OC"), []);
});

test("partidas que se guardan", () => {
  assert.deepEqual(partidasParaGuardar([{ item: " Varilla ", unidad: " ", cantidad: "3", costo: "10.5", iva: false }, partidaVacia()]), [
    { item: "Varilla", unidad: null, cantidad: 3, costo: 10.5, iva: false },
  ]);
});

test("etapa de la OC/OS y si se puede editar", () => {
  assert.equal(etapaOrdenCompra({ fuente: "acumulado", autorizacion: "pendiente" }, "OC").etiqueta, "por autorizar");
  assert.equal(etapaOrdenCompra({ fuente: "acumulado", autorizacion: "rechazada", rechazo_motivo: "Cancelada: error" }, "OC").etiqueta, "cancelada");
  assert.equal(etapaOrdenCompra({ fuente: "acumulado", autorizacion: "rechazada", rechazo_motivo: "caro" }, "OC").tono, "rojo");
  assert.equal(etapaOrdenCompra({ fuente: "acumulado", autorizacion: "autorizada", saldo: 100, total: 100, programado: 100 }, "OC").etiqueta, "pago programado");
  assert.equal(etapaOrdenCompra({ fuente: "acumulado", autorizacion: "autorizada", saldo: 0, total: 100, recepcion_estado: "parcial" }, "OC").etiqueta, "pagada · por recibir");
  assert.equal(etapaOrdenCompra({ fuente: "acumulado", autorizacion: "autorizada", saldo: 0, total: 100 }, "OS").etiqueta, "pagada");
  assert.equal(ordenEditable({ fuente: "acumulado", autorizacion: "pendiente" }), true);
  assert.equal(ordenEditable({ fuente: "acumulado", autorizacion: "autorizada" }), false);
  assert.equal(ordenEditable({ fuente: "api", autorizacion: "pendiente" }), false);
  assert.equal(ordenEditable({ fuente: "acumulado", cancelada: true }), false);
});

test("Excel de compras y servicios en un solo archivo", () => {
  const csv = csvOrdenes([
    { tipo: "OS", folio: "IA-OS-0004", fecha: "2026-10-19", empresa: "CSC", contraparte: "Fletes \"El Rayo\"", forma_pago: "Transferencia", proyecto: "Parque Real 63", total: 1160, estado: "por autorizar" },
    { tipo: "OC", folio: "41422", fecha: "2026-10-13", empresa: "MCF", contraparte: "Cemex", proyecto: null, total: null, estado: "pagada" },
  ]);
  const lineas = csv.split("\n");
  // Orden de Laura: Empresa · Folio · Tipo · Proveedor · Tipo de pago · Proyecto · Monto · Fecha · Estatus.
  assert.equal(lineas[0], '"Empresa","Folio","Tipo","Proveedor / cliente","Tipo de pago","Proyecto","Monto c/IVA","Fecha","Estatus"');
  assert.equal(lineas[1], '"CSC","IA-OS-0004","Servicio","Fletes ""El Rayo""","Transferencia","Parque Real 63","1160.00","2026-10-19","por autorizar"');
  assert.equal(lineas[2], '"MCF","41422","Compra","Cemex","","","","2026-10-13","pagada"');
});
