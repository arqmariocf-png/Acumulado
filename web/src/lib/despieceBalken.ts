// Despiece de losa de vigueta y bovedilla (Balken) para cotizar rápido.
// Sin DOM: se compila también para las pruebas de node.
//
// Cómo se despieza un tablero (losa rectangular):
//   - Las viguetas corren en el sentido del CLARO (L). Cada vigueta mide
//     L + apoyo en cada extremo (por omisión 10 cm por lado).
//   - Entre ejes de vigueta hay una separación fija (por omisión 0.70 m,
//     bovedilla de 56 cm de ancho + patín de vigueta). Viguetas por tablero
//     = claros entre viguetas + 1, con claros = ceil(A / separación).
//   - Cada claro entre viguetas se rellena con bovedillas a lo largo de L:
//     ceil(L / largo de bovedilla) piezas por claro.
//   - Concreto: capa de compresión (espesor × área) + relleno de nervios
//     (factor m³/m², editable). Malla electrosoldada: área × traslape.
//
// Los parámetros son editables desde la pantalla; los valores por omisión
// son los usuales del sistema con bovedilla de cemento.

export interface Tablero {
  nombre: string;
  /** Claro (m): sentido de las viguetas. */
  claro: number;
  /** Ancho (m): sentido perpendicular, donde se reparten las viguetas. */
  ancho: number;
  cantidad: number;
}

export interface ParametrosDespiece {
  /** Peralte de la vigueta (cm), solo para etiquetar y validar claro máximo. */
  peralteVigueta: number;
  /** Separación entre ejes de vigueta (m). */
  separacionEjes: number;
  /** Apoyo de la vigueta en cada extremo (m). */
  apoyo: number;
  /** Largo de la bovedilla en el sentido de la vigueta (m). */
  largoBovedilla: number;
  /** Etiqueta de la bovedilla (ej. "Bovedilla de cemento 15×25×56"). */
  bovedilla: string;
  /** Desperdicio de bovedilla (fracción, ej. 0.03). */
  desperdicioBovedilla: number;
  /** Espesor de la capa de compresión (m). */
  espesorCapa: number;
  /** Concreto adicional por relleno de nervios (m³ por m²). */
  concretoNervios: number;
  /** Factor de traslape de la malla (ej. 1.10). */
  traslapeMalla: number;
  /** Redondeo de la longitud de vigueta hacia arriba (m), ej. 0.10. */
  redondeoVigueta: number;
}

export const PARAMETROS_BASE: ParametrosDespiece = {
  peralteVigueta: 12,
  separacionEjes: 0.7,
  apoyo: 0.1,
  largoBovedilla: 0.25,
  bovedilla: "Bovedilla de cemento 15×25×56",
  desperdicioBovedilla: 0.03,
  espesorCapa: 0.05,
  concretoNervios: 0.02,
  traslapeMalla: 1.1,
  redondeoVigueta: 0.1,
};

/** Claro máximo orientativo por peralte (m). Es una referencia práctica,
 * no sustituye el cálculo estructural. */
export const CLARO_MAXIMO_POR_PERALTE: Record<number, number> = { 12: 3.5, 15: 4.5, 20: 6.0 };

export interface DespieceTablero {
  tablero: Tablero;
  area: number;
  viguetasPorTablero: number;
  longitudVigueta: number;
  viguetas: number;
  metrosVigueta: number;
  clarosPorTablero: number;
  bovedillasPorClaro: number;
  bovedillas: number;
  excedeClaro: boolean;
}

export interface LineaVigueta {
  longitud: number;
  piezas: number;
  metros: number;
}

export interface Despiece {
  tableros: DespieceTablero[];
  area: number;
  viguetas: number;
  metrosVigueta: number;
  viguetasPorLongitud: LineaVigueta[];
  bovedillas: number;
  bovedillasConDesperdicio: number;
  concretoM3: number;
  mallaM2: number;
}

const EPS = 1e-9;

export function redondearArriba(valor: number, paso: number): number {
  if (paso <= 0) return valor;
  return Math.ceil(valor / paso - EPS) * paso;
}

function ceil(n: number): number {
  return Math.ceil(n - EPS);
}

export function despiezarTablero(t: Tablero, p: ParametrosDespiece): DespieceTablero {
  const cantidad = Math.max(0, Math.floor(t.cantidad));
  const area = t.claro * t.ancho * cantidad;
  const clarosPorTablero = Math.max(1, ceil(t.ancho / p.separacionEjes));
  const viguetasPorTablero = clarosPorTablero + 1;
  const longitudVigueta = Number(redondearArriba(t.claro + 2 * p.apoyo, p.redondeoVigueta).toFixed(2));
  const viguetas = viguetasPorTablero * cantidad;
  const bovedillasPorClaro = Math.max(1, ceil(t.claro / p.largoBovedilla));
  const bovedillas = clarosPorTablero * bovedillasPorClaro * cantidad;
  const maximo = CLARO_MAXIMO_POR_PERALTE[p.peralteVigueta];
  return {
    tablero: t,
    area,
    viguetasPorTablero,
    longitudVigueta,
    viguetas,
    metrosVigueta: viguetas * longitudVigueta,
    clarosPorTablero,
    bovedillasPorClaro,
    bovedillas,
    excedeClaro: maximo != null && t.claro > maximo + EPS,
  };
}

export function despiezar(tableros: Tablero[], p: ParametrosDespiece): Despiece {
  const validos = tableros.filter((t) => t.claro > 0 && t.ancho > 0 && t.cantidad > 0);
  const detalle = validos.map((t) => despiezarTablero(t, p));
  const area = detalle.reduce((s, d) => s + d.area, 0);
  const viguetas = detalle.reduce((s, d) => s + d.viguetas, 0);
  const metrosVigueta = detalle.reduce((s, d) => s + d.metrosVigueta, 0);
  const bovedillas = detalle.reduce((s, d) => s + d.bovedillas, 0);
  const porLongitud = new Map<number, number>();
  for (const d of detalle) porLongitud.set(d.longitudVigueta, (porLongitud.get(d.longitudVigueta) ?? 0) + d.viguetas);
  const viguetasPorLongitud = [...porLongitud.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([longitud, piezas]) => ({ longitud, piezas, metros: Number((longitud * piezas).toFixed(2)) }));
  return {
    tableros: detalle,
    area,
    viguetas,
    metrosVigueta: Number(metrosVigueta.toFixed(2)),
    viguetasPorLongitud,
    bovedillas,
    bovedillasConDesperdicio: ceil(bovedillas * (1 + p.desperdicioBovedilla)),
    concretoM3: Number((area * (p.espesorCapa + p.concretoNervios)).toFixed(3)),
    mallaM2: Number((area * p.traslapeMalla).toFixed(2)),
  };
}

// ── Cotización ────────────────────────────────────────────────────────────

export interface PreciosCotizacion {
  /** $/m lineal de vigueta. */
  viguetaPorMetro: number;
  /** $/pieza de bovedilla. */
  bovedillaPorPieza: number;
  /** $/m³ de concreto (0 si no se cotiza). */
  concretoPorM3: number;
  /** $/m² de malla (0 si no se cotiza). */
  mallaPorM2: number;
  /** $/m² de mano de obra de montaje (0 si no se cotiza). */
  manoObraPorM2: number;
  /** Flete (importe fijo). */
  flete: number;
  /** IVA (fracción, ej. 0.16). */
  iva: number;
}

export const PRECIOS_BASE: PreciosCotizacion = {
  viguetaPorMetro: 0,
  bovedillaPorPieza: 0,
  concretoPorM3: 0,
  mallaPorM2: 0,
  manoObraPorM2: 0,
  flete: 0,
  iva: 0.16,
};

export interface LineaCotizacion {
  concepto: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
  importe: number;
}

export interface Cotizacion {
  lineas: LineaCotizacion[];
  subtotal: number;
  iva: number;
  total: number;
  precioPorM2: number;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function cotizar(d: Despiece, p: ParametrosDespiece, precios: PreciosCotizacion): Cotizacion {
  const lineas: LineaCotizacion[] = [];
  for (const v of d.viguetasPorLongitud) {
    lineas.push({
      concepto: `Vigueta pretensada ${p.peralteVigueta} cm × ${v.longitud.toFixed(2)} m`,
      unidad: "PZA",
      cantidad: v.piezas,
      precioUnitario: r2(v.longitud * precios.viguetaPorMetro),
      importe: r2(v.metros * precios.viguetaPorMetro),
    });
  }
  if (d.bovedillasConDesperdicio > 0) {
    lineas.push({
      concepto: p.bovedilla,
      unidad: "PZA",
      cantidad: d.bovedillasConDesperdicio,
      precioUnitario: precios.bovedillaPorPieza,
      importe: r2(d.bovedillasConDesperdicio * precios.bovedillaPorPieza),
    });
  }
  if (precios.concretoPorM3 > 0 && d.concretoM3 > 0) {
    lineas.push({ concepto: "Concreto capa de compresión y nervios", unidad: "M3", cantidad: d.concretoM3, precioUnitario: precios.concretoPorM3, importe: r2(d.concretoM3 * precios.concretoPorM3) });
  }
  if (precios.mallaPorM2 > 0 && d.mallaM2 > 0) {
    lineas.push({ concepto: "Malla electrosoldada 6-6/10-10", unidad: "M2", cantidad: d.mallaM2, precioUnitario: precios.mallaPorM2, importe: r2(d.mallaM2 * precios.mallaPorM2) });
  }
  if (precios.manoObraPorM2 > 0 && d.area > 0) {
    lineas.push({ concepto: "Mano de obra de montaje", unidad: "M2", cantidad: r2(d.area), precioUnitario: precios.manoObraPorM2, importe: r2(d.area * precios.manoObraPorM2) });
  }
  if (precios.flete > 0) {
    lineas.push({ concepto: "Flete a obra", unidad: "LOTE", cantidad: 1, precioUnitario: precios.flete, importe: r2(precios.flete) });
  }
  const subtotal = r2(lineas.reduce((s, l) => s + l.importe, 0));
  const iva = r2(subtotal * precios.iva);
  const total = r2(subtotal + iva);
  return { lineas, subtotal, iva, total, precioPorM2: d.area > 0 ? r2(subtotal / d.area) : 0 };
}

// ── Impresión ─────────────────────────────────────────────────────────────

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function money(n: number): string {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
}

function num(n: number, d = 2): string {
  return n.toLocaleString("es-MX", { maximumFractionDigits: d });
}

export interface EncabezadoCotizacion {
  empresa: string;
  cliente: string;
  obra: string;
  fecha: string;
  vigencia: string;
  elaboro: string | null;
  notas: string;
}

export function htmlCotizacionBalken(enc: EncabezadoCotizacion, p: ParametrosDespiece, d: Despiece, c: Cotizacion): string {
  const filasTableros = d.tableros
    .map(
      (t) => `<tr><td>${esc(t.tablero.nombre)}</td><td class="r">${num(t.tablero.claro)}</td><td class="r">${num(t.tablero.ancho)}</td><td class="r">${t.tablero.cantidad}</td><td class="r">${num(t.area)}</td><td class="r">${t.viguetas} × ${num(t.longitudVigueta)} m</td><td class="r">${t.bovedillas}</td></tr>`,
    )
    .join("");
  const filasCot = c.lineas
    .map((l) => `<tr><td>${esc(l.concepto)}</td><td class="c">${esc(l.unidad)}</td><td class="r">${num(l.cantidad, 3)}</td><td class="r">${money(l.precioUnitario)}</td><td class="r">${money(l.importe)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cotización losa vigueta y bovedilla</title>
<style>
  @page { size: letter; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; }
  .hoja { max-width: 190mm; margin: 0 auto; padding: 12px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .emp { font-weight: bold; font-size: 13px; }
  .cab { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
  .datos { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; margin-bottom: 10px; }
  .datos span { display: block; font-size: 10px; text-transform: uppercase; color: #666; }
  h2 { font-size: 12px; text-transform: uppercase; margin: 14px 0 4px; color: #333; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 4px 6px; }
  th { background: #eee; font-size: 10px; text-transform: uppercase; text-align: left; }
  .r { text-align: right; } .c { text-align: center; }
  tfoot td { font-weight: bold; background: #f6f6f6; }
  .param { font-size: 10px; color: #555; margin-top: 4px; }
  .notas { margin-top: 10px; white-space: pre-wrap; }
  .btn { position: fixed; top: 10px; right: 10px; padding: 8px 14px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } .hoja { padding: 0; } }
</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
  <div class="cab">
    <div><h1>COTIZACIÓN · LOSA DE VIGUETA Y BOVEDILLA</h1><div class="emp">${esc(enc.empresa)}</div></div>
    <div style="text-align:right"><div>Fecha: ${esc(enc.fecha)}</div><div>Vigencia: ${esc(enc.vigencia)}</div></div>
  </div>
  <div class="datos">
    <div><span>Cliente</span>${esc(enc.cliente) || "—"}</div>
    <div><span>Obra</span>${esc(enc.obra) || "—"}</div>
    <div><span>Sistema</span>Vigueta ${esc(p.peralteVigueta)} cm · ${esc(p.bovedilla)} · ejes a ${num(p.separacionEjes)} m</div>
    <div><span>Elaboró</span>${esc(enc.elaboro) || "—"}</div>
  </div>

  <h2>Tableros</h2>
  <table>
    <thead><tr><th>Tablero</th><th class="r">Claro (m)</th><th class="r">Ancho (m)</th><th class="r">Cant.</th><th class="r">Área (m²)</th><th class="r">Viguetas</th><th class="r">Bovedillas</th></tr></thead>
    <tbody>${filasTableros}</tbody>
    <tfoot><tr><td colspan="4">Total</td><td class="r">${num(d.area)}</td><td class="r">${d.viguetas} pzas · ${num(d.metrosVigueta)} m</td><td class="r">${d.bovedillas} (+${Math.round(p.desperdicioBovedilla * 100)}% = ${d.bovedillasConDesperdicio})</td></tr></tfoot>
  </table>
  <div class="param">Apoyo ${num(p.apoyo * 100, 0)} cm por lado · bovedilla de ${num(p.largoBovedilla * 100, 0)} cm de largo · capa de compresión ${num(p.espesorCapa * 100, 0)} cm · concreto estimado ${num(d.concretoM3, 3)} m³ · malla ${num(d.mallaM2)} m² (con traslape).</div>

  <h2>Cotización</h2>
  <table>
    <thead><tr><th>Concepto</th><th class="c">Unidad</th><th class="r">Cantidad</th><th class="r">P. unitario</th><th class="r">Importe</th></tr></thead>
    <tbody>${filasCot}</tbody>
    <tfoot>
      <tr><td colspan="4">Subtotal</td><td class="r">${money(c.subtotal)}</td></tr>
      <tr><td colspan="4">IVA</td><td class="r">${money(c.iva)}</td></tr>
      <tr><td colspan="4">Total</td><td class="r">${money(c.total)}</td></tr>
      <tr><td colspan="4">Precio por m² (antes de IVA)</td><td class="r">${money(c.precioPorM2)}</td></tr>
    </tfoot>
  </table>
  ${enc.notas ? `<div class="notas"><strong>Notas:</strong> ${esc(enc.notas)}</div>` : ""}
  <p class="param">Las cantidades son un despiece estimado a partir de las medidas indicadas; se confirman con el plano y la visita a obra. El claro máximo por peralte es orientativo y no sustituye el cálculo estructural.</p>
</div></body></html>`;
}
