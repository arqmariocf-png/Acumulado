// Utilidades de normalización de texto. El Excel real de referencia tiene
// variantes de escritura para el mismo dato (ej. "Constructora, Supervision y
// Consultoria Loma" vs "Constructora Supervisión y Consultoría Loma" — con y
// sin acentos, con y sin coma), así que toda comparación de texto libre
// (proveedor, palabras clave) debe ser insensible a acentos/mayúsculas.

export function normalizarTexto(valor: string | null | undefined): string {
  if (!valor) return "";
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .replace(/[,.]/g, "") // quita puntuación común de nombres de empresa
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function contieneTexto(haystack: string | null | undefined, needle: string): boolean {
  return normalizarTexto(haystack).includes(normalizarTexto(needle));
}

export function textoIgual(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizarTexto(a) === normalizarTexto(b);
}

/** AAAAMM a partir de una fecha ISO (yyyy-mm-dd). */
export function periodoDeFecha(fechaIso: string): string {
  return fechaIso.slice(0, 7).replace("-", "");
}

/** true si periodoA es estrictamente anterior a periodoB (ambos AAAAMM). */
export function periodoEsAnterior(periodoA: string, periodoB: string): boolean {
  return periodoA < periodoB;
}
