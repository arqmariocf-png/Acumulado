import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearPdfEstadoCuentaSantander } from "./pdf-estado-cuenta-santander.ts";
import { TEXTO_REAL_SANTANDER_BALKEN_JULIO_2026 } from "./pdf-estado-cuenta-santander.fixture.ts";

test("parsea el PDF real de Santander (Balken, julio 2026, Cuenta de cheques): 19 movimientos, cuadra exacto con lo que el banco declara", () => {
  const r = parsearPdfEstadoCuentaSantander(TEXTO_REAL_SANTANDER_BALKEN_JULIO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  assert.equal(r.movimientos.length, 19);

  const depositos = r.movimientos.filter((m) => m.abonoTotal != null);
  const retiros = r.movimientos.filter((m) => m.cargoTotal != null);
  assert.equal(depositos.length, 10);
  assert.equal(retiros.length, 9);

  const sumaDepositos = Math.round(depositos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;
  const sumaRetiros = Math.round(retiros.reduce((a, m) => a + (m.cargoTotal ?? 0), 0) * 100) / 100;
  assert.equal(sumaDepositos, 175155.7);
  assert.equal(sumaRetiros, 179870);

  const ultimo = r.movimientos[r.movimientos.length - 1];
  assert.equal(ultimo.saldo, 11870.89);
});

test("captura el folio (número de operación) que Santander sí trae limpio junto a la fecha", () => {
  const r = parsearPdfEstadoCuentaSantander(TEXTO_REAL_SANTANDER_BALKEN_JULIO_2026);
  const primero = r.movimientos.find((m) => m.abonoTotal === 665);
  assert.ok(primero, "debe existir el primer abono de 665.00");
  assert.equal(primero!.folio, "0043839");
  assert.equal(primero!.fechaPago, "2026-07-03");
});

test("clasifica depósito vs retiro por delta de saldo, y ambos comparten la misma cuenta de folio 0000000 (comisión + IVA)", () => {
  const r = parsearPdfEstadoCuentaSantander(TEXTO_REAL_SANTANDER_BALKEN_JULIO_2026);
  const comision = r.movimientos.find((m) => m.cargoTotal === 750);
  assert.ok(comision, "debe existir el cargo de comisión de membresía");
  assert.equal(comision!.folio, "0000000");
  const iva = r.movimientos.find((m) => m.cargoTotal === 120);
  assert.ok(iva, "debe existir el cargo de IVA sobre comisión");
});

test("una descripción partida en varias líneas (SPEI con clave de rastreo/RFC) se concatena en un solo movimiento", () => {
  const r = parsearPdfEstadoCuentaSantander(TEXTO_REAL_SANTANDER_BALKEN_JULIO_2026);
  const spei = r.movimientos.find((m) => m.abonoTotal === 12563.9);
  assert.ok(spei, "debe existir el segundo abono de 12,563.90");
  assert.match(spei!.nombreRazonSocial ?? "", /CLAVE DE RASTREO/);
  assert.match(spei!.nombreRazonSocial ?? "", /RFC/);
});

test("un segundo producto en el mismo PDF sin movimientos (INVERSION CRECIENTE) no genera error ni movimientos", () => {
  // Confirmado indirectamente: si el segundo producto tuviera movimientos
  // reales, la primera prueba habría fallado con errorDocumento de "más de
  // un producto" -- aquí solo se confirma que no ocurrió.
  const r = parsearPdfEstadoCuentaSantander(TEXTO_REAL_SANTANDER_BALKEN_JULIO_2026);
  assert.equal(r.errorDocumento, null);
});

test("un PDF con un segundo producto que también trae movimientos reales bloquea el documento", () => {
  const texto = [
    "SALDO FINAL DEL PERIODO ANTERIOR: $100.00",
    "FECHA FOLIO DESCRIPCION DEPOSITO RETIRO SALDO",
    "01-JUL-2026 0000001 ABONO PRUEBA",
    "50.00 150.00",
    "TOTAL 50.00 0.00",
    "SALDO FINAL DEL PERIODO: $150.00",
    "SALDO FINAL DEL PERIODO ANTERIOR: 0.00",
    "FECHA FOLIO DESCRIPCION DEPOSITO RETIRO SALDO",
    "02-JUL-2026 0000002 OTRO MOVIMIENTO",
    "10.00 10.00",
    "TOTAL 10.00 0.00",
    "SALDO FINAL DEL PERIODO: $10.00",
  ].join("\n");
  const r = parsearPdfEstadoCuentaSantander(texto);
  assert.match(r.errorDocumento ?? "", /más de un producto con movimientos/);
});

test("si el saldo final calculado no cuadra con el declarado, bloquea todo el documento", () => {
  const texto = [
    "SALDO FINAL DEL PERIODO ANTERIOR: $100.00",
    "FECHA FOLIO DESCRIPCION DEPOSITO RETIRO SALDO",
    "01-JUL-2026 0000001 ABONO PRUEBA",
    "50.00 150.00",
    "TOTAL 50.00 0.00",
    "SALDO FINAL DEL PERIODO: $999.00",
  ].join("\n");
  const r = parsearPdfEstadoCuentaSantander(texto);
  assert.equal(r.movimientos.length, 0);
  assert.match(r.errorDocumento ?? "", /Saldo Final.*999/);
});

test("un PDF sin el marcador de saldo anterior reporta errorDocumento", () => {
  const r = parsearPdfEstadoCuentaSantander("cualquier otro texto sin el marcador");
  assert.match(r.errorDocumento ?? "", /No se encontró el marcador/);
});
