import { test } from "node:test";
import assert from "node:assert/strict";
import { construirReporteSaldosDia, etiquetaCuenta, saldoAjustado, type FilaSaldoCuenta } from "./saldos.ts";

function fila(parcial: Partial<FilaSaldoCuenta> & Pick<FilaSaldoCuenta, "empresaNombre" | "banco" | "ultimos4">): FilaSaldoCuenta {
  return {
    cuentaId: `${parcial.banco}-${parcial.ultimos4}`,
    empresaId: parcial.empresaNombre,
    alias: null,
    saldoInicial: 0,
    entradas: 0,
    salidas: 0,
    saldoFinal: 0,
    ajusteSaldo: 0,
    ajusteNota: null,
    tieneMovimientos: false,
    ...parcial,
  };
}

test("etiquetaCuenta: sin alias muestra solo banco y últimos 4", () => {
  assert.equal(etiquetaCuenta({ banco: "BBVA", ultimos4: "1226", alias: null }), "BBVA ····1226");
});

test("etiquetaCuenta: con alias lo agrega entre paréntesis", () => {
  assert.equal(
    etiquetaCuenta({ banco: "BanBajio", ultimos4: "9403", alias: "Del Excel maestro" }),
    "BanBajio ····9403 (Del Excel maestro)",
  );
});

test("construirReporteSaldosDia: agrupa por empresa y calcula subtotal + total", () => {
  const filas: FilaSaldoCuenta[] = [
    fila({ empresaNombre: "Aceros y Envasados de Puebla", banco: "BBVA", ultimos4: "1226", saldoInicial: 100, entradas: 50, salidas: 20, saldoFinal: 130 }),
    fila({ empresaNombre: "Aceros y Envasados de Puebla", banco: "Banorte", ultimos4: "1273", saldoInicial: 200, entradas: 0, salidas: 30, saldoFinal: 170 }),
    fila({ empresaNombre: "Ergodinova", banco: "Santander", ultimos4: "7153", saldoInicial: 500, entradas: 10, salidas: 0, saldoFinal: 510 }),
  ];

  const reporte = construirReporteSaldosDia(filas);

  assert.equal(reporte.grupos.length, 2);
  assert.equal(reporte.grupos[0].empresaNombre, "Aceros y Envasados de Puebla");
  assert.equal(reporte.grupos[0].filas.length, 2);
  assert.deepEqual(reporte.grupos[0].subtotal, { saldoInicial: 300, entradas: 50, salidas: 50, saldoFinal: 300, ajusteSaldo: 0 });
  assert.equal(reporte.grupos[1].empresaNombre, "Ergodinova");
  assert.deepEqual(reporte.grupos[1].subtotal, { saldoInicial: 500, entradas: 10, salidas: 0, saldoFinal: 510, ajusteSaldo: 0 });

  assert.deepEqual(reporte.total, { saldoInicial: 800, entradas: 60, salidas: 50, saldoFinal: 810, ajusteSaldo: 0 });
});

test("construirReporteSaldosDia: ordena las cuentas dentro de una empresa alfabéticamente", () => {
  const filas: FilaSaldoCuenta[] = [
    fila({ empresaNombre: "Aceros y Envasados de Puebla", banco: "BBVA", ultimos4: "5859" }),
    fila({ empresaNombre: "Aceros y Envasados de Puebla", banco: "BBVA", ultimos4: "1226" }),
    fila({ empresaNombre: "Aceros y Envasados de Puebla", banco: "Banorte", ultimos4: "1273" }),
  ];

  const reporte = construirReporteSaldosDia(filas);

  assert.deepEqual(
    reporte.grupos[0].filas.map((f) => etiquetaCuenta(f)),
    ["Banorte ····1273", "BBVA ····1226", "BBVA ····5859"],
  );
});

test("construirReporteSaldosDia: lista vacía produce cero grupos y totales en cero", () => {
  const reporte = construirReporteSaldosDia([]);
  assert.equal(reporte.grupos.length, 0);
  assert.deepEqual(reporte.total, { saldoInicial: 0, entradas: 0, salidas: 0, saldoFinal: 0, ajusteSaldo: 0 });
});

test("saldoAjustado: suma el ajuste manual (puede ser negativo) al saldo que arrastra el sistema", () => {
  assert.equal(saldoAjustado({ saldoFinal: 143749.83, ajusteSaldo: -42661.84 }), 101087.99);
  assert.equal(saldoAjustado({ saldoFinal: 2066.1, ajusteSaldo: 0 }), 2066.1);
});

test("construirReporteSaldosDia: el subtotal y el total suman el ajusteSaldo de cada cuenta, no lo recalculan", () => {
  const filas: FilaSaldoCuenta[] = [
    fila({ empresaNombre: "Aceros y Envasados de Puebla", banco: "BBVA", ultimos4: "5859", saldoFinal: 143749.83, ajusteSaldo: -42661.84 }),
    fila({ empresaNombre: "Aceros y Envasados de Puebla", banco: "Banorte", ultimos4: "1273", saldoFinal: 100, ajusteSaldo: 0 }),
  ];

  const reporte = construirReporteSaldosDia(filas);

  assert.equal(reporte.grupos[0].subtotal.ajusteSaldo, -42661.84);
  assert.equal(reporte.total.ajusteSaldo, -42661.84);
  assert.equal(saldoAjustado(reporte.total), 101187.99);
});
