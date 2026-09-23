import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPorEmpresa, htmlSaldosEmpresas, type FilaSaldoCuenta } from "./saldosEmpresas.ts";

const fila = (x: Partial<FilaSaldoCuenta>): FilaSaldoCuenta => ({
  cuenta_id: "c", empresa_id: "e1", empresa_nombre: "Ergodinova", banco: "BBVA", ultimos_4: "1234", alias: null,
  saldo_inicial: 100, entradas: 50, salidas: 20, saldo_final: 130, ajuste_saldo: 0, tiene_movimientos: true, ...x,
});

test("agruparPorEmpresa suma por empresa y total, ordenado por nombre", () => {
  const { grupos, total } = agruparPorEmpresa([
    fila({ cuenta_id: "a", empresa_id: "e2", empresa_nombre: "Balken", saldo_inicial: 10, entradas: 0, salidas: 5, saldo_final: 5 }),
    fila({ cuenta_id: "b" }),
    fila({ cuenta_id: "c2", saldo_inicial: 1, entradas: 1, salidas: 0, saldo_final: 2 }),
  ]);
  assert.deepEqual(grupos.map((g) => g.empresa_nombre), ["Balken", "Ergodinova"]);
  assert.equal(grupos[1].cuentas.length, 2);
  assert.equal(grupos[1].saldo_final, 132);
  assert.equal(total.saldo_inicial, 111);
  assert.equal(total.saldo_final, 137);
});

test("htmlSaldosEmpresas escapa y muestra totales", () => {
  const { grupos, total } = agruparPorEmpresa([fila({ empresa_nombre: "A & B <SA>" })]);
  const html = htmlSaldosEmpresas("22 de septiembre de 2026", grupos, total, "Laura");
  assert.match(html, /A &amp; B &lt;SA&gt;/);
  assert.match(html, /Total grupo/);
  assert.match(html, /elaboró Laura/);
  assert.match(html, /\$130\.00/);
});
