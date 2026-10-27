// Excel (CSV) de los catálogos de compras (27-oct-2026, Laura: "no le salen
// todos los proveedores y todos los ítems"): la pantalla recortaba a 300
// renglones; ahora se ven todos y además se bajan completos a Excel.
import type { ContraparteCatalogo } from "./buscadorCaptura.ts";
import { etiquetaCategoria, type ItemCompra } from "./catalogoItems.ts";

const celda = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const fila = (r: unknown[]) => r.map(celda).join(",");

export const COLUMNAS_EXCEL_ITEMS = ["Clave", "Descripción", "Unidad", "Categoría", "Precio ref. s/IVA", "IVA", "Notas", "Activo"];

export function csvItemsCatalogo(items: ItemCompra[]): string {
  const renglones = [fila(COLUMNAS_EXCEL_ITEMS)];
  for (const i of items) {
    renglones.push(fila([i.clave, i.descripcion, i.unidad ?? "", etiquetaCategoria(i.categoria), i.precio_referencia == null ? "" : Number(i.precio_referencia).toFixed(2), i.iva ? "sí" : "no", i.notas ?? "", i.activo ? "sí" : "no"]));
  }
  return renglones.join("\n");
}

export const COLUMNAS_EXCEL_PROVEEDORES = ["Proveedor", "RFC", "Cuenta", "CLABE", "Órdenes", "Última orden", "Ficha"];

export function csvProveedoresCatalogo(lista: ContraparteCatalogo[]): string {
  const renglones = [fila(COLUMNAS_EXCEL_PROVEEDORES)];
  for (const c of lista) {
    renglones.push(fila([c.nombre, c.rfc ?? "", c.cuenta ?? "", c.clabe ?? "", c.veces || 0, c.ultima ?? "", c.ficha ? "con ficha" : "solo en órdenes"]));
  }
  return renglones.join("\n");
}
