// Reglas de la suscripción. Qué le pasa al acceso de un cliente cuando la
// pasarela avisa algo. Puro: recibe el estado actual y un evento, devuelve el
// estado nuevo -- no lee ni escribe nada.
import type {
  CambioSuscripcion,
  EstadoSuscripcion,
  EventoSuscripcion,
  SuscripcionActual,
} from "./tipos.ts";

function sumarDias(iso: string, dias: number): string {
  const fecha = new Date(iso);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString();
}

/** Aplica un evento de la pasarela sobre la suscripción actual.
 *
 * La decisión menos obvia está en el cobro fallido: la pasarela reintenta el
 * mismo cobro varios días seguidos y manda un evento por intento. Si cada
 * reintento reiniciara la gracia, un cliente que nunca paga tendría gracia
 * infinita -- por eso, si ya venía en periodo de gracia, se CONSERVA la fecha
 * original. La gracia se cuenta desde el primer fallo, no desde el último. */
export function aplicarEvento(actual: SuscripcionActual, evento: EventoSuscripcion): CambioSuscripcion {
  const base: CambioSuscripcion = {
    estado: actual.estado,
    periodoFin: actual.periodoFin,
    graciaHasta: actual.graciaHasta,
    metodoPago: evento.metodoPago ?? null,
    pago: null,
  };

  switch (evento.tipo) {
    case "cobro_exitoso":
      return {
        ...base,
        estado: "activa",
        periodoFin: evento.periodoFin ?? actual.periodoFin,
        graciaHasta: null,
        pago: {
          estado: "pagado",
          montoCentavos: evento.montoCentavos ?? 0,
          moneda: evento.moneda ?? "MXN",
          pagoId: evento.pagoId ?? null,
          periodoInicio: evento.periodoInicio ?? null,
          periodoFin: evento.periodoFin ?? null,
          pagadoEn: evento.ocurridoEn,
          detalleError: null,
        },
      };

    case "cobro_fallido":
      return {
        ...base,
        estado: "periodo_gracia",
        graciaHasta:
          actual.estado === "periodo_gracia" && actual.graciaHasta
            ? actual.graciaHasta
            : sumarDias(evento.ocurridoEn, actual.diasGracia),
        pago: {
          estado: "fallido",
          montoCentavos: evento.montoCentavos ?? 0,
          moneda: evento.moneda ?? "MXN",
          pagoId: evento.pagoId ?? null,
          periodoInicio: evento.periodoInicio ?? null,
          periodoFin: evento.periodoFin ?? null,
          pagadoEn: null,
          detalleError: evento.detalleError ?? null,
        },
      };

    case "suscripcion_activada":
      return {
        ...base,
        estado: "activa",
        periodoFin: evento.periodoFin ?? actual.periodoFin,
        graciaHasta: null,
      };

    case "suscripcion_cancelada":
      return { ...base, estado: "cancelada", graciaHasta: null };

    case "metodo_pago_actualizado":
      return base;
  }
}

/** El estado que hay que MOSTRAR, que no siempre es el guardado: una gracia
 * vencida ya es una suspensión aunque nadie haya corrido todavía el barrido,
 * y una 'activa' con el periodo vencido hace rato quiere decir que se perdió
 * un webhook. Es el mismo criterio que aplica la base en
 * public.suscripcion_permite_escribir() -- si uno cambia, el otro también. */
export function estadoEfectivo(actual: SuscripcionActual, ahora: Date = new Date()): EstadoSuscripcion {
  const t = ahora.getTime();

  switch (actual.estado) {
    case "activa": {
      if (!actual.periodoFin) return "activa";
      const limite = new Date(sumarDias(actual.periodoFin, actual.diasGracia)).getTime();
      return t <= limite ? "activa" : "suspendida";
    }
    case "prueba":
      if (!actual.periodoFin) return "prueba";
      return t <= new Date(actual.periodoFin).getTime() ? "prueba" : "suspendida";
    case "periodo_gracia":
      if (!actual.graciaHasta) return "suspendida";
      return t <= new Date(actual.graciaHasta).getTime() ? "periodo_gracia" : "suspendida";
    default:
      return actual.estado;
  }
}

export function puedeEscribir(actual: SuscripcionActual, ahora: Date = new Date()): boolean {
  const estado = estadoEfectivo(actual, ahora);
  return estado === "activa" || estado === "prueba" || estado === "periodo_gracia";
}
