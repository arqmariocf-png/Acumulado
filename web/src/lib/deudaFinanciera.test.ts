import { test } from "node:test";
import assert from "node:assert/strict";
import { creditosDesdeTabla, csvPlantilla, estadoPagos, fechaDeTexto, numeroDeTexto, numeroPagos, resumenDeuda, sumarPeriodos, tablaAmortizacion, type CreditoBase } from "./deudaFinanciera.ts";

const base: CreditoBase = {
  monto: 120000,
  fecha_disposicion: "2026-01-15",
  tasa_anual: 12,
  iva_intereses: true,
  plazo_meses: 12,
  periodicidad: "mensual",
  amortizacion: "pagos_iguales",
  primer_pago: "2026-02-15",
};

test("fechas por periodo respetan el fin de mes", () => {
  assert.equal(sumarPeriodos("2026-01-31", "mensual", 1), "2026-02-28");
  assert.equal(sumarPeriodos("2026-01-31", "trimestral", 1), "2026-04-30");
  assert.equal(sumarPeriodos("2026-01-01", "semanal", 2), "2026-01-15");
  assert.equal(numeroPagos({ plazo_meses: 36, periodicidad: "mensual" }), 36);
  assert.equal(numeroPagos({ plazo_meses: 12, periodicidad: "quincenal" }), 24);
  assert.equal(numeroPagos({ plazo_meses: 24, periodicidad: "al_vencimiento" }), 1);
});

test("pagos iguales: cuota fija, el capital cierra exacto y el IVA es del interés", () => {
  const t = tablaAmortizacion(base);
  assert.equal(t.length, 12);
  assert.equal(t[0].interes, 1200);
  assert.equal(t[0].iva, 192);
  assert.equal(t[0].capital, 9461.85); // cuota 10,661.85 − 1,200
  assert.equal(t[11].saldoFinal, 0);
  assert.equal(t[11].capitalAcumulado, 120000);
  assert.equal(t[1].fecha, "2026-03-15");
});

test("capital igual y solo intereses", () => {
  const ci = tablaAmortizacion({ ...base, amortizacion: "capital_igual", iva_intereses: false });
  assert.equal(ci[0].capital, 10000);
  assert.equal(ci[0].interes, 1200);
  assert.equal(ci[1].interes, 1100);
  assert.equal(ci[0].iva, 0);
  const si = tablaAmortizacion({ ...base, amortizacion: "al_vencimiento" });
  assert.equal(si[0].capital, 0);
  assert.equal(si[11].capital, 120000);
  assert.deepEqual(tablaAmortizacion({ ...base, amortizacion: "personalizado" }), []);
});

test("un solo pago al vencimiento: interés por días (base 360)", () => {
  const t = tablaAmortizacion({ ...base, periodicidad: "al_vencimiento", fecha_vencimiento: "2026-07-14", iva_intereses: false });
  assert.equal(t.length, 1);
  assert.equal(t[0].interes, 7200); // 120,000 × 12 % × 180 días / 360
});

test("próximo pago y vencidos contra el saldo real", () => {
  // Al 20-abr ya debieron pagarse feb, mar y abr; el saldo solo bajó lo de febrero.
  const t = tablaAmortizacion(base);
  const saldo = 120000 - t[0].capital;
  const e = estadoPagos({ ...base, saldo, estatus: "vigente" }, "2026-04-20");
  assert.equal(e.proximo?.numero, 2);
  assert.equal(e.vencidos, 2);
  assert.equal(e.montoVencido, Math.round((t[1].pago + t[2].pago) * 100) / 100);
  const alDia = estadoPagos({ ...base, saldo: t[2].saldoFinal, estatus: "vigente" }, "2026-04-20");
  assert.equal(alDia.vencidos, 0);
  assert.equal(alDia.proximo?.numero, 4);
  assert.equal(estadoPagos({ ...base, saldo: 0, estatus: "vigente" }, "2026-04-20").proximo, null);
  assert.equal(estadoPagos({ ...base, saldo: 5000, estatus: "liquidado" }, "2026-04-20").proximo, null);
});

test("resumen por moneda y empresa con tasa ponderada", () => {
  const r = resumenDeuda([
    { empresa_id: "a", empresa_codigo: "AEP", moneda: "MXN", saldo: 300000, tasa_anual: 10, estatus: "vigente" },
    { empresa_id: "a", empresa_codigo: "AEP", moneda: "MXN", saldo: 100000, tasa_anual: 14, estatus: "vigente" },
    { empresa_id: "b", empresa_codigo: "CSC", moneda: "USD", saldo: 5000, tasa_anual: null, estatus: "vigente" },
    { empresa_id: "b", empresa_codigo: "CSC", moneda: "MXN", saldo: 999, tasa_anual: 20, estatus: "liquidado" },
  ]);
  assert.deepEqual(r.porMoneda.find((m) => m.moneda === "MXN"), { moneda: "MXN", saldo: 400000, creditos: 2, tasaPonderada: 11 });
  assert.equal(r.porMoneda.find((m) => m.moneda === "USD")?.tasaPonderada, null);
  assert.equal(r.porEmpresa[0].empresa, "AEP");
});

test("números y fechas del Excel", () => {
  assert.equal(numeroDeTexto("$1,250,000.50"), 1250000.5);
  assert.equal(numeroDeTexto("14.5%"), 14.5);
  assert.equal(numeroDeTexto(""), null);
  assert.equal(fechaDeTexto("15/01/2026"), "2026-01-15");
  assert.equal(fechaDeTexto("2026-01-15T00:00:00.000Z"), "2026-01-15");
  assert.equal(fechaDeTexto("31/02/2026"), null);
  assert.equal(fechaDeTexto("15-01-26"), "2026-01-15");
});

test("carga desde la tabla: encabezados libres, empresa por código y errores por fila", () => {
  const empresas = [
    { id: "e1", codigo: "AEP", nombre: "Aceros" },
    { id: "e2", codigo: "CSC", nombre: "Constructora" },
  ];
  const tabla = [
    ["Préstamos bancarios al 30-sep"],
    ["Empresa", "Banco", "Tipo", "Monto", "Fecha", "Tasa", "Plazo", "Periodicidad", "Amortización", "Saldo", "Saldo al"],
    ["aep", "BBVA", "Arrendamiento", "$1,000,000", "15/01/2026", "0.145", "36", "Trimestral", "capital igual", "800,000", "30/09/2026"],
    ["XYZ", "", "", "abc", "", "", "", "", "", "100", ""],
    [null, null],
  ];
  const { creditos, faltan } = creditosDesdeTabla(tabla, empresas);
  assert.deepEqual(faltan, []);
  assert.equal(creditos.length, 2);
  const [a, b] = creditos;
  assert.equal(a.empresa_id, "e1");
  assert.equal(a.tipo, "arrendamiento");
  assert.equal(a.tasa_anual, 14.5);
  assert.equal(a.periodicidad, "trimestral");
  assert.equal(a.amortizacion, "capital_igual");
  assert.equal(a.saldo_corte, 800000);
  assert.deepEqual(a.errores, []);
  assert.equal(a.fila, 3);
  assert.ok(b.errores.some((e) => /XYZ/.test(e)));
  assert.ok(b.errores.some((e) => /acreedor/.test(e)));
  assert.ok(b.errores.some((e) => /Monto/.test(e)));
  assert.ok(b.errores.some((e) => /fecha del saldo/.test(e)));
  assert.match(creditosDesdeTabla([["Nombre", "Otra"]], empresas).faltan[0], /Acreedor/);
});

test("la plantilla se puede volver a leer", () => {
  const filas = csvPlantilla()
    .split("\n")
    .map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')).slice(0, 20));
  const { creditos } = creditosDesdeTabla(filas, [{ id: "e1", codigo: "AEP", nombre: "Aceros" }]);
  assert.equal(creditos.length, 1);
  assert.deepEqual(creditos[0].errores, []);
  assert.equal(creditos[0].tasa_tipo, "variable");
});
