import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearPdfEstadoCuentaBanorte } from "./pdf-estado-cuenta-banorte.ts";
import { TEXTO_REAL_BANORTE_ACEROS_JULIO_2026 } from "./pdf-estado-cuenta-banorte.fixture.ts";
import { TEXTO_REAL_BANORTE_SIN_MOVIMIENTOS_CSC_JULIO_2026 } from "./pdf-estado-cuenta-banorte-sin-movimientos.fixture.ts";
import { TEXTO_REAL_BANORTE_ACEROS_AGOSTO_2026_CUENTA_CHEQUES } from "./pdf-estado-cuenta-banorte-cuenta-cheques.fixture.ts";

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

function textoConDosProductosConMovimientos(): string {
  return [
    "RESUMEN INTEGRAL",
    "Producto No. de Cuenta CLABE Saldo anterior Saldo al corte",
    "ENLACE NEGOCIOS BASICA 1155651273 072 650 01155651273 6 $100.00 $150.00",
    "INVERSION ENLACE NEGOCIOS 1155652515 072 650 01155652515 0 $500.00 $530.00",
    "TOTAL $600.00 $680.00",
    "Enlace Negocios Basica",
    "FECHA DESCRIPCIÓN / ESTABLECIMIENTO MONTO DEL DEPOSITO MONTO DEL RETIRO SALDO",
    "30-JUN-26 SALDO ANTERIOR 100.00",
    "01-JUL-26 DEPOSITO 50.00 150.00",
    "INVERSION ENLACE NEGOCIOS",
    "FECHA DESCRIPCIÓN / ESTABLECIMIENTO MONTO DEL DEPOSITO MONTO DEL RETIRO SALDO",
    "30-JUN-26 SALDO ANTERIOR 500.00",
    "01-JUL-26 RENDIMIENTO 30.00 530.00",
    "OTROS▼",
  ].join("\n");
}

test("con el número de cuenta de la cuenta principal, elige la tabla del primer producto e ignora la del segundo", () => {
  const r = parsearPdfEstadoCuentaBanorte(textoConDosProductosConMovimientos(), "1273");
  assert.equal(r.errorDocumento, null);
  assert.equal(r.movimientos.length, 1);
  assert.equal(r.movimientos[0].abonoTotal, 50);
  assert.equal(r.movimientos[0].saldo, 150);
});

test("con el número de cuenta de la inversión, elige la tabla del segundo producto e ignora la del primero", () => {
  const r = parsearPdfEstadoCuentaBanorte(textoConDosProductosConMovimientos(), "2515");
  assert.equal(r.errorDocumento, null);
  assert.equal(r.movimientos.length, 1);
  assert.equal(r.movimientos[0].abonoTotal, 30);
  assert.equal(r.movimientos[0].nombreRazonSocial, "RENDIMIENTO");
  assert.equal(r.movimientos[0].saldo, 530);
});

test("si el número de cuenta no coincide con ningún producto del RESUMEN INTEGRAL, bloquea con un mensaje específico", () => {
  const r = parsearPdfEstadoCuentaBanorte(textoConDosProductosConMovimientos(), "9999");
  assert.equal(r.movimientos.length, 0);
  assert.match(r.errorDocumento ?? "", /terminación 9999/);
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

test('una cuenta sin movimientos en el periodo ("SALDO ANTERIOR ... SIN MOVIMIENTOS" sin otra fecha ancla que las separe) no bloquea el documento -- no hay nada que insertar, no es un error (caso real: Constructora Supervisión y Consultoría LOMA, cuenta Banorte 7529, julio 2026)', () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_SIN_MOVIMIENTOS_CSC_JULIO_2026, "7529");
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  assert.equal(r.movimientos.length, 0);
});

test('parsea el TERCER formato de Banorte -- "Cuentas de Cheques" detallado, con Depósitos/Retiros en columnas separadas (misma cuenta Aceros 1273, agosto 2026): 7 movimientos, cuadra exacto con OPERACIONES/TOTAL declarados y con Saldo Actual', () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ACEROS_AGOSTO_2026_CUENTA_CHEQUES, "1273");
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  assert.equal(r.movimientos.length, 7);

  const depositos = r.movimientos.filter((m) => m.abonoTotal != null);
  const retiros = r.movimientos.filter((m) => m.cargoTotal != null);
  assert.equal(depositos.length, 2);
  assert.equal(retiros.length, 5);

  const sumaDepositos = Math.round(depositos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;
  const sumaRetiros = Math.round(retiros.reduce((a, m) => a + (m.cargoTotal ?? 0), 0) * 100) / 100;
  assert.equal(sumaDepositos, 86592.69);
  assert.equal(sumaRetiros, 87687.87);

  const primero = r.movimientos[0];
  assert.equal(primero.fechaPago, "2026-08-14");
  assert.equal(primero.abonoTotal, 39176.43);
  assert.equal(primero.folio, "657");

  const ultimo = r.movimientos[r.movimientos.length - 1];
  assert.equal(ultimo.fechaPago, "2026-08-31");
  assert.equal(ultimo.saldo, 2678.68);
  // El último movimiento no debe arrastrar el pie de página ("DEPÓSITOS
  // RETIROS OPERACIONES:... TOTAL:...") en su descripción.
  assert.doesNotMatch(ultimo.nombreRazonSocial ?? "", /OPERACIONES|TOTAL:/);
});

test('en el TERCER formato de Banorte, "Final Mes Anterior"/"Inicial del día" declarados NO se usan para autovalidar (son iguales al Saldo Actual final, no al saldo antes de los movimientos) -- la cadena de saldos y los totales de Depósitos/Retiros ya dan suficiente confianza', () => {
  // Confirmado con el PDF real: "Final Mes Anterior: $2,678.68" (== Saldo
  // Actual al final), pero el saldo ANTES del primer movimiento que sí
  // reconstruye la cadena interna es $3,773.86 -- si este parser validara
  // contra "Final Mes Anterior" bloquearía un documento perfectamente bien
  // leído. Esta prueba confirma que NO se bloquea.
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ACEROS_AGOSTO_2026_CUENTA_CHEQUES, "1273");
  assert.equal(r.errorDocumento, null);
});

test('en el TERCER formato de Banorte, un número de cuenta que no termina en cuentaUltimos4 bloquea el documento', () => {
  const r = parsearPdfEstadoCuentaBanorte(TEXTO_REAL_BANORTE_ACEROS_AGOSTO_2026_CUENTA_CHEQUES, "9999");
  assert.equal(r.movimientos.length, 0);
  assert.match(r.errorDocumento ?? "", /terminación 1273/);
});

test('en el TERCER formato de Banorte, si el saldo declarado (Saldo Actual) no cuadra con el último movimiento extraído, bloquea todo el documento', () => {
  const texto = [
    "TRANSAC SUCURSAL DEPÓSITOS RETIROS SALDO MOVIMIENTO DESCRIPCIÓN DETALLADA CHEQUE",
    "1155651273 01/08/2026 01/08/2026 0000000000 DEPOSITO 003 5663 $100.00 - $100.00 1",
    "-",
    "Saldo Actual: $999.00 MXP",
    "OPERACIONES: 1 0",
    "TOTAL: $100.00 $0.00",
  ].join("\n");
  const r = parsearPdfEstadoCuentaBanorte(texto);
  assert.equal(r.movimientos.length, 0);
  assert.match(r.errorDocumento ?? "", /Saldo Actual.*999/);
});
