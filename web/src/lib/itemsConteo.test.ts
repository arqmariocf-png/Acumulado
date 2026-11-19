import { test } from "node:test";
import assert from "node:assert/strict";
import { claveTexto, cruzarItemsConProductos, filtrarItemsConteo, itemsContables, lotes, type ItemParaConteo } from "./itemsConteo.ts";

const item = (x: Partial<ItemParaConteo> & { descripcion: string }): ItemParaConteo => ({ id: x.descripcion, clave: "IT-0001", unidad: "pza", categoria: "material", activo: true, ...x });

test("claveTexto e itemsContables", () => {
  assert.equal(claveTexto("  Varilla  3/8\" R-42  "), "varilla 3 8 r 42");
  assert.equal(claveTexto("ALAMBRÓN 5.5 mm"), "alambron 5 5 mm");
  const lista = [item({ descripcion: "Varilla" }), item({ descripcion: "Flete", categoria: "servicio" }), item({ descripcion: "Taladro", categoria: "equipo" }), item({ descripcion: "Viejo", activo: false })];
  assert.deepEqual(
    itemsContables(lista).map((i) => i.descripcion),
    ["Varilla", "Taladro"],
    "fuera servicios e inactivos",
  );
});

test("cruzarItemsConProductos: empata por nombre normalizado y filtrarItemsConteo busca por clave, nombre y ART-", () => {
  const items = [item({ descripcion: "ALAMBRON 5.5 mm 1004", clave: "IT-0010" }), item({ descripcion: "Cemento gris 50 kg", clave: "IT-0011" })];
  const cruce = cruzarItemsConProductos(items, [{ id: "p1", nombre: "Alambrón 5.5 MM 1004", sku: "OC-X-1", clave_control: "ART-MCC-0002" }]);
  assert.equal(cruce[0].producto?.id, "p1", "el item ya es producto de la empresa");
  assert.equal(cruce[1].producto, null);
  assert.deepEqual(filtrarItemsConteo(cruce, "art-mcc-0002").map((x) => x.item.clave), ["IT-0010"]);
  assert.deepEqual(filtrarItemsConteo(cruce, "cemento 50").map((x) => x.item.clave), ["IT-0011"]);
  assert.deepEqual(filtrarItemsConteo(cruce, "", true).map((x) => x.item.clave), ["IT-0011"], "solo los que faltan de dar de alta");
  assert.equal(filtrarItemsConteo(cruce, "").length, 2);
});

test("lotes de 500", () => {
  const ids = Array.from({ length: 1201 }, (_, i) => String(i));
  const l = lotes(ids, 500);
  assert.deepEqual(l.map((x) => x.length), [500, 500, 201]);
  assert.deepEqual(lotes([], 500), []);
});
