import { test } from "node:test";
import assert from "node:assert/strict";
import { cantidadSugerida, seguimientoLinea, validarEvento, type EventoLinea, type TipoEvento } from "./seguimientoLinea.ts";

let n = 0;
const ev = (tipo: TipoEvento, cantidad: number | null, nota: string | null = null): EventoLinea => ({
  id: String(++n),
  requisicion_linea_id: "l1",
  tipo,
  cantidad,
  nota,
  created_by: "u",
  created_by_nombre: "Jonathan",
  created_at: `2026-09-29T10:${String(n).padStart(2, "0")}:00Z`,
});

test("sin marcas: sin pedir y todo por pedir", () => {
  const s = seguimientoLinea(10, []);
  assert.equal(s.estado, "sin_pedir");
  assert.equal(s.porPedir, 10);
  assert.equal(s.porEntregar, 10);
});

test("pedido completo y entrega parcial", () => {
  const s = seguimientoLinea(10, [ev("pedido", 10), ev("entregado", 4)]);
  assert.equal(s.estado, "entregado_parcial");
  assert.equal(s.pedido, 10);
  assert.equal(s.entregado, 4);
  assert.equal(s.porPedir, 0);
  assert.equal(s.porEntregar, 6);
});

test("cambio: baja lo entregado pero no lo pedido; la reposición completa", () => {
  const eventos = [ev("pedido", 10), ev("entregado", 10), ev("cambio", 2, "venían dobladas")];
  let s = seguimientoLinea(10, eventos);
  assert.equal(s.entregado, 8);
  assert.equal(s.pedido, 10);
  assert.equal(s.enCambio, 2);
  assert.equal(s.porEntregar, 2);
  assert.equal(s.estado, "entregado_parcial");
  assert.equal(s.comentarios.length, 1);
  s = seguimientoLinea(10, [...eventos, ev("entregado", 2)]);
  assert.equal(s.estado, "entregado");
  assert.equal(s.porEntregar, 0);
});

test("devolución: baja pedido y entregado (no se repone)", () => {
  const s = seguimientoLinea(10, [ev("pedido", 10), ev("entregado", 10), ev("devolucion", 3, "sobraron")]);
  assert.equal(s.pedido, 7);
  assert.equal(s.entregado, 7);
  assert.equal(s.porPedir, 3);
  assert.equal(s.devuelto, 3);
});

test("comentarios del más nuevo al más viejo", () => {
  const a = ev("comentario", null, "primero");
  const b = ev("comentario", null, "segundo");
  const s = seguimientoLinea(1, [a, b]);
  assert.deepEqual(s.comentarios.map((c) => c.nota), ["segundo", "primero"]);
});

test("cantidades sugeridas", () => {
  const s = seguimientoLinea(10, [ev("pedido", 6), ev("entregado", 5)]);
  assert.equal(cantidadSugerida("pedido", 10, s), 4);
  assert.equal(cantidadSugerida("entregado", 10, s), 5);
  assert.equal(cantidadSugerida("cambio", 10, s), 5);
});

test("validaciones", () => {
  const s = seguimientoLinea(10, [ev("entregado", 4)]);
  assert.equal(validarEvento("comentario", null, "  ", s), "Escribe el comentario.");
  assert.equal(validarEvento("pedido", 0, "", s), "La cantidad debe ser mayor a 0.");
  assert.match(validarEvento("cambio", 2, "", s) ?? "", /motivo/);
  assert.match(validarEvento("devolucion", 5, "no sirve", s) ?? "", /lo entregado/);
  assert.equal(validarEvento("devolucion", 4, "no sirve", s), null);
});
