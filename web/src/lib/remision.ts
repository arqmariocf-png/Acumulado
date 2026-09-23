// Remisión de salida de almacén: HTML imprimible con código QR. Sin DOM
// (se compila también para las pruebas de node): el QR llega ya generado
// como SVG y la pantalla se encarga de abrir la ventana de impresión.

export interface RemisionImprimible {
  folio: string;
  fecha: string;
  empresa_nombre: string;
  almacen_nombre: string;
  entregar_a: string;
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

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function htmlRemision(r: RemisionImprimible, lineas: LineaRemision[], qrSvg: string, url: string): string {
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
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Remisión ${esc(r.folio)}</title>
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
  .sku { font-size: 10px; color: #666; }
  tfoot td { font-weight: bold; background: #f6f6f6; }
  .obs { margin-top: 10px; min-height: 28px; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 44px; }
  .firmas div { border-top: 1px solid #111; padding-top: 6px; text-align: center; font-size: 11px; }
  .pie { margin-top: 18px; font-size: 10px; color: #666; display: flex; justify-content: space-between; gap: 12px; }
  .sello { display: inline-block; border: 2px solid #15803d; color: #15803d; padding: 2px 8px; font-weight: bold; border-radius: 4px; font-size: 11px; }
  .btn { position: fixed; top: 10px; right: 10px; padding: 8px 14px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } .hoja { padding: 0; } }
</style></head>
<body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
  <div class="cab">
    <div>
      <h1>REMISIÓN DE SALIDA</h1>
      <div class="emp">${esc(r.empresa_nombre)}</div>
      <div class="sub">${esc(r.almacen_nombre)}</div>
      ${entregada ? `<div style="margin-top:6px"><span class="sello">ENTREGADA</span></div>` : ""}
    </div>
    <div class="folio">
      <div class="num">${esc(r.folio)}</div>
      <div class="sub">${esc(fechaCorta(r.fecha))}</div>
      <div class="qr" style="margin: 6px 0 0 auto">${qrSvg}</div>
    </div>
  </div>
  <div class="datos">
    <div><span>Entregar a</span>${esc(r.entregar_a)}</div>
    <div><span>Emitida por</span>${esc(r.emitida_por_nombre) || "—"}</div>
    <div><span>Recibió</span>${entregada ? `${esc(r.recibio_nombre)} · ${esc(r.entregada_en ? new Date(r.entregada_en).toLocaleString("es-MX") : "")}` : `<em style="color:#666">Pendiente de confirmar (escanea el QR)</em>`}</div>
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
