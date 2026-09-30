import { test } from "node:test";
import assert from "node:assert/strict";
import { cierrePedido, csvNomina, porPreparar, puedePedir, resumenNomina, totalSeleccion, type PedidoComedor } from "./comedor.ts";

test("hora límite en hora de México", () => {
  assert.equal(cierrePedido("2026-10-01", "11:00").toISOString(), "2026-10-01T17:00:00.000Z");
  assert.equal(puedePedir("2026-10-01", "11:00", new Date("2026-10-01T16:59:00Z")), true);
  assert.equal(puedePedir("2026-10-01", "11:00", new Date("2026-10-01T17:01:00Z")), false);
});

test("total de lo elegido", () => {
  const menu = [
    { platillo_id: "a", nombre: "Comida corrida", precio: 65 },
    { platillo_id: "b", nombre: "Agua", precio: 15 },
  ];
  assert.equal(totalSeleccion(menu, { a: 1, b: 2 }), 95);
  assert.equal(totalSeleccion(menu, { a: -3 }), 0);
});

const p = (o: Partial<PedidoComedor>): PedidoComedor => ({
  id: Math.random().toString(),
  fecha: "2026-10-01",
  profile_id: "u1",
  trabajador_nombre: "Ana",
  empresa_trabajador_id: "e1",
  empresa_trabajador: "Aceros",
  estado: "entregado",
  total: 65,
  piezas: 1,
  detalle: "1 Comida corrida",
  descuento_aplicado_en: null,
  ...o,
});

test("nómina: solo entregado; separa aplicado de pendiente", () => {
  const r = resumenNomina([
    p({}),
    p({ total: 80, descuento_aplicado_en: "2026-10-02" }),
    p({ estado: "pedido", total: 999 }),
    p({ estado: "cancelado", total: 999 }),
    p({ profile_id: "u2", trabajador_nombre: "Beto", total: 15 }),
  ]);
  assert.equal(r.length, 2);
  const ana = r.find((x) => x.trabajador === "Ana")!;
  assert.equal(ana.comidas, 2);
  assert.equal(ana.pendiente, 65);
  assert.equal(ana.aplicado, 80);
  assert.equal(ana.total, 145);
});

test("CSV con BOM y comillas", () => {
  const csv = csvNomina(resumenNomina([p({ trabajador_nombre: 'Ana "La" Pérez' })]), "2026-10-01", "2026-10-15");
  assert.ok(csv.startsWith("﻿"));
  assert.match(csv, /"Ana ""La"" Pérez"/);
  assert.match(csv, /"65.00"/);
});

test("por preparar suma piezas por platillo y omite cancelados", () => {
  assert.deepEqual(
    porPreparar([p({ detalle: "1 Comida corrida, 2 Agua" }), p({ detalle: "1 Comida corrida" }), p({ estado: "cancelado", detalle: "5 Agua" })]),
    [
      { platillo: "Comida corrida", piezas: 2 },
      { platillo: "Agua", piezas: 2 },
    ],
  );
});
