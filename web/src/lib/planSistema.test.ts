import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPlan, csvPlan, filtrarPlan, limpiarAvance, resumenPorGrupo, rutaNavegable, tonoEstatus, yaFunciona, type OpcionPlan } from "./planSistema.ts";

const op = (numero: number, grupo_menu: string, menu: string, estatus: OpcionPlan["estatus"], fase: number, extra: Partial<OpcionPlan> = {}): OpcionPlan => ({
  id: String(numero),
  numero,
  grupo_menu,
  menu,
  opcion: `Opción ${numero}`,
  que_hace: null,
  viene_de: null,
  estatus,
  ruta: null,
  fase,
  quien: null,
  prioridad: null,
  responsable: null,
  fecha_compromiso: null,
  avance: 0,
  notas: null,
  especificacion: null,
  ...extra,
});

const plan = [
  op(1, "Mi día", "Mi día", "Ajustar", 1),
  op(2, "Mi día", "Mi día", "Unir", 1, { avance: 50 }),
  op(3, "Mi día", "Mi día", "Existe", 1),
  op(4, "Mi día", "Mi día", "Existe", 2),
  op(5, "Mi día", "Mi día", "Unir", 2),
  op(6, "Dirección", "Tablero", "Ajustar", 1, { opcion: "Resumen del grupo", responsable: "Mario" }),
  op(10, "Dirección", "Análisis", "Crear", 2, { avance: 20 }),
  op(16, "Dirección", "Gobierno", "Existe", 2),
];

test("ya funciona y color por estatus", () => {
  assert.equal(yaFunciona("Existe"), true);
  assert.equal(yaFunciona("Unir"), true);
  assert.equal(yaFunciona("Hecho"), true);
  assert.equal(yaFunciona("Ajustar"), false);
  assert.equal(tonoEstatus("Existe"), "verde");
  assert.equal(tonoEstatus("Validar"), "azul");
  assert.equal(tonoEstatus("Migrar del backoffice"), "ambar");
  assert.equal(tonoEstatus("Por definir"), "gris");
});

test("resumen por grupo como la hoja del Excel (Mi día: 1 menú, 5 opciones, 4 funcionan)", () => {
  const { grupos, total } = resumenPorGrupo(plan);
  assert.deepEqual(grupos.map((g) => g.grupo), ["Mi día", "Dirección"]);
  assert.deepEqual(grupos[0], { grupo: "Mi día", menus: 1, opciones: 5, funcionan: 4, porTrabajar: 1, fase1: 3, fase2: 2, fase3: 0, avance: 10 });
  assert.equal(grupos[1].menus, 3);
  assert.equal(grupos[1].funcionan, 1);
  assert.equal(total.opciones, 8);
  assert.equal(total.menus, 4);
  assert.equal(total.avance, 8.8);
});

test("filtros: grupo, fase, estatus, por trabajar y texto sin acentos", () => {
  assert.equal(filtrarPlan(plan, { grupo: "Dirección" }).length, 3);
  assert.equal(filtrarPlan(plan, { fase: 2 }).length, 4);
  assert.equal(filtrarPlan(plan, { estatus: "Existe" }).length, 3);
  assert.equal(filtrarPlan(plan, { estatus: "por_trabajar" }).length, 3);
  assert.deepEqual(filtrarPlan(plan, { texto: "grupo resumen" }).map((o) => o.numero), [6]);
  assert.deepEqual(filtrarPlan(plan, { texto: "mario" }).map((o) => o.numero), [6]);
  assert.equal(filtrarPlan(plan, { texto: "direccion tablero" }).length, 1);
});

test("agrupa por grupo y menú en el orden del número", () => {
  const g = agruparPlan([...plan].reverse());
  assert.deepEqual(g.map((x) => x.grupo), ["Mi día", "Dirección"]);
  assert.deepEqual(g[1].menus.map((m) => m.menu), ["Tablero", "Análisis", "Gobierno"]);
  assert.deepEqual(g[0].menus[0].opciones.map((o) => o.numero), [1, 2, 3, 4, 5]);
});

test("ruta navegable y avance limpio", () => {
  assert.equal(rutaNavegable("/personaje; /mis-documentos"), "/personaje");
  assert.equal(rutaNavegable(null), null);
  assert.equal(rutaNavegable("pendiente"), null);
  assert.equal(limpiarAvance("150"), 100);
  assert.equal(limpiarAvance(-3), 0);
  assert.equal(limpiarAvance("42.6"), 43);
  assert.equal(limpiarAvance("x"), 0);
});

test("CSV con las columnas del Excel y comillas escapadas", () => {
  const csv = csvPlan([op(2, "Mi día", "Mi día", "Unir", 1, { que_hace: 'Una "sola" lista, con filtro', avance: 50 }), op(1, "Mi día", "Mi día", "Existe", 2)]);
  const lineas = csv.trim().split("\r\n");
  assert.equal(lineas.length, 3);
  assert.match(lineas[0], /^#,Grupo,Menú,Opción/);
  assert.match(lineas[1], /^1,/);
  assert.match(lineas[2], /"Una ""sola"" lista, con filtro"/);
  assert.match(lineas[2], /Fase 1/);
});
