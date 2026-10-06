import { test } from "node:test";
import assert from "node:assert/strict";
import { diasEntre, htmlResponsivaEpp, porDescontar, semaforoVigencia, valorEnPoder, type LineaEpp } from "./epp.ts";

const l = (o: Partial<LineaEpp>): LineaEpp => ({
  id: "x",
  descripcion: "Casco",
  talla: null,
  cantidad: 1,
  unidad: "pza",
  costo_unitario: 150,
  vigencia_meses: 12,
  origen: "bodega",
  estado: "entregado",
  entregado_en: "2026-10-06",
  vence_el: "2027-10-06",
  devuelto_en: null,
  descuento_monto: null,
  descuento_aplicado_en: null,
  ...o,
});

test("semáforo de vigencia: solo lo que trae puesto", () => {
  assert.equal(semaforoVigencia(l({}), "2026-10-06"), "vigente");
  assert.equal(semaforoVigencia(l({}), "2027-09-10"), "por_vencer");
  assert.equal(semaforoVigencia(l({}), "2027-10-07"), "vencido");
  assert.equal(semaforoVigencia(l({ estado: "devuelto" }), "2027-10-07"), "sin_vigencia");
  assert.equal(semaforoVigencia(l({ vence_el: null }), "2027-10-07"), "sin_vigencia");
  assert.equal(diasEntre("2026-10-06", "2026-11-05"), 30);
});

test("valor en poder y descuentos pendientes", () => {
  const lineas = [
    l({ cantidad: 2, costo_unitario: 150 }),
    l({ estado: "devuelto" }),
    l({ estado: "perdido", descuento_monto: 900 }),
    l({ estado: "perdido", descuento_monto: 100, descuento_aplicado_en: "2026-10-15" }),
  ];
  assert.equal(valorEnPoder(lineas), 300);
  assert.equal(porDescontar(lineas), 900);
});

test("responsiva: solo lo entregado, con valor y vigencia, y escapa texto", () => {
  const html = htmlResponsivaEpp({
    folio: "EPP-CSC-0001",
    fecha: "2026-10-06",
    empresa_nombre: "Constructora <LOMA>",
    empresa_codigo: "CSC",
    obra: "Obra EPP",
    trabajador: "Trabajador EPP",
    puesto: "Ayudante",
    entrega_nombre: "Raúl",
    lineas: [l({ descripcion: "Botas", talla: "27", costo_unitario: 900, vence_el: "2027-04-06" }), l({ descripcion: "Guantes", estado: "por_surtir" })],
  });
  assert.match(html, /CARTA RESPONSIVA/);
  assert.match(html, /Botas <span class="t">talla 27<\/span>/);
  assert.match(html, /6 de abril de 2027/);
  assert.doesNotMatch(html, /Guantes/);
  assert.match(html, /Constructora &lt;LOMA&gt;/);
  assert.match(html, /artículo 110/);
  assert.match(html, /\$900\.00/);
});
