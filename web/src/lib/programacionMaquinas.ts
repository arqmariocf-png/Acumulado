// Programación de operaciones por máquina (Clavicón: la malla pasa por
// varios pasos en distintas máquinas). Puro, sin DOM: se prueba en node.
//
// Reglas:
//   - Jornada de trabajo configurable (por omisión 08:00-18:00, lunes a
//     sábado). Una operación que no cabe en el día continúa al siguiente
//     día hábil.
//   - Los pasos de un lote van en secuencia: cada paso empieza cuando
//     termina el anterior, y no antes de que la máquina esté libre (última
//     operación ya programada en esa máquina).
//   - Duración = minutos de preparación + minutos por unidad × cantidad.

export interface PasoRuta {
  orden: number;
  nombre_paso: string;
  equipo_id: string | null;
  minutos_preparacion: number;
  minutos_por_unidad: number;
}

export interface OcupacionMaquina {
  equipo_id: string | null;
  fin_programado: string;
}

export interface Jornada {
  horaInicio: number;
  horaFin: number;
  /** Días de la semana que se trabaja (0 = domingo). */
  diasLaborales: number[];
}

export const JORNADA_BASE: Jornada = { horaInicio: 8, horaFin: 18, diasLaborales: [1, 2, 3, 4, 5, 6] };

export interface OperacionGenerada {
  paso: number;
  nombre_paso: string;
  equipo_id: string | null;
  inicio_programado: string;
  fin_programado: string;
  minutos: number;
}

export function duracionMinutos(p: PasoRuta, cantidad: number): number {
  return Math.max(1, Math.round((Number(p.minutos_preparacion) + Number(p.minutos_por_unidad) * cantidad) * 100) / 100);
}

function esLaboral(d: Date, j: Jornada): boolean {
  return j.diasLaborales.includes(d.getDay());
}

/** Mueve `d` al siguiente instante en horario laboral (mismo instante si ya
 * lo está). */
export function siguienteHoraLaboral(d: Date, j: Jornada): Date {
  const r = new Date(d);
  for (let i = 0; i < 400; i++) {
    const inicioDia = new Date(r);
    inicioDia.setHours(j.horaInicio, 0, 0, 0);
    const finDia = new Date(r);
    finDia.setHours(j.horaFin, 0, 0, 0);
    if (esLaboral(r, j) && r >= inicioDia && r < finDia) return r;
    if (esLaboral(r, j) && r < inicioDia) return inicioDia;
    // fuera de horario o día no laboral: brinca al inicio del día siguiente
    r.setDate(r.getDate() + 1);
    r.setHours(j.horaInicio, 0, 0, 0);
  }
  return r;
}

/** Suma minutos de trabajo respetando la jornada (lo que no cabe hoy sigue
 * el siguiente día laboral). */
export function sumarMinutosLaborales(inicio: Date, minutos: number, j: Jornada): Date {
  let actual = siguienteHoraLaboral(inicio, j);
  let restantes = minutos;
  for (let i = 0; i < 400 && restantes > 0; i++) {
    const finDia = new Date(actual);
    finDia.setHours(j.horaFin, 0, 0, 0);
    const disponibles = (finDia.getTime() - actual.getTime()) / 60000;
    if (restantes <= disponibles) {
      return new Date(actual.getTime() + restantes * 60000);
    }
    restantes -= disponibles;
    actual = siguienteHoraLaboral(new Date(finDia.getTime() + 1000), j);
  }
  return actual;
}

/** Genera las operaciones de un lote a partir de su ruta, empezando en
 * `inicio` (o cuando la máquina se desocupe), en secuencia. */
export function programarLote(ruta: PasoRuta[], cantidad: number, inicio: Date, ocupacion: OcupacionMaquina[], j: Jornada = JORNADA_BASE): OperacionGenerada[] {
  const pasos = [...ruta].sort((a, b) => a.orden - b.orden);
  const libreDesde = new Map<string, number>();
  for (const o of ocupacion) if (o.equipo_id) libreDesde.set(o.equipo_id, Math.max(libreDesde.get(o.equipo_id) ?? 0, new Date(o.fin_programado).getTime()));
  const resultado: OperacionGenerada[] = [];
  let cursor = inicio.getTime();
  for (const p of pasos) {
    const minutos = duracionMinutos(p, cantidad);
    const maquinaLibre = p.equipo_id ? (libreDesde.get(p.equipo_id) ?? 0) : 0;
    const comienzo = siguienteHoraLaboral(new Date(Math.max(cursor, maquinaLibre)), j);
    const fin = sumarMinutosLaborales(comienzo, minutos, j);
    resultado.push({ paso: p.orden, nombre_paso: p.nombre_paso, equipo_id: p.equipo_id, inicio_programado: comienzo.toISOString(), fin_programado: fin.toISOString(), minutos });
    if (p.equipo_id) libreDesde.set(p.equipo_id, fin.getTime());
    cursor = fin.getTime();
  }
  return resultado;
}

/** Carga por máquina en un rango: minutos programados y % de la jornada. */
export function cargaPorMaquina(
  operaciones: { equipo_id: string | null; inicio_programado: string; fin_programado: string; estado: string }[],
  desde: Date,
  hasta: Date,
  j: Jornada = JORNADA_BASE,
): Map<string, { minutos: number; pct: number }> {
  const minutosJornadaDia = (j.horaFin - j.horaInicio) * 60;
  let diasLaborales = 0;
  for (let d = new Date(desde); d < hasta; d.setDate(d.getDate() + 1)) if (esLaboral(d, j)) diasLaborales++;
  const capacidad = Math.max(1, diasLaborales * minutosJornadaDia);
  const mapa = new Map<string, { minutos: number; pct: number }>();
  for (const o of operaciones) {
    if (!o.equipo_id || o.estado === "cancelada") continue;
    const ini = Math.max(new Date(o.inicio_programado).getTime(), desde.getTime());
    const fin = Math.min(new Date(o.fin_programado).getTime(), hasta.getTime());
    if (fin <= ini) continue;
    const m = (fin - ini) / 60000;
    const actual = mapa.get(o.equipo_id) ?? { minutos: 0, pct: 0 };
    actual.minutos += m;
    actual.pct = Math.round((actual.minutos / capacidad) * 100);
    mapa.set(o.equipo_id, actual);
  }
  return mapa;
}
