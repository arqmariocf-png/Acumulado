import test from "node:test";
import assert from "node:assert/strict";
import { csvItemsCatalogo, csvProveedoresCatalogo } from "./catalogoExcel.ts";

test("Excel del catálogo de items con todos los renglones", () => {
  const csv = csvItemsCatalogo([
    { id: "1", clave: "IT-0001", descripcion: 'Varilla 3/8 "corrugada"', unidad: "pza", categoria: "material", iva: true, precio_referencia: 150.5, notas: null, activo: true },
    { id: "2", clave: "IT-0002", descripcion: "Flete", unidad: null, categoria: "servicio", iva: false, precio_referencia: null, notas: "por viaje", activo: false },
  ]);
  const l = csv.split("\n");
  assert.equal(l.length, 3);
  assert.equal(l[0], '"Clave","Descripción","Unidad","Categoría","Precio ref. s/IVA","IVA","Notas","Activo"');
  assert.equal(l[1], '"IT-0001","Varilla 3/8 ""corrugada""","pza","Material","150.50","sí","","sí"');
  assert.match(l[2], /^"IT-0002","Flete","","Servicio","","no","por viaje","no"$/);
});

test("Excel de proveedores con RFC, cuenta y CLABE", () => {
  const csv = csvProveedoresCatalogo([
    { nombre: "Cemex", rfc: "CEM123", cuenta: "123456", clabe: "012650001127363818", veces: 12, ultima: "2026-10-20", misma_empresa: true, ficha: true },
    { nombre: "Fletes El Rayo", veces: 0, ultima: null, misma_empresa: false },
  ]);
  const l = csv.split("\n");
  assert.equal(l[0], '"Proveedor","RFC","Cuenta","CLABE","Órdenes","Última orden","Ficha"');
  assert.equal(l[1], '"Cemex","CEM123","123456","012650001127363818","12","2026-10-20","con ficha"');
  assert.equal(l[2], '"Fletes El Rayo","","","","0","","solo en órdenes"');
});
