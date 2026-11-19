import { test } from "node:test";
import assert from "node:assert/strict";
import { nombreAlmacen, revisarAlmacen, administraConteo, claveArticulo, csvConteo, fechaHoyMx, filtrarItems, filtrarProductos, htmlEtiquetas, resumenConteo, revisarHerramientaNueva, revisarItem, urlEtiqueta, urlEtiquetaHerramienta, urlEtiquetaProducto, type ItemConteo } from "./conteoInventario.ts";

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
  assert.equal(lineas[0], "Código,Empresa,Almacén,Descripción,Cantidad,Unidad,Ubicación,Código de barras,Contó,Fecha y hora,Notas");
  assert.match(lineas[1], /^INV-AEP-0001,Aceros,,Varilla 3\/8,120,pza,Rack A,,Alma,19\/11\/2026 09:00,$/);
  const html = htmlEtiquetas([{ codigo: "INV-AEP-0001", descripcion: "Varilla <3/8>", cantidad: 120, unidad: "pza", ubicacion: "Rack A", empresa: "Aceros", qrSvg: "<svg/>" }], "Etiquetas");
  assert.match(html, /INV-AEP-0001/);
  assert.match(html, /Varilla &lt;3\/8&gt;/);
  assert.match(html, /Aceros · 120 pza · Rack A/);
  assert.match(html, /<svg\/>/);
});

test("etiquetas de artículos del catálogo: liga por producto, sin cantidad, y filtro", () => {
  assert.equal(urlEtiquetaProducto("abc"), "/inventario/conteo?producto=abc");
  const html = htmlEtiquetas([{ codigo: "VAR-38", descripcion: "Varilla 3/8", cantidad: null, unidad: "pza", ubicacion: null, empresa: "Aceros", qrSvg: "<svg/>" }], "Artículos");
  assert.match(html, /Aceros · pza</);
  assert.doesNotMatch(html, /null/);
  const productos = [
    { id: "1", sku: "VAR-38", nombre: "Varilla 3/8 R42", unidad_medida: "pza" },
    { id: "2", sku: "ALA-55", nombre: "Alambrón 5.5", unidad_medida: "kg" },
  ];
  assert.deepEqual(filtrarProductos(productos, "alambron").map((p) => p.id), ["2"]);
  assert.deepEqual(filtrarProductos(productos, "var 42").map((p) => p.id), ["1"]);
  assert.equal(filtrarProductos(productos, "").length, 2);
});

test("herramienta desde el conteo: validación y QR de control por folio", () => {
  assert.equal(revisarHerramientaNueva({ empresa_id: "e1", nombre: "Taladro", piezas: "" }), null, "sin piezas = 1");
  assert.equal(revisarHerramientaNueva({ empresa_id: "e1", nombre: "Taladro", piezas: 3 }), null);
  assert.match(revisarHerramientaNueva({ empresa_id: "", nombre: "Taladro", piezas: 1 }) ?? "", /empresa/);
  assert.match(revisarHerramientaNueva({ empresa_id: "e1", nombre: " ", piezas: 1 }) ?? "", /herramienta/);
  assert.match(revisarHerramientaNueva({ empresa_id: "e1", nombre: "Taladro", piezas: "2.5" }) ?? "", /1 a 100/);
  assert.match(revisarHerramientaNueva({ empresa_id: "e1", nombre: "Taladro", piezas: 101 }) ?? "", /1 a 100/);
  assert.equal(urlEtiquetaHerramienta("HE-MCC-0001", "https://x"), "https://x/inventario/conteo?herramienta=HE-MCC-0001");
});

test("claveArticulo: la clave de control antes que el sku del match", () => {
  assert.equal(claveArticulo({ sku: "OC-MWE0CL1R-17", clave_control: "ART-AEP-0001" }), "ART-AEP-0001");
  assert.equal(claveArticulo({ sku: "OC-MWE0CL1R-17", clave_control: null }), "OC-MWE0CL1R-17");
  assert.equal(claveArticulo({ sku: null, clave_control: null, codigo_barras: "750" }), "750");
});

test("almacenes con nombre: validación, nombre y filtro por almacén", () => {
  const existentes = [{ id: "a1", nombre: "Almacén principal" }, { id: "a2", nombre: "Zona BBVA" }];
  assert.match(revisarAlmacen("  ", existentes) ?? "", /nombre/);
  assert.match(revisarAlmacen("zona  bbva", existentes) ?? "", /Ya hay/);
  assert.equal(revisarAlmacen("Zona BBVA", existentes, "a2"), null, "renombrar al mismo nombre no choca consigo");
  assert.equal(revisarAlmacen("Herrería", existentes), null);
  const nombres = new Map([["a1", "Almacén principal"]]);
  assert.equal(nombreAlmacen("a1", nombres), "Almacén principal");
  assert.equal(nombreAlmacen(null, nombres), "—");
  const base = { conteo_id: "c", empresa_id: "e", descripcion: "x", cantidad: 1, unidad: "pza", ubicacion: null, codigo_barras: null, notas: null, contado_por: "p", contado_por_nombre: "P", created_at: "2026-11-19T10:00:00Z" };
  const items = [
    { ...base, id: "1", codigo: "INV-1", almacen_id: "a1" },
    { ...base, id: "2", codigo: "INV-2", almacen_id: "a2" },
    { ...base, id: "3", codigo: "INV-3", almacen_id: null },
  ];
  assert.deepEqual(filtrarItems(items, { almacen: "a1" }).map((i) => i.id), ["1"]);
  assert.deepEqual(filtrarItems(items, { almacen: "sin" }).map((i) => i.id), ["3"]);
  assert.equal(filtrarItems(items, {}).length, 3);
  const csv = csvConteo(items, new Map([["e", "AEP"]]), nombres);
  assert.match(csv.split("\n")[0], /Código,Empresa,Almacén,Descripción/);
  assert.match(csv.split("\n")[1], /^INV-1,AEP,Almacén principal,x/);
  assert.match(csv.split("\n")[3], /^INV-3,AEP,,x/);
});
