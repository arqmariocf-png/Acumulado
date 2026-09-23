// Remisión de planta (Clavicón, Balken, taller) en hoja membretada, con QR.
// Sin DOM: el QR llega como SVG ya generado. El membrete usa el nombre,
// RFC y código de la empresa; si existe /logos/<codigo>.png se muestra.

export interface RemisionProduccionDoc {
  folio: string;
  tipo: "salida" | "entrada";
  fecha: string;
  empresa_nombre: string;
  empresa_rfc: string | null;
  empresa_codigo: string;
  contraparte: string;
  proyecto_nombre: string | null;
  referencia: string | null;
  observaciones: string | null;
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

/** Color de membrete por empresa (fallback gris azulado). */
export const COLOR_MEMBRETE: Record<string, string> = { MCC: "#b91c1c", VBB: "#1d4ed8", CSC: "#0f766e" };

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function htmlRemisionProduccion(r: RemisionProduccionDoc, lineas: LineaRemisionProduccion[], qrSvg: string, url: string, logoUrl: string | null): string {
  const color = COLOR_MEMBRETE[r.empresa_codigo] ?? "#334155";
  const entregada = r.estatus === "entregada";
  const titulo = r.tipo === "salida" ? "REMISIÓN DE ENTREGA" : "REMISIÓN DE RECEPCIÓN";
  const etiquetaContraparte = r.tipo === "salida" ? "Cliente" : "Proveedor / de quién se recibe";
  const filas = lineas
    .map((l, i) => `<tr><td class="c">${i + 1}</td><td>${esc(l.descripcion)}</td><td class="c">${esc(l.unidad)}</td><td class="r">${esc(cantidadTexto(l.cantidad))}</td></tr>`)
    .join("");
  const total = lineas.reduce((s, l) => s + Number(l.cantidad), 0);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(r.folio)} · ${esc(r.empresa_nombre)}</title>
<style>
  @page { size: letter; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; }
  .hoja { max-width: 190mm; margin: 0 auto; padding: 12px; }
  .membrete { display: flex; justify-content: space-between; align-items: center; gap: 16px; border-bottom: 4px solid ${color}; padding-bottom: 10px; }
  .membrete .marca { display: flex; align-items: center; gap: 12px; }
  .membrete img { height: 56px; max-width: 180px; object-fit: contain; }
  .membrete .emp { font-size: 20px; font-weight: 800; color: ${color}; letter-spacing: .5px; }
  .membrete .rfc { color: #555; font-size: 11px; }
  .folio { text-align: right; }
  .folio .tit { font-size: 12px; font-weight: bold; color: ${color}; letter-spacing: 1px; }
  .folio .num { font-size: 24px; font-weight: bold; font-family: "Courier New", monospace; }
  .cuerpo { display: grid; grid-template-columns: 1fr 34mm; gap: 16px; margin-top: 12px; align-items: start; }
  .datos { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; }
  .datos div span { display: block; font-size: 10px; text-transform: uppercase; color: #666; }
  .qr svg { width: 34mm; height: 34mm; display: block; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #999; padding: 6px 8px; vertical-align: top; }
  th { background: ${color}; color: #fff; font-size: 11px; text-transform: uppercase; text-align: left; }
  td.c, th.c { text-align: center; } td.r, th.r { text-align: right; }
  tfoot td { font-weight: bold; background: #f3f4f6; }
  .obs { margin-top: 10px; min-height: 24px; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 44px; }
  .firmas div { border-top: 1px solid #111; padding-top: 6px; text-align: center; font-size: 11px; }
  .pie { margin-top: 18px; font-size: 10px; color: #666; display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid ${color}; padding-top: 6px; }
  .sello { display: inline-block; border: 2px solid #15803d; color: #15803d; padding: 2px 8px; font-weight: bold; border-radius: 4px; font-size: 11px; }
  .btn { position: fixed; top: 10px; right: 10px; padding: 8px 14px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } .hoja { padding: 0; } }
</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
  <div class="membrete">
    <div class="marca">
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="" onerror="this.style.display='none'">` : ""}
      <div><div class="emp">${esc(r.empresa_nombre)}</div><div class="rfc">${r.empresa_rfc ? `RFC ${esc(r.empresa_rfc)}` : ""}</div></div>
    </div>
    <div class="folio"><div class="tit">${titulo}</div><div class="num">${esc(r.folio)}</div><div class="rfc">${esc(fechaLargaCorta(r.fecha))}</div>${entregada ? `<div style="margin-top:4px"><span class="sello">ENTREGADA</span></div>` : ""}</div>
  </div>
  <div class="cuerpo">
    <div class="datos">
      <div><span>${etiquetaContraparte}</span>${esc(r.contraparte)}</div>
      <div><span>Proyecto / obra</span>${esc(r.proyecto_nombre) || "—"}</div>
      <div><span>Referencia (OV / OC)</span>${esc(r.referencia) || "—"}</div>
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
