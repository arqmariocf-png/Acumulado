import { test } from "node:test";
import assert from "node:assert/strict";
import { almacenesTablero, articulosTablero, lugaresTablero, personasTablero, serieTiempo, textoHace, totalesTablero } from "./tableroConteo.ts";
import type { ItemConteo } from "./conteoInventario.ts";

const ahora = new Date("2026-11-19T18:00:00Z");
const item = (x: Partial<ItemConteo>): ItemConteo => ({
  id: x.codigo ?? "i",
  conteo_id: "c",
  empresa_id: "aep",
  codigo: "INV-AEP-0001",
  descripcion: "Varilla 3/8",
  cantidad: 10,
  unidad: "pza",
  ubicacion: "BOD-R01-N1",
  codigo_barras: null,
  notas: null,
  contado_por: "brenda",
  contado_por_nombre: "Brenda",
  created_at: "2026-11-19T17:55:00Z",
  ...x,
});

const items: ItemConteo[] = [
  item({ codigo: "INV-AEP-0001", created_at: "2026-11-19T16:00:00Z", ubicacion: "BOD-R01-N1" }),
  item({ codigo: "INV-AEP-0002", created_at: "2026-11-19T17:55:00Z", ubicacion: "BOD-R02-N1", cantidad: 5.5 }),
  item({ codigo: "INV-AEP-0003", contado_por: "alma", contado_por_nombre: "Alma", created_at: "2026-11-19T17:20:00Z", ubicacion: null, descripcion: "varilla  3/8 ", cantidad: 2 }),
  item({ codigo: "INV-MCC-0001", contado_por: "alma", contado_por_nombre: "Alma", empresa_id: "mcc", created_at: "2026-11-19T17:30:00Z", ubicacion: "BOD-R01-N1", producto_id: "p1", descripcion: "Alambrón", unidad: "kg", cantidad: 100 }),
];

test("personasTablero: activa en los últimos 10 min, último lugar, ritmo de la última hora", () => {
  const p = personasTablero(items, ahora);
  assert.deepEqual(p.map((x) => x.persona), ["Brenda", "Alma"], "la activa primero");
  assert.equal(p[0].activa, true);
  assert.equal(p[0].minutos_sin_capturar, 5);
  assert.equal(p[0].ultima_ubicacion, "BOD-R02-N1");
  assert.equal(p[0].items, 2);
  assert.equal(p[0].cantidad, 15.5);
  assert.equal(p[0].ultima_hora, 1, "la de las 16:00 ya no cuenta en la última hora");
  assert.equal(p[1].activa, false);
  assert.equal(p[1].minutos_sin_capturar, 30);
  assert.equal(p[1].ultima_ubicacion, "BOD-R01-N1", "el ítem sin ubicación no borra el último lugar conocido");
  assert.deepEqual(p[1].empresas, ["aep", "mcc"]);
});

test("lugaresTablero y totalesTablero", () => {
  const l = lugaresTablero(items);
  assert.equal(l[0].ubicacion, "BOD-R01-N1");
  assert.equal(l[0].items, 2);
  assert.deepEqual(l[0].personas, ["Brenda", "Alma"]);
  assert.ok(l.some((x) => x.ubicacion === "(sin ubicación)"));
  const t = totalesTablero(items, personasTablero(items, ahora));
  assert.equal(t.personas, 2);
  assert.equal(t.activas, 1);
  assert.equal(t.items, 4);
  assert.equal(t.cantidad, 117.5);
  assert.equal(t.lugares, 2, "los lugares reales, sin contar 'sin ubicación'");
  assert.equal(t.empresas, 2);
  assert.equal(t.ultima_captura, "2026-11-19T17:55:00Z");
});

test("articulosTablero: por producto con su clave de control, o por descripción normalizada", () => {
  const a = articulosTablero(items, new Map([["p1", "ART-MCC-0007"]]));
  assert.equal(a[0].clave, "ART-MCC-0007");
  assert.equal(a[0].cantidad, 100);
  const varilla = a.find((x) => x.descripcion === "Varilla 3/8");
  assert.equal(varilla?.cantidad, 17.5, "'varilla  3/8 ' se junta con 'Varilla 3/8'");
  assert.equal(varilla?.renglones, 3);
  assert.deepEqual(varilla?.lugares, ["BOD-R01-N1", "BOD-R02-N1"]);
});

test("serieTiempo por tramos de 15 min y textoHace", () => {
  const s = serieTiempo(items, ahora, 15);
  assert.equal(s.length, 9, "de las 16:00 a las 18:00 son 9 tramos");
  assert.equal(s[0].items, 1);
  assert.equal(s[s.length - 1].items, 0);
  assert.equal(s.reduce((n, t) => n + t.items, 0), 4);
  assert.equal(textoHace(0), "ahora mismo");
  assert.equal(textoHace(7), "hace 7 min");
  assert.equal(textoHace(65), "hace 1 h 05 min");
});

test("almacenesTablero: por empresa y almacén, lo sin almacén al final", () => {
  const conAlmacen = items.map((i, n) => ({ ...i, almacen_id: n % 2 === 0 ? "alm1" : null }));
  const a = almacenesTablero(conAlmacen, new Map([["alm1", "Bodega de material"]]));
  assert.ok(a.length >= 2);
  const bod = a.find((x) => x.almacen_id === "alm1");
  assert.equal(bod?.nombre, "Bodega de material");
  assert.equal(bod?.items, conAlmacen.filter((i) => i.almacen_id === "alm1").length);
  assert.ok(a.filter((x) => x.almacen_id === null).every((x) => x.nombre === "sin almacén"));
  const porEmpresa = a.filter((x) => x.empresa_id === a[0].empresa_id);
  assert.ok(!(porEmpresa[0].almacen_id === null && porEmpresa.length > 1), "con almacén primero");
});
