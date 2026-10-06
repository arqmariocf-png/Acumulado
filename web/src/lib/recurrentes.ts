// Actividades recurrentes y programadas de un tablero (Mario, 6-oct-2026).
// Texto legible de la frecuencia y la próxima fecha en que se crea la
// tarjeta; misma regla que fn_generar_actividades_recurrentes. Puro, con pruebas.

export type Frecuencia = "semanal" | "mensual" | "unica";

export interface Recurrente {
  frecuencia: Frecuencia;
  dias_semana: number[];
  dia_mes: number | null;
  fecha_unica: string | null;
  activa: boolean;
}

export const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export function textoFrecuencia(r: Recurrente): string {
  if (r.frecuencia === "mensual") return `cada mes, el día ${r.dia_mes}`;
  if (r.frecuencia === "unica") return r.fecha_unica ? `una vez, el ${fechaCorta(r.fecha_unica)}` : "una vez";
  const dias = [...r.dias_semana].sort((a, b) => a - b);
  if (dias.length === 7) return "todos los días";
  if (dias.join(",") === "1,2,3,4,5") return "de lunes a viernes";
  return `cada ${dias.map((d) => DIAS_CORTOS[d - 1]).join(", ")}`;
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Próxima fecha (desde `hoy`, incluido) en que se crea la tarjeta; null si ya no habrá. */
export function proximaFecha(r: Recurrente, hoy: string): string | null {
  if (!r.activa) return null;
  if (r.frecuencia === "unica") return r.fecha_unica && r.fecha_unica >= hoy ? r.fecha_unica : null;
  const base = new Date(`${hoy}T12:00:00Z`);
  for (let i = 0; i < 400; i++) {
    const f = new Date(base.getTime() + i * 86_400_000);
    if (r.frecuencia === "semanal") {
      const isodow = ((f.getUTCDay() + 6) % 7) + 1;
      if (r.dias_semana.includes(isodow)) return iso(f);
    } else {
      const ultimo = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate();
      if (f.getUTCDate() === Math.min(r.dia_mes ?? 1, ultimo)) return iso(f);
    }
  }
  return null;
}
