// Cambiar el método de un pago programado (25-nov-2026, Mario: "crea el
// botón para hacerlo manual"): un pago que quedó en efectivo por una
// devolución equivocada de tesorería (o al revés) se regresa a
// transferencia sin SQL. Reglas puras; la base lo aplica con
// fn_pago_cambiar_metodo / fn_oc_pagos_cambiar_metodo.

export type MetodoPago = "transferencia" | "cheque" | "efectivo";

export const METODOS_PAGO: { clave: MetodoPago; etiqueta: string; ayuda: string }[] = [
  { clave: "transferencia", etiqueta: "Transferencia", ayuda: "Lo paga tesorería desde la cuenta de cargo que elijas." },
  { clave: "cheque", etiqueta: "Cheque", ayuda: "Lo paga tesorería con cheque de la cuenta que elijas." },
  { clave: "efectivo", etiqueta: "Efectivo", ayuda: "Sale de Tesorería; dirección lo confirma en Efectivo por confirmar." },
];

export interface CuentaCargoOpcion {
  id: string;
  empresa_id: string;
  banco: string;
  ultimos_4: string;
  alias?: string | null;
  activo?: boolean;
}

export function etiquetaMetodo(metodo: string | null | undefined): string {
  return METODOS_PAGO.find((m) => m.clave === metodo)?.etiqueta ?? "—";
}

/** Cuentas activas de la empresa del pago, para el selector. */
export function cuentasDeEmpresa(cuentas: CuentaCargoOpcion[] | null | undefined, empresaId: string): CuentaCargoOpcion[] {
  return (cuentas ?? []).filter((c) => c.empresa_id === empresaId && c.activo !== false);
}

/** El método que conviene ofrecer de entrada: lo contrario de lo que tiene
 * el pago (un efectivo atorado casi siempre debía ser transferencia). */
export function metodoSugerido(metodoActual: string | null | undefined): MetodoPago {
  return metodoActual === "efectivo" ? "transferencia" : "efectivo";
}

/** Lo que falta antes de cambiar, o null si está completo: el método debe
 * ser distinto al actual y, si no es efectivo, llevar cuenta de cargo de la
 * misma empresa (cuando la empresa tiene cuentas). */
export function revisarCambioMetodo(metodoActual: string | null | undefined, nuevo: string | null | undefined, cuentaId: string | null | undefined, cuentasEmpresa: CuentaCargoOpcion[]): string | null {
  if (!nuevo || !METODOS_PAGO.some((m) => m.clave === nuevo)) return "Elige el método de pago.";
  if (nuevo === metodoActual) return `El pago ya está en ${etiquetaMetodo(nuevo).toLowerCase()}.`;
  if (nuevo !== "efectivo") {
    if (cuentasEmpresa.length > 0 && !cuentaId) return "Elige de qué cuenta sale el pago.";
    if (cuentaId && !cuentasEmpresa.some((c) => c.id === cuentaId)) return "Esa cuenta no es de la empresa del pago.";
  }
  return null;
}

/** La fecha a proponer: la programada si todavía no pasa; si ya pasó, hoy. */
export function fechaSugerida(fechaProgramada: string | null | undefined, hoy: string): string {
  return fechaProgramada && fechaProgramada >= hoy ? fechaProgramada : hoy;
}

/** "Pago a X: ahora transferencia desde BBVA 5859, para el 25/11." */
export function textoCambioMetodo(beneficiario: string, nuevo: MetodoPago, cuenta: CuentaCargoOpcion | null | undefined, fecha: string | null | undefined): string {
  const partes = [`Pago a ${beneficiario}: ahora ${etiquetaMetodo(nuevo).toLowerCase()}`];
  if (nuevo !== "efectivo" && cuenta) partes.push(`desde ${cuenta.banco} ${cuenta.ultimos_4}`);
  if (fecha) partes.push(`para el ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`);
  const base = partes.join(" ") + ".";
  return nuevo === "efectivo" ? `${base} Se confirma en Efectivo por confirmar.` : `${base} Ya lo ve tesorería.`;
}
