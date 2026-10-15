import { test } from "node:test";
import assert from "node:assert/strict";
import { compararPrecios, detalleContraparte, detalleItem, filtrarContrapartes, filtrarItems, filtrarObras, normalizarBusqueda, tienePartidas, type ContraparteCatalogo, type ItemCatalogo } from "./buscadorCaptura.ts";

const provs: ContraparteCatalogo[] = [
  { nombre: "Aceros y Envasados de Puebla", rfc: "AEP010101AAA", veces: 254, ultima: "2026-10-13", misma_empresa: true },
  { nombre: "MAQUI PRINT SA DE CV", rfc: null, veces: 141, ultima: "2026-10-15", misma_empresa: true },
  { nombre: "Ferretería Peña", rfc: null, veces: 3, ultima: "2026-09-01", misma_empresa: false },
  { nombre: "Cementos Cruz Azul", rfc: "CCA990101BBB", veces: 20, ultima: "2026-10-01", misma_empresa: true },
];

const items: ItemCatalogo[] = [
  { descripcion: "VARILLA CORRUGADA 3/8", unidad: "PZA", precio: 120, iva: true, contraparte: "Aceros y Envasados de Puebla", veces: 10, ultima: "2026-10-01", misma_empresa: true },
  { descripcion: "Varilla corrugada 3/8", unidad: "PZA", precio: 115, iva: true, contraparte: "Ferretería Peña", veces: 2, ultima: "2026-10-10", misma_empresa: false },
  { descripcion: "CEMENTO GRIS CPC 30R", unidad: "BULTO", precio: 210, iva: true, contraparte: "Cementos Cruz Azul", veces: 30, ultima: "2026-10-05", misma_empresa: true },
  { descripcion: "Alambrón 5.5 mm", unidad: "KG", precio: 15.8, iva: true, contraparte: "Aceros y Envasados de Puebla", veces: 5, ultima: "2026-10-09", misma_empresa: true },
  { descripcion: "Tornillo", unidad: "PZA", precio: 2, iva: true, contraparte: null, veces: 0, ultima: null, misma_empresa: true },
];

test("normaliza acentos, mayúsculas, puntos y espacios", () => {
  assert.equal(normalizarBusqueda("  Ferretería  Peña, S.A. "), "FERRETERIA PENA SA");
});

test("proveedores por palabras en cualquier orden, sin acentos y por RFC", () => {
  assert.deepEqual(filtrarContrapartes(provs, "pena ferreteria").map((c) => c.nombre), ["Ferretería Peña"]);
  assert.deepEqual(filtrarContrapartes(provs, "cca99").map((c) => c.nombre), ["Cementos Cruz Azul"]);
  // Sin texto: los más usados de la misma empresa primero.
  assert.equal(filtrarContrapartes(provs, "")[0].nombre, "Aceros y Envasados de Puebla");
  assert.equal(filtrarContrapartes(provs, "", 2).length, 2);
});

test("lo que empieza igual va antes que lo que solo contiene", () => {
  const lista: ContraparteCatalogo[] = [
    { nombre: "Grupo Acero Norte", veces: 50, ultima: null, misma_empresa: true },
    { nombre: "Acero Sur", veces: 1, ultima: null, misma_empresa: true },
  ];
  assert.equal(filtrarContrapartes(lista, "acero")[0].nombre, "Acero Sur");
});

test("partidas: una por concepto, gana el precio más reciente y se suman las veces", () => {
  const r = filtrarItems(items, "varilla 3/8", null);
  assert.equal(r.length, 1);
  assert.equal(r[0].precio, 115);
  assert.equal(r[0].veces, 12);
});

test("con proveedor elegido gana su propio precio", () => {
  const r = filtrarItems(items, "varilla", "ACEROS Y ENVASADOS DE PUEBLA");
  assert.equal(r[0].precio, 120);
  assert.equal(r[0].contraparte, "Aceros y Envasados de Puebla");
});

test("sin texto: solo lo que se le compra al proveedor elegido; sin proveedor, nada", () => {
  assert.deepEqual(filtrarItems(items, "", "Aceros y Envasados de Puebla").map((i) => i.descripcion).sort(), ["Alambrón 5.5 mm", "VARILLA CORRUGADA 3/8"]);
  assert.deepEqual(filtrarItems(items, "", null), []);
  assert.equal(filtrarItems(items, "alambron", null)[0].descripcion, "Alambrón 5.5 mm");
});

test("textos de detalle", () => {
  assert.equal(detalleContraparte(provs[0]), "RFC AEP010101AAA · 254 órdenes · última 13 oct 26");
  assert.equal(detalleContraparte(provs[2]), "3 órdenes · última 1 sep 26 · otra empresa");
  assert.equal(detalleItem(items[2], false), "BULTO · $210.00 s/IVA · de Cementos Cruz Azul · 5 oct 26 · 30 veces");
  assert.equal(detalleItem(items[4], true), "PZA · $2.00 s/IVA · catálogo");
});

test("solo del proveedor: no se ve el universo", () => {
  assert.deepEqual(filtrarItems(items, "varilla", "Ferretería Peña", 12, true).map((i) => i.contraparte), ["Ferretería Peña"]);
  assert.deepEqual(filtrarItems(items, "cemento", "Ferretería Peña", 12, true), []);
  // Sin proveedor elegido el modo estricto no aplica.
  assert.equal(filtrarItems(items, "cemento", null, 12, true).length, 1);
  assert.equal(tienePartidas(items, "ferreteria pena"), true);
  assert.equal(tienePartidas(items, "Proveedor Nuevo"), false);
});

test("obras: por palabras, recientes primero, sin repetir la elegida", () => {
  const obras = [
    { nombre: "Paseo 6 Ampliación", veces: 3, ultima: "2026-10-01" },
    { nombre: "Pisos Falla geológica N21", veces: 100, ultima: "2026-10-13" },
    { nombre: "Corporativo CLAVICON", veces: 50, ultima: "2026-10-10" },
  ];
  assert.deepEqual(filtrarObras(obras, "").map((o) => o.nombre), ["Pisos Falla geológica N21", "Corporativo CLAVICON", "Paseo 6 Ampliación"]);
  assert.deepEqual(filtrarObras(obras, "ampliacion paseo").map((o) => o.nombre), ["Paseo 6 Ampliación"]);
  assert.deepEqual(filtrarObras(obras, "Paseo 6 Ampliación"), []);
});

test("comparar precios entre proveedores, del más barato al más caro", () => {
  assert.deepEqual(compararPrecios(items, "varilla").map((i) => i.precio), [115, 120]);
  assert.deepEqual(compararPrecios(items, ""), []);
});
