// Catálogo propio de items de compras (21-oct-2026, Mario: "para compras, un
// módulo para agregar nuevos items"): clave, descripción, unidad, categoría,
// IVA y precio de referencia SIN IVA, sin necesidad de proveedor. Aquí lo que
// la pantalla necesita sin red: revisar el item, sugerir la clave, avisar de
// duplicados y filtrar. Puro, con pruebas.

import { normalizarBusqueda } from "./buscadorCaptura.ts";

export type CategoriaItem = "material" | "herramienta" | "equipo" | "servicio" | "consumible" | "otro";

export const CATEGORIAS_ITEM: { valor: CategoriaItem; etiqueta: string }[] = [
  { valor: "material", etiqueta: "Material" },
  { valor: "consumible", etiqueta: "Consumible" },
  { valor: "herramienta", etiqueta: "Herramienta" },
  { valor: "equipo", etiqueta: "Equipo" },
  { valor: "servicio", etiqueta: "Servicio" },
  { valor: "otro", etiqueta: "Otro" },
];

export interface ItemCompra {
  id: string;
  clave: string;
  descripcion: string;
  unidad: string | null;
  categoria: CategoriaItem;
  iva: boolean;
  precio_referencia: number | null;
  notas: string | null;
  activo: boolean;
}

export interface FormItem {
  clave: string;
  descripcion: string;
  unidad: string;
  categoria: string;
  precio: string;
}

/** Devuelve el problema a corregir o null si el item se puede guardar. */
export function revisarItem(f: FormItem): string | null {
  const descripcion = f.descripcion.trim();
  if (descripcion.length < 3) return "Escribe la descripción del item (al menos 3 letras).";
  if (!CATEGORIAS_ITEM.some((c) => c.valor === f.categoria)) return "Elige la categoría.";
  const clave = f.clave.trim();
  if (clave && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/.test(clave)) return "La clave lleva solo letras, números, guion o punto (hasta 20).";
  if (f.precio.trim() !== "") {
    const p = Number(f.precio);
    if (!Number.isFinite(p) || p < 0) return "El precio de referencia no es válido.";
  }
  return null;
}

/** Siguiente clave IT-0001 (la base hace lo mismo si se deja en blanco). */
export function claveSugerida(items: Pick<ItemCompra, "clave">[]): string {
  const max = items.reduce((m, i) => {
    const r = /^IT-(\d+)$/.exec(i.clave.toUpperCase());
    return r ? Math.max(m, Number(r[1])) : m;
  }, 0);
  return `IT-${String(max + 1).padStart(4, "0")}`;
}

/** Igual sin acentos ni mayúsculas = duplicado; con todas las palabras = parecido. */
export function posiblesDuplicados<T extends Pick<ItemCompra, "id" | "descripcion">>(
  items: T[],
  descripcion: string,
  excluirId?: string | null,
): { exacto: T | null; parecidos: T[] } {
  const n = normalizarBusqueda(descripcion);
  if (n.length < 3) return { exacto: null, parecidos: [] };
  const ps = n.split(" ");
  const otros = items.filter((i) => i.id !== excluirId);
  const exacto = otros.find((i) => normalizarBusqueda(i.descripcion) === n) ?? null;
  const parecidos = otros
    .filter((i) => i !== exacto)
    .filter((i) => {
      const d = normalizarBusqueda(i.descripcion);
      return ps.every((p) => d.includes(p)) || d.split(" ").every((p) => n.includes(p));
    })
    .slice(0, 5);
  return { exacto, parecidos };
}

/** Por palabras en cualquier orden (descripción o clave), sin acentos. */
export function filtrarCatalogo<T extends ItemCompra>(items: T[], texto: string, categoria: CategoriaItem | "" = "", incluirInactivos = false): T[] {
  const ps = normalizarBusqueda(texto).split(" ").filter(Boolean);
  return items
    .filter((i) => (incluirInactivos || i.activo) && (!categoria || i.categoria === categoria))
    .filter((i) => {
      const campo = normalizarBusqueda(`${i.clave} ${i.descripcion}`);
      return ps.every((p) => campo.includes(p));
    })
    .sort((a, b) => Number(b.activo) - Number(a.activo) || a.descripcion.localeCompare(b.descripcion, "es"));
}

/** Sugerencias del catálogo para un renglón (requisición o artículo de proveedor). */
export function sugerirItems<T extends ItemCompra>(items: T[], texto: string, limite = 8): T[] {
  if (normalizarBusqueda(texto).length < 2) return [];
  return filtrarCatalogo(items, texto).slice(0, limite);
}

export function etiquetaCategoria(c: string): string {
  return CATEGORIAS_ITEM.find((x) => x.valor === c)?.etiqueta ?? c;
}
