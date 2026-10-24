import { test } from "node:test";
import assert from "node:assert/strict";
import { etapaOrdenCompra, ordenEditable, partidasParaGuardar, partidaVacia, revisarOrden, totalesPartidas, csvOrdenes, csvOrdenesConDetalle, ordenarPorFolio, claveFolio } from "./ordenesIa.ts";

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
  // Orden de Laura: Empresa · Folio · Tipo · Proveedor · Tipo de pago · Proyecto · Monto · Fecha · Estatus; renglones por folio ascendente.
  assert.equal(lineas[0], '"Empresa","Folio","Tipo","Proveedor / cliente","Tipo de pago","Proyecto","Monto c/IVA","Fecha","Estatus"');
  assert.equal(lineas[1], '"MCF","41422","Compra","Cemex","","","","2026-10-13","pagada"');
  assert.equal(lineas[2], '"CSC","IA-OS-0004","Servicio","Fletes ""El Rayo""","Transferencia","Parque Real 63","1160.00","2026-10-19","por autorizar"');
});

test("Excel de órdenes con el detalle de cada partida", () => {
  const base = { tipo: "OV" as const, fecha: "2026-10-22", empresa: "AEP", contraparte: "Cliente", forma_pago: "Transferencia", proyecto: "Obra", estado: "abierta" };
  const csv = csvOrdenesConDetalle(
    [
      { ...base, id: "a", folio: "IA-OV-0001", total: 1160, fuente: "acumulado" },
      { ...base, id: "b", folio: "15340", total: 232, fuente: "api" },
      { ...base, id: "c", folio: "15341", total: 0, fuente: "api" },
    ],
    new Map([
      ["a", [{ numero: 2, concepto: "Varilla", unidad: "pza", cantidad: 5, precio: 100, iva: true }, { numero: 1, concepto: "Alambre", unidad: "kg", cantidad: 10, precio: 50, iva: true }]],
      ["b", [{ numero: 1, concepto: "Flete", unidad: "srv", cantidad: 2, precio: 116, iva: true }]],
    ]),
  );
  const filas = csv.split("\n");
  assert.equal(filas.length, 5); // encabezado + 2 partidas + 1 + orden sin partidas
  assert.match(filas[0], /"Partida","Concepto","Unidad","Cantidad","Precio unitario s\/IVA","Importe c\/IVA"$/);
  // Por folio (id) ascendente: 15340, 15341, IA-OV-0001.
  assert.match(filas[1], /"15340".*"1","Flete","srv","2","100.00","232.00"$/); // backoffice: precio con IVA
  assert.match(filas[2], /"15341".*,"","","","","",""$/);
  assert.match(filas[3], /"IA-OV-0001".*"1","Alambre","kg","10","50.00","580.00"$/);
  assert.match(filas[4], /"2","Varilla","pza","5","100.00","580.00"$/);
});

test("Excel por el número del folio: OC y OS comparten serie (Laura, 24-oct-2026)", () => {
  const folios = ["IA-OS-0010", "IA-OC-0012", "41500", "IA-OS-0004", "IA-OC-0003", "RQ-CSC-0002", "41492", "IA-OC-0005"].map((folio) => ({ folio }));
  assert.deepEqual(
    ordenarPorFolio(folios).map((f) => f.folio),
    ["41492", "41500", "IA-OC-0003", "IA-OS-0004", "IA-OC-0005", "IA-OS-0010", "IA-OC-0012", "RQ-CSC-0002"],
  );
  assert.deepEqual(claveFolio("IA-OS-0004"), { serie: "IA-", numero: 4 });
  assert.deepEqual(claveFolio("41492"), { serie: "", numero: 41492 });
  assert.deepEqual(claveFolio("IA-OV-0001"), { serie: "IA-", numero: 1 });
});
