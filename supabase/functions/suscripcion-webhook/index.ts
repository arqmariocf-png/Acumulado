// Edge function: recibe los avisos de la pasarela y mueve el estado de la
// suscripción. Es lo que hace que "no pagó" se traduzca solo en "solo
// lectura", sin que nadie lo haga a mano.
//
// Tres cosas que este endpoint tiene que hacer bien, porque es público:
//
//   1. Verificar la firma ANTES de leer nada del cuerpo. Sin eso, cualquiera
//      con la URL se activa la suscripción gratis.
//   2. Ser idempotente: la pasarela reintenta lo que no confirmamos y manda
//      el mismo evento más de una vez. La unicidad de (pasarela, evento_id)
//      en eventos_pasarela es lo que lo garantiza, no una bandera en memoria.
//   3. Responder 200 aunque el evento no nos interese. Un 4xx/5xx hace que la
//      pasarela reintente para siempre y acabe deshabilitando el endpoint.
//
// Corre con la service_role key a propósito: no hay usuario autenticado
// detrás de un webhook, y las policies de suscripciones/pagos solo dejan
// escribir a la plataforma.
//
// Configuración: `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...` y dar
// de alta la URL de esta función en el panel de la pasarela.

import { clienteServicio } from "../_shared/supabase-clients.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { clienteDelEvento, grupoDelEvento, traducirEvento, verificarFirma } from "../_shared/pagos/stripe.ts";
import { aplicarEvento } from "../_shared/pagos/suscripcion.ts";
import type { SuscripcionActual } from "../_shared/pagos/tipos.ts";

const PASARELA = "stripe";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);

  const secreto = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const cuerpo = await req.text(); // crudo: reserializar rompe la firma

  if (!(await verificarFirma(cuerpo, req.headers.get("stripe-signature"), secreto))) {
    return jsonResponse({ error: "Firma inválida" }, 400);
  }

  let evento: Record<string, unknown>;
  try {
    evento = JSON.parse(cuerpo);
  } catch {
    return jsonResponse({ error: "Cuerpo no es JSON" }, 400);
  }

  const eventoId = typeof evento.id === "string" ? evento.id : null;
  const tipo = typeof evento.type === "string" ? evento.type : "desconocido";
  if (!eventoId) return jsonResponse({ error: "Evento sin id" }, 400);

  const db = clienteServicio();

  // El insert es el candado de idempotencia: si el evento ya estaba, la
  // unicidad lo rechaza (23505). Pero "ya estaba" no siempre es "ya se
  // aplicó": si el intento anterior falló a medias, este reintento -- que es
  // justo para lo que la pasarela reintenta -- tiene que volver a procesarlo.
  // Solo se corta cuando quedó procesado y sin error.
  const { error: errEvento } = await db
    .from("eventos_pasarela")
    .insert({ pasarela: PASARELA, evento_id: eventoId, tipo, payload: evento });
  if (errEvento) {
    if (errEvento.code !== "23505") return jsonResponse({ error: errEvento.message }, 500);

    const { data: previo } = await db
      .from("eventos_pasarela")
      .select("procesado_at, error")
      .eq("pasarela", PASARELA)
      .eq("evento_id", eventoId)
      .maybeSingle();
    if (previo?.procesado_at && !previo.error) {
      return jsonResponse({ recibido: true, repetido: true });
    }
  }

  try {
    const traducido = traducirEvento(evento);
    if (!traducido) {
      await marcarProcesado(db, eventoId, null);
      return jsonResponse({ recibido: true, ignorado: true });
    }

    // Se busca por el cliente de la pasarela (viene en todos los eventos) y,
    // si no, por la organización que mandamos en metadata al crear la sesión.
    const clienteId = clienteDelEvento(evento);
    const grupoId = grupoDelEvento(evento);

    let consulta = db.from("suscripciones").select("id, grupo_id, estado, dias_gracia, periodo_fin, gracia_hasta");
    consulta = clienteId ? consulta.eq("pasarela_cliente_id", clienteId) : consulta.eq("grupo_id", grupoId ?? "");

    const { data: suscripcion, error: errSus } = await consulta.maybeSingle();
    if (errSus) throw new Error(errSus.message);
    if (!suscripcion) {
      // No es un error nuestro: puede ser un cliente de la pasarela que no
      // corresponde a ninguna organización (pruebas, otro producto). Se deja
      // anotado y se responde 200 para que no reintente eternamente.
      await marcarProcesado(db, eventoId, "No se encontró una suscripción para este cliente");
      return jsonResponse({ recibido: true, sinSuscripcion: true });
    }

    const actual: SuscripcionActual = {
      estado: suscripcion.estado,
      diasGracia: suscripcion.dias_gracia,
      periodoFin: suscripcion.periodo_fin,
      graciaHasta: suscripcion.gracia_hasta,
    };

    const cambio = aplicarEvento(actual, traducido);

    const campos: Record<string, unknown> = {
      estado: cambio.estado,
      periodo_fin: cambio.periodoFin,
      gracia_hasta: cambio.graciaHasta,
      pasarela: PASARELA,
    };
    if (cambio.metodoPago) {
      campos.metodo_pago_marca = cambio.metodoPago.marca;
      campos.metodo_pago_ultimos4 = cambio.metodoPago.ultimos4;
    }
    if (cambio.estado === "cancelada") campos.cancelada_at = traducido.ocurridoEn;

    // El id de suscripción de la pasarela se guarda la primera vez que llega:
    // es lo que después distingue "abrir alta" de "abrir portal".
    const objeto = (evento as any)?.data?.object ?? {};
    const idSuscripcionPasarela =
      typeof objeto.subscription === "string" ? objeto.subscription : tipo.startsWith("customer.subscription") ? objeto.id : null;
    if (idSuscripcionPasarela) campos.pasarela_suscripcion_id = idSuscripcionPasarela;

    const { error: errActualizar } = await db.from("suscripciones").update(campos).eq("id", suscripcion.id);
    if (errActualizar) throw new Error(errActualizar.message);

    if (cambio.pago) {
      const { error: errPago } = await db.from("pagos").insert({
        grupo_id: suscripcion.grupo_id,
        suscripcion_id: suscripcion.id,
        monto_centavos: cambio.pago.montoCentavos,
        moneda: cambio.pago.moneda,
        estado: cambio.pago.estado,
        pasarela: PASARELA,
        pasarela_pago_id: cambio.pago.pagoId,
        periodo_inicio: cambio.pago.periodoInicio,
        periodo_fin: cambio.pago.periodoFin,
        pagado_at: cambio.pago.pagadoEn,
        detalle_error: cambio.pago.detalleError,
      });
      // 23505 = el mismo cobro ya estaba registrado; no es una falla.
      if (errPago && errPago.code !== "23505") throw new Error(errPago.message);
    }

    await marcarProcesado(db, eventoId, null);
    return jsonResponse({ recibido: true, estado: cambio.estado });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : "Error inesperado";
    await marcarProcesado(db, eventoId, mensaje);
    // 500 a propósito: este sí queremos que la pasarela lo reintente.
    return jsonResponse({ error: mensaje }, 500);
  }
});

async function marcarProcesado(db: ReturnType<typeof clienteServicio>, eventoId: string, error: string | null) {
  await db
    .from("eventos_pasarela")
    .update({ procesado_at: new Date().toISOString(), error })
    .eq("pasarela", PASARELA)
    .eq("evento_id", eventoId);
}
