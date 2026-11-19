import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparSimilares, filtrarGrupos, ordenarParaConservar, puntosUso, resumenFusion, type UsoCatalogo } from "./fusiones.ts";

const uso = (x: Partial<UsoCatalogo> & { id: string }): UsoCatalogo => ({
  texto: x.id,
  clave: null,
  unidad: "pza",
  empresa_id: "e",
  activo: true,
  existencia: 0,
  movimientos: 0,
  conteos: 0,
  requisiciones: 0,
  ventas: 0,
  proveedores: 0,
  productos: 0,
  extra: null,
  ...x,
});

test("agruparSimilares: une transitivamente, respeta el umbral y el tamaño máximo", () => {
  const pares = [
    { a_id: "a", b_id: "b", similitud: 0.95 },
    { a_id: "b", b_id: "c", similitud: 0.72 },
    { a_id: "x", b_id: "y", similitud: 0.55 },
    { a_id: "m", b_id: "n", similitud: 0.81 },
  ];
  const g80 = agruparSimilares(pares, 0.8);
  assert.deepEqual(
    g80.map((g) => g.ids.sort()),
    [["a", "b"], ["m", "n"]],
    "a-b y m-n; c queda fuera por el umbral, x-y también",
  );
  assert.equal(g80[0].maxima, 0.95);
  const g70 = agruparSimilares(pares, 0.7);
  assert.deepEqual(g70[0].ids.sort(), ["a", "b", "c"], "con 70 % c entra por b");
  assert.equal(g70[0].minima, 0.72);
  const cadena = Array.from({ length: 6 }, (_, i) => ({ a_id: `p${i}`, b_id: `p${i + 1}`, similitud: 0.9 }));
  const chicos = agruparSimilares(cadena, 0.5, 4);
  assert.ok(chicos.every((g) => g.ids.length <= 4), "ningún grupo pasa del máximo");
  assert.equal(chicos.reduce((s, g) => s + g.ids.length, 0), 7);
});

test("ordenarParaConservar: el más usado primero; empate, el más viejo", () => {
  const m = new Map<string, UsoCatalogo>([
    ["nuevo", uso({ id: "nuevo", movimientos: 2, extra: { created_at: "2026-11-01" } })],
    ["viejo", uso({ id: "viejo", movimientos: 2, extra: { created_at: "2026-09-01" } })],
    ["usado", uso({ id: "usado", movimientos: 10, existencia: 50 })],
    ["vacio", uso({ id: "vacio" })],
  ]);
  assert.deepEqual(ordenarParaConservar(["vacio", "nuevo", "usado", "viejo"], m), ["usado", "viejo", "nuevo", "vacio"]);
  assert.ok(puntosUso(m.get("usado")!) > puntosUso(m.get("nuevo")!));
});

test("resumenFusion y filtrarGrupos", () => {
  const m = new Map<string, UsoCatalogo>([
    ["d", uso({ id: "d", texto: "Alambrón 5.5", clave: "ART-AEP-0010", existencia: 100 })],
    ["o", uso({ id: "o", texto: "Alambron 5.5", clave: "ART-AEP-0011", existencia: 40, movimientos: 3, conteos: 1 })],
  ]);
  const r = resumenFusion("d", ["o"], m, "producto");
  assert.match(r, /Se conserva ART-AEP-0010 · Alambrón 5\.5/);
  assert.match(r, /3 movimiento\(s\) de inventario \(existencia 40 que se suma a 100\)/);
  assert.match(r, /1 renglón\(es\) de conteo/);
  const ri = resumenFusion("d", ["o"], new Map([["d", uso({ id: "d", texto: "Cemento" })], ["o", uso({ id: "o", texto: "Cemento gris", proveedores: 2 })]]), "item");
  assert.match(ri, /2 precio\(s\) de proveedor/);
  const grupos = [
    { ids: ["d", "o"], maxima: 1, minima: 1 },
    { ids: ["z"], maxima: 0.9, minima: 0.9 },
  ];
  assert.equal(filtrarGrupos(grupos, m, "alambron 0011").length, 1);
  assert.equal(filtrarGrupos(grupos, m, "cemento").length, 0);
  assert.equal(filtrarGrupos(grupos, m, "").length, 2);
});
