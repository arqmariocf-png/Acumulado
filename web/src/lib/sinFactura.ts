// Marcar un movimiento bancario "sin factura" con su motivo (Mario, 7-oct-2026,
// correcciones de Laura). La etiqueta siempre va "N/A - …" como las de
// reglas_clasificacion; la palabra clave sugerida es el inicio del concepto del
// banco, sin fechas ni montos, para que la regla atrape los meses siguientes.
// Puro, con pruebas.

export function etiquetaSinFactura(texto: string): string {
  const motivo = texto
    .trim()
    .replace(/^N\s*\/\s*A\s*-?\s*/i, "")
    .trim()
    .toUpperCase();
  return motivo ? `N/A - ${motivo}` : "";
}

/** "PENALIZ SDO PROM MIN/01SEP26/30SEP26 POR MANT" → "PENALIZ SDO PROM MIN". */
export function palabraClaveSugerida(concepto: string | null | undefined): string {
  if (!concepto) return "";
  const corte = concepto.split(/[/#(]|\d{2,}/)[0] ?? "";
  const palabras = corte.trim().toUpperCase().split(/\s+/).filter(Boolean).slice(0, 5);
  return palabras.join(" ");
}

/** Se ofrece marcar cuando no hay factura real (F- …) ya ligada. */
export function puedeMarcarSinFactura(factura: string | null | undefined): boolean {
  return !factura || /^N\s*\/\s*A/i.test(factura);
}
