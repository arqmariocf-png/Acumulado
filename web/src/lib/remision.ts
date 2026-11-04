// Remisión de salida de almacén: HTML imprimible con código QR, en la hoja
// membretada de la empresa (desde 4-nov-2026 el mismo logo y formato que la
// remisión de planta; ver membreteRemision.ts). Sin DOM (se compila también
// para las pruebas de node): el QR llega ya generado como SVG y la pantalla se
// encarga de abrir la ventana de impresión.

import { colorMembrete, esc, estilosMembrete, htmlMembrete, type EmpresaMembrete } from "./membreteRemision.ts";

export interface RemisionImprimible extends Partial<EmpresaMembrete> {
  folio: string;
  fecha: string;
  empresa_nombre: string;
  almacen_nombre: string;
  entregar_a: string;
  destino?: string | null;
  referencia?: string | null;
  observaciones: string | null;
  estatus: string;
  emitida_por_nombre: string | null;
  recibio_nombre: string | null;
  entregada_en: string | null;
}

export interface LineaRemision {
  nombre: string;
  sku: string;
  unidad: string;
  cantidad: number;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return iso;
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

export function cantidadTexto(n: number): string {
  return Number(n).toLocaleString("es-MX", { maximumFractionDigits: 3 });
}

/** Ruta dentro de la app a la que apunta el QR; `origen` es
 * window.location.origin en la pantalla. */
export function urlRemision(origen: string, remisionId: string): string {
  return `${origen}/inventario/remisiones/${remisionId}`;
}

/** Si un código escaneado es el QR de una remisión, regresa su id. Sirve
 * para que el lector de "Registrar movimiento" abra la remisión en vez de
 * buscar un producto. */
export function idRemisionDesdeCodigo(codigo: string): string | null {
  const m = codigo.trim().match(/\/inventario\/remisiones\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}

/** @param logoUrl el logo de la empresa (`logoDeEmpresa`); sin él solo va el nombre. */
export function htmlRemision(r: RemisionImprimible, lineas: LineaRemision[], qrSvg: string, url: string, logoUrl: string | null = null): string {
  const color = colorMembrete(r.empresa_codigo);
  const filas = lineas
    .map(
      (l, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.nombre)}<div class="sku">${esc(l.sku)}</div></td>
        <td class="c">${esc(l.unidad)}</td>
        <td class="r">${esc(cantidadTexto(l.cantidad))}</td>
      </tr>`,
    )
    .join("");
  const total = lineas.reduce((s, l) => s + Number(l.cantidad), 0);
  const entregada = r.estatus === "entregada";
  const membrete = htmlMembrete(
    { empresa_nombre: r.empresa_nombre, empresa_codigo: r.empresa_codigo ?? "", empresa_rfc: r.empresa_rfc, empresa_razon_social: r.empresa_razon_social, empresa_domicilio: r.empresa_domicilio, empresa_telefono: r.empresa_telefono },
    logoUrl,
    "REMISIÓN DE SALIDA",
    r.folio,
    fechaCorta(r.fecha),
    entregada,
  );
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Remisión ${esc(r.folio)} · ${esc(r.empresa_nombre)}</title>
<style>${estilosMembrete(color)}</style></head>
<body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
  ${membrete}
  <div class="cuerpo">
    <div class="datos">
      <div><span>Entregar a</span>${esc(r.entregar_a)}${r.destino ? `<div class="rfc">${esc(r.destino)}</div>` : ""}</div>
      <div><span>Almacén</span>${esc(r.almacen_nombre)}</div>
      <div><span>Referencia (OV)</span>${esc(r.referencia) || "—"}</div>
      <div><span>Emitida por</span>${esc(r.emitida_por_nombre) || "—"}</div>
      <div><span>Recibió</span>${entregada ? `${esc(r.recibio_nombre)} · ${esc(r.entregada_en ? new Date(r.entregada_en).toLocaleString("es-MX") : "")}` : `<em style="color:#666">Pendiente de confirmar (escanea el QR)</em>`}</div>
    </div>
    <div class="qr">${qrSvg}</div>
  </div>
  <table>
    <thead><tr><th class="c" style="width:32px">#</th><th>Producto</th><th class="c" style="width:70px">Unidad</th><th class="r" style="width:90px">Cantidad</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr><td colspan="3">Total de líneas: ${lineas.length}</td><td class="r">${esc(cantidadTexto(total))}</td></tr></tfoot>
  </table>
  <div class="obs"><strong>Observaciones:</strong> ${esc(r.observaciones) || ""}</div>
  <div class="firmas">
    <div>Entrega (almacén)</div>
    <div>Recibe (nombre y firma)</div>
  </div>
  <div class="pie">
    <div>Escanea el QR para consultar esta remisión o confirmar su recepción en la app.</div>
    <div>${esc(url)}</div>
  </div>
</div>
</body></html>`;
}
