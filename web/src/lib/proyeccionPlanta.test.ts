import { test } from "node:test";
import assert from "node:assert/strict";
import { diasVacacionesLFT, festivosLFT, proyeccionAnual, ritmoPlanta, totalProyeccion, type SupuestosProyeccion } from "./proyeccionPlanta.ts";

test("festivos de ley 2027 y el 1 de octubre cada 6 años", () => {
  assert.deepEqual(festivosLFT(2027), ["2027-01-01", "2027-02-01", "2027-03-15", "2027-05-01", "2027-09-16", "2027-11-15", "2027-12-25"]);
  assert.ok(festivosLFT(2030).includes("2030-10-01"));
  assert.ok(!festivosLFT(2026).includes("2026-10-01"));
});

test("vacaciones LFT por antigüedad", () => {
  assert.equal(diasVacacionesLFT(0), 0);
  assert.equal(diasVacacionesLFT(1), 12);
  assert.equal(diasVacacionesLFT(3), 16);
  assert.equal(diasVacacionesLFT(5), 20);
  assert.equal(diasVacacionesLFT(6), 22);
  assert.equal(diasVacacionesLFT(10), 22);
  assert.equal(diasVacacionesLFT(11), 24);
});

const base: SupuestosProyeccion = {
  desde: "2026-10-12",
  precioVenta: 1500,
  pctVenta: 100,
  mpPieza: 1200,
  piezasPorDia: 5,
  nominaSemanal: 11800,
  indirectosMes: 20000,
  semanasCierre: 1,
  diasVacacionesSinIngreso: 12,
};

test("doce meses, festivos, cierre de diciembre y nómina completa", () => {
  const meses = proyeccionAnual([], [], base);
  assert.equal(meses.length, 13); // oct-2026 parcial … oct-2027 parcial
  const dic = meses.find((m) => m.mes === "2026-12")!;
  assert.equal(dic.festivos, 1);
  assert.equal(dic.cierre, 6);
  const t = totalProyeccion(meses);
  // Nómina de 365 días aunque haya festivos y vacaciones.
  assert.equal(Math.round(t.nomina), Math.round((11800 * 365) / 7));
  assert.equal(Math.round(t.indirectos), 240000);
});

test("vacaciones en el mes del aniversario y lote programado", () => {
  const personas = [
    { nombre: "A", pago_semanal: 3600, ingreso: "2023-12-18" },
    { nombre: "B", pago_semanal: 2600, ingreso: null },
  ];
  const lotes = [{ folio: "002", estado: "planeada", inicio: "2026-10-14", fin: null, dias: 7, cantidad: 37 }];
  const meses = proyeccionAnual(lotes, personas, base);
  const oct = meses[0];
  assert.equal(oct.piezasProgramadas, 37);
  // A cumple 3 años en dic-2026: 16 días ÷ 2 personas = 8 días-planta.
  const dic = meses.find((m) => m.mes === "2026-12")!;
  assert.ok(dic.vacaciones >= 8 && dic.vacaciones < 8.6);
  assert.ok(oct.productivos > 0 && oct.piezas > 37);
});

test("ritmo de la planta con días planeados", () => {
  assert.equal(
    ritmoPlanta([
      { folio: "1", estado: "terminada", inicio: "2026-09-25", fin: null, dias: 14, cantidad: 74 },
      { folio: "2", estado: "planeada", inicio: "2026-10-14", fin: null, dias: 7, cantidad: 37 },
    ]),
    5.29,
  );
  assert.equal(ritmoPlanta([]), null);
});
