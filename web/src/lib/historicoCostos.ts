// Histórico de costos por proveedor (15-oct-2026, Mario: "también es
// importante tener el histórico por proveedor de costos"). Las compras salen
// de fn_proveedor_historico_costos (cada partida de OC con precio s/IVA); aquí
// se resumen por concepto: último precio, el anterior, variación, mínimo,
// máximo y promedio ponderado por cantidad.

import { normalizarBusqueda } from "./buscadorCaptura.ts";

export interface CompraHistorico {
  descripcion: string;
  unidad: string | null;
  fecha: string;
  /** Precio unitario SIN IVA. */
  precio: number;
  cantidad: number | null;
  iva: boolean | null;
  folio: string;
  empresa: string | null;
  proyecto: string | null;
  fuente: string | null;
}

export interface ResumenConcepto {
  clave: string;
  descripcion: string;
  unidad: string | null;
  compras: number;
  cantidad: number;
  ultimo: number;
  ultimaFecha: string;
  anterior: number | null;
  anteriorFecha: string | null;
  /** % del último contra el precio anterior distinto (null si no hay). */
  variacion: number | null;
  minimo: number;
  maximo: number;
  promedio: number;
  historial: CompraHistorico[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Por concepto, del que se compró más recientemente al más viejo. */
export function resumenPorConcepto(compras: CompraHistorico[]): ResumenConcepto[] {
  const grupos = new Map<string, CompraHistorico[]>();
  for (const c of compras) {
    if (!(Number(c.precio) > 0)) continue;
    const k = normalizarBusqueda(c.descripcion);
    grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  const resumen: ResumenConcepto[] = [];
  for (const [clave, lista] of grupos) {
    const orden = [...lista].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.folio.localeCompare(a.folio, "es", { numeric: true }));
    const u = orden[0];
    const ultimo = Number(u.precio);
    // El "anterior" es el último precio distinto: comprar tres veces al mismo
    // precio no es una variación.
    const prev = orden.find((c) => Math.abs(Number(c.precio) - ultimo) >= 0.005);
    const precios = orden.map((c) => Number(c.precio));
    const cantidad = orden.reduce((s, c) => s + Math.max(0, Number(c.cantidad ?? 0)), 0);
    const ponderado = cantidad > 0 ? orden.reduce((s, c) => s + Number(c.precio) * Math.max(0, Number(c.cantidad ?? 0)), 0) / cantidad : precios.reduce((s, p) => s + p, 0) / precios.length;
    resumen.push({
      clave,
      descripcion: u.descripcion,
      unidad: orden.find((c) => c.unidad)?.unidad ?? null,
      compras: orden.length,
      cantidad: r2(cantidad),
      ultimo: r2(ultimo),
      ultimaFecha: u.fecha,
      anterior: prev ? r2(Number(prev.precio)) : null,
      anteriorFecha: prev?.fecha ?? null,
      variacion: prev ? Math.round(((ultimo - Number(prev.precio)) / Number(prev.precio)) * 1000) / 10 : null,
      minimo: r2(Math.min(...precios)),
      maximo: r2(Math.max(...precios)),
      promedio: r2(ponderado),
      historial: orden,
    });
  }
  return resumen.sort((a, b) => b.ultimaFecha.localeCompare(a.ultimaFecha) || b.compras - a.compras || a.descripcion.localeCompare(b.descripcion, "es"));
}

/** Total comprado (s/IVA) y conceptos que subieron / bajaron. */
export function totalesHistorico(resumen: ResumenConcepto[]): { conceptos: number; compras: number; subieron: number; bajaron: number; importe: number } {
  let compras = 0;
  let subieron = 0;
  let bajaron = 0;
  let importe = 0;
  for (const r of resumen) {
    compras += r.compras;
    if (r.variacion != null && r.variacion > 0) subieron += 1;
    if (r.variacion != null && r.variacion < 0) bajaron += 1;
    importe += r.historial.reduce((s, c) => s + Number(c.precio) * Math.max(0, Number(c.cantidad ?? 0)), 0);
  }
  return { conceptos: resumen.length, compras, subieron, bajaron, importe: r2(importe) };
}

/** CSV para Excel (todas las compras del proveedor). */
export function csvHistorico(proveedor: string, compras: CompraHistorico[]): string {
  const c = (v: string | number | null | undefined) => {
    const t = String(v ?? "");
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const filas = [["Proveedor", "Fecha", "Folio", "Empresa", "Proyecto", "Concepto", "Unidad", "Cantidad", "Precio s/IVA", "Importe s/IVA"].join(",")];
  for (const x of [...compras].sort((a, b) => b.fecha.localeCompare(a.fecha))) {
    filas.push([proveedor, x.fecha, x.folio, x.empresa, x.proyecto, x.descripcion, x.unidad, x.cantidad ?? "", Number(x.precio).toFixed(2), (Number(x.precio) * Number(x.cantidad ?? 0)).toFixed(2)].map(c).join(","));
  }
  return "﻿" + filas.join("\n");
}
