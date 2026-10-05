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

/** Datos impresos de la empresa (tabla `empresas`): membrete y cuenta para
 * depósito. Todo opcional: lo que falte no se imprime. */
export interface MembreteEmpresa {
  razon_social?: string | null;
  domicilio_fiscal?: string | null;
  telefono?: string | null;
  correo?: string | null;
  banco?: string | null;
  cuenta_bancaria?: string | null;
  clabe?: string | null;
  sucursal_bancaria?: string | null;
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
  membrete?: MembreteEmpresa | null;
  cliente_rfc?: string | null;
  cliente_domicilio?: string | null;
  /** Quien firma la cotización (por omisión, quien la elaboró). */
  firma_nombre?: string | null;
  firma_puesto?: string | null;
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

/** "012650001127363818" → "012 650 00112736381 8" (banco, plaza, cuenta, dígito). */
export function clabeLegible(clabe: string): string {
  const c = clabe.replace(/\D/g, "");
  return c.length === 18 ? `${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6, 17)} ${c.slice(17)}` : clabe;
}

export function htmlCotizacionPlanta(enc: EncabezadoCotizacionPlanta, lineas: LineaCotizacionPlanta[], logoUrl: string | null): string {
  const t = totalesCotizacion(lineas);
  const m = enc.membrete ?? {};
  const razon = m.razon_social || enc.empresa_nombre;
  const filas = lineas
    .map(
      (l, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(l.descripcion)}</td><td class="c">${esc(l.unidad)}</td><td class="r">${esc(Number(l.cantidad).toLocaleString("es-MX", { maximumFractionDigits: 4 }))}</td><td class="r">${money(Number(l.precio_unitario))}</td><td class="r">${money(Number(l.precio_unitario) * (1 + IVA))}</td><td class="r">${money(Number(l.cantidad) * Number(l.precio_unitario))}</td></tr>`,
    )
    .join("");
  const pago = enc.condicion_pago === "credito" ? `Crédito${enc.dias_credito ? ` a ${esc(enc.dias_credito)} días` : ""}` : enc.condicion_pago === "contado" ? "Contado" : "Por acordar";
  const contacto = [m.telefono ? `Tel. ${esc(m.telefono)}` : "", m.correo ? esc(m.correo) : ""].filter(Boolean).join(" &nbsp;·&nbsp; ");
  const banco =
    m.clabe || m.cuenta_bancaria
      ? `<div class="banco"><div class="tit">Datos bancarios para depósito o transferencia</div>
      <table class="b"><tr><td>Beneficiario</td><td><b>${esc(razon)}</b></td></tr>
      ${m.banco ? `<tr><td>Banco</td><td>${esc(m.banco)}</td></tr>` : ""}
      ${m.cuenta_bancaria ? `<tr><td>Cuenta</td><td class="mono">${esc(m.cuenta_bancaria)}</td></tr>` : ""}
      ${m.clabe ? `<tr><td>CLABE interbancaria</td><td class="mono"><b>${esc(clabeLegible(m.clabe))}</b></td></tr>` : ""}
      ${m.sucursal_bancaria ? `<tr><td>Sucursal</td><td class="mono">${esc(m.sucursal_bancaria)}</td></tr>` : ""}
      ${enc.empresa_rfc ? `<tr><td>RFC</td><td class="mono">${esc(enc.empresa_rfc)}</td></tr>` : ""}</table>
      <div class="ref">Referencia: ${esc(enc.folio)}. Favor de enviar el comprobante de pago${m.correo ? ` a ${esc(m.correo)}` : ""}.</div></div>`
      : "";
  const firma = enc.firma_nombre || enc.elaboro;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cotización ${esc(enc.folio)} · ${esc(razon)}</title>
<style>
  @page { size: letter; margin: 12mm 14mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1d1d1f; font-size: 11.5px; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .hoja { max-width: 190mm; margin: 0 auto; padding: 10px; }
  .membrete { display: flex; align-items: center; gap: 16px; padding-bottom: 10px; }
  .logo { background: #000; border-radius: 6px; padding: 6px 10px; flex: none; }
  .logo img { height: 74px; display: block; }
  .emp { flex: 1; text-align: right; line-height: 1.45; color: #3a3a3c; }
  .emp .rs { font-size: 15px; font-weight: bold; color: #111; letter-spacing: .02em; }
  .rayas { height: 4px; background: #be0a13; margin-bottom: 2px; } .rayas2 { height: 1px; background: #5b5a5f; margin-bottom: 14px; }
  .titulo { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; }
  .titulo h1 { font-size: 22px; letter-spacing: .18em; margin: 0; color: #111; }
  .titulo .fol { text-align: right; } .titulo .fol b { color: #be0a13; font-size: 14px; }
  .datos { display: grid; grid-template-columns: 1.4fr 1fr; gap: 0; border: 1px solid #c7c7cc; border-radius: 6px; margin-bottom: 12px; overflow: hidden; }
  .datos > div { padding: 7px 10px; } .datos > div + div { border-left: 1px solid #c7c7cc; }
  .lbl { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #6e6e73; margin-top: 4px; }
  .lbl:first-child { margin-top: 0; }
  table.p { width: 100%; border-collapse: collapse; }
  table.p th { background: #2b2b2e; color: #fff; font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; padding: 6px; text-align: left; }
  table.p td { border-bottom: 1px solid #d1d1d6; padding: 6px; vertical-align: top; }
  .r { text-align: right; } .c { text-align: center; } th.r { text-align: right; } th.c { text-align: center; }
  .totales { display: flex; justify-content: flex-end; margin-top: 6px; }
  .totales table { border-collapse: collapse; min-width: 250px; } .totales td { padding: 4px 8px; }
  .totales tr.t td { background: #be0a13; color: #fff; font-weight: bold; font-size: 13px; }
  .bloques { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
  .cond, .banco { border: 1px solid #c7c7cc; border-radius: 6px; padding: 8px 10px; }
  .tit { font-weight: bold; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #be0a13; margin-bottom: 6px; }
  .cond ul { margin: 0; padding-left: 16px; line-height: 1.5; }
  table.b td { padding: 2px 0; vertical-align: top; } table.b td:first-child { color: #6e6e73; padding-right: 10px; white-space: nowrap; }
  .mono { font-family: "Courier New", monospace; font-size: 12px; } .ref { margin-top: 6px; font-size: 10px; color: #3a3a3c; }
  .firma { margin-top: 34px; text-align: center; } .firma .l { width: 230px; border-top: 1px solid #1d1d1f; margin: 0 auto 4px; }
  .pie { margin-top: 18px; border-top: 3px solid #be0a13; padding-top: 5px; font-size: 9px; color: #6e6e73; text-align: center; }
  .btn { position: fixed; top: 10px; right: 10px; padding: 8px 14px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } .hoja { padding: 0; } }
</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
  <div class="membrete">
    ${logoUrl ? `<div class="logo"><img src="${esc(logoUrl)}" alt="${esc(enc.empresa_nombre)}" onerror="this.parentNode.remove()"></div>` : ""}
    <div class="emp"><div class="rs">${esc(razon)}</div>${enc.empresa_rfc ? `<div>RFC ${esc(enc.empresa_rfc)}</div>` : ""}${m.domicilio_fiscal ? `<div>${esc(m.domicilio_fiscal)}</div>` : ""}${contacto ? `<div>${contacto}</div>` : ""}</div>
  </div>
  <div class="rayas"></div><div class="rayas2"></div>
  <div class="titulo"><h1>COTIZACIÓN</h1><div class="fol"><b>${esc(enc.folio)}</b><br>${fechaLarga(enc.fecha)}</div></div>
  <div class="datos">
    <div><span class="lbl">Cliente</span><b>${esc(enc.contraparte)}</b>${enc.cliente_rfc ? `<span class="lbl">RFC</span>${esc(enc.cliente_rfc)}` : ""}${enc.cliente_domicilio ? `<span class="lbl">Domicilio</span>${esc(enc.cliente_domicilio)}` : ""}</div>
    <div><span class="lbl">Obra / destino</span>${esc(enc.obra) || "—"}<span class="lbl">Condiciones de pago</span>${pago}<span class="lbl">Vigencia</span>${esc(enc.vigencia_dias)} días a partir de la fecha</div>
  </div>
  <table class="p">
    <thead><tr><th class="c" style="width:26px">#</th><th>Descripción</th><th class="c" style="width:52px">Unidad</th><th class="r" style="width:64px">Cantidad</th><th class="r" style="width:92px">P.U. sin IVA</th><th class="r" style="width:92px">P.U. con IVA</th><th class="r" style="width:104px">Importe</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>
  <div class="totales"><table>
    <tr><td class="r">Subtotal</td><td class="r">${money(t.subtotal)}</td></tr>
    <tr><td class="r">IVA 16 %</td><td class="r">${money(t.iva)}</td></tr>
    <tr class="t"><td class="r">Total</td><td class="r">${money(t.total)}</td></tr>
  </table></div>
  <div class="bloques">
    <div class="cond"><div class="tit">Condiciones</div><ul>
      <li>Precios en moneda nacional (MXN).</li>
      <li>Vigencia de ${esc(enc.vigencia_dias)} días; sujeta a existencias al confirmar el pedido.</li>
      <li>Forma de pago: ${pago}.</li>
      ${enc.notas ? `<li>${esc(enc.notas)}</li>` : ""}
    </ul></div>
    ${banco}
  </div>
  ${firma ? `<div class="firma">Atentamente<div style="height:34px"></div><div class="l"></div><b>${esc(firma)}</b>${enc.firma_puesto ? `<br>${esc(enc.firma_puesto)}` : ""}<br>${esc(razon)}</div>` : ""}
  <div class="pie">${esc(razon)}${enc.empresa_rfc ? ` · RFC ${esc(enc.empresa_rfc)}` : ""}${m.domicilio_fiscal ? ` · ${esc(m.domicilio_fiscal)}` : ""}</div>
</div></body></html>`;
}
