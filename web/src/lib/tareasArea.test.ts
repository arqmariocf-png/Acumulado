import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPorArea, avancePorTablero, esAreaTareas, nombreArea, buscarTableros, rutaTareasArea, tablerosDondeParticipa } from "./tareasArea.ts";

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

test("solo los tableros donde la persona está activa", () => {
  const tableros = [
    { id: "rh", nombre: "RH · Actividades", creado_por: "mario" },
    { id: "obra1", nombre: "Parque Real 63", creado_por: "mario", proyecto_id: "p1", obra_encargados: ["miguel", null] },
    { id: "obra2", nombre: "Rio Frio", creado_por: "mario", proyecto_id: "p2", obra_encargados: [] },
    { id: "mio", nombre: "Mi tablero", creado_por: "ana" },
  ];
  const tarjetas = [
    { tablero_id: "rh", asignado_a: "ana", supervisor_id: null, corresponsables: null },
    { tablero_id: "obra2", asignado_a: "luis", supervisor_id: null, corresponsables: ["ana"] },
  ];
  assert.deepEqual([...tablerosDondeParticipa(tableros, tarjetas, "ana")].sort(), ["mio", "obra2", "rh"]);
  assert.deepEqual([...tablerosDondeParticipa(tableros, tarjetas, "miguel")], ["obra1"]);
  // El creador automático de un tablero de obra no cuenta como activo en él.
  assert.deepEqual([...tablerosDondeParticipa(tableros, tarjetas, "mario")], ["rh"]);
  assert.equal(tablerosDondeParticipa(tableros, tarjetas, null).size, 0);
});

test("buscador de tableros por proyecto, sin acentos y por palabras", () => {
  const t = [{ n: "Abarrotes Neto Río Frío", e: "CSC" }, { n: "Parque Real 63", e: "MCF" }, { n: "RH · Actividades", e: "" }];
  const de = (x: { n: string; e: string }) => `${x.n} ${x.e}`;
  assert.deepEqual(buscarTableros(t, "rio frio", de).map((x) => x.n), ["Abarrotes Neto Río Frío"]);
  assert.deepEqual(buscarTableros(t, "real mcf", de).map((x) => x.n), ["Parque Real 63"]);
  assert.equal(buscarTableros(t, "  ", de).length, 3);
});
