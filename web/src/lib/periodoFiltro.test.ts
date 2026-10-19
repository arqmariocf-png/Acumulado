import { test } from "node:test";
import assert from "node:assert/strict";
import { etiquetaPeriodo, moverPeriodo, rangoPeriodo } from "./periodoFiltro.ts";

test("rango por día, semana (lunes a domingo) y mes", () => {
  assert.equal(rangoPeriodo("todo", "2026-10-20"), null);
  assert.deepEqual(rangoPeriodo("dia", "2026-10-20"), { desde: "2026-10-20", hasta: "2026-10-20" });
  assert.deepEqual(rangoPeriodo("semana", "2026-10-20"), { desde: "2026-10-19", hasta: "2026-10-25" }); // martes
  assert.deepEqual(rangoPeriodo("semana", "2026-10-25"), { desde: "2026-10-19", hasta: "2026-10-25" }); // domingo
  assert.deepEqual(rangoPeriodo("mes", "2026-02-14"), { desde: "2026-02-01", hasta: "2026-02-28" });
  assert.deepEqual(rangoPeriodo("mes", "2026-12-31"), { desde: "2026-12-01", hasta: "2026-12-31" });
});

test("mover hacia atrás y adelante", () => {
  assert.equal(moverPeriodo("dia", "2026-10-01", -1), "2026-09-30");
  assert.equal(moverPeriodo("semana", "2026-10-20", 1), "2026-10-27");
  assert.equal(moverPeriodo("mes", "2026-01-31", -1), "2025-12-01");
  assert.equal(moverPeriodo("mes", "2026-12-15", 1), "2027-01-01");
});

test("etiqueta corta", () => {
  assert.equal(etiquetaPeriodo("dia", "2026-10-20"), "20 oct 2026");
  assert.equal(etiquetaPeriodo("semana", "2026-10-20"), "19–25 oct 2026");
  assert.equal(etiquetaPeriodo("semana", "2026-09-30"), "28 sep – 4 oct 2026");
  assert.equal(etiquetaPeriodo("mes", "2026-10-20"), "oct 2026");
  assert.equal(etiquetaPeriodo("todo", "2026-10-20"), "todas las fechas");
});
