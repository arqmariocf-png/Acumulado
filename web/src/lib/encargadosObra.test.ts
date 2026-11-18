import { test } from "node:test";
import assert from "node:assert/strict";
import { esDeLaObra, obrasParaPedir, puedeAsignarEncargados, puedeConfirmarObra, textoConfirmarObra } from "./encargadosObra.ts";

const brenda = { id: "b", rol: "supervisor" };
const obra = { id: "o1", responsable_id: "r", comprador_id: null };

test("puedeAsignarEncargados: admin, corporativo, dirección y empresa", () => {
  assert.equal(puedeAsignarEncargados("direccion"), true);
  assert.equal(puedeAsignarEncargados("empresa"), true);
  assert.equal(puedeAsignarEncargados("supervisor"), false);
  assert.equal(puedeAsignarEncargados(null), false);
});

test("esDeLaObra: responsable, comprador o encargada", () => {
  assert.equal(esDeLaObra({ id: "r", rol: "responsable" }, obra, []), true);
  assert.equal(esDeLaObra(brenda, obra, []), false);
  assert.equal(esDeLaObra(brenda, obra, ["o1"]), true);
  assert.equal(esDeLaObra(brenda, obra, new Set(["o2"])), false);
});

test("puedeConfirmarObra: quien pidió, los de la obra y los que procesan; nunca cancelada o recibida", () => {
  const req = { estado: "enviada", etapa: "en_bodega", solicitado_por: "x", proyecto_id: "o1", proyectos: obra };
  assert.equal(puedeConfirmarObra({ id: "x", rol: "administrativo" }, req, []), true);
  assert.equal(puedeConfirmarObra(brenda, req, []), false);
  assert.equal(puedeConfirmarObra(brenda, req, ["o1"]), true);
  assert.equal(puedeConfirmarObra({ id: "l", rol: "direccion" }, req, []), true);
  assert.equal(puedeConfirmarObra({ id: "a", rol: "almacen" }, req, []), false);
  assert.equal(puedeConfirmarObra({ id: "x", rol: "administrativo" }, { ...req, estado: "cancelada" }, []), false);
  assert.equal(puedeConfirmarObra({ id: "x", rol: "administrativo" }, { ...req, etapa: "recibida" }, []), false);
  assert.equal(puedeConfirmarObra(null, req, ["o1"]), false);
});

test("obrasParaPedir: el responsable solo sus obras (incluidas las encargadas); los demás todas las visibles", () => {
  const obras = [obra, { id: "o2", responsable_id: null, comprador_id: null }];
  assert.deepEqual(obrasParaPedir({ id: "r", rol: "responsable" }, obras, []).map((o) => o.id), ["o1"]);
  assert.deepEqual(obrasParaPedir({ id: "r", rol: "responsable" }, obras, ["o2"]).map((o) => o.id), ["o1", "o2"]);
  assert.deepEqual(obrasParaPedir(brenda, obras, []).map((o) => o.id), ["o1", "o2"]);
  assert.deepEqual(obrasParaPedir(null, obras, []), []);
});

test("textoConfirmarObra según lo que falta", () => {
  assert.equal(textoConfirmarObra(null), "Ya lo recibí todo en obra");
  assert.equal(textoConfirmarObra({ partidas: 6, en_obra: 0 }), "Ya lo recibí todo en obra");
  assert.equal(textoConfirmarObra({ partidas: 6, en_obra: 2 }), "Ya recibí en obra lo que falta (4 de 6)");
});
