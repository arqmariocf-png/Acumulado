// Remisión de planta (Clavicón, Balken, taller) en hoja membretada, con QR.
// Sin DOM: el QR llega como SVG ya generado. El membrete (logo, razón social,
// RFC, domicilio, color de la empresa) es el mismo de la remisión de almacén:
// ver membreteRemision.ts.

import { colorMembrete, esc, estilosMembrete, htmlMembrete, type EmpresaMembrete } from "./membreteRemision.ts";

export { COLOR_MEMBRETE } from "./membreteRemision.ts";

export interface RemisionProduccionDoc extends Partial<Omit<EmpresaMembrete, "empresa_nombre" | "empresa_codigo" | "empresa_rfc">> {
  folio: string;
  tipo: "salida" | "entrada";
  fecha: string;
  empresa_nombre: string;
  empresa_rfc: string | null;
  empresa_codigo: string;
  contraparte: string;
  /** RFC y domicilio del cliente cuando la remisión se ligó al catálogo. */
  cliente_rfc?: string | null;
  cliente_domicilio?: string | null;
  proyecto_nombre: string | null;
  referencia: string | null;
  observaciones: string | null;
  /** Contado o crédito (salidas, desde 30-sep-2026). */
  condicion_pago?: "contado" | "credito" | null;
  dias_credito?: number | null;
  /** Se entrega a un cliente y paga otro (23-oct-2026): a quién se le cobra
   * y factura, con la referencia que los liga (OV, pedido, acuerdo). */
  paga_nombre?: string | null;
  paga_rfc?: string | null;
  paga_domicilio?: string | null;
  referencia_pago?: string | null;
  estatus: "emitida" | "entregada";
  emitida_por_nombre: string | null;
  recibio_nombre: string | null;
  entregada_en: string | null;
}

export interface LineaRemisionProduccion {
  descripcion: string;
  cantidad: number;
  unidad: string;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function fechaLargaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return iso;
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

export function cantidadTexto(n: number): string {
  return Number(n).toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

export function urlRemisionProduccion(origen: string, id: string): string {
  return `${origen}/produccion/remisiones/${id}`;
}

export function idRemisionProduccionDesdeCodigo(codigo: string): string | null {
  const m = codigo.trim().match(/\/produccion\/remisiones\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}

export function htmlRemisionProduccion(r: RemisionProduccionDoc, lineas: LineaRemisionProduccion[], qrSvg: string, url: string, logoUrl: string | null): string {
  const color = colorMembrete(r.empresa_codigo);
  const entregada = r.estatus === "entregada";
  const titulo = r.tipo === "salida" ? "REMISIÓN DE ENTREGA" : "REMISIÓN DE RECEPCIÓN";
  const pagaOtro = r.tipo === "salida" && !!r.paga_nombre && r.paga_nombre.trim() !== r.contraparte.trim();
  const etiquetaContraparte = r.tipo === "salida" ? (pagaOtro ? "Entregar a (recibe la mercancía)" : "Cliente") : "Proveedor / de quién se recibe";
  const filas = lineas
    .map((l, i) => `<tr><td class="c">${i + 1}</td><td>${esc(l.descripcion)}</td><td class="c">${esc(l.unidad)}</td><td class="r">${esc(cantidadTexto(l.cantidad))}</td></tr>`)
    .join("");
  const total = lineas.reduce((s, l) => s + Number(l.cantidad), 0);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(r.folio)} · ${esc(r.empresa_nombre)}</title>
<style>${estilosMembrete(color)}</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
  ${htmlMembrete({ empresa_nombre: r.empresa_nombre, empresa_codigo: r.empresa_codigo, empresa_rfc: r.empresa_rfc, empresa_razon_social: r.empresa_razon_social, empresa_domicilio: r.empresa_domicilio, empresa_telefono: r.empresa_telefono }, logoUrl, titulo, r.folio, fechaLargaCorta(r.fecha), entregada)}
  <div class="cuerpo">
    <div class="datos">
      <div><span>${etiquetaContraparte}</span>${esc(r.contraparte)}${r.cliente_rfc ? `<div class="rfc">RFC ${esc(r.cliente_rfc)}</div>` : ""}${r.cliente_domicilio ? `<div class="rfc">${esc(r.cliente_domicilio)}</div>` : ""}</div>
      ${pagaOtro ? `<div><span>Paga / se factura a</span>${esc(r.paga_nombre)}${r.paga_rfc ? `<div class="rfc">RFC ${esc(r.paga_rfc)}</div>` : ""}${r.paga_domicilio ? `<div class="rfc">${esc(r.paga_domicilio)}</div>` : ""}</div>` : ""}
      <div><span>Proyecto / obra</span>${esc(r.proyecto_nombre) || "—"}</div>
      <div><span>Referencia (OV / OC)</span>${esc(r.referencia) || "—"}${r.referencia_pago ? `<div class="rfc">Pago: ${esc(r.referencia_pago)}</div>` : ""}</div>
      ${r.tipo === "salida" && r.condicion_pago ? `<div><span>Pago</span>${r.condicion_pago === "contado" ? "Contado" : `Crédito${r.dias_credito ? ` a ${esc(r.dias_credito)} días` : ""}`}</div>` : ""}
      <div><span>Emitida por</span>${esc(r.emitida_por_nombre) || "—"}</div>
      <div><span>Recibió</span>${entregada ? `${esc(r.recibio_nombre)} · ${esc(r.entregada_en ? new Date(r.entregada_en).toLocaleString("es-MX") : "")}` : `<em style="color:#666">Pendiente de confirmar (escanea el QR)</em>`}</div>
    </div>
    <div class="qr">${qrSvg}</div>
  </div>
  <table>
    <thead><tr><th class="c" style="width:32px">#</th><th>Descripción</th><th class="c" style="width:70px">Unidad</th><th class="r" style="width:100px">Cantidad</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr><td colspan="3">Total de partidas: ${lineas.length}</td><td class="r">${esc(cantidadTexto(total))}</td></tr></tfoot>
  </table>
  <div class="obs"><strong>Observaciones:</strong> ${esc(r.observaciones) || ""}</div>
  <div class="firmas"><div>Entrega</div><div>Recibe (nombre y firma)</div></div>
  <div class="pie"><div>Escanea el QR para consultar esta remisión o confirmar su recepción.</div><div>${esc(url)}</div></div>
</div></body></html>`;
}
