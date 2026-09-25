// Comprobante de entrada a almacén (recepción contra OC): HTML imprimible
// con código QR que abre el avance de esa OC en la app. Sin DOM (se compila
// también para las pruebas de node), igual que remision.ts.
import { cantidadTexto, fechaCorta } from "./remision.ts";

export interface ComprobanteEntrada {
  folio: string;
  fecha: string;
  empresa_nombre: string;
  almacen_nombre: string;
  /** "OC 40921" o null cuando la entrada se guardó sin orden. */
  orden: string | null;
  proveedor: string | null;
  registrado_por_nombre: string | null;
  con_evidencia_foto: boolean;
}

export interface LineaComprobante {
  nombre: string;
  sku: string;
  unidad: string;
  /** Cantidad de ESTA entrada. */
  cantidad: number;
  /** Cantidad pedida en la partida de la OC (null si la línea no viene de una partida). */
  pedido: number | null;
  /** Recibido acumulado en la partida, ya contando esta entrada. */
  recibido_total: number | null;
}

/** Ruta dentro de la app a la que apunta el QR: el avance de la OC en
 * "Match con OC/OV". */
export function urlAvanceOc(origen: string, ordenCompraId: string): string {
  return `${origen}/inventario/match?oc=${ordenCompraId}`;
}

export type EstadoLinea = { texto: string; clase: "ok" | "falta" | "excede" | "sin" };

/** Qué pasa con la partida después de esta entrada: si llegó menos, el
 * proveedor todavía debe producto; si llegó más, habrá un ajuste o
 * reclamación posterior. */
export function estadoLinea(l: Pick<LineaComprobante, "pedido" | "recibido_total" | "unidad">): EstadoLinea {
  if (l.pedido == null || l.recibido_total == null) return { texto: "Sin partida de OC", clase: "sin" };
  const diff = Number(l.pedido) - Number(l.recibido_total);
  if (diff > 0.0005) return { texto: `Faltan ${cantidadTexto(diff)} ${l.unidad} · el proveedor aún debe producto`, clase: "falta" };
  if (diff < -0.0005) return { texto: `Excedente de ${cantidadTexto(-diff)} ${l.unidad} · ajuste o reclamación posterior`, clase: "excede" };
  return { texto: "Partida completa", clase: "ok" };
}

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function htmlComprobanteEntrada(c: ComprobanteEntrada, lineas: LineaComprobante[], qrSvg: string, url: string): string {
  const filas = lineas
    .map((l, i) => {
      const e = estadoLinea(l);
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.nombre)}<div class="sku">${esc(l.sku)}</div></td>
        <td class="c">${esc(l.unidad)}</td>
        <td class="r">${l.pedido == null ? "—" : esc(cantidadTexto(l.pedido))}</td>
        <td class="r">${esc(cantidadTexto(l.cantidad))}</td>
        <td class="r">${l.recibido_total == null ? "—" : esc(cantidadTexto(l.recibido_total))}</td>
        <td class="e ${e.clase}">${esc(e.texto)}</td>
      </tr>`;
    })
    .join("");
  const total = lineas.reduce((s, l) => s + Number(l.cantidad), 0);
  const faltantes = lineas.filter((l) => estadoLinea(l).clase === "falta").length;
  const excedentes = lineas.filter((l) => estadoLinea(l).clase === "excede").length;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Entrada ${esc(c.folio)}</title>
<style>
  @page { size: letter; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; }
  .hoja { max-width: 190mm; margin: 0 auto; padding: 12px; }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 10px; }
  .cab h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: .5px; }
  .cab .emp { font-size: 13px; font-weight: bold; }
  .cab .sub { color: #555; }
  .folio { text-align: right; }
  .folio .num { font-size: 22px; font-weight: bold; font-family: "Courier New", monospace; }
  .qr { width: 34mm; height: 34mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .datos { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; margin: 12px 0; }
  .datos div span { display: block; font-size: 10px; text-transform: uppercase; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #999; padding: 6px 8px; vertical-align: top; }
  th { background: #eee; font-size: 11px; text-transform: uppercase; text-align: left; }
  td.c, th.c { text-align: center; }
  td.r, th.r { text-align: right; }
  td.e { font-size: 11px; }
  td.falta { color: #b45309; font-weight: bold; }
  td.excede { color: #b91c1c; font-weight: bold; }
  td.ok { color: #15803d; }
  td.sin { color: #666; }
  .sku { font-size: 10px; color: #666; }
  tfoot td { font-weight: bold; background: #f6f6f6; }
  .resumen { margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap; }
  .chip { border: 1px solid #999; border-radius: 4px; padding: 3px 8px; font-size: 11px; }
  .chip.falta { border-color: #b45309; color: #b45309; }
  .chip.excede { border-color: #b91c1c; color: #b91c1c; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 44px; }
  .firmas div { border-top: 1px solid #111; padding-top: 6px; text-align: center; font-size: 11px; }
  .pie { margin-top: 18px; font-size: 10px; color: #666; display: flex; justify-content: space-between; gap: 12px; }
  .btn { position: fixed; top: 10px; right: 10px; padding: 8px 14px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } .hoja { padding: 0; } }
</style></head>
<body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
  <div class="cab">
    <div>
      <h1>ENTRADA A ALMACÉN</h1>
      <div class="emp">${esc(c.empresa_nombre)}</div>
      <div class="sub">${esc(c.almacen_nombre)}</div>
    </div>
    <div class="folio">
      <div class="num">${esc(c.folio)}</div>
      <div class="sub">${esc(fechaCorta(c.fecha))}</div>
      <div class="qr" style="margin: 6px 0 0 auto">${qrSvg}</div>
    </div>
  </div>
  <div class="datos">
    <div><span>Orden de compra</span>${esc(c.orden) || '<em style="color:#666">Sin vincular</em>'}</div>
    <div><span>Proveedor</span>${esc(c.proveedor) || "—"}</div>
    <div><span>Registró</span>${esc(c.registrado_por_nombre) || "—"}</div>
    <div><span>Evidencia</span>${c.con_evidencia_foto ? "Foto de la nota adjunta en la app" : "Sin foto"}</div>
  </div>
  <table>
    <thead><tr>
      <th class="c" style="width:28px">#</th><th>Producto</th><th class="c" style="width:56px">Unidad</th>
      <th class="r" style="width:70px">Pedido</th><th class="r" style="width:70px">Recibido hoy</th><th class="r" style="width:70px">Acumulado</th><th style="width:150px">Estado de la partida</th>
    </tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr><td colspan="4">Total de líneas: ${lineas.length}</td><td class="r">${esc(cantidadTexto(total))}</td><td colspan="2"></td></tr></tfoot>
  </table>
  <div class="resumen">
    ${faltantes > 0 ? `<span class="chip falta">${faltantes} partida(s) con faltante: el proveedor debe producto</span>` : ""}
    ${excedentes > 0 ? `<span class="chip excede">${excedentes} partida(s) con excedente: ajuste o reclamación posterior</span>` : ""}
    ${faltantes === 0 && excedentes === 0 ? `<span class="chip">Sin diferencias contra la orden</span>` : ""}
  </div>
  <div class="firmas">
    <div>Recibe (almacén)</div>
    <div>Entrega (proveedor / transportista)</div>
  </div>
  <div class="pie">
    <div>Escanea el QR para ver el avance de la orden de compra en la app.</div>
    <div>${esc(url)}</div>
  </div>
</div>
</body></html>`;
}
