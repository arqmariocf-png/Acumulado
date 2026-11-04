// Membrete común de las remisiones (4-nov-2026, Mario: "las empresas ya
// tienen el logo arriba, ocupa el mismo logo y formato, esto hazlo en general
// para todas las empresas"). La remisión de almacén y la de planta comparten
// desde aquí el encabezado: logo de la empresa (el subido en Catálogos ›
// Empresas o /logos/<codigo>.png), razón social, RFC, domicilio y teléfono,
// con el color de la empresa. Puro, sin DOM.

/** Color de membrete por empresa (las demás, gris azulado). */
export const COLOR_MEMBRETE: Record<string, string> = { MCC: "#b91c1c", VBB: "#1d4ed8", CSC: "#0f766e" };

export function colorMembrete(codigo: string | null | undefined): string {
  return COLOR_MEMBRETE[(codigo ?? "").toUpperCase()] ?? "#334155";
}

export interface EmpresaMembrete {
  empresa_nombre: string;
  empresa_codigo: string;
  empresa_rfc?: string | null;
  empresa_razon_social?: string | null;
  empresa_domicilio?: string | null;
  empresa_telefono?: string | null;
}

export function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** CSS de la hoja membretada (letter, color de la empresa en líneas y encabezados de tabla). */
export function estilosMembrete(color: string): string {
  return `
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
  .sku { font-size: 10px; color: #666; }
  tfoot td { font-weight: bold; background: #f3f4f6; }
  .obs { margin-top: 10px; min-height: 24px; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 44px; }
  .firmas div { border-top: 1px solid #111; padding-top: 6px; text-align: center; font-size: 11px; }
  .pie { margin-top: 18px; font-size: 10px; color: #666; display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid ${color}; padding-top: 6px; }
  .sello { display: inline-block; border: 2px solid #15803d; color: #15803d; padding: 2px 8px; font-weight: bold; border-radius: 4px; font-size: 11px; }
  .btn { position: fixed; top: 10px; right: 10px; padding: 8px 14px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } .hoja { padding: 0; } }`;
}

/** Encabezado: logo, empresa (razón social, RFC, domicilio, teléfono) y a la
 * derecha el título, el folio, la fecha y el sello de entregada. */
export function htmlMembrete(e: EmpresaMembrete, logoUrl: string | null, titulo: string, folio: string, fechaTexto: string, entregada: boolean): string {
  const nombre = e.empresa_razon_social?.trim() || e.empresa_nombre;
  const lineas = [
    e.empresa_rfc ? `RFC ${esc(e.empresa_rfc)}` : "",
    e.empresa_domicilio ? esc(e.empresa_domicilio) : "",
    e.empresa_telefono ? `Tel. ${esc(e.empresa_telefono)}` : "",
  ]
    .filter(Boolean)
    .map((l) => `<div class="rfc">${l}</div>`)
    .join("");
  return `<div class="membrete">
    <div class="marca">
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="" onerror="this.style.display='none'">` : ""}
      <div><div class="emp">${esc(nombre)}</div>${lineas}</div>
    </div>
    <div class="folio"><div class="tit">${esc(titulo)}</div><div class="num">${esc(folio)}</div><div class="rfc">${esc(fechaTexto)}</div>${entregada ? `<div style="margin-top:4px"><span class="sello">ENTREGADA</span></div>` : ""}</div>
  </div>`;
}
