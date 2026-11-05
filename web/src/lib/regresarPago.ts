// Regresar un pago con error desde Tesorería (5-nov-2026, Mario: "Delia me
// comenta que se agregue un botón en los pagos porque hay errores y le
// llegan en transferencia cuando debería ser en efectivo; con esto regresa
// el error y lo documenta"). Reglas puras: tipos de error, validación y
// textos. La base lo aplica con fn_pago_regresar_error.

export type TipoErrorPago = "efectivo" | "cuenta" | "monto" | "proveedor" | "otro";

export const TIPOS_ERROR_PAGO: { clave: TipoErrorPago; etiqueta: string; ayuda: string }[] = [
  { clave: "efectivo", etiqueta: "Debe ser en efectivo, no por transferencia", ayuda: "El pago pasa a efectivo y la OC a Efectivo por confirmar; dirección lo confirma ahí." },
  { clave: "cuenta", etiqueta: "La cuenta de cargo no es la correcta", ayuda: "Dirección elige la cuenta y lo regresa a Tesorería." },
  { clave: "monto", etiqueta: "El monto no corresponde", ayuda: "Dirección corrige el monto y lo regresa a Tesorería." },
  { clave: "proveedor", etiqueta: "Proveedor o datos bancarios equivocados", ayuda: "Dirección corrige el beneficiario o sus datos bancarios." },
  { clave: "otro", etiqueta: "Otro error", ayuda: "Explica qué está mal para que dirección lo corrija." },
];

/** Lo que falta antes de mandar la devolución, o null si está completa. El
 * motivo es obligatorio salvo cuando el error es "debe ser en efectivo"
 * (ahí la base pone el texto). */
export function revisarDevolucion(tipo: string | null | undefined, motivo: string | null | undefined): string | null {
  if (!tipo || !TIPOS_ERROR_PAGO.some((t) => t.clave === tipo)) return "Elige qué está mal en el pago.";
  if (tipo !== "efectivo" && !(motivo ?? "").trim()) return "Escribe qué está mal para que dirección lo corrija.";
  return null;
}

export interface PagoDevuelto {
  devuelto_en?: string | null;
  devuelto_por_nombre?: string | null;
  devuelto_tipo?: string | null;
  devuelto_motivo?: string | null;
}

export function estaDevuelto(p: PagoDevuelto): boolean {
  return !!p.devuelto_en;
}

export function etiquetaTipoError(tipo: string | null | undefined): string {
  return TIPOS_ERROR_PAGO.find((t) => t.clave === tipo)?.etiqueta ?? "Error en el pago";
}

const fechaCorta = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** "Regresado por Delia el 05/11 · Debe ser en efectivo…: motivo" */
export function textoDevolucion(p: PagoDevuelto): string {
  if (!p.devuelto_en) return "";
  const quien = p.devuelto_por_nombre ? ` por ${p.devuelto_por_nombre}` : " por tesorería";
  const cuando = fechaCorta(p.devuelto_en);
  const motivo = (p.devuelto_motivo ?? "").trim();
  return `Regresado${quien}${cuando ? ` el ${cuando}` : ""} · ${etiquetaTipoError(p.devuelto_tipo)}${motivo ? `: ${motivo}` : ""}`;
}

/** Los pagos regresados a dirección no se le muestran a tesorería hasta que
 * dirección los dé por corregidos; los que pasaron a efectivo se confirman
 * en Efectivo por confirmar. */
export function visibleEnTesoreria<T extends PagoDevuelto & { estatus: string; metodo: string }>(p: T): boolean {
  if (p.metodo === "efectivo") return false;
  if (p.estatus === "pendiente" && estaDevuelto(p)) return false;
  return true;
}
