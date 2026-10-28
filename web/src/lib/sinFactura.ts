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

/** Lo que dice la pantalla antes de guardar una regla "siempre que el
 * concepto diga…" (28-oct-2026, tras los 489 movimientos de "PAGO CUENTA DE
 * TERCERO"): cuántos pendientes se marcarían ahora y en qué empresas. */
export function textoAlcanceRegla(n: number, empresas: { codigo: string; n: number }[]): string {
  if (n <= 0) return "Ningún otro movimiento pendiente dice eso hoy; solo aplicará a los que lleguen.";
  const detalle = empresas.map((e) => `${e.codigo} ${e.n}`).join(", ");
  return `Esta regla marcará ahora ${n.toLocaleString("es-MX")} movimiento${n === 1 ? "" : "s"} pendiente${n === 1 ? "" : "s"} más${detalle ? ` (${detalle})` : ""} y todos los que lleguen con esa palabra.`;
}
