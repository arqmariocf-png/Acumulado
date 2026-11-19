import { test } from "node:test";
import assert from "node:assert/strict";
import { administraConteo, csvConteo, fechaHoyMx, filtrarItems, htmlEtiquetas, resumenConteo, revisarItem, urlEtiqueta, type ItemConteo } from "./conteoInventario.ts";

const base: ItemConteo = { id: "1", conteo_id: "c", empresa_id: "e1", codigo: "INV-AEP-0001", descripcion: "Varilla 3/8", cantidad: 120, unidad: "pza", ubicacion: "Rack A", codigo_barras: null, notas: null, contado_por: "u1", contado_por_nombre: "Alma", created_at: "2026-11-19T15:00:00Z" };
const items: ItemConteo[] = [
  base,
  { ...base, id: "2", codigo: "INV-AEP-0002", descripcion: "Alambrón 5.5", cantidad: 2.5, unidad: "ton", created_at: "2026-11-19T16:00:00Z" },
  { ...base, id: "3", empresa_id: "e2", codigo: "INV-MCC-0001", descripcion: "Rollo de malla", cantidad: 10, contado_por: "u2", contado_por_nombre: "Jaime", created_at: "2026-11-19T14:00:00Z" },
];
const empresas = new Map([["e1", "Aceros"], ["e2", "Clavicón"]]);

test("revisarItem: empresa, descripción, cantidad numérica y unidad", () => {
  assert.equal(revisarItem({ empresa_id: "e1", descripcion: "Varilla", cantidad: "12", unidad: "pza" }), null);
  assert.match(revisarItem({ empresa_id: "", descripcion: "Varilla", cantidad: 1, unidad: "pza" }) ?? "", /empresa/);
  assert.match(revisarItem({ empresa_id: "e1", descripcion: "  ", cantidad: 1, unidad: "pza" }) ?? "", /qué es/);
  assert.match(revisarItem({ empresa_id: "e1", descripcion: "x", cantidad: "abc", unidad: "pza" }) ?? "", /cantidad/);
  assert.match(revisarItem({ empresa_id: "e1", descripcion: "x", cantidad: -1, unidad: "pza" }) ?? "", /cantidad/);
  assert.match(revisarItem({ empresa_id: "e1", descripcion: "x", cantidad: "1,200", unidad: "" }) ?? "", /unidad/);
  assert.equal(revisarItem({ empresa_id: "e1", descripcion: "x", cantidad: "1,200", unidad: "kg" }), null, "acepta comas de miles");
});

test("urlEtiqueta, administraConteo y fechaHoyMx", () => {
  assert.equal(urlEtiqueta("INV-AEP-0001"), "/inventario/conteo?item=INV-AEP-0001");
  assert.equal(urlEtiqueta("INV AEP", "https://acumulado-nine.vercel.app"), "https://acumulado-nine.vercel.app/inventario/conteo?item=INV%20AEP");
  assert.equal(administraConteo("almacen"), true);
  assert.equal(administraConteo("supervisor"), false);
  assert.equal(fechaHoyMx(new Date("2026-11-20T03:00:00Z")), "2026-11-19", "a las 9 pm de México sigue siendo el 19");
});

test("resumenConteo: por persona y empresa, ordenado por nombre", () => {
  const r = resumenConteo(items, empresas);
  assert.deepEqual(r.map((x) => [x.persona, x.empresa, x.items, x.cantidad]), [["Alma", "Aceros", 2, 122.5], ["Jaime", "Clavicón", 1, 10]]);
  assert.equal(r[0].primero, "2026-11-19T15:00:00Z");
  assert.equal(r[0].ultimo, "2026-11-19T16:00:00Z");
});

test("filtrarItems: empresa, persona y texto sin acentos", () => {
  assert.equal(filtrarItems(items, { empresa: "e2" }).length, 1);
  assert.equal(filtrarItems(items, { persona: "u1" }).length, 2);
  assert.deepEqual(filtrarItems(items, { texto: "alambron" }).map((i) => i.id), ["2"]);
  assert.deepEqual(filtrarItems(items, { texto: "rack 0001" }).map((i) => i.id), ["1", "3"]);
});

test("csvConteo y htmlEtiquetas", () => {
  const csv = csvConteo(items.slice(0, 1), empresas);
  const lineas = csv.split("\n");
  assert.equal(lineas[0], "Código,Empresa,Descripción,Cantidad,Unidad,Ubicación,Código de barras,Contó,Fecha y hora,Notas");
  assert.match(lineas[1], /^INV-AEP-0001,Aceros,Varilla 3\/8,120,pza,Rack A,,Alma,19\/11\/2026 09:00,$/);
  const html = htmlEtiquetas([{ codigo: "INV-AEP-0001", descripcion: "Varilla <3/8>", cantidad: 120, unidad: "pza", ubicacion: "Rack A", empresa: "Aceros", qrSvg: "<svg/>" }], "Etiquetas");
  assert.match(html, /INV-AEP-0001/);
  assert.match(html, /Varilla &lt;3\/8&gt;/);
  assert.match(html, /Aceros · 120 pza · Rack A/);
  assert.match(html, /<svg\/>/);
});
