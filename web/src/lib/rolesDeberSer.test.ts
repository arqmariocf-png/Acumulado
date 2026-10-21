import { test } from "node:test";
import assert from "node:assert/strict";
import { APLICAR_ROLES_DEBER_SER, equivalencia, menuPermitido, menusQueSeQuitan, nombrePuestos, PUESTOS, TODOS_LOS_MENUS } from "./rolesDeberSer.ts";
import { SECCIONES } from "./menu.ts";

test("los menús de la matriz son los 22 del menú", () => {
  assert.deepEqual([...SECCIONES.map((s) => s.clave)].sort(), [...TODOS_LOS_MENUS].sort());
  for (const p of Object.values(PUESTOS)) assert.ok(p.menus.includes("mi_dia"), p.nombre);
});

test("equivalencias de los roles de hoy", () => {
  assert.equal(equivalencia({ rol: "admin" }).menus?.size, 22);
  const laura = equivalencia({ rol: "direccion" });
  assert.deepEqual(laura.puestos, ["finanzas_tesoreria"]);
  assert.ok(laura.menus?.has("catalogos"), "excepción de catálogos");
  assert.ok(!laura.menus?.has("obras"));
  assert.deepEqual(equivalencia({ rol: "corporativo", modulos: ["tesoreria"] }).puestos, ["finanzas_tesoreria"]);
  assert.deepEqual(equivalencia({ rol: "corporativo", modulos: ["contabilidad", "legal"] }).puestos, ["contabilidad", "legal"]);
  assert.deepEqual(equivalencia({ rol: "responsable", bbva_mantenimiento: true }).puestos, ["coordinador_bbva"]);
  const christian = equivalencia({ rol: "responsable", bbva_mantenimiento: true, modulos: ["requisiciones"] });
  assert.ok(christian.menus?.has("compras"));
  assert.ok(christian.menus?.has("mantenimiento_bbva"));
  assert.deepEqual(equivalencia({ rol: "supervisor", modulos: ["tareas", "precios"] }).puestos, ["residente"]);
  assert.deepEqual([...equivalencia({ rol: "operativo", modulos: ["tareas"] }).menus!], ["mi_dia"]);
  assert.equal(equivalencia({ rol: "empresa" }).menus, null);
  assert.equal(nombrePuestos(equivalencia({ rol: "empresa" })), "Sin equivalente (como hoy)");
  assert.equal(nombrePuestos(equivalencia({ rol: "almacen" })), "Almacenista + Compras");
});

test("con la matriz apagada no se esconde nada; prendida sí", () => {
  assert.equal(APLICAR_ROLES_DEBER_SER, false);
  assert.equal(menuPermitido({ rol: "direccion" }, "obras"), true);
  assert.equal(menuPermitido({ rol: "direccion" }, "obras", true), false);
  assert.equal(menuPermitido({ rol: "direccion" }, "tesoreria", true), true);
  assert.equal(menuPermitido({ rol: "empresa" }, "obras", true), true);
});

test("qué dejaría de ver cada quien", () => {
  assert.deepEqual(menusQueSeQuitan({ rol: "direccion" }, ["tesoreria", "obras", "almacen", "catalogos"]), ["obras", "almacen"]);
  assert.deepEqual(menusQueSeQuitan({ rol: "empresa" }, ["obras"]), []);
});
