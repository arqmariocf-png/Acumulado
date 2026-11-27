import { test } from "node:test";
import assert from "node:assert/strict";
import { enPeriodoVolteo, lunes, movimientosVolteo, nombreMaterial, recuperacion, rubroDeGasto, serie, sumaPor, tipoDeOc, totales } from "./volteoTablero.ts";

const U = "u1";
const datos = {
  viajes: [
    { id: "v1", unidad_id: U, fecha: "2025-01-06", folio: "H-VJ-1", cliente: "Ventosa", destino: "Armería", material: "ARENA", cantidad: 1, unidad_medida: "viaje", viajes: 1, importe: 1250, estado: "terminado" },
    { id: "v2", unidad_id: U, fecha: "2025-01-08", folio: "H-VJ-2", cliente: "ERG", destino: "N77", material: "ESCOMBRO", cantidad: 2, unidad_medida: "viaje", viajes: 1, importe: 4500, estado: "terminado" },
    { id: "v3", unidad_id: U, fecha: "2025-01-09", folio: "x", cliente: "X", destino: null, material: "ARENA", cantidad: 1, unidad_medida: "viaje", viajes: 1, importe: 999, estado: "cancelado" },
    { id: "v4", unidad_id: "otra", fecha: "2025-01-09", folio: "y", cliente: "Y", destino: null, material: "ARENA", cantidad: 1, unidad_medida: "viaje", viajes: 1, importe: 777, estado: "terminado" },
  ],
  gastos: [
    { id: "g1", unidad_id: U, fecha: "2025-01-06", folio: "H-GU-1", tipo: "material", proveedor: "Tentle", descripcion: "ARENA", monto: 780 },
    { id: "g2", unidad_id: U, fecha: "2025-01-07", folio: "H-GU-2", tipo: "gasolina", proveedor: "Gasolinera", descripcion: null, monto: 1000 },
    { id: "g3", unidad_id: U, fecha: "2025-02-02", folio: "H-NOM-1", tipo: "chofer", proveedor: "Salvador", descripcion: null, monto: 2060 },
  ],
  backoffice: {
    ingresos: [{ id: "ov1", fecha: "2026-07-15", folio: "15200", cliente: "Ergodinova", proyecto: "N21", material: "ARENA", unidad: "VIAJE", cantidad: 2, importe: 2500 }],
    gastos: [{ id: "oc1", fecha: "2026-07-20", folio: "41000", tipo: "OC", proveedor: "Forza Gas SA de CV", concepto: "GAS LP", monto: 1500, unidad_id: U }],
  },
};

test("rubros y tipos de OC", () => {
  assert.equal(rubroDeGasto("material"), "material");
  assert.equal(rubroDeGasto("tiro"), "material");
  assert.equal(rubroDeGasto("chofer"), "mano_obra");
  assert.equal(rubroDeGasto("gasolina"), "operacion");
  assert.equal(tipoDeOc("Forza Gas SA de CV GAS LP"), "gasolina");
  assert.equal(tipoDeOc("Quálitas Compañia de Seguros SEGURO"), "seguro");
  assert.equal(tipoDeOc("Banco de tiro ESCOMBRO"), "tiro");
  assert.equal(tipoDeOc("JAIME SIERRA FARFAN ACEITE"), "mantenimiento");
  assert.equal(tipoDeOc("QX SOLUTIONS MONITOREO GPS"), "otro");
});

test("movimientos: solo la unidad, sin cancelados, con el backoffice", () => {
  const { ingresos, egresos } = movimientosVolteo(datos, new Set([U]));
  assert.equal(ingresos.length, 3);
  assert.equal(egresos.length, 4);
  const t = totales(ingresos, egresos);
  assert.deepEqual([t.ingresos, t.material, t.mano_obra, t.operacion, t.egresos, t.utilidad], [8250, 780, 2060, 2500, 5340, 2910]);
  assert.equal(t.margen_pct, 35.3);
});

test("serie por mes y por semana", () => {
  const { ingresos, egresos } = movimientosVolteo(datos, new Set([U]));
  const m = serie(ingresos, egresos, "mes");
  assert.deepEqual(m.map((x) => x.clave), ["2025-01", "2025-02", "2026-07"]);
  assert.equal(m[0].ingresos, 5750);
  assert.equal(m[0].egresos, 1780);
  assert.equal(m[1].utilidad, -2060);
  const s = serie(ingresos, egresos, "semana");
  assert.equal(s[0].clave, "2025-01-06");
  assert.equal(lunes("2025-01-12"), "2025-01-06");
});

test("recuperación de la inversión", () => {
  const r = recuperacion(919400, 100000, [{ utilidad: 10000 }, { utilidad: 20000 }]);
  assert.equal(r.pct, 10.9);
  assert.equal(r.falta, 819400);
  assert.equal(r.ritmo, 15000);
  assert.equal(r.meses_faltan, 55);
  assert.equal(recuperacion(100, 50, [{ utilidad: -5 }]).meses_faltan, null);
  assert.equal(recuperacion(100, 150, []).meses_faltan, 0);
});

test("sumaPor, materiales y periodos", () => {
  const r = sumaPor([{ c: "A", v: 1 }, { c: "B", v: 5 }, { c: "A", v: 2 }, { c: "", v: 1 }], (f) => f.c, (f) => f.v);
  assert.deepEqual(r.map((x) => [x.clave, x.total, x.n]), [["B", 5, 1], ["A", 3, 2], ["Sin dato", 1, 1]]);
  assert.equal(nombreMaterial("GRAVA DE1/2"), "Grava de 1/2");
  assert.equal(nombreMaterial(" ARENA "), "Arena");
  assert.equal(enPeriodoVolteo("2025-06-01", "2025", "2026-11-27"), true);
  assert.equal(enPeriodoVolteo("2025-06-01", "12m", "2026-11-27"), false);
  assert.equal(enPeriodoVolteo("2026-01-01", "12m", "2026-11-27"), true);
});
