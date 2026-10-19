// Filtro de periodo para revisar la conciliación (20-oct-2026, Mario: "en
// contabilidad, movimientos, ponme un filtro de fecha por mes o semana o día").
// Puro, sin DOM: fechas ISO aaaa-mm-dd; semana de lunes a domingo.

export type TipoPeriodo = "todo" | "dia" | "semana" | "mes";

export const TIPOS_PERIODO: [TipoPeriodo, string][] = [
  ["todo", "Todo"],
  ["dia", "Día"],
  ["semana", "Semana"],
  ["mes", "Mes"],
];

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function deIso(s: string): Date {
  const [a, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sumarDias(s: string, n: number): string {
  const d = deIso(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Primer y último día del periodo que contiene `fecha`; null para "todo". */
export function rangoPeriodo(tipo: TipoPeriodo, fecha: string): { desde: string; hasta: string } | null {
  if (tipo === "todo") return null;
  if (tipo === "dia") return { desde: fecha, hasta: fecha };
  if (tipo === "semana") {
    const dow = (deIso(fecha).getUTCDay() + 6) % 7; // 0 = lunes
    const lunes = sumarDias(fecha, -dow);
    return { desde: lunes, hasta: sumarDias(lunes, 6) };
  }
  const [a, m] = fecha.split("-").map(Number);
  const primero = `${a}-${String(m).padStart(2, "0")}-01`;
  const siguiente = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
  return { desde: primero, hasta: sumarDias(siguiente, -1) };
}

/** La fecha del periodo anterior (n = -1) o siguiente (n = 1). Al mover por
 * mes se queda en el día 1 para no saltarse febrero. */
export function moverPeriodo(tipo: TipoPeriodo, fecha: string, n: number): string {
  if (tipo === "dia") return sumarDias(fecha, n);
  if (tipo === "semana") return sumarDias(fecha, 7 * n);
  if (tipo === "mes") {
    const [a, m] = fecha.split("-").map(Number);
    const total = a * 12 + (m - 1) + n;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
  }
  return fecha;
}

/** Texto corto del periodo: "20 oct 2026", "13–19 oct 2026", "oct 2026". */
export function etiquetaPeriodo(tipo: TipoPeriodo, fecha: string): string {
  const r = rangoPeriodo(tipo, fecha);
  if (!r) return "todas las fechas";
  const [a1, m1, d1] = r.desde.split("-").map(Number);
  const [a2, m2, d2] = r.hasta.split("-").map(Number);
  if (tipo === "dia") return `${d1} ${MESES[m1 - 1]} ${a1}`;
  if (tipo === "mes") return `${MESES[m1 - 1]} ${a1}`;
  if (a1 !== a2) return `${d1} ${MESES[m1 - 1]} ${a1} – ${d2} ${MESES[m2 - 1]} ${a2}`;
  if (m1 !== m2) return `${d1} ${MESES[m1 - 1]} – ${d2} ${MESES[m2 - 1]} ${a2}`;
  return `${d1}–${d2} ${MESES[m1 - 1]} ${a1}`;
}
