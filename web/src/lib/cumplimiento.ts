// Cumplimiento de actividades (tablero "RH · Actividades"): clasifica cada
// tarjeta contra su fecha límite y la agrupa por semana y por persona para
// las gráficas del panel de RH. Sin DOM: se prueba en node.

export type EstadoCumplimiento = "a_tiempo" | "tarde" | "vencida" | "pendiente" | "sin_fecha";

export interface ActividadBase {
  id: string;
  titulo: string;
  asignado_a: string | null;
  fecha_limite: string | null;
  /** true cuando la tarjeta está en la columna final ("Hecho"). */
  hecha: boolean;
  /** Fecha/hora en que se movió a Hecho (última actividad "movida" a esa columna). */
  hecha_en: string | null;
  created_at: string;
}

export const ETIQUETA_CUMPLIMIENTO: Record<EstadoCumplimiento, string> = {
  a_tiempo: "Hecha a tiempo",
  tarde: "Hecha tarde",
  vencida: "Vencida sin hacer",
  pendiente: "Pendiente",
  sin_fecha: "Sin fecha límite",
};

export function clasificar(a: ActividadBase, hoyIso: string): EstadoCumplimiento {
  if (!a.fecha_limite) return a.hecha ? "a_tiempo" : "sin_fecha";
  if (a.hecha) {
    const hechaDia = (a.hecha_en ?? hoyIso).slice(0, 10);
    return hechaDia <= a.fecha_limite ? "a_tiempo" : "tarde";
  }
  return a.fecha_limite < hoyIso ? "vencida" : "pendiente";
}

/** Lunes de la semana (ISO) de una fecha YYYY-MM-DD. */
export function lunesDe(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const dia = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((dia + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export interface SemanaCumplimiento {
  semana: string;
  a_tiempo: number;
  tarde: number;
  vencida: number;
  pendiente: number;
  total: number;
}

/** Agrupa por la semana de la fecha límite (las sin fecha no entran a la
 * gráfica semanal). `semanas` = cuántas semanas hacia atrás desde hoy,
 * más la semana actual y la siguiente. */
export function porSemana(actividades: ActividadBase[], hoyIso: string, semanas = 8): SemanaCumplimiento[] {
  const inicio = new Date(`${lunesDe(hoyIso)}T00:00:00Z`);
  inicio.setUTCDate(inicio.getUTCDate() - 7 * semanas);
  const filas = new Map<string, SemanaCumplimiento>();
  for (let i = 0; i <= semanas + 1; i++) {
    const d = new Date(inicio);
    d.setUTCDate(d.getUTCDate() + 7 * i);
    const clave = d.toISOString().slice(0, 10);
    filas.set(clave, { semana: clave, a_tiempo: 0, tarde: 0, vencida: 0, pendiente: 0, total: 0 });
  }
  for (const a of actividades) {
    if (!a.fecha_limite) continue;
    const fila = filas.get(lunesDe(a.fecha_limite));
    if (!fila) continue;
    const estado = clasificar(a, hoyIso);
    if (estado === "sin_fecha") continue;
    fila[estado]++;
    fila.total++;
  }
  return [...filas.values()];
}

export interface PersonaCumplimiento {
  asignado_a: string | null;
  total: number;
  hechas: number;
  a_tiempo: number;
  vencidas: number;
  pendientes: number;
  /** % de las que ya vencieron o se hicieron que se cumplieron a tiempo. */
  cumplimiento_pct: number;
}

export function porPersona(actividades: ActividadBase[], hoyIso: string): PersonaCumplimiento[] {
  const mapa = new Map<string | null, PersonaCumplimiento>();
  for (const a of actividades) {
    const fila = mapa.get(a.asignado_a) ?? { asignado_a: a.asignado_a, total: 0, hechas: 0, a_tiempo: 0, vencidas: 0, pendientes: 0, cumplimiento_pct: 0 };
    const estado = clasificar(a, hoyIso);
    fila.total++;
    if (a.hecha) fila.hechas++;
    if (estado === "a_tiempo") fila.a_tiempo++;
    if (estado === "vencida") fila.vencidas++;
    if (estado === "pendiente" || estado === "sin_fecha") fila.pendientes++;
    mapa.set(a.asignado_a, fila);
  }
  for (const f of mapa.values()) {
    const cerradas = f.hechas + f.vencidas;
    f.cumplimiento_pct = cerradas > 0 ? Math.round((f.a_tiempo / cerradas) * 100) : 0;
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}
