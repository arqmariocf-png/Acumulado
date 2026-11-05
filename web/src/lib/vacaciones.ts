// Vacaciones y permisos (3-nov-2026, Mario: "habilitar un módulo de
// vacaciones, con recordatorio de quién se va y cuándo regresa"). Reglas
// puras que la pantalla comparte con la base (fn_dias_habiles_lft,
// fn_vacaciones_dias_ley): días hábiles según la jornada (lun-vie o
// lun-sáb) sin festivos del art. 74 LFT, días de ley del art. 76 y el
// calendario de quién está fuera, quién sale y quién regresa.

import { festivosLFT } from "./proyeccionPlanta.ts";

export type TipoAusencia = "vacaciones" | "permiso_con_goce" | "permiso_sin_goce" | "incapacidad";
export type EstadoAusencia = "solicitada" | "autorizada" | "rechazada" | "cancelada";

export const ETIQUETA_TIPO: Record<TipoAusencia, string> = {
  vacaciones: "Vacaciones",
  permiso_con_goce: "Permiso con goce",
  permiso_sin_goce: "Permiso sin goce",
  incapacidad: "Incapacidad",
};

export const ETIQUETA_ESTADO: Record<EstadoAusencia, string> = {
  solicitada: "Por autorizar",
  autorizada: "Autorizada",
  rechazada: "Rechazada",
  cancelada: "Cancelada",
};

export interface Ausencia {
  id: string;
  personal_id: string;
  profile_id: string | null;
  personal_nombre: string;
  tipo: TipoAusencia;
  desde: string; // AAAA-MM-DD
  hasta: string;
  dias: number;
  regresa_el: string;
  cubre_nombre: string | null;
  notas: string | null;
  estado: EstadoAusencia;
  solicitante_nombre: string | null;
  rechazo_motivo: string | null;
  created_at: string;
}

export interface SaldoVacaciones {
  anio_servicio: number;
  anios_cumplidos: number;
  periodo_desde: string;
  periodo_hasta: string;
  dias_ley: number;
  tomados: number;
  pendientes: number;
  disponibles: number;
  /** Las vacaciones se habilitan al cumplir un año (5-nov-2026, Mario); RH
   * puede registrarlas antes. Opcionales por si llega un saldo viejo. */
  habilitado?: boolean;
  habilitado_desde?: string;
  dias_semana: number;
}

/** Fecha en que una persona cumple un año y se le habilitan las vacaciones. */
export function vacacionesDesde(fechaIngreso: string): string {
  const d = fecha(fechaIngreso);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return iso(d);
}

/** ¿Ya cumplió el año? (la base manda `habilitado`; si no viene, se calcula). */
export function vacacionesHabilitadas(saldo: Pick<SaldoVacaciones, "habilitado" | "anios_cumplidos"> | null | undefined): boolean {
  if (!saldo) return false;
  return saldo.habilitado ?? saldo.anios_cumplidos >= 1;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fecha = (s: string) => new Date(s.slice(0, 10) + "T00:00:00Z");

function esHabil(d: Date, diasSemana: number, festivos: Set<string>): boolean {
  const dow = d.getUTCDay(); // 0 = domingo
  if (dow === 0) return false;
  if (dow === 6 && diasSemana <= 5) return false;
  return !festivos.has(iso(d));
}

function festivosEntre(desde: string, hasta: string): Set<string> {
  const f = new Set<string>();
  for (let a = Number(desde.slice(0, 4)); a <= Number(hasta.slice(0, 4)); a++) festivosLFT(a).forEach((x) => f.add(x));
  return f;
}

/** Días hábiles entre dos fechas inclusive (misma regla que la base). */
export function diasHabiles(desde: string, hasta: string, diasSemana = 6): number {
  if (!desde || !hasta || hasta < desde) return 0;
  const festivos = festivosEntre(desde, hasta);
  let n = 0;
  for (let d = fecha(desde); iso(d) <= hasta; d.setUTCDate(d.getUTCDate() + 1)) if (esHabil(d, diasSemana, festivos)) n++;
  return n;
}

/** Primer día hábil después de `hasta`: el día en que regresa. */
export function diaDeRegreso(hasta: string, diasSemana = 6): string {
  const d = fecha(hasta);
  const festivos = festivosEntre(hasta, iso(new Date(d.getTime() + 20 * 86_400_000)));
  for (let i = 0; i < 20; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (esHabil(d, diasSemana, festivos)) return iso(d);
  }
  return iso(d);
}

/** Días de vacaciones por año de servicio (art. 76 LFT, reforma 2023). */
export function diasDeLey(anioServicio: number): number {
  if (anioServicio <= 1) return 12;
  if (anioServicio <= 5) return 12 + 2 * (anioServicio - 1);
  return 20 + 2 * (Math.floor((anioServicio - 6) / 5) + 1);
}

/** Qué revisar antes de mandar la solicitud (la base lo vuelve a validar). */
export function revisarSolicitud(p: { tipo: TipoAusencia; desde: string; hasta: string; diasSemana?: number; saldo?: SaldoVacaciones | null; puedeExceder?: boolean }): string | null {
  if (!p.desde || !p.hasta) return "Elige el primer y el último día.";
  if (p.hasta < p.desde) return "El último día no puede ser antes del primero.";
  const dias = diasHabiles(p.desde, p.hasta, p.diasSemana ?? 6);
  if (dias === 0) return "Esas fechas no tienen días hábiles (domingos o festivos).";
  if (p.tipo === "vacaciones" && p.saldo && !p.puedeExceder && !vacacionesHabilitadas(p.saldo)) {
    return `Las vacaciones se habilitan al cumplir un año de antigüedad${p.saldo.habilitado_desde ? ` (a partir del ${p.saldo.habilitado_desde.slice(8, 10)}/${p.saldo.habilitado_desde.slice(5, 7)}/${p.saldo.habilitado_desde.slice(0, 4)})` : ""}. Mientras, pide un permiso o habla con RH.`;
  }
  if (p.tipo === "vacaciones" && p.saldo && !p.puedeExceder && dias > p.saldo.disponibles) {
    return `Pides ${dias} días y tienes ${p.saldo.disponibles} disponibles en tu periodo (${p.saldo.dias_ley} de ley). Habla con RH.`;
  }
  return null;
}

export type SituacionAusencia = "fuera" | "sale_hoy" | "regresa_manana" | "proxima" | "pasada";

/** Dónde está la ausencia respecto a hoy. */
export function situacion(a: Pick<Ausencia, "desde" | "hasta" | "regresa_el">, hoy: string): SituacionAusencia {
  if (a.hasta < hoy) return "pasada";
  if (a.desde > hoy) return "proxima";
  if (a.hasta === hoy || sumarDias(hoy, 1) === a.regresa_el) return "regresa_manana";
  if (a.desde === hoy) return "sale_hoy";
  return "fuera";
}

export function sumarDias(fechaIso: string, dias: number): string {
  const d = fecha(fechaIso);
  d.setUTCDate(d.getUTCDate() + dias);
  return iso(d);
}

export interface CalendarioAusencias {
  fueraHoy: Ausencia[];
  salenProximos7: Ausencia[];
  regresanProximos7: Ausencia[];
  proximas30: Ausencia[];
}

/** Agrupa las autorizadas para el tablero de RH: quién está fuera hoy, quién
 * sale y quién regresa en la semana, y lo que viene en 30 días. */
export function calendarioAusencias(lista: Ausencia[], hoy: string): CalendarioAusencias {
  const aut = lista.filter((a) => a.estado === "autorizada");
  const en7 = sumarDias(hoy, 7);
  const en30 = sumarDias(hoy, 30);
  const porDesde = (x: Ausencia, y: Ausencia) => x.desde.localeCompare(y.desde) || x.personal_nombre.localeCompare(y.personal_nombre, "es");
  return {
    fueraHoy: aut.filter((a) => a.desde <= hoy && a.hasta >= hoy).sort((x, y) => x.regresa_el.localeCompare(y.regresa_el)),
    salenProximos7: aut.filter((a) => a.desde > hoy && a.desde <= en7).sort(porDesde),
    regresanProximos7: aut.filter((a) => a.regresa_el > hoy && a.regresa_el <= en7 && a.desde <= hoy).sort((x, y) => x.regresa_el.localeCompare(y.regresa_el)),
    proximas30: aut.filter((a) => a.desde > en7 && a.desde <= en30).sort(porDesde),
  };
}

export function fechaCorta(fechaIso: string): string {
  const [a, m, d] = fechaIso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(a, m - 1, d)));
}

/** Texto de una ausencia para listas y avisos. */
export function resumenAusencia(a: Pick<Ausencia, "desde" | "hasta" | "dias" | "regresa_el" | "cubre_nombre">): string {
  return `del ${fechaCorta(a.desde)} al ${fechaCorta(a.hasta)} · ${a.dias} día${a.dias === 1 ? "" : "s"} · regresa el ${fechaCorta(a.regresa_el)}${a.cubre_nombre ? ` · cubre ${a.cubre_nombre}` : ""}`;
}
