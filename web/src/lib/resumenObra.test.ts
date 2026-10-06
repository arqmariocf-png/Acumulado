import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularResumenObra, semaforoDesfase } from "./resumenObra.ts";

test("financiero contra físico", () => {
  const r = calcularResumenObra({ presupuesto: 130000, materiales: 54142.18, nomina: 54600, tarjetas: 4, hechas: 1, requisiciones: [], pu: [] });
  assert.equal(Math.round(r.ejercido), 108742);
  assert.equal(Math.round(r.avanceFinanciero!), 84);
  assert.equal(r.avanceTareas, 25);
  assert.equal(r.avanceSuministro, null);
  assert.equal(r.avanceFisico, 25);
  assert.equal(Math.round(r.desfase!), 59);
  assert.equal(semaforoDesfase(r, 130000), "rojo");
});

test("sin presupuesto no hay financiero ni desfase", () => {
  const r = calcularResumenObra({ presupuesto: 0, materiales: 0, nomina: 0, tarjetas: 7, hechas: 0, requisiciones: [], pu: [] });
  assert.equal(r.avanceFinanciero, null);
  assert.equal(r.desfase, null);
  assert.equal(semaforoDesfase(r, 0), "gris");
});

test("rebasar el presupuesto es rojo aunque el avance vaya bien", () => {
  const r = calcularResumenObra({ presupuesto: 100, materiales: 120, nomina: 0, tarjetas: 1, hechas: 1, requisiciones: [], pu: [] });
  assert.equal(semaforoDesfase(r, 100), "rojo");
});
