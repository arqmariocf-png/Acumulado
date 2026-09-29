// Pagos por orden de compra (dirección, 29-sep-2026). Sin DOM: se prueba
// en node. La regla de verdad vive en fn_oc_programar_pago; aquí se replica
// para proponer monto y fecha en la pantalla.

export type CondicionPago = "contado" | "credito" | "anticipo";

export const ETIQUETA_CONDICION: Record<CondicionPago, string> = { contado: "Contado", credito: "Crédito", anticipo: "Anticipo" };

export interface OcConSaldo {
  total: number | null;
  pagado: number;
  fecha_creacion: string | null;
  dias_credito: number | null;
}

function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Saldo pendiente de la OC: total menos lo pagado (nunca negativo). */
export function saldoOc(oc: OcConSaldo): number {
  return Math.max(0, Math.round((Number(oc.total ?? 0) - Number(oc.pagado ?? 0)) * 100) / 100);
}

/** Fecha propuesta para el pago: crédito = fecha de la OC + días de crédito
 * del proveedor (30 si no tiene línea); contado y anticipo = hoy. Nunca en
 * el pasado. */
export function fechaPagoSugerida(condicion: CondicionPago, oc: OcConSaldo, hoy: string): string {
  if (condicion !== "credito") return hoy;
  const base = oc.fecha_creacion ?? hoy;
  const f = sumarDias(base, oc.dias_credito ?? 30);
  return f < hoy ? hoy : f;
}

/** Monto propuesto: el saldo completo, salvo anticipo (la mitad, redondeada). */
export function montoPagoSugerido(condicion: CondicionPago, oc: OcConSaldo): number {
  const saldo = saldoOc(oc);
  if (condicion === "anticipo") return Math.round((saldo / 2) * 100) / 100;
  return saldo;
}

/** Estado de pago de la OC para la etiqueta de la lista. */
export function estadoPagoOc(oc: OcConSaldo & { programado?: number }): "pagada" | "parcial" | "programada" | "sin_programar" {
  const saldo = saldoOc(oc);
  if (saldo <= 0.005) return "pagada";
  if (Number(oc.pagado ?? 0) > 0) return "parcial";
  if (Number(oc.programado ?? 0) > 0) return "programada";
  return "sin_programar";
}
