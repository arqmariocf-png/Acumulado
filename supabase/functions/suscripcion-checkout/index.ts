// Edge function: manda al admin de una organización a capturar o cambiar su
// tarjeta, en el dominio de la pasarela.
//
// POST body: { urlRegreso: string }
// Responde { url } y el frontend redirige ahí.
//
// Si la organización todavía no tiene suscripción en la pasarela, abre una
// sesión de alta (checkout). Si ya la tiene, abre el portal de cliente --
// donde puede cambiar tarjeta, ver recibos y cancelar -- en vez de crearle
// una segunda suscripción, que es el error clásico de este flujo.
//
// La tarjeta NUNCA pasa por aquí: esta función solo crea la sesión y devuelve
// una URL del dominio de la pasarela.

import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { crearCliente, crearSesionCheckout, crearSesionPortal } from "../_shared/pagos/stripe.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const { urlRegreso } = await req.json();
    if (!urlRegreso || typeof urlRegreso !== "string") {
      return jsonResponse({ error: "urlRegreso es requerido" }, 400);
    }

    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    // Solo el admin de la organización administra el pago: no es información
    // que deba tocar quien captura movimientos.
    if (perfil.rol !== "admin" || !perfil.grupoId) {
      return jsonResponse({ error: "Solo un administrador de la organización puede administrar la suscripción" }, 403);
    }

    const llave = Deno.env.get("STRIPE_SECRET_KEY");
    const precioId = Deno.env.get("STRIPE_PRECIO_ID");
    if (!llave) return jsonResponse({ error: "STRIPE_SECRET_KEY no está configurado" }, 500);

    // Se lee con el cliente del usuario para que RLS confirme que la
    // suscripción es de SU organización; se escribe con el de servicio
    // porque suscripciones solo la edita la plataforma (ver policies).
    const db = clienteComoUsuario(req);
    const dbServicio = clienteServicio();

    const { data: suscripcion, error: errSus } = await db
      .from("suscripciones")
      .select("id, grupo_id, pasarela, pasarela_cliente_id, pasarela_suscripcion_id")
      .eq("grupo_id", perfil.grupoId)
      .single();
    if (errSus || !suscripcion) {
      return jsonResponse({ error: "Esta organización no tiene una suscripción dada de alta" }, 404);
    }

    const { data: grupo } = await db.from("grupos").select("nombre, marca_comercial").eq("id", perfil.grupoId).single();

    let clienteId = suscripcion.pasarela_cliente_id as string | null;
    if (!clienteId) {
      clienteId = await crearCliente(llave, grupo?.marca_comercial ?? grupo?.nombre ?? "Organización", perfil.grupoId);
      const { error: errGuardar } = await dbServicio
        .from("suscripciones")
        .update({ pasarela: "stripe", pasarela_cliente_id: clienteId })
        .eq("id", suscripcion.id);
      if (errGuardar) return jsonResponse({ error: errGuardar.message }, 500);
    }

    if (suscripcion.pasarela_suscripcion_id) {
      const url = await crearSesionPortal(llave, { clienteId, urlRegreso });
      return jsonResponse({ url, modo: "portal" });
    }

    if (!precioId) return jsonResponse({ error: "STRIPE_PRECIO_ID no está configurado" }, 500);

    const url = await crearSesionCheckout(llave, {
      clienteId,
      precioId,
      grupoId: perfil.grupoId,
      urlExito: urlRegreso,
      urlCancelar: urlRegreso,
    });
    return jsonResponse({ url, modo: "alta" });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
