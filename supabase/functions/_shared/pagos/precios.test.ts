// Pruebas del cálculo de precio por usuario con escalones de volumen. Los
// números son los del plan real: 1-4 a $1,500, 5-9 a $1,300, 10-19 a $1,100,
// 20+ a $900 (en centavos).
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularCobro, costoDeAgregarUsuario } from "./precios.ts";
import type { Escalon } from "./precios.ts";

const ESCALONES: Escalon[] = [
  { desdeUsuarios: 1, precioUnitarioCentavos: 150000 },
  { desdeUsuarios: 5, precioUnitarioCentavos: 130000 },
  { desdeUsuarios: 10, precioUnitarioCentavos: 110000 },
  { desdeUsuarios: 20, precioUnitarioCentavos: 90000 },
];

test("dentro del primer escalón se cobra el precio de lista por cada usuario", () => {
  const cobro = calcularCobro(ESCALONES, 3);
  assert.equal(cobro.precioUnitarioCentavos, 150000);
  assert.equal(cobro.totalCentavos, 450000); // $4,500
  assert.equal(cobro.escalonDesde, 1);
});

test("al llegar al paquete, el precio bajo aplica a TODOS los usuarios", () => {
  const cobro = calcularCobro(ESCALONES, 5);
  assert.equal(cobro.precioUnitarioCentavos, 130000);
  assert.equal(cobro.totalCentavos, 650000, "5 × $1,300, no 4 × $1,500 + 1 × $1,300");
});

test("cada escalón toma el precio del último umbral alcanzado", () => {
  assert.equal(calcularCobro(ESCALONES, 9).precioUnitarioCentavos, 130000);
  assert.equal(calcularCobro(ESCALONES, 10).precioUnitarioCentavos, 110000);
  assert.equal(calcularCobro(ESCALONES, 19).precioUnitarioCentavos, 110000);
  assert.equal(calcularCobro(ESCALONES, 20).precioUnitarioCentavos, 90000);
  assert.equal(calcularCobro(ESCALONES, 500).precioUnitarioCentavos, 90000);
});

test("cero usuarios cotiza al precio de lista pero no cobra nada", () => {
  const cobro = calcularCobro(ESCALONES, 0);
  assert.equal(cobro.precioUnitarioCentavos, 150000);
  assert.equal(cobro.totalCentavos, 0);
});

test("dice cuánto falta para el siguiente escalón, y nada al llegar al último", () => {
  const cobro = calcularCobro(ESCALONES, 3);
  assert.deepEqual(cobro.siguienteEscalon, { faltanUsuarios: 2, precioUnitarioCentavos: 130000 });
  assert.equal(calcularCobro(ESCALONES, 25).siguienteEscalon, null);
});

test("el escalón no depende del orden en que vengan configurados", () => {
  const desordenados = [...ESCALONES].reverse();
  assert.equal(calcularCobro(desordenados, 12).precioUnitarioCentavos, 110000);
});

test("agregar un usuario dentro del escalón cuesta el precio unitario", () => {
  assert.equal(costoDeAgregarUsuario(ESCALONES, 2), 150000);
});

test("el usuario que cruza al paquete cuesta menos que uno normal", () => {
  // 4 × $1,500 = $6,000 → 5 × $1,300 = $6,500: el quinto usuario cuesta $500,
  // no $1,300. Es el número que hay que enseñar antes de darlo de alta.
  assert.equal(costoDeAgregarUsuario(ESCALONES, 4), 50000);
});

test("un plan sin escalones es un error de configuración, no un cobro de cero", () => {
  assert.throws(() => calcularCobro([], 3), /escalones/);
});
