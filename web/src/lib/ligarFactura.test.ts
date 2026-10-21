import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claveNombre,
  esFolioFiscal,
  filtrarFacturas,
  folioDeFactura,
  ordenarFacturas,
  puedeLigarFactura,
  terminoBusqueda,
  type FacturaCandidata,
} from "./ligarFactura.ts";

const f = (folio: string, extra: Partial<FacturaCandidata> = {}): FacturaCandidata => ({
  id: folio,
  folio,
  rfc: null,
  contraparte: null,
  total: 100,
  fecha: "2026-10-01",
  complemento: false,
  ...extra,
});

test("primero el mismo monto, luego la misma contraparte, luego la fecha más cercana", () => {
  const lista = ordenarFacturas(
    [
      f("A", { total: 500, contraparte: "Cemex SA de CV", fecha: "2026-10-10" }),
      f("B", { total: 1000, fecha: "2026-09-01" }),
      f("C", { total: 500, fecha: "2026-10-09" }),
      f("D", { total: 1000.5, contraparte: "CEMEX, S.A. DE C.V.", fecha: "2026-08-01" }),
    ],
    { monto: 1000, fecha: "2026-10-10", nombre: "SPEI CEMEX" },
  );
  assert.deepEqual(lista.map((x) => x.folio), ["D", "B", "A", "C"]);
  assert.equal(lista[0].mismoMonto, true);
  assert.equal(lista[0].mismaContraparte, true);
  assert.equal(lista[2].mismaContraparte, true);
});

test("claveNombre quita razón social y puntuación", () => {
  assert.equal(claveNombre("Bodega Cruz Azul, S.A. de C.V."), "bodega cruz azul");
  assert.equal(claveNombre("Pinturerías S. de R.L."), "pinturerias");
});

test("filtra por folio fiscal, RFC o nombre sin acentos", () => {
  const lista = [
    f("A3E54ADE-8F75-46B3-8479-B6EA73F94376", { rfc: "CEM880726UZA", contraparte: "Cemex" }),
    f("F-1203", { rfc: "PIN010101AAA", contraparte: "Pinturerías" }),
  ];
  assert.deepEqual(filtrarFacturas(lista, "a3e54ade").map((x) => x.folio), ["A3E54ADE-8F75-46B3-8479-B6EA73F94376"]);
  assert.deepEqual(filtrarFacturas(lista, "pinturerias 1203").map((x) => x.folio), ["F-1203"]);
  assert.deepEqual(filtrarFacturas(lista, "cem880726").map((x) => x.contraparte), ["Cemex"]);
  assert.equal(filtrarFacturas(lista, "  ").length, 2);
});

test("folio fiscal y término de búsqueda", () => {
  assert.equal(esFolioFiscal(" a3e54ade-8f75-46b3-8479-b6ea73f94376 "), true);
  assert.equal(esFolioFiscal("1203"), false);
  assert.equal(terminoBusqueda(" 41,(2)%  x "), "41 2 x");
});

test("se ofrece ligar si no está conciliado o si la factura fue F-/FM-", () => {
  assert.equal(puedeLigarFactura("pendiente_revision", null), true);
  assert.equal(puedeLigarFactura("pendiente_esperado", null), true);
  assert.equal(puedeLigarFactura("resuelto", "F- ABC"), true);
  assert.equal(puedeLigarFactura("resuelto", "FM- ABC"), true);
  assert.equal(puedeLigarFactura("resuelto", "N/A - COMISION BANCARIA"), false);
  assert.equal(puedeLigarFactura("resuelto", null), false);
});

test("folioDeFactura lee el folio de F- y FM-", () => {
  assert.equal(folioDeFactura("FM- ABC-1"), "ABC-1");
  assert.equal(folioDeFactura("F- 99"), "99");
  assert.equal(folioDeFactura("N/A - X"), null);
});
