// Tipos de la capa de suscripción. Módulo puro (sin dependencias de Deno ni
// de Node) para poder probarlo con node --test, igual que el motor de
// conciliación y los parsers de ingesta.
//
// La idea de estos tipos es que NINGUNO menciona a Stripe: son el vocabulario
// propio de Acumulado. Cada pasarela se traduce a esto en su adaptador
// (`stripe.ts`), y la lógica de negocio -- qué le pasa a la suscripción
// cuando un cobro falla -- vive una sola vez, en `suscripcion.ts`. Cambiar de
// pasarela es escribir otro adaptador, no volver a decidir las reglas.

export type EstadoSuscripcion =
  | "prueba"
  | "activa"
  | "periodo_gracia"
  | "suspendida"
  | "cancelada";

export type TipoEvento =
  | "suscripcion_activada"
  | "cobro_exitoso"
  | "cobro_fallido"
  | "suscripcion_cancelada"
  | "metodo_pago_actualizado";

export interface MetodoPago {
  marca: string;
  ultimos4: string;
}

/** Un evento de la pasarela ya traducido al vocabulario de Acumulado. */
export interface EventoSuscripcion {
  tipo: TipoEvento;
  /** ISO. Cuándo ocurrió según la pasarela, no cuándo lo recibimos. */
  ocurridoEn: string;
  /** Fin del periodo pagado que reporta la pasarela (ISO), si el evento lo trae. */
  periodoFin?: string | null;
  periodoInicio?: string | null;
  montoCentavos?: number;
  moneda?: string;
  /** Id del cobro en la pasarela; es lo que hace idempotente el registro del pago. */
  pagoId?: string | null;
  metodoPago?: MetodoPago | null;
  detalleError?: string | null;
}

export interface SuscripcionActual {
  estado: EstadoSuscripcion;
  diasGracia: number;
  periodoFin: string | null;
  graciaHasta: string | null;
}

export interface PagoRegistrado {
  estado: "pagado" | "fallido";
  montoCentavos: number;
  moneda: string;
  pagoId: string | null;
  periodoInicio: string | null;
  periodoFin: string | null;
  pagadoEn: string | null;
  detalleError: string | null;
}

export interface CambioSuscripcion {
  estado: EstadoSuscripcion;
  periodoFin: string | null;
  graciaHasta: string | null;
  metodoPago: MetodoPago | null;
  /** Si el evento fue un cobro, el renglón que hay que dejar en `pagos`. */
  pago: PagoRegistrado | null;
}
