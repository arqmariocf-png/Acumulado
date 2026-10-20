import { test } from "node:test";
import assert from "node:assert/strict";
import { claveSugerida, filtrarCatalogo, posiblesDuplicados, revisarItem, sugerirItems, type ItemCompra } from "./catalogoItems.ts";

const item = (id: string, descripcion: string, extra: Partial<ItemCompra> = {}): ItemCompra => ({
  id,
  clave: `IT-000${id}`,
  descripcion,
  unidad: "pza",
  categoria: "material",
  iva: true,
  precio_referencia: null,
  notas: null,
  activo: true,
  ...extra,
});

test("revisión del item antes de guardar", () => {
  const base = { clave: "", descripcion: "Cemento gris 50 kg", unidad: "bulto", categoria: "material", precio: "210.5" };
  assert.equal(revisarItem(base), null);
  assert.match(revisarItem({ ...base, descripcion: " c " }) ?? "", /descripción/);
  assert.match(revisarItem({ ...base, categoria: "comida" }) ?? "", /categoría/);
  assert.match(revisarItem({ ...base, clave: "IT 01" }) ?? "", /clave/);
  assert.equal(revisarItem({ ...base, clave: "CEM-50" }), null);
  assert.match(revisarItem({ ...base, precio: "-1" }) ?? "", /precio/);
  assert.equal(revisarItem({ ...base, precio: "" }), null);
});

test("clave consecutiva IT-0001", () => {
  assert.equal(claveSugerida([]), "IT-0001");
  assert.equal(claveSugerida([{ clave: "IT-0007" }, { clave: "CEM-50" }, { clave: "it-0012" }]), "IT-0013");
});

test("duplicados sin acentos ni mayúsculas, y parecidos", () => {
  const lista = [item("1", "Cemento gris 50 kg"), item("2", "Varilla corrugada 3/8"), item("3", "Cemento blanco")];
  const r = posiblesDuplicados(lista, "  CEMENTO  GRÍS 50 KG ");
  assert.equal(r.exacto?.id, "1");
  assert.deepEqual(posiblesDuplicados(lista, "cemento").parecidos.map((i) => i.id), ["1", "3"]);
  assert.equal(posiblesDuplicados(lista, "Cemento gris 50 kg", "1").exacto, null);
  assert.deepEqual(posiblesDuplicados(lista, "ab"), { exacto: null, parecidos: [] });
});

test("filtrar por palabras, clave y categoría", () => {
  const lista = [
    item("1", "Varilla corrugada 3/8"),
    item("2", "Disco de corte", { categoria: "consumible" }),
    item("3", "Varilla lisa 1/2", { activo: false }),
  ];
  assert.deepEqual(filtrarCatalogo(lista, "3/8 varilla").map((i) => i.id), ["1"]);
  assert.deepEqual(filtrarCatalogo(lista, "it-0002").map((i) => i.id), ["2"]);
  assert.deepEqual(filtrarCatalogo(lista, "", "consumible").map((i) => i.id), ["2"]);
  assert.deepEqual(filtrarCatalogo(lista, "varilla", "", true).map((i) => i.id), ["1", "3"]);
  assert.deepEqual(sugerirItems(lista, "v"), []);
  assert.deepEqual(sugerirItems(lista, "vari").map((i) => i.id), ["1"]);
});
