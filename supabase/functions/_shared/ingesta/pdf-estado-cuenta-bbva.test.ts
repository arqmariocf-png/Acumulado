import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearPdfEstadoCuentaBBVA } from "./pdf-estado-cuenta-bbva.ts";
import { TEXTO_REAL_ESTADO_CUENTA_ACEROS_BBVA_JULIO_2026 } from "./pdf-estado-cuenta-bbva.fixture.ts";

test("parsea el PDF real de BBVA (Aceros, julio 2026): 139 filas, 138 clasificadas, 1 pendiente (la más antigua)", () => {
  const r = parsearPdfEstadoCuentaBBVA(TEXTO_REAL_ESTADO_CUENTA_ACEROS_BBVA_JULIO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.movimientos.length, 138);
  assert.equal(r.erroresPorFila.length, 1);
  assert.match(r.erroresPorFila[0].errores[0], /transacción más antigua/);
});

test("clasifica correctamente cargo vs abono usando el delta de saldo contra la fila cronológicamente anterior", () => {
  const r = parsearPdfEstadoCuentaBBVA(TEXTO_REAL_ESTADO_CUENTA_ACEROS_BBVA_JULIO_2026);

  const nomina = r.movimientos.find((m) => m.nombreRazonSocial?.includes("PAGO DE NOMINA"))!;
  assert.equal(nomina.cargoTotal, 9070.14);
  assert.equal(nomina.abonoTotal, null);
  assert.equal(nomina.fechaPago, "2026-07-31");

  const spei = r.movimientos.find((m) => m.nombreRazonSocial?.includes("PAGO ERGODINOVA") && m.saldo === 177146.15)!;
  assert.equal(spei.abonoTotal, 174047.33);
  assert.equal(spei.cargoTotal, null);
});

test('el desglose de "IVA:X.XX" embebido en la descripción no se cuenta como un monto de la fila', () => {
  const r = parsearPdfEstadoCuentaBBVA(TEXTO_REAL_ESTADO_CUENTA_ACEROS_BBVA_JULIO_2026);
  // Fila real: "PAGO CUENTA DE TERCERO/ 0024332015 RFC:VPU860913EB0 IVA:827.59 6,000.00" -> saldo 170,251.67
  const fila = r.movimientos.find((m) => m.saldo === 170251.67)!;
  assert.ok(fila, "la fila debe existir");
  assert.equal(fila.cargoTotal ?? fila.abonoTotal, 6000);
});

test("las fechas DD-MM-AAAA de cada fila se convierten a ISO sin depender de un encabezado de periodo aparte", () => {
  const r = parsearPdfEstadoCuentaBBVA(TEXTO_REAL_ESTADO_CUENTA_ACEROS_BBVA_JULIO_2026);
  assert.ok(r.movimientos.every((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.fechaPago)));
  // 1 de julio es la fila más antigua del archivo -- queda en erroresPorFila
  // (no se puede clasificar cargo/abono), no en movimientos.
  assert.ok(r.movimientos.some((m) => m.fechaPago === "2026-07-02"));
  assert.ok(r.movimientos.some((m) => m.fechaPago === "2026-07-31"));
});

test("un PDF sin filas con fecha DD-MM-AAAA reporta errorDocumento en vez de reventar", () => {
  const r = parsearPdfEstadoCuentaBBVA("cualquier otro texto sin esa estructura");
  assert.match(r.errorDocumento ?? "", /No se encontraron filas/);
});
