import { test } from "node:test";
import assert from "node:assert/strict";
import { agregarAlCarrito, buscarPorCodigo, corteCaja, filtrarProductos, htmlTicket, importeLinea, precioConUtilidad, revisarPagos, revisarPrecio, utilidadDePrecio, totalesCarrito, type LineaCarrito } from "./puntoVenta.ts";

const linea = (precio: number, cantidad: number, descuentoPct = 0): LineaCarrito => ({ productoId: `p${precio}`, nombre: "x", sku: null, unidad: "pza", precio, cantidad, descuentoPct, ivaTasa: 0.16 });

test("importes y desglose de IVA con precios con IVA incluido", () => {
  assert.equal(importeLinea(linea(116, 2)), 232);
  assert.equal(importeLinea(linea(100, 3, 10)), 270);
  assert.deepEqual(totalesCarrito([linea(116, 2), linea(58, 1)]), { total: 290, subtotal: 250, iva: 40, piezas: 3 });
});

test("agregar al carrito suma cantidad del mismo producto", () => {
  const base = { productoId: "a", nombre: "Clavo", sku: "CL1", unidad: "kg", precio: 40, ivaTasa: 0.16 };
  let c = agregarAlCarrito([], base);
  c = agregarAlCarrito(c, base);
  assert.equal(c.length, 1);
  assert.equal(c[0].cantidad, 2);
});

test("pagos: falta, cambio del efectivo y límites", () => {
  assert.equal(revisarPagos(232, [{ metodo: "efectivo", monto: 300 }]).cambio, 68);
  assert.equal(revisarPagos(232, [{ metodo: "efectivo", monto: 100 }]).falta, 132);
  assert.match(revisarPagos(232, [{ metodo: "efectivo", monto: 100 }]).error ?? "", /Falta/);
  assert.match(revisarPagos(232, [{ metodo: "tarjeta", monto: 300 }]).error ?? "", /no pueden pasar/);
  const mixto = revisarPagos(232, [{ metodo: "tarjeta", monto: 132 }, { metodo: "efectivo", monto: 200 }]);
  assert.equal(mixto.error, null);
  assert.equal(mixto.cambio, 100);
  assert.equal(revisarPagos(232, [{ metodo: "credito", monto: 232 }]).error, null);
});

test("búsqueda por código de barras, SKU y texto", () => {
  const ps = [
    { id: "1", nombre: "Clavo estándar 2½\"", sku: "CL-25", codigo_barras: "7501234567890" },
    { id: "2", nombre: "Malla electrosoldada", sku: "ME-66", codigo_barras: null },
  ];
  assert.equal(buscarPorCodigo(ps, " 7501234567890 ")?.id, "1");
  assert.equal(buscarPorCodigo(ps, "me-66")?.id, "2");
  assert.equal(buscarPorCodigo(ps, "nada"), null);
  assert.deepEqual(filtrarProductos(ps, "malla electro").map((p) => p.id), ["2"]);
  assert.equal(filtrarProductos(ps, "").length, 2);
});

test("corte de caja", () => {
  assert.deepEqual(corteCaja({ fondo_inicial: 500, efectivo: 232, ingresos: 0, retiros: 100 }, 630), { esperado: 632, diferencia: -2 });
  assert.equal(corteCaja({ fondo_inicial: 500, efectivo: 0, ingresos: 0, retiros: 0 }, null).diferencia, null);
});

test("ticket con folio en código de barras", () => {
  const h = htmlTicket({ empresa: "AEP", folio: "PV-AEP-0001", fecha: "10/10/2026 18:00", lineas: [{ descripcion: "Clavo <2>", cantidad: 2, precio: 116, descuentoPct: 0 }], pagos: [{ metodo: "efectivo", monto: 232 }], cambio: 68 });
  assert.ok(h.includes("PV-AEP-0001"));
  assert.ok(h.includes("<svg"));
  assert.ok(h.includes("Clavo &lt;2&gt;"));
  assert.ok(h.includes("$232.00"));
  assert.ok(h.includes("Cambio"));
});

test("precio con % de utilidad sobre el costo y utilidad positiva", () => {
  // Costo $100 s/IVA + 30 % = $130 s/IVA = $150.80 c/IVA.
  assert.equal(precioConUtilidad(100, 30), 150.8);
  assert.equal(utilidadDePrecio(150.8, 100), 30);
  assert.equal(utilidadDePrecio(150.8, null), null);
  assert.equal(revisarPrecio(150.8, 100), null);
  assert.match(revisarPrecio(116, 100)!, /no hay utilidad/);
  assert.match(revisarPrecio(100, 100)!, /no hay utilidad/);
  assert.match(revisarPrecio(0, null)!, /mayor a cero/);
  assert.equal(revisarPrecio(50, null), null); // sin costo no se puede revisar
});
