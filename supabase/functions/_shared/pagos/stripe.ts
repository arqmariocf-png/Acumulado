// Adaptador de Stripe: traduce entre el vocabulario de Stripe y el de
// Acumulado (`tipos.ts`). Las reglas de negocio NO viven aquí -- aquí solo se
// traduce. Cambiar de pasarela es escribir el equivalente de este archivo.
//
// Se habla con la API por `fetch` y form-encoding en vez de usar el SDK: el
// SDK de Stripe para Node arrastra dependencias que en Deno solo estorban, y
// de toda la API aquí se ocupan tres endpoints.
import type { EventoSuscripcion, MetodoPago } from "./tipos.ts";

const API = "https://api.stripe.com/v1";

function isoDesdeUnix(segundos: number | null | undefined): string | null {
  if (typeof segundos !== "number" || !Number.isFinite(segundos)) return null;
  return new Date(segundos * 1000).toISOString();
}

// ── Verificación de firma ───────────────────────────────────────────────
// El webhook es un endpoint público: sin verificar la firma, cualquiera que
// conozca la URL podría mandar un "cobro_exitoso" y activarse la suscripción
// gratis. Stripe firma con HMAC-SHA256 sobre "<timestamp>.<cuerpo crudo>" y
// manda el resultado en el header stripe-signature.

function comparaSegura(a: string, b: string): boolean {
  // Tiempo constante: comparar con === se corta en el primer byte distinto y
  // filtra, por diferencia de tiempo, cuánto prefijo se acertó.
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

export function parsearHeaderFirma(header: string): { timestamp: number | null; firmas: string[] } {
  let timestamp: number | null = null;
  const firmas: string[] = [];

  for (const parte of header.split(",")) {
    const [clave, valor] = parte.trim().split("=", 2);
    if (clave === "t" && valor) {
      const n = Number(valor);
      timestamp = Number.isFinite(n) ? n : null;
    } else if (clave === "v1" && valor) {
      firmas.push(valor);
    }
  }

  return { timestamp, firmas };
}

export async function firmar(cuerpoFirmado: string, secreto: string): Promise<string> {
  const llave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(cuerpoFirmado));
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verifica la firma del webhook. `cuerpo` tiene que ser el texto CRUDO tal
 * como llegó: si se parsea y se vuelve a serializar, cambia un espacio y la
 * firma deja de cuadrar.
 *
 * La tolerancia de tiempo es contra reenvío: sin ella, quien capture una
 * petición válida puede repetirla mañana. Los 5 minutos son el valor que usa
 * la propia librería de Stripe. */
export async function verificarFirma(
  cuerpo: string,
  header: string | null,
  secreto: string,
  ahoraSegundos: number = Math.floor(Date.now() / 1000),
  toleranciaSegundos = 300,
): Promise<boolean> {
  if (!header || !secreto) return false;

  const { timestamp, firmas } = parsearHeaderFirma(header);
  if (timestamp === null || firmas.length === 0) return false;
  if (Math.abs(ahoraSegundos - timestamp) > toleranciaSegundos) return false;

  const esperada = await firmar(`${timestamp}.${cuerpo}`, secreto);
  return firmas.some((f) => comparaSegura(f, esperada));
}

// ── Traducción de eventos ───────────────────────────────────────────────

function metodoDePago(objeto: Record<string, any>): MetodoPago | null {
  const tarjeta = objeto?.card ?? objeto?.payment_method_details?.card;
  if (!tarjeta?.brand || !tarjeta?.last4) return null;
  return { marca: String(tarjeta.brand), ultimos4: String(tarjeta.last4) };
}

/** Traduce un evento de Stripe. Devuelve null para todo lo que no nos
 * interesa -- que es la mayoría: Stripe manda decenas de tipos de evento y
 * el webhook tiene que ignorarlos sin ruido, no fallar. */
export function traducirEvento(evento: Record<string, any>): EventoSuscripcion | null {
  const objeto = evento?.data?.object ?? {};
  const ocurridoEn = isoDesdeUnix(evento?.created) ?? new Date().toISOString();
  const periodo = objeto?.lines?.data?.[0]?.period ?? {};

  switch (evento?.type) {
    case "invoice.payment_succeeded":
      return {
        tipo: "cobro_exitoso",
        ocurridoEn,
        periodoInicio: isoDesdeUnix(periodo.start),
        periodoFin: isoDesdeUnix(periodo.end),
        montoCentavos: Number(objeto.amount_paid ?? 0),
        moneda: String(objeto.currency ?? "mxn").toUpperCase(),
        pagoId: objeto.id ? String(objeto.id) : null,
      };

    case "invoice.payment_failed":
      return {
        tipo: "cobro_fallido",
        ocurridoEn,
        periodoInicio: isoDesdeUnix(periodo.start),
        periodoFin: isoDesdeUnix(periodo.end),
        montoCentavos: Number(objeto.amount_due ?? 0),
        moneda: String(objeto.currency ?? "mxn").toUpperCase(),
        pagoId: objeto.id ? String(objeto.id) : null,
        detalleError: objeto?.last_finalization_error?.message ?? "El cobro no se pudo realizar",
      };

    case "customer.subscription.created":
    case "customer.subscription.updated":
      // 'canceled' llega como update cuando la baja se programó de antemano.
      if (objeto.status === "canceled") {
        return { tipo: "suscripcion_cancelada", ocurridoEn };
      }
      if (objeto.status !== "active" && objeto.status !== "trialing") return null;
      return {
        tipo: "suscripcion_activada",
        ocurridoEn,
        periodoFin: isoDesdeUnix(objeto.current_period_end),
      };

    case "customer.subscription.deleted":
      return { tipo: "suscripcion_cancelada", ocurridoEn };

    case "payment_method.attached":
      return { tipo: "metodo_pago_actualizado", ocurridoEn, metodoPago: metodoDePago(objeto) };

    default:
      return null;
  }
}

/** El id de cliente de Stripe que trae el evento. Es por donde se resuelve a
 * qué organización pertenece: `metadata.grupo_id` solo viaja en los eventos
 * que nosotros originamos, el `customer` viene en todos. */
export function clienteDelEvento(evento: Record<string, any>): string | null {
  const objeto = evento?.data?.object ?? {};
  const cliente = objeto.customer ?? null;
  return typeof cliente === "string" && cliente.length > 0 ? cliente : null;
}

/** La organización, cuando el evento la trae en metadata (los que nacieron de
 * una sesión de checkout creada por nosotros). */
export function grupoDelEvento(evento: Record<string, any>): string | null {
  const objeto = evento?.data?.object ?? {};
  const grupo = objeto?.metadata?.grupo_id ?? objeto?.subscription_details?.metadata?.grupo_id ?? null;
  return typeof grupo === "string" && grupo.length > 0 ? grupo : null;
}

// ── Llamadas a la API ───────────────────────────────────────────────────

function aFormulario(datos: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(datos)) {
    if (valor !== undefined) params.set(clave, String(valor));
  }
  return params.toString();
}

async function llamar(ruta: string, llave: string, datos: Record<string, string | number | undefined>) {
  const respuesta = await fetch(`${API}${ruta}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${llave}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: aFormulario(datos),
  });

  const cuerpo = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(cuerpo?.error?.message ?? `Stripe respondió ${respuesta.status}`);
  }
  return cuerpo;
}

export async function crearCliente(llave: string, nombre: string, grupoId: string): Promise<string> {
  const cliente = await llamar("/customers", llave, { name: nombre, "metadata[grupo_id]": grupoId });
  return String(cliente.id);
}

/** Sesión de alta: es la pantalla donde el cliente captura su tarjeta, en el
 * dominio de Stripe. Por eso la tarjeta nunca pasa por Acumulado. */
export async function crearSesionCheckout(
  llave: string,
  opciones: { clienteId: string; precioId: string; grupoId: string; urlExito: string; urlCancelar: string },
): Promise<string> {
  const sesion = await llamar("/checkout/sessions", llave, {
    mode: "subscription",
    customer: opciones.clienteId,
    "line_items[0][price]": opciones.precioId,
    "line_items[0][quantity]": 1,
    success_url: opciones.urlExito,
    cancel_url: opciones.urlCancelar,
    "subscription_data[metadata][grupo_id]": opciones.grupoId,
    "metadata[grupo_id]": opciones.grupoId,
  });
  return String(sesion.url);
}

/** Portal de cliente: cambiar tarjeta, ver recibos, cancelar. Es lo que evita
 * tener que construir todas esas pantallas del lado nuestro. */
export async function crearSesionPortal(
  llave: string,
  opciones: { clienteId: string; urlRegreso: string },
): Promise<string> {
  const sesion = await llamar("/billing_portal/sessions", llave, {
    customer: opciones.clienteId,
    return_url: opciones.urlRegreso,
  });
  return String(sesion.url);
}
