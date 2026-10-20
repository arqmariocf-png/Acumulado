import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarCandidatas, numerosEnConcepto, ordenarCandidatas, puedeLigarOrden, type OrdenCandidata } from "./ligarOrden.ts";

const oc = (numero: string, extra: Partial<OrdenCandidata> = {}): OrdenCandidata => ({
  id: numero,
  numero,
  tipo: "OC",
  contraparte: null,
  proyecto: null,
  total: 100,
  saldo: 100,
  fecha: "2026-10-01",
  ...extra,
});

test("números de orden en el concepto del banco", () => {
  assert.deepEqual(numerosEnConcepto("SPEI ENVIADO BAJIO/0028066829 030 0191026OC 41492 CSC"), ["41492"]);
  assert.deepEqual(numerosEnConcepto("PAGO O.C. 41001 Y OS-41002"), ["41001", "41002"]);
  assert.deepEqual(numerosEnConcepto("ORDEN 15340 cliente"), ["15340"]);
  assert.deepEqual(numerosEnConcepto("COMISION 123"), []);
  assert.deepEqual(numerosEnConcepto("DOC 41492"), []);
  assert.deepEqual(numerosEnConcepto(null), []);
});

test("primero la que nombra el concepto, luego mismo monto, luego fecha cercana", () => {
  const lista = [
    oc("41000", { fecha: "2026-10-18" }),
    oc("41001", { total: 2175.38, saldo: 0, fecha: "2026-09-01" }),
    oc("41002", { fecha: "2026-10-19" }),
    oc("41492", { total: 9999, saldo: 9999, fecha: "2026-08-01" }),
  ];
  const r = ordenarCandidatas(lista, { monto: 2175.38, fecha: "2026-10-19", concepto: "SPEI 0191026OC 41492 CSC" });
  assert.deepEqual(r.map((o) => o.numero), ["41492", "41001", "41002", "41000"]);
  assert.equal(r[0].enConcepto, true);
  assert.equal(r[1].mismoMonto, true);
  assert.equal(r[2].mismoMonto, false);
});

test("filtro por número, proveedor o proyecto sin acentos", () => {
  const lista = [oc("41492", { contraparte: "Cementos Cruz Azul" }), oc("41500", { proyecto: "Parque Réal 63" })];
  assert.deepEqual(filtrarCandidatas(lista, "414").map((o) => o.numero), ["41492"]);
  assert.deepEqual(filtrarCandidatas(lista, "azul cruz").map((o) => o.numero), ["41492"]);
  assert.deepEqual(filtrarCandidatas(lista, "real").map((o) => o.numero), ["41500"]);
  assert.equal(filtrarCandidatas(lista, "  ").length, 2);
});

test("solo se liga lo no conciliado", () => {
  assert.equal(puedeLigarOrden("pendiente_revision"), true);
  assert.equal(puedeLigarOrden("ambiguo"), true);
  assert.equal(puedeLigarOrden("resuelto"), false);
});
