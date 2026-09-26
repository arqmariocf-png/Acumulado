import { test } from "node:test";
import assert from "node:assert/strict";
import { avanceRequisiciones, puedeMarcarEtapa, semaforoEtapa, siguienteEtapa } from "./requisicionEtapa.ts";

test("colores por tramo del flujo", () => {
  assert.equal(semaforoEtapa("solicitada").color, "rojo");
  assert.equal(semaforoEtapa("autorizada").color, "rojo");
  assert.equal(semaforoEtapa("pagada").color, "ambar");
  assert.equal(semaforoEtapa("suministro").color, "ambar");
  assert.equal(semaforoEtapa("en_bodega").color, "azul");
  assert.equal(semaforoEtapa("en_transito").color, "azul");
  assert.equal(semaforoEtapa("recibida").color, "verde");
  assert.equal(semaforoEtapa("recibida", true).color, "gris");
});

test("avance 0 % al inicio y 100 % recibida", () => {
  assert.equal(semaforoEtapa("solicitada").pct, 0);
  assert.equal(semaforoEtapa("recibida").pct, 100);
  assert.equal(siguienteEtapa("solicitada"), "autorizada");
  assert.equal(siguienteEtapa("recibida"), null);
});

test("quién marca cada etapa (misma regla que la base)", () => {
  assert.equal(puedeMarcarEtapa("empresa", "autorizada"), true);
  assert.equal(puedeMarcarEtapa("empresa", "pagada"), false);
  assert.equal(puedeMarcarEtapa("direccion", "pagada"), true);
  assert.equal(puedeMarcarEtapa("almacen", "en_bodega"), true);
  assert.equal(puedeMarcarEtapa("supervisor", "recibida"), false);
  assert.equal(puedeMarcarEtapa("supervisor", "recibida", true), true);
  assert.equal(puedeMarcarEtapa("admin", "pagada"), true);
});

test("avance promedio ignora canceladas", () => {
  assert.equal(avanceRequisiciones([]), null);
  assert.equal(avanceRequisiciones([{ etapa: "recibida", estado: "resuelta" }, { etapa: "solicitada", estado: "enviada" }, { etapa: "recibida", estado: "cancelada" }]), 50);
});
