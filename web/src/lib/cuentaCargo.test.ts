import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPorCuenta, cuentaSugerida, necesitaCuenta, quedaEnCuenta, revisarCuentaCargo, textoCuenta } from "./cuentaCargo.ts";

const cuentas = [
  { id: "c1", empresa_id: "aep", banco: "BBVA", ultimos_4: "5859", alias: "Principal" },
  { id: "c2", empresa_id: "aep", banco: "Banorte", ultimos_4: "1273", alias: null },
  { id: "c3", empresa_id: "csc", banco: "BBVA", ultimos_4: "6448", alias: null },
];

test("texto de la cuenta y cuándo hace falta", () => {
  assert.equal(textoCuenta(cuentas[0]), "BBVA 5859 · Principal");
  assert.equal(textoCuenta(cuentas[1]), "Banorte 1273");
  assert.equal(textoCuenta(null), "");
  assert.equal(necesitaCuenta("transferencia"), true);
  assert.equal(necesitaCuenta("cheque"), true);
  assert.equal(necesitaCuenta("efectivo"), false);
  assert.match(revisarCuentaCargo("transferencia", "") ?? "", /Elige la cuenta/);
  assert.match(revisarCuentaCargo("credito", null) ?? "", /tesorería/);
  assert.equal(revisarCuentaCargo("contado", "c1"), null);
  assert.equal(revisarCuentaCargo("efectivo", null), null);
});

test("cuenta sugerida: la única, o la última usada si sigue activa", () => {
  assert.equal(cuentaSugerida([cuentas[2]], null), "c3");
  assert.equal(cuentaSugerida(cuentas.slice(0, 2), "c2"), "c2");
  assert.equal(cuentaSugerida(cuentas.slice(0, 2), "c3"), "");
  assert.equal(cuentaSugerida(cuentas.slice(0, 2), null), "");
  assert.equal(cuentaSugerida([], "c1"), "");
});

test("agrupa los pendientes por cuenta y aparta los que no tienen", () => {
  const pagos = [
    { id: "p1", empresa_id: "aep", cuenta_id: "c1", monto: 100, metodo: "transferencia" as const, estatus: "pendiente" as const, fecha_programada: "2026-11-09" },
    { id: "p2", empresa_id: "aep", cuenta_id: "c1", monto: 50.5, metodo: "cheque" as const, estatus: "pendiente" as const, fecha_programada: "2026-11-09" },
    { id: "p3", empresa_id: "aep", cuenta_id: null, monto: 200, metodo: "transferencia" as const, estatus: "pendiente" as const, fecha_programada: "2026-11-09" },
    { id: "p4", empresa_id: "csc", cuenta_id: null, monto: 300, metodo: "efectivo" as const, estatus: "pendiente" as const, fecha_programada: "2026-11-09" },
    { id: "p5", empresa_id: "csc", cuenta_id: "c3", monto: 10, metodo: "transferencia" as const, estatus: "pagado" as const, fecha_programada: "2026-11-09" },
    { id: "p6", empresa_id: "csc", cuenta_id: "zz", monto: 7, metodo: "transferencia" as const, estatus: "pendiente" as const, fecha_programada: "2026-11-09" },
  ];
  const r = agruparPorCuenta(pagos, cuentas);
  assert.equal(r.grupos.length, 1);
  assert.equal(r.grupos[0].cuenta?.id, "c1");
  assert.equal(r.grupos[0].n, 2);
  assert.equal(r.grupos[0].total, 150.5);
  // p3 (sin cuenta) y p6 (cuenta que ya no existe) quedan como "sin cuenta", por empresa.
  assert.deepEqual(r.sinCuenta.map((g) => [g.empresa_id, g.n, g.total]), [["aep", 1, 200], ["csc", 1, 7]]);
  assert.equal(r.total, 357.5);
});

test("lo que queda en la cuenta después de lo programado", () => {
  assert.equal(quedaEnCuenta(1000, 150.5), 849.5);
  assert.equal(quedaEnCuenta(100, 150), -50);
  assert.equal(quedaEnCuenta(null, 150), null);
});
