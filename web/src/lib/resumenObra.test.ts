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

test("OC y mano de obra del backoffice cuentan como ejercido (Parque Real 63)", () => {
  const r = calcularResumenObra({ presupuesto: 0, materiales: 0, nomina: 0, oc: 594865.81, manoObra: 314369.71, tarjetas: 8, hechas: 1, requisiciones: [], pu: [] });
  assert.equal(Math.round(r.ejercido), 909236);
  assert.deepEqual(r.desglose, { compras: 0, oc: 594865.81, manoObra: 314369.71, manoObraDe: "api" });
  assert.equal(r.avanceFinanciero, null); // sin presupuesto capturado
  const conPresupuesto = calcularResumenObra({ presupuesto: 2000000, materiales: 10000, nomina: 50000, oc: 590000, manoObra: 400000, tarjetas: 8, hechas: 4, requisiciones: [], pu: [] });
  // La nómina capturada no se suma si ya llega la pagada por la API.
  assert.equal(conPresupuesto.ejercido, 1000000);
  assert.equal(conPresupuesto.avanceFinanciero, 50);
  assert.equal(conPresupuesto.desfase, 0);
  const sinApi = calcularResumenObra({ presupuesto: 100, materiales: 10, nomina: 20, oc: 30, tarjetas: 0, hechas: 0, requisiciones: [], pu: [] });
  assert.equal(sinApi.ejercido, 60);
  assert.equal(sinApi.desglose.manoObraDe, "captura");
});
