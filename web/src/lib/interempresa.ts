// Venta inter empresa desde una OC/OS (21-oct-2026, Mario: "Aceros compra a
// proveedor material y esto se lo vende a Mario, sin embargo Mario también
// necesita comprárselo a Aceros; es un triple movimiento con la misma
// información o con muy pequeña variación"). De las partidas de la orden
// original sale el costo s/IVA y, con la comisión, el precio al que la
// empresa que compró le vende a la otra (OV) y al que esa otra le compra (OC).
// Puro, con pruebas; la base guarda las dos órdenes en fn_orden_interempresa.

import type { PartidaCaptura } from "./ordenesIa.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface LineaOrigen {
  /** Partida de la orden de origen (fn_interempresa_restante). */
  linea_id?: string | null;
  /** Lo que falta por vender inter empresa de la partida; sin dato = toda. */
  restante?: number | string | null;
  item: string | null;
  unidad: string | null;
  cantidad: number | string | null;
  costo: number | string | null;
  iva: boolean | null;
}

/** Las OC del backoffice (api, excel) traen el costo de partida con IVA; las
 * propias (acumulado, requisición) sin IVA. */
export function costoSinIva(l: Pick<LineaOrigen, "costo" | "iva">, fuente: string): number {
  const c = Number(l.costo ?? 0);
  const conIva = (fuente === "api" || fuente === "excel") && l.iva !== false;
  return r2(conIva ? c / 1.16 : c);
}

export function precioConComision(costo: number, comisionPct: number): number {
  return r2(costo * (1 + (Number.isFinite(comisionPct) ? comisionPct : 0) / 100));
}

export interface PartidaInterempresa {
  incluir: boolean;
  item: string;
  unidad: string;
  cantidad: string;
  costo: number;
  /** Precio de venta s/IVA; vacío = costo + comisión. */
  precio: string;
  iva: boolean;
  /** Partida de origen y lo máximo que se puede vender de ella. */
  origenLinea?: string;
  maximo?: number;
}

/** Cuánto queda de una partida (lo ya vendido inter empresa no se repite;
 * Mario, 21-oct-2026: "si ya se generó la venta y compra total, que ya no te
 * deje volverlo a hacer"). */
function queda(l: LineaOrigen): number {
  return l.restante == null ? Number(l.cantidad) : Number(l.restante);
}

export function partidasDesdeOrigen(lineas: LineaOrigen[], fuente: string): PartidaInterempresa[] {
  return lineas
    .filter((l) => (l.item ?? "").trim() !== "" && Number(l.cantidad) > 0 && queda(l) > 0)
    .map((l) => ({
      incluir: true,
      item: (l.item ?? "").trim(),
      unidad: (l.unidad ?? "").trim(),
      cantidad: String(queda(l)),
      costo: costoSinIva(l, fuente),
      precio: "",
      iva: l.iva !== false,
      ...(l.linea_id ? { origenLinea: l.linea_id, maximo: queda(l) } : {}),
    }));
}

/** ¿Ya se vendió todo inter empresa? (sin partidas pendientes). */
export function interempresaCompleta(lineas: LineaOrigen[]): boolean {
  const validas = lineas.filter((l) => (l.item ?? "").trim() !== "" && Number(l.cantidad) > 0);
  return validas.length > 0 && validas.every((l) => queda(l) <= 0);
}

/** Lo que cubre esta venta de cada partida de origen (la base lo valida). */
export function partidasOrigen(ps: PartidaInterempresa[]): { linea: string; cantidad: number }[] {
  return ps.filter((p) => p.incluir && p.origenLinea).map((p) => ({ linea: p.origenLinea as string, cantidad: Number(p.cantidad) }));
}

export function precioPartida(p: PartidaInterempresa, comisionPct: number): number {
  return p.precio.trim() !== "" ? r2(Number(p.precio)) : precioConComision(p.costo, comisionPct);
}

/** Las partidas que van a la OV y a la OC (mismo precio en las dos). */
export function partidasVenta(ps: PartidaInterempresa[], comisionPct: number): PartidaCaptura[] {
  return ps
    .filter((p) => p.incluir)
    .map((p) => ({ item: p.item, unidad: p.unidad, cantidad: Number(p.cantidad), costo: precioPartida(p, comisionPct), iva: p.iva }));
}

export interface ResumenInterempresa {
  costo: number;
  venta: number;
  comision: number;
  /** Comisión real sobre el costo (con los precios corregidos a mano). */
  pct: number | null;
}

export function resumenInterempresa(ps: PartidaInterempresa[], comisionPct: number): ResumenInterempresa {
  let costo = 0;
  let venta = 0;
  for (const p of ps) {
    if (!p.incluir) continue;
    const q = Number(p.cantidad) || 0;
    costo += r2(q * p.costo);
    venta += r2(q * precioPartida(p, comisionPct));
  }
  costo = r2(costo);
  venta = r2(venta);
  return { costo, venta, comision: r2(venta - costo), pct: costo > 0 ? r2(((venta - costo) / costo) * 100) : null };
}

/** Problemas que impiden generar (vacío = se puede). */
export function revisarInterempresa(o: { empresaVende: string; empresaCompra: string; formaPago: string; partidas: PartidaInterempresa[] }): string[] {
  const errores: string[] = [];
  if (!o.empresaCompra) errores.push("Elige la empresa que compra.");
  else if (o.empresaCompra === o.empresaVende) errores.push("La empresa que compra debe ser otra.");
  if (!o.formaPago.trim()) errores.push("Elige la forma de pago.");
  const usadas = o.partidas.filter((p) => p.incluir);
  if (usadas.length === 0) errores.push("Deja al menos una partida.");
  usadas.forEach((p, i) => {
    if (!p.item.trim()) errores.push(`Partida ${i + 1}: falta la descripción.`);
    if (!(Number(p.cantidad) > 0)) errores.push(`Partida ${i + 1}: cantidad inválida.`);
    else if (p.maximo != null && Number(p.cantidad) > p.maximo + 1e-9) errores.push(`Partida ${i + 1}: solo faltan ${p.maximo} por vender inter empresa.`);
    if (p.precio.trim() !== "" && !(Number(p.precio) >= 0)) errores.push(`Partida ${i + 1}: precio inválido.`);
  });
  return errores;
}
