import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoLinea, htmlComprobanteEntrada, urlAvanceOc } from "./comprobanteEntrada.ts";

test("estadoLinea distingue faltante, excedente, completa y sin partida", () => {
  assert.equal(estadoLinea({ pedido: 100, recibido_total: 80, unidad: "PZA" }).clase, "falta");
  assert.match(estadoLinea({ pedido: 100, recibido_total: 80, unidad: "PZA" }).texto, /Faltan 20 PZA/);
  assert.equal(estadoLinea({ pedido: 100, recibido_total: 120, unidad: "KG" }).clase, "excede");
  assert.match(estadoLinea({ pedido: 100, recibido_total: 120, unidad: "KG" }).texto, /Excedente de 20 KG/);
  assert.equal(estadoLinea({ pedido: 100, recibido_total: 100, unidad: "PZA" }).clase, "ok");
  assert.equal(estadoLinea({ pedido: null, recibido_total: null, unidad: "PZA" }).clase, "sin");
});

test("htmlComprobanteEntrada arma folio, QR, filas y resumen", () => {
  const url = urlAvanceOc("https://acumulado-nine.vercel.app", "abc");
  assert.equal(url, "https://acumulado-nine.vercel.app/inventario/match?oc=abc");
  const html = htmlComprobanteEntrada(
    {
      folio: "ENT-1A2B3C4D",
      fecha: "2026-09-24",
      empresa_nombre: "Aceros & Envasados",
      almacen_nombre: "Almacén principal",
      orden: "OC 40921",
      proveedor: "Industrial <de> Alambres",
      registrado_por_nombre: "Laura",
      con_evidencia_foto: true,
    },
    [
      { nombre: "Alambrón 5.5", sku: "ALAMBRON", unidad: "KG", cantidad: 2800, pedido: 2845, recibido_total: 2800 },
      { nombre: "Clavo", sku: "CLAVO", unidad: "KG", cantidad: 30, pedido: 25, recibido_total: 30 },
    ],
    "<svg/>",
    url,
  );
  assert.match(html, /ENT-1A2B3C4D/);
  assert.match(html, /Aceros &amp; Envasados/);
  assert.match(html, /Industrial &lt;de&gt; Alambres/);
  assert.match(html, /24 de septiembre de 2026/);
  assert.match(html, /Faltan 45 KG/);
  assert.match(html, /Excedente de 5 KG/);
  assert.match(html, /1 partida\(s\) con faltante/);
  assert.match(html, /1 partida\(s\) con excedente/);
  assert.match(html, /Foto de la nota adjunta/);
  assert.ok(html.includes(url));
});
