import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearPdfEstadoCuentaBanorte } from "./pdf-estado-cuenta-banorte.ts";
import { TEXTO_REAL_BANORTE_ACEROS_JULIO_2026 } from "./pdf-estado-cuenta-banorte.fixture.ts";

test("parsea el PDF real de Banorte (Aceros, julio 2026, ENLACE NEGOCIOS BASICA): 7 movimientos, cuadra exacto con lo que el banco declara", () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ACEROS_JULIO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  assert.equal(r.movimientos.length, 7);

  const depositos = r.movimientos.filter((m) => m.abonoTotal != null);
  const retiros = r.movimientos.filter((m) => m.cargoTotal != null);
  assert.equal(depositos.length, 2);
  assert.equal(retiros.length, 5);

  const sumaDepositos = Math.round(depositos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;
  assert.equal(sumaDepositos, 87184.69);

  const ultimoMovimiento = r.movimientos[r.movimientos.length - 1];
  assert.equal(ultimoMovimiento.saldo, 3773.86);
});

test("clasifica depósito vs retiro comparando el saldo contra el saldo anterior (delta), no por columna", () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ACEROS_JULIO_2026);

  const primerSpei = r.movimientos.find((m) => m.abonoTotal === 47767.19)!;
  assert.ok(primerSpei, "debe existir el SPEI recibido de 47,767.19");
  assert.equal(primerSpei.cargoTotal, null);
  assert.equal(primerSpei.saldo, 52005.04);
  assert.equal(primerSpei.fechaPago, "2026-07-15");

  const pagoCapital = r.movimientos.find((m) => m.nombreRazonSocial?.includes("PAGO DE CAPITAL"))!;
  assert.ok(pagoCapital, "debe existir el movimiento de PAGO DE CAPITAL");
  assert.equal(pagoCapital.cargoTotal, 28500);
  assert.equal(pagoCapital.abonoTotal, null);
});

test('el monto embebido "IVA:00000000.00" dentro de una descripción no se cuenta como un tercer monto del renglón', () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ACEROS_JULIO_2026);
  const traspaso = r.movimientos.find((m) => m.nombreRazonSocial?.includes("TRASPASO A CUENTA DE TERCEROS"))!;
  assert.ok(traspaso, "debe existir el movimiento de traspaso a cuenta de terceros");
  assert.equal(traspaso.cargoTotal, 39417.5);
  assert.equal(traspaso.saldo, 52005.04);
});

test("una descripción partida en varias líneas de texto (ej. SPEI con CLABE/RFC/referencia) se concatena en un solo movimiento, no en varios", () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ACEROS_JULIO_2026);
  const spei = r.movimientos.find((m) => m.abonoTotal === 39417.5)!;
  assert.ok(spei, "debe existir el segundo SPEI recibido de 39,417.50");
  assert.match(spei.nombreRazonSocial ?? "", /SPEI RECIBIDO/);
  assert.match(spei.nombreRazonSocial ?? "", /CLABE/);
  assert.match(spei.nombreRazonSocial ?? "", /CVE RAST/);
});

test("un PDF sin la tabla de movimientos reporta errorDocumento", () => {
  const r = parsearPdfEstadoCuentaBanorte("cualquier otro texto sin la tabla");
  assert.match(r.errorDocumento ?? "", /No se encontró la tabla de movimientos/);
});

test("un PDF con un segundo producto que también trae movimientos reales (no SIN MOVIMIENTOS) bloquea el documento", () => {
  const texto = [
    "FECHA DESCRIPCIÓN / ESTABLECIMIENTO MONTO DEL DEPOSITO MONTO DEL RETIRO SALDO",
    "30-JUN-26 SALDO ANTERIOR 100.00",
    "01-JUL-26 DEPOSITO 50.00 150.00",
    "FECHA DESCRIPCIÓN / ESTABLECIMIENTO MONTO DEL DEPOSITO MONTO DEL RETIRO SALDO",
    "30-JUN-26 SALDO ANTERIOR 0.00",
    "01-JUL-26 OTRO MOVIMIENTO 10.00 10.00",
    "OTROS▼",
  ].join("\n");
  const r = parsearPdfEstadoCuentaBanorte(texto);
  assert.match(r.errorDocumento ?? "", /más de un producto con movimientos/);
});

test("un segundo producto SIN MOVIMIENTOS no bloquea el documento", () => {
  const texto = [
    "FECHA DESCRIPCIÓN / ESTABLECIMIENTO MONTO DEL DEPOSITO MONTO DEL RETIRO SALDO",
    "30-JUN-26 SALDO ANTERIOR 100.00",
    "01-JUL-26 DEPOSITO 50.00 150.00",
    "FECHA DESCRIPCIÓN / ESTABLECIMIENTO MONTO DEL DEPOSITO MONTO DEL RETIRO SALDO",
    "30-JUN-26 SALDO ANTERIOR 0.00",
    "SIN MOVIMIENTOS",
    "OTROS▼",
    "+ Total de depósitos $ 50.00",
    "Saldo actual $ 150.00",
  ].join("\n");
  const r = parsearPdfEstadoCuentaBanorte(texto);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.movimientos.length, 1);
});

test("si el saldo final calculado no cuadra con el declarado, bloquea todo el documento", () => {
  const texto = [
    "FECHA DESCRIPCIÓN / ESTABLECIMIENTO MONTO DEL DEPOSITO MONTO DEL RETIRO SALDO",
    "30-JUN-26 SALDO ANTERIOR 100.00",
    "01-JUL-26 DEPOSITO 50.00 150.00",
    "OTROS▼",
    "+ Total de depósitos $ 50.00",
    "Saldo actual $ 999.00",
  ].join("\n");
  const r = parsearPdfEstadoCuentaBanorte(texto);
  assert.equal(r.movimientos.length, 0);
  assert.match(r.errorDocumento ?? "", /Saldo Final.*999/);
});
