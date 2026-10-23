// Elegir la factura (CFDI) de un movimiento bancario por número de factura o
// folio fiscal (21-oct-2026, Mario: "así como pusiste un botón para elegir
// OV/OC/OS, poner uno para elegir factura o folio fiscal"). Orden de la lista:
// la del mismo monto, luego la de la misma contraparte y luego la fecha más
// cercana al pago. Puro, con pruebas.

export interface FacturaCandidata {
  id: string;
  folio: string;
  rfc: string | null;
  contraparte: string | null;
  total: number | null;
  fecha: string | null;
  complemento: boolean;
}

export interface FacturaOrdenada extends FacturaCandidata {
  mismoMonto: boolean;
  mismaContraparte: boolean;
}

const TOLERANCIA = 1;

function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Quita lo que no ayuda a comparar nombres: SA DE CV, puntuación, acentos. */
export function claveNombre(nombre: string | null | undefined): string {
  return sinAcentos(nombre ?? "")
    .replace(/\b(s\.?\s?a\.?|de|c\.?\s?v\.?|s\.?\s?de\s?r\.?\s?l\.?|sapi|s\.?\s?c\.?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function diasEntre(a: string | null, b: string | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86_400_000;
}

function mismaContraparte(a: string | null, b: string | null): boolean {
  const x = claveNombre(a);
  const y = claveNombre(b);
  if (x.length < 4 || y.length < 4) return false;
  return x.includes(y) || y.includes(x);
}

export function ordenarFacturas(
  facturas: FacturaCandidata[],
  mov: { monto: number | null; fecha: string | null; nombre: string | null },
): FacturaOrdenada[] {
  const marcadas = facturas.map((f) => ({
    ...f,
    mismoMonto: mov.monto != null && f.total != null && Math.abs(f.total - mov.monto) <= TOLERANCIA,
    mismaContraparte: mismaContraparte(f.contraparte, mov.nombre),
  }));
  return marcadas.sort(
    (a, b) =>
      Number(b.mismoMonto) - Number(a.mismoMonto) ||
      Number(b.mismaContraparte) - Number(a.mismaContraparte) ||
      diasEntre(a.fecha, mov.fecha) - diasEntre(b.fecha, mov.fecha) ||
      b.folio.localeCompare(a.folio, "es", { numeric: true }),
  );
}

/** Filtro de texto: número de factura / folio fiscal, RFC o nombre, por palabras. */
export function filtrarFacturas<T extends FacturaCandidata>(facturas: T[], texto: string): T[] {
  const palabras = sinAcentos(texto).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return facturas;
  return facturas.filter((f) => {
    const campo = sinAcentos(`${f.folio} ${f.rfc ?? ""} ${f.contraparte ?? ""}`);
    return palabras.every((p) => campo.includes(p));
  });
}

/** Lo que se escribe para buscar en todo el histórico, sin caracteres que rompen el filtro. */
export function terminoBusqueda(texto: string): string {
  return texto.replace(/[%,()*]/g, " ").replace(/\s+/g, " ").trim();
}

/** Folio fiscal (UUID del SAT) en mayúsculas para compararlo. */
export function esFolioFiscal(texto: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(texto.trim());
}

/** Se ofrece elegir factura si no está conciliado o si la factura fue del motor o a mano (F-/FM-). */
export function puedeLigarFactura(estado: string | null | undefined, factura: string | null | undefined): boolean {
  if (estado === "pendiente_revision" || estado === "ambiguo" || estado === "pendiente_esperado") return true;
  return estado === "resuelto" && /^FM?- /.test(factura ?? "");
}

/** "FM- ABC…" / "F- ABC…" → "ABC…"; otro texto → null. */
export function folioDeFactura(factura: string | null | undefined): string | null {
  const m = /^FM?- (.+)$/.exec(factura ?? "");
  return m ? m[1].trim() : null;
}

/** Folios de una factura con una o varias ("FM- A, B, C" → ["A", "B", "C"]). */
export function foliosDeFactura(factura: string | null | undefined): string[] {
  const texto = folioDeFactura(factura);
  if (!texto) return [];
  return texto
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
}

/** Suma de las facturas elegidas contra el monto del movimiento (±$1 cuadra). */
export function resumenSeleccion(monto: number | null, totales: (number | null)[]): { n: number; suma: number; diferencia: number | null; cuadra: boolean } {
  const suma = Math.round(totales.reduce<number>((s, t) => s + (Number(t) || 0), 0) * 100) / 100;
  const diferencia = monto == null ? null : Math.round((monto - suma) * 100) / 100;
  return { n: totales.length, suma, diferencia, cuadra: diferencia != null && Math.abs(diferencia) <= TOLERANCIA };
}

/** Texto seguro para buscar un folio dentro de la columna factura con ilike. */
export function folioParaBuscar(folio: string): string {
  return folio.replace(/[%,()*_\\]/g, "").trim();
}
