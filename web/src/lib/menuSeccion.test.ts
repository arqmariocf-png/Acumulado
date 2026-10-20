import { test } from "node:test";
import assert from "node:assert/strict";
import { muestraBarra, seccionDeRuta } from "./menuSeccion.ts";
import type { EntradaMenu, SeccionMenu } from "./menu.ts";

const e = (ruta: string, etiqueta = ruta): EntradaMenu => ({ ruta, etiqueta, descripcion: "", uso: "", visible: () => true });
const secciones: SeccionMenu[] = [
  { clave: "obras", titulo: "Obras", proposito: "", entradas: [e("/proyectos", "Proyectos"), e("/requisiciones", "Requisiciones")] },
  { clave: "finanzas", titulo: "Finanzas", proposito: "", entradas: [e("/finanzas/pagos"), e("/finanzas/pagos/historial"), e("/finanzas/tesoreria")] },
  { clave: "sistemas", titulo: "Sistemas", proposito: "", entradas: [e("/guia")] },
];

test("la sección y la entrada de la ruta actual", () => {
  const r = seccionDeRuta(secciones, "/proyectos/abc-123");
  assert.equal(r?.seccion.clave, "obras");
  assert.equal(r?.entrada.etiqueta, "Proyectos");
  assert.equal(seccionDeRuta(secciones, "/requisiciones/")?.entrada.etiqueta, "Requisiciones");
});

test("gana el prefijo más largo y no confunde rutas parecidas", () => {
  assert.equal(seccionDeRuta(secciones, "/finanzas/pagos/historial")?.entrada.ruta, "/finanzas/pagos/historial");
  assert.equal(seccionDeRuta(secciones, "/finanzas/pagos")?.entrada.ruta, "/finanzas/pagos");
  assert.equal(seccionDeRuta(secciones, "/proyectosx"), null);
});

test("sin barra en el inicio, en rutas fuera del menú y en secciones de una sola entrada", () => {
  assert.equal(seccionDeRuta(secciones, "/"), null);
  assert.equal(seccionDeRuta(secciones, "/inicio"), null);
  assert.equal(seccionDeRuta(secciones, "/archivo"), null);
  assert.equal(muestraBarra(seccionDeRuta(secciones, "/guia")), false);
  assert.equal(muestraBarra(seccionDeRuta(secciones, "/finanzas/tesoreria")), true);
  assert.equal(muestraBarra(null), false);
});
