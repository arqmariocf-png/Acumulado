import { test } from "node:test";
import assert from "node:assert/strict";
import { contarSemaforoPu, semaforoPu, PASOS_PU } from "./puSemaforo.ts";

test("borrador y revisión de material son rojo (interno, arranque)", () => {
  assert.equal(semaforoPu("borrador", null).color, "rojo");
  assert.equal(semaforoPu("en_revision_material", null).color, "rojo");
  assert.equal(semaforoPu("borrador", null).paso, 1);
});

test("material confirmado y autorizado son ámbar (interno, dirección/publicación)", () => {
  assert.equal(semaforoPu("material_confirmado", null).color, "ambar");
  assert.equal(semaforoPu("autorizado", null).color, "ambar");
  assert.equal(semaforoPu("autorizado", null).grupo, "interno");
});

test("publicado sin cliente es azul; con cliente, verde y 100 %", () => {
  const sinCliente = semaforoPu("publicado", null);
  assert.equal(sinCliente.color, "azul");
  assert.equal(sinCliente.grupo, "cliente");
  assert.equal(sinCliente.paso, PASOS_PU - 1);
  const conCliente = semaforoPu("publicado", "2026-09-26T10:00:00Z");
  assert.equal(conCliente.color, "verde");
  assert.equal(conCliente.pct, 100);
});

test("la autorización del cliente solo cuenta sobre publicado", () => {
  assert.equal(semaforoPu("autorizado", "2026-09-26T10:00:00Z").color, "ambar");
});

test("obsoleto es gris y no entra al avance", () => {
  const c = contarSemaforoPu([
    { estado: "obsoleto", cliente_autorizado_en: null },
    { estado: "publicado", cliente_autorizado_en: "2026-09-26T10:00:00Z" },
    { estado: "borrador", cliente_autorizado_en: null },
  ]);
  assert.equal(c.total, 3);
  assert.equal(c.obsoleto, 1);
  assert.equal(c.autorizado, 1);
  assert.equal(c.interno, 1);
  assert.equal(c.avance_pct, Math.round((100 + Math.round(100 / PASOS_PU)) / 2));
});
