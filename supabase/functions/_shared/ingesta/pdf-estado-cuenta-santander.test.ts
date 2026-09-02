import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearPdfEstadoCuentaSantander } from "./pdf-estado-cuenta-santander.ts";
import { TEXTO_REAL_SANTANDER_BALKEN_JULIO_2026 } from "./pdf-estado-cuenta-santander.fixture.ts";
import { TEXTO_REAL_SANTANDER_CONSULTA_BALKEN_AGOSTO_2026 } from "./pdf-estado-cuenta-santander-consulta.fixture.ts";

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

test('parsea el SEGUNDO formato de Santander -- "Consulta de Movimientos de la Cuenta de Cheques" (misma cuenta Balken 8617, agosto 2026): 15 movimientos, cuadra exacto con Número/Importe Total de Abonos y Cargos, y con Saldo Final', () => {
  const r = parsearPdfEstadoCuentaSantander(TEXTO_REAL_SANTANDER_CONSULTA_BALKEN_AGOSTO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  assert.equal(r.movimientos.length, 15);

  const cargos = r.movimientos.filter((m) => m.cargoTotal != null);
  const abonos = r.movimientos.filter((m) => m.abonoTotal != null);
  assert.equal(cargos.length, 9);
  assert.equal(abonos.length, 6);

  const sumaCargos = Math.round(cargos.reduce((a, m) => a + (m.cargoTotal ?? 0), 0) * 100) / 100;
  const sumaAbonos = Math.round(abonos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;
  assert.equal(sumaCargos, 76649.34);
  assert.equal(sumaAbonos, 66568.65);

  // Los movimientos vienen en orden cronológico ASCENDENTE (más antiguo
  // primero) -- a diferencia del formato "Cuenta de cheques".
  const primero = r.movimientos[0];
  assert.equal(primero.fechaPago, "2026-08-03");
  assert.equal(primero.abonoTotal, 488.4);
  assert.equal(primero.saldo, 12359.29);

  const ultimo = r.movimientos[r.movimientos.length - 1];
  assert.equal(ultimo.fechaPago, "2026-08-31");
  assert.equal(ultimo.saldo, 1790.2);
});

test('en el formato "Consulta de Movimientos", la fecha DDMMAAAA partida por unpdf en dos líneas (ej. "03082\\n026") se reconstruye a ISO sin perder ningún movimiento entre páginas', () => {
  const r = parsearPdfEstadoCuentaSantander(TEXTO_REAL_SANTANDER_CONSULTA_BALKEN_AGOSTO_2026);
  const fechas = r.movimientos.map((m) => m.fechaPago);
  assert.ok(fechas.every((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)));
  // Movimientos de la página 2 (26-ago y 31-ago) deben seguir presentes --
  // el pie de página + encabezado repetido entre páginas no debe cortar la
  // tabla a la mitad.
  assert.ok(fechas.includes("2026-08-26"));
  assert.ok(fechas.includes("2026-08-31"));
});
