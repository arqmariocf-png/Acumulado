import { test } from "node:test";
import assert from "node:assert/strict";
import { buscarMenu, esAtajoBuscador, indiceMenu, itemsObras } from "./buscadorMenu.ts";
import type { SeccionMenu } from "./menu.ts";

const si = () => true;
const SECCIONES: SeccionMenu[] = [
  {
    clave: "cobranza", grupo: "comercial", titulo: "Cobranza", proposito: "", entradas: [
      { ruta: "/finanzas/cobranza", etiqueta: "Cuentas por cobrar", descripcion: "cartera por antigüedad, cobros y agenda", uso: "Registra el depósito", visible: si },
      { ruta: "/legal?tab=credito", etiqueta: "Crédito a clientes", descripcion: "línea y contrato por cliente", uso: "", visible: si },
    ],
  },
  {
    clave: "finanzas", grupo: "finanzas", titulo: "Finanzas", proposito: "", entradas: [
      { ruta: "/finanzas/pagos", etiqueta: "Programación de pagos", descripcion: "hoja del día y OC", uso: "", visible: si, niveles: [{ etiqueta: "Por autorizar", ruta: "/finanzas/pagos?tab=ordenes", hijos: [{ etiqueta: "Archivadas", ruta: "/finanzas/pagos?tab=ordenes&ver=archivadas" }] }] },
      { ruta: "/finanzas/cobranza", etiqueta: "Repetida", descripcion: "", uso: "", visible: si },
    ],
  },
];
const GRUPOS = [{ clave: "comercial" as const, titulo: "Comercial" }, { clave: "finanzas" as const, titulo: "Finanzas" }];

test("índice: pantallas con su camino, pestañas y sin rutas repetidas", () => {
  const items = indiceMenu(SECCIONES, GRUPOS);
  assert.deepEqual(items.map((i) => [i.tipo, i.etiqueta, i.camino]), [
    ["pantalla", "Cuentas por cobrar", "Comercial › Cobranza"],
    ["pantalla", "Crédito a clientes", "Comercial › Cobranza"],
    ["pantalla", "Programación de pagos", "Finanzas › Finanzas"],
    ["pestaña", "Por autorizar", "Finanzas › Finanzas › Programación de pagos"],
    ["pestaña", "Archivadas", "Finanzas › Finanzas › Programación de pagos › Por autorizar"],
  ]);
});

test("busca sin acentos, por palabras en cualquier orden y por relevancia", () => {
  const items = [...indiceMenu(SECCIONES, GRUPOS), ...itemsObras([{ id: "x", nombre: "Parque Real 63", empresa: "MCF" }])];
  assert.deepEqual(buscarMenu(items, "cobrar").map((i) => i.etiqueta), ["Cuentas por cobrar"]);
  assert.deepEqual(buscarMenu(items, "CREDITO clientes").map((i) => i.etiqueta), ["Crédito a clientes"]);
  assert.equal(buscarMenu(items, "autorizar")[0].etiqueta, "Por autorizar"); // la pestaña antes que su hija "Archivadas"
  assert.deepEqual(buscarMenu(items, "deposito").map((i) => i.etiqueta), ["Cuentas por cobrar"]); // por el uso
  assert.deepEqual(buscarMenu(items, "parque 63").map((i) => i.ruta), ["/proyectos/x"]);
  assert.equal(buscarMenu(items, "zzz").length, 0);
  assert.equal(buscarMenu(items, "", 2).length, 2); // sin texto: las primeras pantallas
  // "pagos" aparece en el nombre de la pantalla antes que en el camino de sus pestañas.
  assert.equal(buscarMenu(items, "pagos")[0].etiqueta, "Programación de pagos");
});

test("atajo del teclado", () => {
  assert.equal(esAtajoBuscador({ key: "k", ctrlKey: true, metaKey: false }), true);
  assert.equal(esAtajoBuscador({ key: "K", ctrlKey: false, metaKey: true }), true);
  assert.equal(esAtajoBuscador({ key: "/", ctrlKey: false, metaKey: false, target: { tagName: "DIV" } as unknown as EventTarget }), true);
  assert.equal(esAtajoBuscador({ key: "/", ctrlKey: false, metaKey: false, target: { tagName: "INPUT" } as unknown as EventTarget }), false);
  assert.equal(esAtajoBuscador({ key: "a", ctrlKey: true, metaKey: false }), false);
});
