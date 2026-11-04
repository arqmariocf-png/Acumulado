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

const TABLA_SIN_TOTALES = [
  "Fecha Movimiento Cód. Trans. Concepto Retiros Depósitos Saldos Cheque",
  "03/Nov./2026 100 511 COMPRA ORDEN DE PAGO SPEI OC 1",
  "$400.00 $1,000.00",
  "03/Nov./2026 101 523 DEPOSITO SPEI CLIENTE",
  "$250.00 $1,250.00",
  "Exportar Imprimir",
];

test("sin 'Saldo Actual' ni 'Total:' y sin saldo previo conocido, bloquea explicando qué faltó (no adivina el saldo inicial)", () => {
  const r = parsearPdfEstadoCuentaBanorte(TABLA_SIN_TOTALES.join("\n"));
  assert.equal(r.movimientos.length, 0);
  assert.match(r.errorDocumento ?? "", /No se pudo determinar el saldo inicial del periodo/);
  assert.match(r.errorDocumento ?? "", /'Saldo Actual:' y la fila 'Total/);
  assert.match(r.errorDocumento ?? "", /no tiene movimientos cargados/);
});

test("sin totales declarados, el último saldo cargado de la cuenta decide si el primer movimiento fue retiro (caso Ergodinova 3-nov-2026)", () => {
  // Último saldo en la base 1,400.00 -> el primer renglón ($400 → $1,000) fue retiro.
  const r = parsearPdfEstadoCuentaBanorte(TABLA_SIN_TOTALES.join("\n"), "7022", { saldo: 1400, fecha: "2026-10-30" });
  assert.equal(r.errorDocumento, null);
  assert.equal(r.movimientos.length, 2);
  assert.equal(r.movimientos[0].cargoTotal, 400);
  assert.equal(r.movimientos[0].abonoTotal, null);
  assert.equal(r.movimientos[0].saldo, 1000);
  assert.equal(r.movimientos[1].abonoTotal, 250);
  assert.equal(r.movimientos[1].saldo, 1250);
  assert.match(r.movimientos[0].observacion ?? "", /sin fila Total; saldo inicial tomado de el último saldo ya cargado de la cuenta \(1400 al 2026-10-30\)/);
});

test("sin totales declarados, el último saldo cargado también puede decir que el primer movimiento fue depósito", () => {
  const r = parsearPdfEstadoCuentaBanorte(TABLA_SIN_TOTALES.join("\n"), undefined, { saldo: 600, fecha: "2026-10-30" });
  assert.equal(r.errorDocumento, null);
  assert.equal(r.movimientos[0].abonoTotal, 400);
  assert.equal(r.movimientos[0].cargoTotal, null);
});

test("sin totales, el 'Saldo Inicial del Día' del encabezado ancla el primer movimiento antes que el saldo de la base", () => {
  const texto = ["1138867022 | 2203-SUCURSAL PUEBLA REFORMA | 15/Ene./2021 Saldo Inicial del Día: $1,400.00", ...TABLA_SIN_TOTALES].join("\n");
  // El saldo de la base no empata (hay movimientos de por medio), el del encabezado sí.
  const r = parsearPdfEstadoCuentaBanorte(texto, "7022", { saldo: 999, fecha: "2026-10-28" });
  assert.equal(r.errorDocumento, null);
  assert.equal(r.movimientos[0].cargoTotal, 400);
  assert.match(r.movimientos[0].observacion ?? "", /Saldo Inicial del Día/);
});

test("sin totales y con un saldo previo que no empata con el primer movimiento, bloquea y dice los dos saldos posibles", () => {
  const r = parsearPdfEstadoCuentaBanorte(TABLA_SIN_TOTALES.join("\n"), undefined, { saldo: 999, fecha: "2026-10-28" });
  assert.equal(r.movimientos.length, 0);
  assert.match(r.errorDocumento ?? "", /999 al 2026-10-28/);
  assert.match(r.errorDocumento ?? "", /tendría que venir de 600 o de 1400/);
});

test("con 'Saldo Actual' pero sin 'Total:', valida el final de la cadena contra el Saldo Actual", () => {
  const ok = parsearPdfEstadoCuentaBanorte(["Saldo Actual: $1,250.00", ...TABLA_SIN_TOTALES].join("\n"), undefined, { saldo: 1400, fecha: "2026-10-30" });
  assert.equal(ok.errorDocumento, null);
  assert.equal(ok.movimientos.length, 2);
  const mal = parsearPdfEstadoCuentaBanorte(["Saldo Actual: $9,999.00", ...TABLA_SIN_TOTALES].join("\n"), undefined, { saldo: 1400, fecha: "2026-10-30" });
  assert.match(mal.errorDocumento ?? "", /declara un Saldo Actual de 9999/);
});

test("la fila 'Total:' pegada al final del último renglón (misma línea) también se reconoce", () => {
  const texto = [
    "Saldo Actual: $1,250.00",
    "Fecha Movimiento Cód. Trans. Concepto Retiros Depósitos Saldos Cheque",
    "03/Nov./2026 100 511 COMPRA ORDEN DE PAGO SPEI OC 1",
    "$400.00 $1,000.00",
    "03/Nov./2026 101 523 DEPOSITO SPEI CLIENTE $250.00 $1,250.00 Total: $400.00 $250.00",
  ].join("\n");
  const r = parsearPdfEstadoCuentaBanorte(texto);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.movimientos.length, 2);
  assert.equal(r.movimientos[0].cargoTotal, 400);
  assert.equal(r.movimientos[1].abonoTotal, 250);
  assert.match(r.movimientos[1].nombreRazonSocial ?? "", /^DEPOSITO SPEI CLIENTE$/);
});

test("un PDF del formato Detalle sin ningún movimiento avisa que no hay nada que cargar y cuál es el último saldo", () => {
  const texto = ["Saldo Actual: $1,000.00", "Fecha Movimiento Cód. Trans. Concepto Retiros Depósitos Saldos Cheque", "Exportar Imprimir"].join("\n");
  const r = parsearPdfEstadoCuentaBanorte(texto, undefined, { saldo: 1000, fecha: "2026-10-30" });
  assert.equal(r.movimientos.length, 0);
  assert.match(r.errorDocumento ?? "", /no trae ningún movimiento en el periodo/);
  assert.match(r.errorDocumento ?? "", /1000 al 2026-10-30/);
});
