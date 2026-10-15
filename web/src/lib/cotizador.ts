// Cotizador para todas las empresas (15-oct-2026, Mario: "tomaremos los
// mismos productos y los mismos clientes y la lógica de la de Clavicón para
// cada una de las empresas"). Misma lógica que lib/cotizacionPlanta.ts
// (precio s/IVA en la base, captura con IVA incluido, margen interno contra
// el costo, impresión sin costos); aquí se arma la lista de productos de la
// empresa juntando:
//   1. producto terminado de la planta (Clavicón/Balken) con su costo PEPS;
//   2. el catálogo de productos de la empresa (costo de referencia, precio
//      de venta con IVA);
//   3. lo ya vendido en órdenes de venta (último precio s/IVA).
// El costo de lo que no es de planta sale de la última compra con la misma
// descripción (OC, s/IVA) o del costo de referencia del catálogo.

import { normalizarBusqueda, type ItemCatalogo } from "./buscadorCaptura.ts";

export type OrigenProducto = "planta" | "catalogo" | "vendido";

export interface ProductoCotizador {
  clave: string;
  descripcion: string;
  unidad: string;
  /** Precio de venta sugerido SIN IVA (último vendido o de lista). */
  precio: number | null;
  /** Costo unitario SIN IVA para el margen interno. */
  costo: number | null;
  costoOrigen: "peps" | "ultima_compra" | "referencia" | null;
  origen: OrigenProducto;
  /** productos_produccion.id (solo planta). */
  productoPlantaId: string | null;
  existencia: number | null;
  veces: number;
}

export interface ProductoPlanta {
  id: string;
  nombre: string;
  calibre: string | null;
  unidad_medida: string | null;
  costo: number | null;
  existencia: number | null;
}

export interface ProductoCatalogo {
  nombre: string;
  unidad_medida: string | null;
  costo_referencia: number | null;
  /** Con IVA. */
  precio_venta: number | null;
  iva_tasa: number | null;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function armarProductos(fuentes: { planta?: ProductoPlanta[]; catalogo?: ProductoCatalogo[]; vendidos?: ItemCatalogo[]; compras?: ItemCatalogo[] }): ProductoCotizador[] {
  // Último costo de compra por descripción (el catálogo ya trae el más
  // reciente por proveedor; aquí gana la fecha más nueva).
  const ultimaCompra = new Map<string, { precio: number; ultima: string }>();
  for (const c of fuentes.compras ?? []) {
    if (c.precio == null || !(Number(c.precio) > 0)) continue;
    const k = normalizarBusqueda(c.descripcion);
    const previo = ultimaCompra.get(k);
    if (!previo || (c.ultima ?? "") > previo.ultima) ultimaCompra.set(k, { precio: Number(c.precio), ultima: c.ultima ?? "" });
  }
  const costoCompra = (desc: string) => ultimaCompra.get(normalizarBusqueda(desc))?.precio ?? null;

  const porClave = new Map<string, ProductoCotizador>();
  const agregar = (p: ProductoCotizador) => {
    const previo = porClave.get(p.clave);
    if (!previo) {
      porClave.set(p.clave, p);
      return;
    }
    // Ya estaba (de una fuente con más prioridad): completa lo que le falte.
    if (previo.precio == null && p.precio != null) previo.precio = p.precio;
    if (previo.costo == null && p.costo != null) {
      previo.costo = p.costo;
      previo.costoOrigen = p.costoOrigen;
    }
    previo.veces += p.veces;
  };

  for (const p of fuentes.planta ?? []) {
    const descripcion = `${p.nombre.trim()}${p.calibre ? ` ${p.calibre.trim()}` : ""}`;
    agregar({ clave: normalizarBusqueda(descripcion), descripcion, unidad: p.unidad_medida || "pza", precio: null, costo: p.costo != null ? Number(p.costo) : null, costoOrigen: p.costo != null ? "peps" : null, origen: "planta", productoPlantaId: p.id, existencia: p.existencia, veces: 0 });
  }
  for (const p of fuentes.catalogo ?? []) {
    const compra = costoCompra(p.nombre);
    const costo = compra ?? (p.costo_referencia != null ? Number(p.costo_referencia) : null);
    agregar({
      clave: normalizarBusqueda(p.nombre),
      descripcion: p.nombre.trim(),
      unidad: p.unidad_medida || "pza",
      precio: p.precio_venta != null ? r4(Number(p.precio_venta) / (1 + Number(p.iva_tasa ?? 0.16))) : null,
      costo,
      costoOrigen: compra != null ? "ultima_compra" : costo != null ? "referencia" : null,
      origen: "catalogo",
      productoPlantaId: null,
      existencia: null,
      veces: 0,
    });
  }
  for (const v of fuentes.vendidos ?? []) {
    const compra = costoCompra(v.descripcion);
    agregar({
      clave: normalizarBusqueda(v.descripcion),
      descripcion: v.descripcion.trim(),
      unidad: v.unidad || "pza",
      precio: v.precio != null ? Number(v.precio) : null,
      costo: compra,
      costoOrigen: compra != null ? "ultima_compra" : null,
      origen: "vendido",
      productoPlantaId: null,
      existencia: null,
      veces: v.veces,
    });
  }
  const orden: Record<OrigenProducto, number> = { planta: 0, catalogo: 1, vendido: 2 };
  return [...porClave.values()].sort((a, b) => orden[a.origen] - orden[b.origen] || b.veces - a.veces || a.descripcion.localeCompare(b.descripcion, "es"));
}

/** Por palabras, sin acentos; lo que empieza igual primero. Sin texto: los
 * de planta y catálogo, luego lo más vendido. */
export function buscarProductos(lista: ProductoCotizador[], texto: string, limite = 15): ProductoCotizador[] {
  const ps = normalizarBusqueda(texto).split(" ").filter(Boolean);
  if (ps.length === 0) return lista.slice(0, limite);
  const frase = ps.join(" ");
  return lista
    .filter((p) => ps.every((w) => p.clave.includes(w)))
    .map((p) => ({ p, s: p.clave === frase ? 3 : p.clave.startsWith(frase) ? 2 : 1 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limite)
    .map((x) => x.p);
}

export function detalleProducto(p: ProductoCotizador, conIva: boolean, veCosto: boolean): string {
  const $ = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const origen = p.origen === "planta" ? "planta" : p.origen === "catalogo" ? "catálogo" : `vendido ${p.veces} ${p.veces === 1 ? "vez" : "veces"}`;
  const precio = p.precio != null ? `precio ${$(conIva ? p.precio * 1.16 : p.precio)} ${conIva ? "c/IVA" : "s/IVA"}` : null;
  const costo = veCosto && p.costo != null ? `costo ${$(p.costo)} s/IVA${p.costoOrigen === "ultima_compra" ? " (última compra)" : p.costoOrigen === "peps" ? " (PEPS)" : ""}` : null;
  const exist = p.existencia != null ? `existencia ${p.existencia}` : null;
  return [p.unidad, origen, precio, costo, exist].filter(Boolean).join(" · ");
}

/** Partidas de la cotización → partidas de la OV IA (costo = precio s/IVA). */
export function lineasParaOrdenVenta(lineas: { descripcion: string; unidad: string; cantidad: number; precio_unitario: number }[]): { item: string; unidad: string; cantidad: number; costo: number; iva: boolean }[] {
  return lineas.map((l) => ({ item: l.descripcion, unidad: l.unidad, cantidad: Number(l.cantidad), costo: Math.round(Number(l.precio_unitario) * 100) / 100, iva: true }));
}
