// Orden de compra RQ imprimible (Alma la genera desde la requisición, Laura
// la autoriza). HTML sin DOM: se compila también para las pruebas de node y
// la pantalla la abre con lib/imprimir.ts.

export interface OrdenCompraDoc {
  id_orden: string;
  fecha: string | null;
  empresa_nombre: string;
  empresa_rfc: string | null;
  empresa_codigo: string;
  proveedor: string | null;
  proyecto: string | null;
  requisicion_folio: number | null;
  solicitante: string | null;
  creada_por: string | null;
  autorizada_en: string | null;
  autorizada_por: string | null;
  nota: string | null;
  /** Forma de pago y datos bancarios del proveedor (Laura, 29-sep-2026). */
  forma_pago?: string | null;
  banco?: string | null;
  clabe?: string | null;
  cuenta?: string | null;
  beneficiario?: string | null;
  /** RFC del proveedor (proveedores_datos_bancarios; Laura, 30-sep-2026). */
  rfc_proveedor?: string | null;
  /** OC del backoffice: el costo de cada partida YA trae IVA y los importes
   * salen de v_oc_importes; no se suma 16 % encima. */
  precios_con_iva?: boolean;
  importes?: { subtotal: number; iva: number; total: number } | null;
  /** Autorizada en el backoffice (sin fecha aquí). */
  autorizada_backoffice?: boolean;
  /** Autorizada aquí por dirección (no en el backoffice). */
  autorizacion_interna?: boolean;
}

export interface LineaOrdenCompra {
  item: string;
  unidad: string | null;
  cantidad: number | null;
  costo: number | null;
  iva: boolean | null;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return iso;
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

function num(n: number, dec = 2): string {
  return Number(n).toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Subtotal, IVA y total de las partidas (el IVA se calcula por partida). */
export function totalesOrdenCompra(lineas: LineaOrdenCompra[]): { subtotal: number; iva: number; total: number } {
  let subtotal = 0;
  let iva = 0;
  for (const l of lineas) {
    const importe = Number(l.cantidad ?? 0) * Number(l.costo ?? 0);
    subtotal += importe;
    if (l.iva) iva += importe * 0.16;
  }
  return { subtotal: Math.round(subtotal * 100) / 100, iva: Math.round(iva * 100) / 100, total: Math.round((subtotal + iva) * 100) / 100 };
}

/** Partidas cuyo costo ya incluye IVA (backoffice): el total es la suma de
 * importes y el IVA se desglosa hacia adentro (× 0.16 / 1.16). */
export function totalesConIvaIncluido(lineas: LineaOrdenCompra[]): { subtotal: number; iva: number; total: number } {
  let total = 0;
  let iva = 0;
  for (const l of lineas) {
    const importe = Number(l.cantidad ?? 0) * Number(l.costo ?? 0);
    total += importe;
    if (l.iva) iva += (importe * 0.16) / 1.16;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { subtotal: r(total - iva), iva: r(iva), total: r(total) };
}

export function htmlOrdenCompra(oc: OrdenCompraDoc, lineas: LineaOrdenCompra[], logoUrl: string | null): string {
  const t = oc.importes ?? (oc.precios_con_iva ? totalesConIvaIncluido(lineas) : totalesOrdenCompra(lineas));
  const filas = lineas
    .map((l, i) => {
      const importe = Number(l.cantidad ?? 0) * Number(l.costo ?? 0);
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.item)}</td>
        <td class="c">${esc(l.unidad ?? "")}</td>
        <td class="r">${esc(num(Number(l.cantidad ?? 0), 3))}</td>
        <td class="r">$ ${esc(num(Number(l.costo ?? 0)))}</td>
        <td class="r">$ ${esc(num(importe))}</td>
      </tr>`;
    })
    .join("");
  const autorizada = !!oc.autorizada_en || !!oc.autorizada_backoffice;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Orden de compra ${esc(oc.id_orden)}</title>
<style>
  @page { size: letter; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; }
  .hoja { max-width: 190mm; margin: 0 auto; padding: 12px; }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 10px; }
  .cab img { max-height: 48px; max-width: 160px; display: block; margin-bottom: 6px; }
  .cab h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: .5px; }
  .cab .emp { font-size: 13px; font-weight: bold; }
  .cab .sub { color: #555; }
  .folio { text-align: right; }
  .folio .num { font-size: 22px; font-weight: bold; font-family: "Courier New", monospace; }
  .datos { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; margin: 12px 0; }
  .datos div span { display: block; font-size: 10px; text-transform: uppercase; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #999; padding: 6px 8px; vertical-align: top; }
  th { background: #eee; font-size: 11px; text-transform: uppercase; text-align: left; }
  td.c, th.c { text-align: center; }
  td.r, th.r { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: bold; background: #f6f6f6; }
  .obs { margin-top: 10px; min-height: 20px; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; margin-top: 44px; }
  .firmas div { border-top: 1px solid #111; padding-top: 6px; text-align: center; font-size: 11px; }
  .sello { display: inline-block; border: 2px solid #15803d; color: #15803d; padding: 2px 8px; font-weight: bold; border-radius: 4px; font-size: 11px; }
  .pend { display: inline-block; border: 2px solid #b45309; color: #b45309; padding: 2px 8px; font-weight: bold; border-radius: 4px; font-size: 11px; }
  .btn { position: fixed; top: 10px; right: 10px; padding: 8px 14px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } .hoja { padding: 0; } }
</style></head>
<body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
  <div class="cab">
    <div>
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="" onerror="this.style.display='none'">` : ""}
      <h1>ORDEN DE COMPRA</h1>
      <div class="emp">${esc(oc.empresa_nombre)}</div>
      <div class="sub">${oc.empresa_rfc ? `RFC ${esc(oc.empresa_rfc)}` : ""}</div>
      <div style="margin-top:6px">${autorizada ? `<span class="sello">AUTORIZADA ${oc.autorizada_en ? `${oc.autorizacion_interna ? "INTERNA " : ""}${esc(fechaLarga(oc.autorizada_en))}` : "EN BACKOFFICE"}</span>` : `<span class="pend">PENDIENTE DE AUTORIZAR</span>`}</div>
    </div>
    <div class="folio">
      <div class="num">${esc(oc.id_orden)}</div>
      <div class="sub">${esc(fechaLarga(oc.fecha))}</div>
    </div>
  </div>
  <div class="datos">
    <div><span>Proveedor</span>${esc(oc.proveedor) || "—"}${oc.rfc_proveedor ? ` · RFC ${esc(oc.rfc_proveedor)}` : ""}</div>
    <div><span>Proyecto / obra</span>${esc(oc.proyecto) || "—"}</div>
    <div><span>Requisición</span>${oc.requisicion_folio != null ? `#${esc(oc.requisicion_folio)}` : "—"}${oc.solicitante ? ` · solicitó ${esc(oc.solicitante)}` : ""}</div>
    <div><span>Elaboró</span>${esc(oc.creada_por) || "—"}</div>
    <div><span>Forma de pago</span>${esc(oc.forma_pago) || "—"}</div>
    <div><span>Pagar a</span>${esc(oc.beneficiario) || esc(oc.proveedor) || "—"}${oc.banco ? ` · ${esc(oc.banco)}` : ""}${oc.clabe ? ` · CLABE ${esc(oc.clabe)}` : ""}${oc.cuenta ? ` · cuenta ${esc(oc.cuenta)}` : ""}${!oc.banco && !oc.clabe && !oc.cuenta ? " · sin datos bancarios capturados" : ""}</div>
  </div>
  <table>
    <thead><tr><th class="c" style="width:32px">#</th><th>Concepto</th><th class="c" style="width:60px">Unidad</th><th class="r" style="width:80px">Cantidad</th><th class="r" style="width:95px">P. unitario${oc.precios_con_iva ? " (IVA incl.)" : ""}</th><th class="r" style="width:105px">Importe</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot>
      <tr><td colspan="5" class="r">Subtotal</td><td class="r">$ ${esc(num(t.subtotal))}</td></tr>
      <tr><td colspan="5" class="r">IVA</td><td class="r">$ ${esc(num(t.iva))}</td></tr>
      <tr><td colspan="5" class="r">Total</td><td class="r">$ ${esc(num(t.total))}</td></tr>
    </tfoot>
  </table>
  <div class="obs"><strong>Notas:</strong> ${esc(oc.nota) || ""}</div>
  <div class="firmas">
    <div>Elaboró (almacén)</div>
    <div>Autorizó (dirección)${oc.autorizada_por ? `<br>${esc(oc.autorizada_por)}` : ""}</div>
    <div>Proveedor</div>
  </div>
</div>
</body></html>`;
}
