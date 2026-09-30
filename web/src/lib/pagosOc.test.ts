import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoPagoOc, fechaPagoSugerida, montoPagoSugerido, saldoOc } from "./pagosOc.ts";

const oc = { total: 1160, pagado: 0, fecha_creacion: "2026-09-01", dias_credito: 30 };

test("saldoOc resta lo pagado y no baja de cero", () => {
  assert.equal(saldoOc(oc), 1160);
  assert.equal(saldoOc({ ...oc, pagado: 500 }), 660);
  assert.equal(saldoOc({ ...oc, pagado: 2000 }), 0);
  assert.equal(saldoOc({ ...oc, total: null }), 0);
});

test("fechaPagoSugerida: crédito suma los días del proveedor, contado/anticipo hoy", () => {
  assert.equal(fechaPagoSugerida("credito", oc, "2026-09-10"), "2026-10-01");
  assert.equal(fechaPagoSugerida("credito", { ...oc, dias_credito: null }, "2026-09-10"), "2026-10-01");
  assert.equal(fechaPagoSugerida("credito", oc, "2026-11-15"), "2026-11-15");
  assert.equal(fechaPagoSugerida("contado", oc, "2026-09-29"), "2026-09-29");
  assert.equal(fechaPagoSugerida("anticipo", oc, "2026-09-29"), "2026-09-29");
});

test("montoPagoSugerido: saldo completo salvo anticipo (mitad)", () => {
  assert.equal(montoPagoSugerido("contado", oc), 1160);
  assert.equal(montoPagoSugerido("credito", { ...oc, pagado: 160 }), 1000);
  assert.equal(montoPagoSugerido("anticipo", oc), 580);
});

test("estadoPagoOc", () => {
  assert.equal(estadoPagoOc(oc), "sin_programar");
  assert.equal(estadoPagoOc({ ...oc, programado: 1160 }), "programada");
  assert.equal(estadoPagoOc({ ...oc, pagado: 500 }), "parcial");
  assert.equal(estadoPagoOc({ ...oc, pagado: 1160 }), "pagada");
});

import { textoVencimiento, vencimientoCredito } from "./pagosOc.ts";

test("vencimientoCredito: vencida, por vencer (≤7 días) y vigente", () => {
  assert.equal(vencimientoCredito(null, "2026-09-29"), null);
  assert.deepEqual(vencimientoCredito("2026-09-25", "2026-09-29"), { estado: "vencida", dias: -4 });
  assert.deepEqual(vencimientoCredito("2026-09-29", "2026-09-29"), { estado: "por_vencer", dias: 0 });
  assert.deepEqual(vencimientoCredito("2026-10-06", "2026-09-29"), { estado: "por_vencer", dias: 7 });
  assert.deepEqual(vencimientoCredito("2026-10-07", "2026-09-29"), { estado: "vigente", dias: 8 });
});

test("textoVencimiento", () => {
  assert.equal(textoVencimiento(vencimientoCredito("2026-09-25", "2026-09-29")), "vencida hace 4 días");
  assert.equal(textoVencimiento(vencimientoCredito("2026-09-28", "2026-09-29")), "vencida ayer");
  assert.equal(textoVencimiento(vencimientoCredito("2026-09-29", "2026-09-29")), "vence hoy");
  assert.equal(textoVencimiento(vencimientoCredito("2026-09-30", "2026-09-29")), "vence mañana");
  assert.equal(textoVencimiento(vencimientoCredito("2026-10-10", "2026-09-29")), "vence en 11 días");
});

import { etapaOc } from "./pagosOc.ts";

test("etapaOc: la cadena por autorizar → por programar → programado a pago → pagada → recibida", () => {
  const base = { autorizacion: "autorizada" as const, total: 1000, pagado: 0 };
  assert.equal(etapaOc({ ...base, autorizacion: "pendiente" }), "por_autorizar");
  assert.equal(etapaOc({ ...base, autorizacion: "rechazada" }), "rechazada");
  assert.equal(etapaOc(base), "por_programar");
  assert.equal(etapaOc({ ...base, programado: 1000 }), "programada");
  assert.equal(etapaOc({ ...base, pagado: 400 }), "programada");
  assert.equal(etapaOc({ ...base, pagado: 1000 }), "pagada");
  assert.equal(etapaOc({ ...base, pagada_backoffice: true }), "pagada");
  assert.equal(etapaOc({ ...base, pagado: 1000, recepcion_estado: "parcial" }), "pagada");
  assert.equal(etapaOc({ ...base, pagado: 1000, recepcion_estado: "recibida" }), "recibida");
});

test("ordenarOcs acomoda por folio numérico y por los demás criterios", async () => {
  const { ordenarOcs } = await import("./pagosOc.ts");
  const l = [
    { id_orden: "41064", fecha_creacion: "2026-09-28", proveedor: "Maracaibo", total: 4664.68, pagado: 0, vence: null },
    { id_orden: "41073", fecha_creacion: "2026-09-29", proveedor: "Home Depot", total: 1233.5, pagado: 0, vence: "2026-10-05" },
    { id_orden: "9998", fecha_creacion: "2026-07-01", proveedor: "acero", total: 14702.94, pagado: 0, vence: "2026-10-01" },
    { id_orden: "41068", fecha_creacion: "2026-09-29", proveedor: "Sistemas", total: 53.01, pagado: 0, vence: null },
  ];
  assert.deepEqual(ordenarOcs(l, "folio_desc").map((o) => o.id_orden), ["41073", "41068", "41064", "9998"]);
  assert.deepEqual(ordenarOcs(l, "folio_asc").map((o) => o.id_orden), ["9998", "41064", "41068", "41073"]);
  assert.deepEqual(ordenarOcs(l, "fecha_desc").map((o) => o.id_orden), ["41073", "41068", "41064", "9998"]);
  assert.deepEqual(ordenarOcs(l, "proveedor").map((o) => o.id_orden), ["9998", "41073", "41064", "41068"]);
  assert.deepEqual(ordenarOcs(l, "saldo_desc").map((o) => o.id_orden), ["9998", "41064", "41073", "41068"]);
  assert.deepEqual(ordenarOcs(l, "vence").map((o) => o.id_orden), ["9998", "41073", "41064", "41068"]);
});

test("porProgramarOc descuenta lo ya programado: no se programa dos veces", async () => {
  const { porProgramarOc, montoPagoSugerido } = await import("./pagosOc.ts");
  const oc41074 = { total: 2383.4, pagado: 0, programado: 2383.4, fecha_creacion: "2026-09-29", dias_credito: null };
  assert.equal(porProgramarOc(oc41074), 0);
  assert.equal(montoPagoSugerido("contado", oc41074), 0);
  assert.equal(porProgramarOc({ ...oc41074, programado: 1000 }), 1383.4);
  assert.equal(porProgramarOc({ ...oc41074, programado: null }), 2383.4);
});
