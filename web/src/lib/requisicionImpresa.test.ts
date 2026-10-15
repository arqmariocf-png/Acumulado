import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlRequisicion, tituloRequisicion } from "./requisicionImpresa.ts";

const doc = {
  folio: 57,
  fecha: "2026-10-15",
  empresa_nombre: "Ergodinova <SA>",
  empresa_rfc: "ERG010101AAA",
  proyecto: "Paseo 6 Ampliación",
  solicitante: "Alberto Temalatzi",
  estado: "enviada",
  comentario: "Urge para el lunes",
  impreso: "15/10/2026 09:30",
};

const lineas = [
  { descripcion: "Cemento gris", unidad: "bulto", solicitado: 20, pedido: 20, enBodega: 5, enCamino: 10, enObra: 10, porEntregar: 10 },
  { descripcion: "Varilla 3/8\"", unidad: "pza", solicitado: 12.5 },
];

test("requisición para la cuadrilla: folio, obra, renglones y firmas, vertical", () => {
  const html = htmlRequisicion(doc, lineas, "requisicion", "/logos/erg.png");
  assert.match(html, /REQUISICIÓN DE MATERIAL/);
  assert.match(html, /#57/);
  assert.match(html, /15 de octubre de 2026/);
  assert.match(html, /Paseo 6 Ampliación/);
  assert.match(html, /Alberto Temalatzi/);
  assert.match(html, /Cemento gris/);
  assert.match(html, /12\.5/);
  assert.match(html, /Urge para el lunes/);
  assert.match(html, /Vo\. Bo\./);
  assert.match(html, /portrait/);
  assert.doesNotMatch(html, /Por entregar/);
  // Escapa lo que viene de la captura.
  assert.match(html, /Ergodinova &lt;SA&gt;/);
  assert.match(html, /Varilla 3\/8&quot;/);
});

test("hoja de entrega para almacén: seguimiento, columnas para contar y horizontal", () => {
  const html = htmlRequisicion(doc, lineas, "entrega", null);
  assert.match(html, /HOJA DE ENTREGA DE MATERIAL/);
  assert.match(html, /landscape/);
  assert.match(html, /En bodega/);
  assert.match(html, /Recibido en obra/);
  assert.match(html, /Entregado hoy/);
  assert.match(html, /Recibe en obra/);
  // Partida con seguimiento: solicitado, bodega, enviado, en obra, por entregar.
  assert.match(html, /<td class="r">20<\/td>\s*<td class="r">5<\/td>\s*<td class="r">10<\/td>\s*<td class="r">10<\/td>\s*<td class="r b">10<\/td>/);
  assert.doesNotMatch(html, /<img/);
});

test("sin renglones no rompe la tabla", () => {
  const html = htmlRequisicion({ ...doc, comentario: null }, [], "entrega", null);
  assert.match(html, /Sin renglones\./);
  assert.match(html, /colspan="11"/);
  assert.doesNotMatch(html, /Comentario de quien pidió/);
});

test("título de la pestaña según el formato", () => {
  assert.equal(tituloRequisicion(57, "requisicion"), "Requisición 57");
  assert.equal(tituloRequisicion(57, "entrega"), "Hoja de entrega requisición 57");
});
