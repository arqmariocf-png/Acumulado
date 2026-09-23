import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clasificarFila,
  conciliarAdquira,
  esPedidoValido,
  fechaExportacionDeNombre,
  parsearFechaEs,
  parsearMontoMxn,
  procesarFilasAdquira,
} from "./bbva-adquira.ts";

test("parsearMontoMxn entiende el formato europeo de Adquira", () => {
  assert.equal(parsearMontoMxn("MXN 40.516,75"), 40516.75);
  assert.equal(parsearMontoMxn("MXN 5.442,38"), 5442.38);
  assert.equal(parsearMontoMxn("MXN 1.234.567,00"), 1234567);
  assert.equal(parsearMontoMxn("286.58"), 286.58);
  assert.equal(parsearMontoMxn(2494.36), 2494.36);
  assert.equal(parsearMontoMxn(""), 0);
  assert.equal(parsearMontoMxn(null), 0);
});

test("parsearFechaEs convierte dd-mes-aaaa", () => {
  assert.equal(parsearFechaEs("10-sep-2026"), "2026-09-10");
  assert.equal(parsearFechaEs("01-dic-2025"), "2025-12-01");
  assert.equal(parsearFechaEs("2026-09-10"), "2026-09-10");
  assert.equal(parsearFechaEs("no fecha"), null);
  assert.equal(parsearFechaEs(null), null);
});

test("fechaExportacionDeNombre saca la fecha del nombre del export", () => {
  assert.equal(fechaExportacionDeNombre("473242_2026-09-17_22_13_01_PEDIDOS_RECIBIDOS.xlsx"), "2026-09-17");
  assert.equal(fechaExportacionDeNombre("pedidos.xlsx"), null);
});

const ENCABEZADO = ["ID. PEDIDO COMPRADOR", "COMPRADOR", "CIF COMPRADOR"];
const CABECERA = ["8542408369", "BBVA México, S.A.", "BBA830831LJ2", "10-sep-2026", "10-sep-2026", "MXN 40.516,75", "FACTURADO", "F", "NO"];
const LINEA = ["8542408369", "00010", "210022007 A1-061 MOVIMIENTO", "FACTURADO", 2, 143.29, 1, "unidad", 286.58, "IVA 16%", 16, 332.4328, "210022007"];
const RECEPCION = ["8542408369", "00010", 2, 2, 0, "10-sep-2026", "11-sep-2026", "LOMA1"];
const DATO_PEDIDO = ["8542408369", "FORCED_PO", "FALSE", null];
const DATO_LINEA = ["8542408369", "00010", "Solicitante", "DULCIA DE LEON", null];

test("clasificarFila reconoce cada tipo de renglón", () => {
  assert.equal(clasificarFila(ENCABEZADO), "encabezado");
  assert.equal(clasificarFila(CABECERA), "cabecera");
  assert.equal(clasificarFila(LINEA), "linea");
  assert.equal(clasificarFila(RECEPCION), "recepcion");
  assert.equal(clasificarFila(DATO_PEDIDO), "dato_pedido");
  assert.equal(clasificarFila(DATO_LINEA), "dato_linea");
  assert.equal(clasificarFila([null, null, null]), "vacia");
});

test("procesarFilasAdquira arma el pedido con base imponible y solicitante", () => {
  const linea2 = ["8542408369", "00020", "210023449 Z1-067 REVISION", "FACTURADO", 3, 831.45, 1, "unidad", 2494.36, "IVA", 16, 2893.4576, "210023449"];
  const pedidos = procesarFilasAdquira([ENCABEZADO, [], CABECERA, LINEA, linea2, RECEPCION, DATO_PEDIDO, DATO_LINEA]);
  assert.equal(pedidos.length, 1);
  const p = pedidos[0];
  assert.equal(p.id_pedido, "8542408369");
  assert.equal(p.fecha, "2026-09-10");
  assert.equal(p.importe_total, 40516.75);
  assert.equal(p.base_imponible, 2780.94);
  assert.equal(p.impuestos, 444.95);
  assert.equal(p.lineas, 2);
  assert.equal(p.estado, "FACTURADO");
  assert.equal(p.solicitante, "DULCIA DE LEON");
  assert.equal(p.lineas_detalle[1].referencia, "210023449");
});

test("esPedidoValido exige 10 dígitos", () => {
  assert.equal(esPedidoValido("8542408369"), true);
  assert.equal(esPedidoValido("854231444"), false);
  assert.equal(esPedidoValido("0"), false);
  assert.equal(esPedidoValido("SUCURSAL CERRADA"), false);
});

test("conciliarAdquira compara contra la base imponible y separa lo que no cruza", () => {
  const bbva = [
    { pedido: "8542408369", folios: 3, monto: 2780.94, facturas: ["F1"], pagados: 3 },
    { pedido: "8542408370", folios: 1, monto: 1000, facturas: [], pagados: 0 },
    { pedido: "8542408371", folios: 2, monto: 500, facturas: ["F2"], pagados: 0 },
    { pedido: "0", folios: 1, monto: 0, facturas: [], pagados: 0 },
  ];
  const adquira = [
    { id_pedido: "8542408369", fecha: "2026-09-10", importe_total: 3225.89, base_imponible: 2780.94, estado: "FACTURADO" },
    { id_pedido: "8542408370", fecha: "2026-09-11", importe_total: 1740, base_imponible: 1500, estado: "FACTURADO" },
    { id_pedido: "9999999999", fecha: "2026-09-12", importe_total: 116, base_imponible: 100, estado: "RECIBIDO" },
  ];
  const c = conciliarAdquira(bbva, adquira, { fecha_exportacion: "2026-09-17" });
  assert.equal(c.total_pedidos, 4);
  assert.equal(c.pedidos_con_factura, 2);
  assert.equal(c.pedidos_en_adquira, 2);
  assert.deepEqual(c.pedidos_sin_adquira, ["8542408371"]);
  assert.deepEqual(c.pedidos_invalidos, ["0"]);
  assert.equal(c.pedidos_coinciden, 1);
  assert.equal(c.pedidos_con_diferencia_monto, 1);
  assert.equal(c.diferencias[0].pedido, "8542408370");
  assert.equal(c.diferencias[0].diferencia, -500);
  assert.equal(c.suma_folios_puebla, 4280.94);
  assert.equal(c.suma_facturas_adquira, 4280.94);
  assert.equal(c.suma_adquira_con_iva, 4965.89);
  assert.equal(c.adquira_meta.pedidos_fuera_maestro, 1);
  assert.equal(c.adquira_meta.importe_fuera_maestro, 116);
  assert.equal(c.adquira_meta.fecha_exportacion, "2026-09-17");
});
