// Items del catálogo de compras en el conteo (19-nov-2026, Laura: "en el
// sistema tenemos más de 4 mil ítems"). El conteo etiqueta `productos` (por
// empresa, clave ART-<EMP>-####); el catálogo de Catálogos › Items
// (`compras_items`, por organización) trae 8,263 materiales del backoffice.
// Aquí se decide cuáles items todavía no son producto de la empresa y cómo
// se buscan; darlos de alta lo hace fn_conteo_alta_productos_desde_items.

export interface ItemParaConteo {
  id: string;
  clave: string;
  descripcion: string;
  unidad: string | null;
  categoria: string;
  activo: boolean;
}

export interface ProductoExistente {
  id: string;
  nombre: string;
  sku?: string | null;
  clave_control?: string | null;
}

/** Texto comparable: sin acentos, minúsculas, espacios colapsados (igual que normalizar_texto_sql para lo que importa). */
export function claveTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Items que se cuentan (material, equipo, consumible, herramienta, otro): los servicios no se inventarían. */
export function itemsContables<T extends ItemParaConteo>(items: T[]): T[] {
  return items.filter((i) => i.activo && i.categoria !== "servicio");
}

export interface ItemConProducto<T extends ItemParaConteo> {
  item: T;
  /** El producto de la empresa con el mismo nombre, si ya existe. */
  producto: ProductoExistente | null;
}

/** Cruza cada item con el producto de la empresa que tenga el mismo nombre normalizado. */
export function cruzarItemsConProductos<T extends ItemParaConteo>(items: T[], productos: ProductoExistente[]): ItemConProducto<T>[] {
  const porNombre = new Map<string, ProductoExistente>();
  for (const p of productos) {
    const k = claveTexto(p.nombre);
    if (!porNombre.has(k)) porNombre.set(k, p);
  }
  return items.map((item) => ({ item, producto: porNombre.get(claveTexto(item.descripcion)) ?? null }));
}

/** Filtra por texto (palabras en cualquier orden) sobre clave, descripción y la clave ART- si ya la tiene. */
export function filtrarItemsConteo<T extends ItemParaConteo>(lista: ItemConProducto<T>[], texto: string, soloSinProducto = false): ItemConProducto<T>[] {
  const t = claveTexto(texto);
  const partes = t ? t.split(" ") : [];
  return lista.filter((x) => {
    if (soloSinProducto && x.producto) return false;
    if (!partes.length) return true;
    const pajar = claveTexto([x.item.clave, x.item.descripcion, x.producto?.clave_control ?? "", x.producto?.sku ?? ""].join(" "));
    return partes.every((p) => pajar.includes(p));
  });
}

/** Reparte una lista de ids en lotes del tamaño que acepta la función de alta. */
export function lotes<T>(lista: T[], tamano = 500): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) r.push(lista.slice(i, i + tamano));
  return r;
}
