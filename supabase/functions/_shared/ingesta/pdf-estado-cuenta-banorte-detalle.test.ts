import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearPdfEstadoCuentaBanorte } from "./pdf-estado-cuenta-banorte.ts";
import { TEXTO_REAL_BANORTE_ERGODINOVA_DETALLE_AGOSTO_2026 } from "./pdf-estado-cuenta-banorte-detalle.fixture.ts";

test("parsea el PDF real de Banorte formato 'Detalle de Movimientos' (Ergodinova, cuenta 7022, agosto 2026): 182 movimientos, cuadra exacto con lo que el banco declara", () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ERGODINOVA_DETALLE_AGOSTO_2026, "7022");
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  assert.equal(r.movimientos.length, 182);

  const sumaDepositos = Math.round(r.movimientos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;
  const sumaRetiros = Math.round(r.movimientos.reduce((a, m) => a + (m.cargoTotal ?? 0), 0) * 100) / 100;
  assert.equal(sumaDepositos, 504335.88);
  assert.equal(sumaRetiros, 2667552.74);

  const ultimoMovimiento = r.movimientos[r.movimientos.length - 1];
  assert.equal(ultimoMovimiento.saldo, 2207.51);
});

test("funciona igual sin pasar cuentaUltimos4 (no bloquea por falta del dato de cuenta)", () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ERGODINOVA_DETALLE_AGOSTO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.movimientos.length, 182);
});

test("bloquea si la cuenta terminación no coincide con la del PDF", () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ERGODINOVA_DETALLE_AGOSTO_2026, "9999");
  assert.equal(r.movimientos.length, 0);
  assert.match(r.errorDocumento ?? "", /terminación 7022.*terminación 9999/);
});

test("clasifica depósito vs retiro comparando el saldo contra el saldo anterior (delta), no por columna", () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ERGODINOVA_DETALLE_AGOSTO_2026, "7022");

  const primerMovimiento = r.movimientos[0];
  assert.equal(primerMovimiento.cargoTotal, 400);
  assert.equal(primerMovimiento.abonoTotal, null);
  assert.equal(primerMovimiento.saldo, 2165024.37);
  assert.equal(primerMovimiento.fechaPago, "2026-08-03");
  assert.equal(primerMovimiento.folio, "10130");

  const deposito = r.movimientos.find((m) => m.abonoTotal === 98241.93)!;
  assert.ok(deposito, "debe existir el SPEI recibido de 98,241.93");
  assert.equal(deposito.cargoTotal, null);
  assert.equal(deposito.saldo, 2100731.34);
});

test('el monto embebido "IVA:" (con o sin salto de línea antes del número) se elimina de la descripción y no se cuenta como un tercer monto del renglón', () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ERGODINOVA_DETALLE_AGOSTO_2026, "7022");
  assert.equal(r.erroresPorFila.length, 0);
  // El primer movimiento trae "IVA:\n000000000055.17" (IVA con salto de
  // línea antes del número) dentro de su descripción -- debe desaparecer
  // por completo, no dejar el monto suelto como un tercer monto del renglón.
  const primerMovimiento = r.movimientos[0];
  assert.doesNotMatch(primerMovimiento.nombreRazonSocial ?? "", /IVA/);
  assert.doesNotMatch(primerMovimiento.nombreRazonSocial ?? "", /055\.17/);
  assert.match(primerMovimiento.nombreRazonSocial ?? "", /RFC: AUSD881130R6A/);
});

test("una descripción partida en varias líneas se concatena en un solo movimiento, no en varios", () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ERGODINOVA_DETALLE_AGOSTO_2026, "7022");
  // El último movimiento del documento es un traspaso a cuenta de terceros
  // cuya descripción real cruza 3 líneas de texto (concepto, "A LA CUENTA...",
  // RFC) antes de llegar a los montos -- debe concatenarse en un solo
  // movimiento, no partirse en varios.
  const traspaso = r.movimientos[r.movimientos.length - 1];
  assert.match(traspaso.nombreRazonSocial ?? "", /TRASPASO A CUENTA DE TERCEROS/);
  assert.match(traspaso.nombreRazonSocial ?? "", /A LA CUENTA/);
  assert.match(traspaso.nombreRazonSocial ?? "", /R\.F\.C/);
  assert.equal(traspaso.cargoTotal, 16488.21);
});

test("un PDF sin ninguno de los dos encabezados conocidos reporta errorDocumento genérico", () => {
  const r = parsearPdfEstadoCuentaBanorte("cualquier otro texto sin la tabla");
  assert.match(r.errorDocumento ?? "", /No se encontró la tabla de movimientos/);
});

test("si faltan 'Saldo Actual' o 'Total:' declarados, bloquea con un mensaje específico en vez de adivinar el saldo inicial", () => {
  const texto = [
    "Fecha Movimiento Cód. Trans. Concepto Retiros Depósitos Saldos Cheque",
    "03/Ago./2026 100 511 ALGO",
    "$400.00 $1,000.00",
  ].join("\n");
  const r = parsearPdfEstadoCuentaBanorte(texto);
  assert.equal(r.movimientos.length, 0);
  assert.match(r.errorDocumento ?? "", /saldo inicial del periodo/);
});
