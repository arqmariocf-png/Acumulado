import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPorArea, avancePorTablero, esAreaTareas, nombreArea, rutaTareasArea } from "./tareasArea.ts";

test("áreas y rutas", () => {
  assert.equal(esAreaTareas("rh"), true);
  assert.equal(esAreaTareas("sistemas"), false);
  assert.equal(esAreaTareas(null), false);
  assert.equal(nombreArea("mantenimiento"), "Mantenimiento");
  assert.equal(nombreArea("otra"), "Sin área");
  assert.equal(rutaTareasArea("contabilidad"), "/tareas/area/contabilidad");
});

test("agrupar en el orden del menú, sin área al final", () => {
  const g = agruparPorArea([
    { id: "1", area: "operacion" },
    { id: "2", area: null },
    { id: "3", area: "rh" },
    { id: "4", area: "operacion" },
    { id: "5", area: "inventada" },
  ]);
  assert.deepEqual(
    g.map((x) => [x.area, x.tableros.map((t) => t.id)]),
    [
      ["rh", ["3"]],
      ["operacion", ["1", "4"]],
      [null, ["2", "5"]],
    ],
  );
});

test("avance: hechas = última columna; las mías por responsable, supervisor o corresponsable", () => {
  const columnas = [
    { id: "a1", tablero_id: "A", orden: 0 },
    { id: "a3", tablero_id: "A", orden: 2 },
    { id: "a2", tablero_id: "A", orden: 1 },
  ];
  const t = (columna_id: string, extra: Partial<{ asignado_a: string; supervisor_id: string; corresponsables: string[] }> = {}) => ({
    tablero_id: "A",
    columna_id,
    asignado_a: null,
    supervisor_id: null,
    corresponsables: null,
    ...extra,
  });
  const r = avancePorTablero(columnas, [t("a3"), t("a1", { asignado_a: "yo" }), t("a2", { corresponsables: ["yo"] }), t("a3", { supervisor_id: "otro" })], "yo");
  assert.deepEqual(r.get("A"), { total: 4, hechas: 2, mias: 2, pct: 50 });
  assert.equal(r.get("B"), undefined);
});
