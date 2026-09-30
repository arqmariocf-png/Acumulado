import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlOrdenCompra, totalesConIvaIncluido, totalesOrdenCompra } from "./ordenCompraRq.ts";

test("totalesOrdenCompra calcula IVA por partida", () => {
  const t = totalesOrdenCompra([
    { item: "Cemento", unidad: "saco", cantidad: 10, costo: 200, iva: true },
    { item: "Flete", unidad: "servicio", cantidad: 1, costo: 500, iva: false },
  ]);
  assert.deepEqual(t, { subtotal: 2500, iva: 320, total: 2820 });
});

test("htmlOrdenCompra escapa texto y muestra folio, proveedor, requisición y sello", () => {
  const html = htmlOrdenCompra(
    {
      id_orden: "RQ-ERG-0001",
      fecha: "2026-09-29",
      empresa_nombre: "Ergodinova <SA>",
      empresa_rfc: "ERG010101AAA",
      empresa_codigo: "ERG",
      proveedor: "Aceros & Cía",
      proyecto: "Nave 40",
      requisicion_folio: 7,
      solicitante: "Jonathan",
      creada_por: "Alma",
      autorizada_en: null,
      autorizada_por: null,
      nota: null,
    },
    [{ item: "Varilla 3/8", unidad: "pza", cantidad: 2, costo: 150, iva: true }],
    "/logos/erg.png",
  );
  assert.match(html, /RQ-ERG-0001/);
  assert.match(html, /sin datos bancarios capturados/);
  assert.match(html, /Ergodinova &lt;SA&gt;/);
  assert.match(html, /Aceros &amp; Cía/);
  assert.match(html, /#7 · solicitó Jonathan/);
  assert.match(html, /PENDIENTE DE AUTORIZAR/);
  assert.match(html, /29 de septiembre de 2026/);
  assert.match(html, /\/logos\/erg\.png/);
  assert.doesNotMatch(html, /<SA>/);
});

test("htmlOrdenCompra con autorización muestra el sello y quién autorizó", () => {
  const html = htmlOrdenCompra(
    { id_orden: "RQ-ERG-0002", fecha: "2026-09-29", empresa_nombre: "ERG", empresa_rfc: null, empresa_codigo: "ERG", proveedor: null, proyecto: null, requisicion_folio: null, solicitante: null, creada_por: null, autorizada_en: "2026-09-30T10:00:00Z", autorizada_por: "Laura", nota: "urgente" },
    [],
    null,
  );
  assert.match(html, /AUTORIZADA 30 de septiembre de 2026/);
  assert.match(html, /Laura/);
  assert.match(html, /urgente/);
  assert.doesNotMatch(html, /<img/);
});

test("htmlOrdenCompra imprime forma de pago, banco y CLABE cuando existen", () => {
  const html = htmlOrdenCompra(
    { id_orden: "41007", fecha: "2026-09-25", empresa_nombre: "AEP", empresa_rfc: null, empresa_codigo: "AEP", proveedor: "Cruz Azul", proyecto: null, requisicion_folio: null, solicitante: null, creada_por: null, autorizada_en: null, autorizada_por: null, nota: null, forma_pago: "Crédito · transferencia", banco: "BBVA", clabe: "012180001234567897", cuenta: null, beneficiario: "BODEGA CRUZ AZUL DEL CENTRO SA DE CV" },
    [],
    null,
  );
  assert.match(html, /Crédito · transferencia/);
  assert.match(html, /BODEGA CRUZ AZUL DEL CENTRO SA DE CV · BBVA · CLABE 012180001234567897/);
});

test("OC del backoffice: el costo ya trae IVA, no se suma 16 % encima (41054)", () => {
  const t = totalesConIvaIncluido([{ item: "Material", unidad: "pza", cantidad: 1, costo: 612.79, iva: true }]);
  assert.deepEqual(t, { subtotal: 528.27, iva: 84.52, total: 612.79 });
  const html = htmlOrdenCompra(
    { id_orden: "41054", fecha: "2026-09-29", empresa_nombre: "CSC", empresa_rfc: null, empresa_codigo: "CSC", proveedor: "Ferretería", proyecto: null, requisicion_folio: null, solicitante: null, creada_por: null, autorizada_en: null, autorizada_por: null, nota: null, rfc_proveedor: "FER010101AB1", precios_con_iva: true, autorizada_backoffice: true, importes: { subtotal: 528.27, iva: 84.52, total: 612.79 } },
    [{ item: "Material", unidad: "pza", cantidad: 1, costo: 612.79, iva: true }],
    null,
  );
  assert.match(html, /Ferretería · RFC FER010101AB1/);
  assert.match(html, /AUTORIZADA EN BACKOFFICE/);
  assert.match(html, /\$ 612\.79<\/td><\/tr>\s*<\/tfoot>/);
  assert.doesNotMatch(html, /710\.84/);
});
