import { test } from "node:test";
import assert from "node:assert/strict";
import { csvHistorico, resumenPorConcepto, totalesHistorico, type CompraHistorico } from "./historicoCostos.ts";

const base = { iva: true, empresa: "MCC", proyecto: "Corporativo CLAVICON", fuente: "api" };
const compras: CompraHistorico[] = [
  { ...base, descripcion: "ALAMBRON 5.5 mm", unidad: "KG", fecha: "2026-10-09", precio: 15.8, cantidad: 5000, folio: "41300" },
  { ...base, descripcion: "Alambrón 5.5 MM", unidad: "KG", fecha: "2026-09-25", precio: 16.07, cantidad: 5695, folio: "40995" },
  { ...base, descripcion: "ALAMBRON 5.5 mm", unidad: "KG", fecha: "2026-10-01", precio: 15.8, cantidad: 1000, folio: "41100" },
  { ...base, descripcion: "Flete", unidad: "SRV", fecha: "2026-10-09", precio: 2000, cantidad: 1, folio: "41301" },
  { ...base, descripcion: "Sin precio", unidad: "PZA", fecha: "2026-10-09", precio: 0, cantidad: 1, folio: "41302" },
];

test("agrupa por concepto sin acentos ni mayúsculas y calcula último, anterior distinto y variación", () => {
  const r = resumenPorConcepto(compras);
  assert.equal(r.length, 2);
  const a = r.find((x) => x.descripcion.startsWith("ALAMBRON"))!;
  assert.equal(a.compras, 3);
  assert.equal(a.ultimo, 15.8);
  assert.equal(a.ultimaFecha, "2026-10-09");
  // El 15.80 del 1-oct no cuenta como "anterior": es el mismo precio.
  assert.equal(a.anterior, 16.07);
  assert.equal(a.anteriorFecha, "2026-09-25");
  assert.equal(a.variacion, -1.7);
  assert.equal(a.minimo, 15.8);
  assert.equal(a.maximo, 16.07);
  // Promedio ponderado por cantidad.
  assert.equal(a.promedio, Math.round(((15.8 * 6000 + 16.07 * 5695) / 11695) * 100) / 100);
  assert.equal(a.cantidad, 11695);
  const f = r.find((x) => x.descripcion === "Flete")!;
  assert.equal(f.anterior, null);
  assert.equal(f.variacion, null);
});

test("totales del proveedor", () => {
  const t = totalesHistorico(resumenPorConcepto(compras));
  assert.deepEqual({ ...t, importe: Math.round(t.importe) }, { conceptos: 2, compras: 4, subieron: 0, bajaron: 1, importe: Math.round(15.8 * 6000 + 16.07 * 5695 + 2000) });
});

test("CSV con comillas y BOM para Excel", () => {
  const csv = csvHistorico("Aceros, S.A.", compras.slice(0, 1));
  assert.ok(csv.startsWith("﻿Proveedor,Fecha"));
  assert.match(csv, /"Aceros, S\.A\.",2026-10-09,41300,MCC,Corporativo CLAVICON,ALAMBRON 5\.5 mm,KG,5000,15\.80,79000\.00/);
});
