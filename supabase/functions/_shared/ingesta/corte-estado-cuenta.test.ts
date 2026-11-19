import { test } from "node:test";
import assert from "node:assert/strict";
import { acotarCorte, extraerCorteEstadoCuenta, hoyMexicoIso } from "./corte-estado-cuenta.ts";
import { TEXTO_REAL_BANBAJIO_CONECTA_MALLAS_AGOSTO_2026 } from "./pdf-estado-cuenta-banbajio-conecta.fixture.ts";
import { TEXTO_REAL_SANTANDER_BALKEN_JULIO_2026 } from "./pdf-estado-cuenta-santander.fixture.ts";

test("BBVA oficial: DEL … AL y Fecha de Corte", () => {
  assert.equal(extraerCorteEstadoCuenta("Periodo DEL 01/07/2026 AL 31/07/2026 No. de Cuenta"), "2026-07-31");
  assert.equal(extraerCorteEstadoCuenta("Fecha de Corte 17/11/2026 No. de Cuenta 0123"), "2026-11-17");
  assert.equal(extraerCorteEstadoCuenta("Periodo: Mes anterior, con Todos los montos FECHA DESCRIPCIÓN"), null, "la app no declara fecha");
});

test("Banorte: mensual y Detalle de Movimientos (fecha de generación manda)", () => {
  assert.equal(extraerCorteEstadoCuenta("Fecha de corte 31/Octubre/2026 Periodo Del 01/Octubre/2026 al 31/Octubre/2026"), "2026-10-31");
  assert.equal(extraerCorteEstadoCuenta("Saldo Inicial del Día: $18,695.72 Fecha Inicial: 01/08/2026 Final: 25/08/2026 Fecha Último Acceso: 25/08/2026 11:15 a. m."), "2026-08-25");
  assert.equal(extraerCorteEstadoCuenta("Tiene 90 días naturales contados a partir de la fecha de corte o de la realización"), null);
});

test("Santander: mensual y consulta", () => {
  assert.equal(extraerCorteEstadoCuenta(TEXTO_REAL_SANTANDER_BALKEN_JULIO_2026), "2026-07-31");
  assert.equal(extraerCorteEstadoCuenta("Consulta de Movimientos de la Cuenta de Cheques Periodo: 03/08/2026 al 31/08/2026"), "2026-08-31");
});

test("BanBajío: clásico y Conecta (generado antes del fin de periodo)", () => {
  assert.equal(extraerCorteEstadoCuenta("PERIODO: 1 DE JULIO AL 31 DE JULIO DE 2026 FECHA DE CORTE 31 JULIO 2026"), "2026-07-31");
  assert.equal(extraerCorteEstadoCuenta(TEXTO_REAL_BANBAJIO_CONECTA_MALLAS_AGOSTO_2026), "2026-08-25");
  assert.equal(extraerCorteEstadoCuenta("Generado el 17-Nov-2026, 16:20:01 horas Fechas 01-Nov-2026 al 30-Nov-2026"), "2026-11-17");
});

test("acotarCorte: ni después de hoy ni antes del último movimiento del archivo", () => {
  assert.equal(acotarCorte("2026-11-17", "2026-11-13", "2026-11-19"), "2026-11-17");
  assert.equal(acotarCorte("2026-11-30", "2026-11-13", "2026-11-19"), "2026-11-19", "el periodo completo se corta en hoy");
  assert.equal(acotarCorte(null, "2026-11-13", "2026-11-19"), "2026-11-13", "sin corte declarado, el último movimiento");
  assert.equal(acotarCorte("2026-11-10", "2026-11-13", "2026-11-19"), "2026-11-13", "nunca antes del último movimiento");
  assert.equal(acotarCorte(null, null, "2026-11-19"), null);
  assert.equal(hoyMexicoIso(new Date("2026-11-19T03:00:00Z")), "2026-11-18");
});
