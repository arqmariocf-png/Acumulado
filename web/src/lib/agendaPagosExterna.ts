import type { MetodoPagoNomina, NominaExternaEstado, NominaExternaOrigenKey } from "../types/database";

// Agenda de pagos de la nómina externa (APIs de Grupo Loma): junta en una
// sola lista todo lo que hay que pagar de los tres orígenes -- mano de obra
// y nómina fija semanal/quincenal -- para verlo y pagarlo por día en vez de
// origen por origen.
//
// Puerto del módulo equivalente en aasanwellness (web/src/lib/
// paymentAgenda.ts), sin el origen "coaches_semanal": ese es específico de
// Aasan Wellness (nómina de las coaches, calculada de asistencia) y no
// aplica aquí.
//
// Este módulo no habla con la base: recibe las entradas ya armadas y solo
// las une, ordena, agrupa y suma -- así la misma aritmética se puede
// probar con `node --test`.

export const ORIGIN_LABELS: Record<NominaExternaOrigenKey, string> = {
  mano_obra: "Mano de obra",
  nomina_semanal: "Nómina fija semanal",
  nomina_quincenal: "Nómina fija quincenal",
};

export interface AgendaEntry {
  /** Id de la fila de pago (nomina_externa_pagos.id). */
  id: string;
  origin: NominaExternaOrigenKey;
  /** A quién se le paga. */
  concept: string;
  /** Periodo o centro de costos -- contexto para reconocerlo. */
  detail: string;
  scheduledFor: string | null;
  method: MetodoPagoNomina;
  status: NominaExternaEstado;
  /**
   * Congelado si ya se pagó; vigente (recalculado) si sigue programado.
   * null cuando el importe todavía no se puede leer -- por ejemplo, un
   * renglón cuya columna de importe no está mapeada.
   */
  amountCents: number | null;
  paidAt: string | null;
  reference: string | null;
}

/** Programado y con fecha ya pasada: es lo que se quedó atorado. */
export function isOverdue(entry: AgendaEntry, todayKey: string): boolean {
  return entry.status === "programado" && entry.scheduledFor != null && entry.scheduledFor < todayKey;
}

/**
 * Orden de trabajo, no de captura: primero lo que se paga antes. Lo que
 * no tiene fecha va al final (no se puede planear), y a fecha igual se
 * ordena por origen y luego por nombre para que la lista no baile entre
 * recargas.
 */
export function sortAgenda(entries: AgendaEntry[]): AgendaEntry[] {
  return [...entries].sort((a, b) => {
    if (a.scheduledFor !== b.scheduledFor) {
      if (a.scheduledFor == null) return 1;
      if (b.scheduledFor == null) return -1;
      return a.scheduledFor.localeCompare(b.scheduledFor);
    }
    if (a.origin !== b.origin) return a.origin.localeCompare(b.origin);
    return a.concept.localeCompare(b.concept);
  });
}

export interface AgendaGroup {
  /** "YYYY-MM-DD", o null para lo que no tiene fecha de pago. */
  date: string | null;
  entries: AgendaEntry[];
  totalCents: number;
  overdue: boolean;
}

/** Agrupa por día de pago -- así se ve "el lunes salen $X en total". */
export function groupByDate(entries: AgendaEntry[], todayKey: string): AgendaGroup[] {
  const groups = new Map<string, AgendaEntry[]>();
  for (const entry of sortAgenda(entries)) {
    const key = entry.scheduledFor ?? "";
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.entries()].map(([key, list]) => ({
    date: key === "" ? null : key,
    entries: list,
    totalCents: sumAmounts(list),
    overdue: list.some((e) => isOverdue(e, todayKey)),
  }));
}

export function sumAmounts(entries: AgendaEntry[]): number {
  return entries.reduce((sum, e) => sum + (e.amountCents ?? 0), 0);
}

export interface AgendaTotals {
  scheduledCents: number;
  paidCents: number;
  overdueCents: number;
  scheduledCount: number;
  paidCount: number;
  overdueCount: number;
  /** Cuántas entradas no traen importe legible -- no se están sumando. */
  unreadableCount: number;
  byOrigin: { origin: NominaExternaOrigenKey; scheduledCents: number; paidCents: number; count: number }[];
}

export function agendaTotals(entries: AgendaEntry[], todayKey: string): AgendaTotals {
  const scheduled = entries.filter((e) => e.status === "programado");
  const paid = entries.filter((e) => e.status === "pagado");
  const overdue = entries.filter((e) => isOverdue(e, todayKey));

  const origins = [...new Set(entries.map((e) => e.origin))].sort();
  return {
    scheduledCents: sumAmounts(scheduled),
    paidCents: sumAmounts(paid),
    overdueCents: sumAmounts(overdue),
    scheduledCount: scheduled.length,
    paidCount: paid.length,
    overdueCount: overdue.length,
    unreadableCount: entries.filter((e) => e.amountCents == null).length,
    byOrigin: origins.map((origin) => {
      const mine = entries.filter((e) => e.origin === origin);
      return {
        origin,
        scheduledCents: sumAmounts(mine.filter((e) => e.status === "programado")),
        paidCents: sumAmounts(mine.filter((e) => e.status === "pagado")),
        count: mine.length,
      };
    }),
  };
}
