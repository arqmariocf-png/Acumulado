// Punto de venta de ferretería (Mario, 10-oct-2026). Reglas puras, las mismas
// que aplica fn_pv_cobrar en la base: precios con IVA incluido, descuento por
// partida, tarjeta/transferencia/crédito no pasan del total y el cambio sale
// del efectivo.
import { svgCode128 } from "./code128.ts";

export type MetodoPago = "efectivo" | "tarjeta" | "transferencia" | "credito";

export const ETIQUETA_METODO: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Crédito",
};

export interface LineaCarrito {
  productoId: string;
  nombre: string;
  sku: string | null;
  unidad: string | null;
  /** Precio unitario con IVA. */
  precio: number;
  cantidad: number;
  descuentoPct: number;
  ivaTasa: number;
  codigo?: string | null;
}

export interface PagoCaptura {
  metodo: MetodoPago;
  monto: number;
  referencia?: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function importeLinea(l: Pick<LineaCarrito, "precio" | "cantidad" | "descuentoPct">): number {
  return r2(l.cantidad * l.precio * (1 - (l.descuentoPct || 0) / 100));
}

/** Total con IVA, subtotal e IVA desglosado (por partida, como la base). */
export function totalesCarrito(lineas: LineaCarrito[]) {
  let total = 0;
  let subtotal = 0;
  let piezas = 0;
  for (const l of lineas) {
    const imp = importeLinea(l);
    total += imp;
    subtotal += r2(imp / (1 + (l.ivaTasa ?? 0.16)));
    piezas += l.cantidad;
  }
  return { total: r2(total), subtotal: r2(subtotal), iva: r2(total - subtotal), piezas };
}

/** Suma un producto al carrito (si ya está, aumenta la cantidad). */
export function agregarAlCarrito(lineas: LineaCarrito[], nueva: Omit<LineaCarrito, "cantidad" | "descuentoPct"> & { cantidad?: number }): LineaCarrito[] {
  const i = lineas.findIndex((l) => l.productoId === nueva.productoId && l.precio === nueva.precio);
  if (i >= 0) return lineas.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + (nueva.cantidad ?? 1) } : l));
  return [...lineas, { ...nueva, cantidad: nueva.cantidad ?? 1, descuentoPct: 0 }];
}

/** Revisa los pagos contra el total. */
export function revisarPagos(total: number, pagos: PagoCaptura[]) {
  const suma = (m: MetodoPago) => r2(pagos.filter((p) => p.metodo === m).reduce((s, p) => s + (Number(p.monto) || 0), 0));
  const efectivo = suma("efectivo");
  const noEfectivo = r2(suma("tarjeta") + suma("transferencia"));
  const credito = suma("credito");
  const pagado = r2(efectivo + noEfectivo + credito);
  let error: string | null = null;
  if (total <= 0) error = "Agrega productos.";
  else if (noEfectivo + credito > total + 0.005) error = "Tarjeta, transferencia y crédito no pueden pasar del total.";
  else if (pagado < total - 0.005) error = `Falta por pagar ${r2(total - pagado).toFixed(2)}.`;
  return { efectivo, noEfectivo, credito, pagado, falta: r2(Math.max(total - pagado, 0)), cambio: r2(Math.max(pagado - total, 0)), error };
}

export interface ProductoPv {
  id: string;
  nombre: string;
  sku: string | null;
  codigo_barras: string | null;
}

/** Producto por código escaneado (código de barras o SKU, exactos). */
export function buscarPorCodigo<T extends ProductoPv>(productos: T[], codigo: string): T | null {
  const c = codigo.trim().toUpperCase();
  if (!c) return null;
  return productos.find((p) => (p.codigo_barras ?? "").trim().toUpperCase() === c) ?? productos.find((p) => (p.sku ?? "").trim().toUpperCase() === c) ?? null;
}

/** Filtro de búsqueda por nombre, SKU o código. */
export function filtrarProductos<T extends ProductoPv>(productos: T[], texto: string): T[] {
  const palabras = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!palabras.length) return productos;
  return productos.filter((p) => {
    const t = `${p.nombre} ${p.sku ?? ""} ${p.codigo_barras ?? ""}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return palabras.every((w) => t.includes(w));
  });
}

/** Efectivo esperado en caja y diferencia contra lo contado. */
export function corteCaja(t: { fondo_inicial: number; efectivo: number; ingresos: number; retiros: number }, contado: number | null) {
  const esperado = r2(Number(t.fondo_inicial) + Number(t.efectivo) + Number(t.ingresos) - Number(t.retiros));
  return { esperado, diferencia: contado == null ? null : r2(contado - esperado) };
}

export interface TicketPv {
  empresa: string;
  rfc?: string | null;
  folio: string;
  fecha: string;
  vendedor?: string | null;
  cliente?: string | null;
  lineas: { descripcion: string; cantidad: number; unidad?: string | null; precio: number; descuentoPct: number }[];
  pagos: { metodo: MetodoPago; monto: number; referencia?: string | null }[];
  cambio: number;
  requiereFactura?: boolean;
  cancelada?: boolean;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const $ = (n: number) => `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Ticket de 80 mm con el folio en código de barras (se presenta en almacén para despachar). */
export function htmlTicket(t: TicketPv): string {
  const lineas = t.lineas.map((l) => ({ ...l, importe: importeLinea({ precio: l.precio, cantidad: l.cantidad, descuentoPct: l.descuentoPct }) }));
  const total = r2(lineas.reduce((s, l) => s + l.importe, 0));
  const subtotal = r2(total / 1.16);
  const filas = lineas
    .map(
      (l) =>
        `<tr><td colspan="3">${esc(l.descripcion)}</td></tr><tr><td>${l.cantidad} ${esc(l.unidad ?? "")} × ${$(l.precio)}${l.descuentoPct ? ` −${l.descuentoPct}%` : ""}</td><td></td><td class="d">${$(l.importe)}</td></tr>`,
    )
    .join("");
  const pagos = t.pagos
    .map((p) => `<tr><td>${ETIQUETA_METODO[p.metodo]}${p.referencia ? ` · ${esc(p.referencia)}` : ""}</td><td></td><td class="d">${$(p.monto)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(t.folio)}</title>
<style>@page{size:80mm auto;margin:3mm}body{font-family:Arial,sans-serif;font-size:11px;width:74mm;margin:0 auto;color:#000}
h1{font-size:14px;text-align:center;margin:2px 0}.c{text-align:center}table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}
.d{text-align:right;white-space:nowrap}.t td{font-weight:bold;font-size:13px;border-top:1px dashed #000}.sep{border-top:1px dashed #000;margin:4px 0}
.cancel{border:2px solid #000;text-align:center;font-weight:bold;padding:2px;margin:4px 0}svg{max-width:100%;height:auto}</style></head>
<body onload="setTimeout(function(){window.print()},300)">
<h1>${esc(t.empresa)}</h1>${t.rfc ? `<div class="c">RFC ${esc(t.rfc)}</div>` : ""}
<div class="c">Ticket ${esc(t.folio)}</div><div class="c">${esc(t.fecha)}</div>
${t.vendedor ? `<div>Atendió: ${esc(t.vendedor)}</div>` : ""}<div>Cliente: ${esc(t.cliente || "Público en general")}</div>
${t.cancelada ? `<div class="cancel">CANCELADA</div>` : ""}
<div class="sep"></div><table>${filas}</table><div class="sep"></div>
<table><tr><td>Subtotal</td><td></td><td class="d">${$(subtotal)}</td></tr><tr><td>IVA</td><td></td><td class="d">${$(r2(total - subtotal))}</td></tr>
<tr class="t"><td>TOTAL</td><td></td><td class="d">${$(total)}</td></tr>${pagos}${t.cambio > 0 ? `<tr><td>Cambio</td><td></td><td class="d">${$(t.cambio)}</td></tr>` : ""}</table>
${t.requiereFactura ? `<div class="sep"></div><div class="c">Solicitó factura: se le hará llegar.</div>` : ""}
<div class="sep"></div><div class="c">${svgCode128(t.folio, { modulo: 1.4, alto: 46 })}</div>
<div class="c">Presente este ticket en almacén para recoger su material.</div></body></html>`;
}
