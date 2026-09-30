// Cotizador de planta (Clavicón, 30-sep-2026). Precios de venta sin IVA en
// la base; la pantalla captura con IVA incluido. El margen es interno: la
// cotización impresa no lleva costos.

export interface LineaCotizacionPlanta {
  descripcion: string;
  cantidad: number;
  unidad: string;
  /** Precio unitario sin IVA. */
  precio_unitario: number;
  /** Costo real unitario (interno). */
  costo_unitario?: number | null;
}

export interface EncabezadoCotizacionPlanta {
  folio: string;
  fecha: string;
  empresa_nombre: string;
  empresa_rfc: string | null;
  contraparte: string;
  obra: string | null;
  vigencia_dias: number;
  condicion_pago: "contado" | "credito" | null;
  dias_credito: number | null;
  notas: string | null;
  elaboro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const IVA = 0.16;

/** Precio sin IVA a partir de uno con IVA incluido (4 decimales). */
export function sinIva(precioConIva: number): number {
  return Math.round((precioConIva / (1 + IVA)) * 10000) / 10000;
}

export function totalesCotizacion(lineas: LineaCotizacionPlanta[]) {
  const subtotal = r2(lineas.reduce((s, l) => s + Number(l.cantidad) * Number(l.precio_unitario), 0));
  const iva = r2(subtotal * IVA);
  const conCosto = lineas.filter((l) => l.costo_unitario != null);
  const costo = r2(conCosto.reduce((s, l) => s + Number(l.cantidad) * Number(l.costo_unitario), 0));
  const ventaConCosto = r2(conCosto.reduce((s, l) => s + Number(l.cantidad) * Number(l.precio_unitario), 0));
  const margen = conCosto.length ? r2(ventaConCosto - costo) : null;
  return {
    subtotal,
    iva,
    total: r2(subtotal + iva),
    costo,
    margen,
    margenPct: margen != null && ventaConCosto ? r2((margen / ventaConCosto) * 100) : null,
    sinCosto: lineas.length - conCosto.length,
  };
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function fechaLarga(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return a && m && d ? `${d} de ${MESES[m - 1]} de ${a}` : iso;
}
const esc = (t: string | number | null | undefined) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number) => "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function htmlCotizacionPlanta(enc: EncabezadoCotizacionPlanta, lineas: LineaCotizacionPlanta[], logoUrl: string | null): string {
  const t = totalesCotizacion(lineas);
  const filas = lineas
    .map(
      (l, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(l.descripcion)}</td><td class="c">${esc(l.unidad)}</td><td class="r">${esc(Number(l.cantidad).toLocaleString("es-MX", { maximumFractionDigits: 4 }))}</td><td class="r">${money(Number(l.precio_unitario))}</td><td class="r">${money(Number(l.cantidad) * Number(l.precio_unitario))}</td></tr>`,
    )
    .join("");
  const pago = enc.condicion_pago === "credito" ? `Crédito${enc.dias_credito ? ` a ${esc(enc.dias_credito)} días` : ""}` : enc.condicion_pago === "contado" ? "Contado" : "Por acordar";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cotización ${esc(enc.folio)}</title>
<style>
  @page { size: letter; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; }
  .hoja { max-width: 190mm; margin: 0 auto; padding: 12px; }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
  .cab img { max-height: 56px; }
  h1 { font-size: 18px; margin: 0; } .emp { font-weight: bold; font-size: 13px; }
  .datos { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; margin-bottom: 10px; }
  .datos span { display: block; font-size: 10px; text-transform: uppercase; color: #666; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 4px 6px; }
  th { background: #eee; font-size: 10px; text-transform: uppercase; text-align: left; }
  .r { text-align: right; } .c { text-align: center; }
  .tot td { font-weight: bold; background: #f6f6f6; }
  .notas { margin-top: 10px; white-space: pre-wrap; }
  .pie { margin-top: 18px; font-size: 10px; color: #555; }
  .btn { position: fixed; top: 10px; right: 10px; padding: 8px 14px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } .hoja { padding: 0; } }
</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
  <div class="cab">
    <div>${logoUrl ? `<img src="${esc(logoUrl)}" alt="" onerror="this.remove()"><br>` : ""}<div class="emp">${esc(enc.empresa_nombre)}</div>${enc.empresa_rfc ? `<div>RFC ${esc(enc.empresa_rfc)}</div>` : ""}</div>
    <div style="text-align:right"><h1>Cotización</h1><div><b>${esc(enc.folio)}</b></div><div>${fechaLarga(enc.fecha)}</div></div>
  </div>
  <div class="datos">
    <div><span>Cliente</span>${esc(enc.contraparte)}</div>
    <div><span>Obra / destino</span>${esc(enc.obra) || "—"}</div>
    <div><span>Condiciones de pago</span>${pago}</div>
    <div><span>Vigencia</span>${esc(enc.vigencia_dias)} días</div>
  </div>
  <table>
    <thead><tr><th class="c" style="width:28px">#</th><th>Descripción</th><th class="c" style="width:60px">Unidad</th><th class="r" style="width:80px">Cantidad</th><th class="r" style="width:100px">P. unitario</th><th class="r" style="width:110px">Importe</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot>
      <tr><td colspan="5" class="r">Subtotal</td><td class="r">${money(t.subtotal)}</td></tr>
      <tr><td colspan="5" class="r">IVA 16 %</td><td class="r">${money(t.iva)}</td></tr>
      <tr class="tot"><td colspan="5" class="r">Total</td><td class="r">${money(t.total)}</td></tr>
    </tfoot>
  </table>
  ${enc.notas ? `<div class="notas"><b>Notas:</b> ${esc(enc.notas)}</div>` : ""}
  <div class="pie">Precios en pesos mexicanos. ${enc.elaboro ? `Elaboró: ${esc(enc.elaboro)}.` : ""}</div>
</div></body></html>`;
}
