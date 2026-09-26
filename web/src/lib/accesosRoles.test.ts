import { test } from "node:test";
import assert from "node:assert/strict";
import { NIVELES_ROLES, accesosDelRol } from "./accesosRoles.ts";

test("cada rol aparece una sola vez en el organigrama", () => {
  const todos = NIVELES_ROLES.flatMap((n) => n.roles);
  assert.equal(new Set(todos).size, todos.length);
  assert.equal(todos.length, 15);
});

test("el administrador ve todo y el pendiente solo lo personal", () => {
  const admin = accesosDelRol("admin");
  assert.ok(admin.some((a) => a.ruta === "/admin"));
  assert.ok(admin.some((a) => a.ruta === "/proyectos"));
  const pendiente = accesosDelRol("pendiente");
  assert.ok(pendiente.every((a) => a.ruta === "/checador" || a.ruta === "/mis-documentos" || a.ruta === "/guia"));
});

test("un operativo ve tareas de fábrica y lo demás solo con módulo", () => {
  const op = accesosDelRol("operativo");
  const tareas = op.find((a) => a.ruta === "/tareas");
  const inventario = op.find((a) => a.ruta === "/inventario");
  assert.ok(tareas && !tareas.conModulo);
  assert.ok(inventario && inventario.conModulo);
  assert.ok(!op.some((a) => a.ruta === "/rh"));
});
