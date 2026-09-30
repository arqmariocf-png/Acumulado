import { test } from "node:test";
import assert from "node:assert/strict";
import { armarHojaPagos, csvHojaPagos, htmlHojaPagos, type CuentaHoja, type PagoHoja } from "./hojaPagos.ts";

const AEP = { empresa_id: "aep", empresa_nombre: "Aceros y Envasados de Puebla" };
const cuentas: CuentaHoja[] = [
  { ...AEP, banco: "BBVA", ultimos_4: "1226", alias: null, saldo_inicial: 21005.95 },
  { ...AEP, banco: "BBVA", ultimos_4: "4239", alias: null, saldo_inicial: 20818.97 },
  { ...AEP, banco: "BBVA", ultimos_4: "5859", alias: null, saldo_inicial: 168450.53 },
];
const pago = (p: Partial<PagoHoja>): PagoHoja => ({ ...AEP, id_orden: null, beneficiario: "", concepto: null, monto: 0, fecha_programada: "2026-09-30", estatus: "pendiente", metodo: "transferencia", tipo_pago_backoffice: null, oc_proyecto: null, notas: null, ...p });

test("hoja de Laura (30-sep): saldo inicial por cuenta, cargos y saldo corrido", () => {
  const pagos = [
    pago({ beneficiario: "NÓMINA FISCAL", monto: 9070.14 }),
    pago({ id_orden: "41075", beneficiario: "MAQUI PRINT SA DE CV", monto: 8133.2, tipo_pago_backoffice: "Transferencia electrónica de fondos", oc_proyecto: "Proyecto X" }),
    pago({ id_orden: "41074", beneficiario: "TUDOGAR", monto: 2383.4, tipo_pago_backoffice: "Tarjeta de débito", notas: "Jorge" }),
    pago({ id_orden: "41069", beneficiario: "DISTRIBUIDORA COLLAR SA DE CV", monto: 32676.95 }),
    pago({ id_orden: "40770", beneficiario: "Cemex S.A.B. DE C.V.", monto: 85120.03 }),
  ];
  const [h] = armarHojaPagos(cuentas, pagos, "2026-09-30");
  assert.equal(h.abonos, 210275.45);
  assert.equal(h.cargos, 137383.72);
  assert.equal(h.saldo, 72891.73);
  assert.deepEqual(h.renglones.map((r) => r.saldo), [21005.95, 41824.92, 210275.45, 202142.25, 199758.85, 167081.9, 81961.87, 72891.73]);
  assert.deepEqual(h.renglones.filter((r) => r.tipo === "pago").map((r) => r.oc), ["41075", "41074", "41069", "40770", null]);
  assert.equal(h.renglones[4].forma_pago, "Tarjeta de débito");
  assert.equal(h.renglones[4].comentarios, "Jorge");
  assert.equal(h.renglones[7].forma_pago, "Transferencia");
});

test("vencidos pendientes entran con comentario; efectivo va aparte; cancelados y futuros no", () => {
  const pagos = [
    pago({ id_orden: "41000", beneficiario: "A", monto: 100, fecha_programada: "2026-09-28" }),
    pago({ id_orden: "41001", beneficiario: "B", monto: 50, fecha_programada: "2026-09-28", estatus: "pagado" }),
    pago({ id_orden: "41002", beneficiario: "C", monto: 70, metodo: "efectivo" }),
    pago({ id_orden: "41003", beneficiario: "D", monto: 10, estatus: "cancelado" }),
    pago({ id_orden: "41004", beneficiario: "E", monto: 10, fecha_programada: "2026-10-01" }),
    pago({ id_orden: "41005", beneficiario: "F", monto: 20, estatus: "pagado", referencia: "123" }),
  ];
  const [h] = armarHojaPagos([], pagos, "2026-09-30");
  assert.deepEqual(h.renglones.map((r) => r.oc), ["41005", "41000"]);
  assert.equal(h.renglones[1].comentarios, "vencido del 28/09");
  assert.equal(h.renglones[0].comentarios, "pagado · ref 123");
  assert.equal(h.cargos, 120);
  assert.equal(h.saldo, -120);
  assert.equal(h.efectivo, 70);
  assert.equal(h.n_efectivo, 1);
});

test("HTML y CSV traen los totales por empresa", () => {
  const hojas = armarHojaPagos(cuentas, [pago({ id_orden: "41074", beneficiario: "TUDOGAR", monto: 2383.4 })], "2026-09-30");
  const html = htmlHojaPagos("30.09.26", hojas);
  assert.match(html, /PAGOS 30\.09\.26/);
  assert.match(html, /SALDO INICIAL BBVA 1226/);
  assert.match(html, /\$ 207,892\.05/);
  const csv = csvHojaPagos(hojas);
  assert.match(csv, /^﻿Aceros y Envasados de Puebla/);
  assert.match(csv, /41074,TUDOGAR,,2383\.40,207892\.05/);
  assert.match(csv, /,TOTAL,210275\.45,2383\.40,207892\.05/);
});
