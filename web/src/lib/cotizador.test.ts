import { test } from "node:test";
import assert from "node:assert/strict";
import { armarProductos, buscarProductos, detalleProducto, lineasParaOrdenVenta } from "./cotizador.ts";
import type { ItemCatalogo } from "./buscadorCaptura.ts";

const it = (descripcion: string, precio: number, ultima: string, veces = 1, unidad = "PZA"): ItemCatalogo => ({ descripcion, unidad, precio, iva: true, contraparte: "X", veces, ultima, misma_empresa: true });

const productos = armarProductos({
  planta: [{ id: "p1", nombre: "Malla ciclónica", calibre: "10.5", unidad_medida: "rollo", costo: 1263.16, existencia: 12 }],
  catalogo: [
    { nombre: "Cemento gris", unidad_medida: "bulto", costo_referencia: 200, precio_venta: 290, iva_tasa: 0.16 },
    { nombre: "Clavo 2 1/2", unidad_medida: "kg", costo_referencia: 30, precio_venta: null, iva_tasa: 0.16 },
  ],
  vendidos: [it("Cemento Gris", 260, "2026-10-01", 4, "BULTO"), it("Varilla 3/8", 120, "2026-10-10", 7), it("Malla ciclónica 10.5", 1500, "2026-10-05", 3)],
  compras: [it("Cemento gris", 205, "2026-09-01"), it("CEMENTO GRIS", 210, "2026-10-05"), it("Varilla 3/8", 95, "2026-10-02")],
});

test("junta planta, catálogo y vendido sin duplicar; la planta y el catálogo mandan", () => {
  assert.deepEqual(productos.map((p) => [p.descripcion, p.origen]), [
    ["Malla ciclónica 10.5", "planta"],
    ["Cemento gris", "catalogo"],
    ["Clavo 2 1/2", "catalogo"],
    ["Varilla 3/8", "vendido"],
  ]);
  const malla = productos[0];
  // Planta: costo PEPS y el precio lo completa lo vendido.
  assert.equal(malla.costo, 1263.16);
  assert.equal(malla.costoOrigen, "peps");
  assert.equal(malla.precio, 1500);
  assert.equal(malla.productoPlantaId, "p1");
  assert.equal(malla.veces, 3);
});

test("costo: última compra antes que el de referencia; precio de lista sin IVA", () => {
  const cemento = productos.find((p) => p.descripcion === "Cemento gris")!;
  assert.equal(cemento.costo, 210);
  assert.equal(cemento.costoOrigen, "ultima_compra");
  assert.equal(cemento.precio, 250);
  const clavo = productos.find((p) => p.descripcion === "Clavo 2 1/2")!;
  assert.equal(clavo.costo, 30);
  assert.equal(clavo.costoOrigen, "referencia");
  assert.equal(clavo.precio, null);
  const varilla = productos.find((p) => p.descripcion === "Varilla 3/8")!;
  assert.equal(varilla.costo, 95);
  assert.equal(varilla.precio, 120);
});

test("búsqueda por palabras sin acentos", () => {
  assert.deepEqual(buscarProductos(productos, "ciclonica malla").map((p) => p.descripcion), ["Malla ciclónica 10.5"]);
  assert.equal(buscarProductos(productos, "").length, 4);
  assert.deepEqual(buscarProductos(productos, "zzz"), []);
});

test("detalle con y sin costo (el costo solo lo ve quien ve margen)", () => {
  const cemento = productos.find((p) => p.descripcion === "Cemento gris")!;
  assert.equal(detalleProducto(cemento, true, true), "bulto · catálogo · precio $290.00 c/IVA · costo $210.00 s/IVA (última compra)");
  assert.equal(detalleProducto(cemento, false, false), "bulto · catálogo · precio $250.00 s/IVA");
  assert.match(detalleProducto(productos[0], true, true), /planta · precio \$1,740\.00 c\/IVA · costo \$1,263\.16 s\/IVA \(PEPS\) · existencia 12/);
});

test("partidas para la orden de venta", () => {
  assert.deepEqual(lineasParaOrdenVenta([{ descripcion: "Malla", unidad: "rollo", cantidad: 3, precio_unitario: 1500.004 }]), [{ item: "Malla", unidad: "rollo", cantidad: 3, costo: 1500, iva: true }]);
});
