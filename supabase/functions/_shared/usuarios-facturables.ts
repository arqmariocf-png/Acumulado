// Mantener en la pasarela la cantidad de usuarios que se están cobrando.
//
// La cuenta la lleva la base (public.usuarios_facturables), no este archivo:
// aquí solo se lee y se empuja. Si la lógica de "quién cuenta" viviera también
// aquí, tarde o temprano una de las dos versiones se quedaría atrás y el
// cliente pagaría por una cifra distinta de la que ve en pantalla.
//
// Es deliberadamente tolerante a fallas: si la pasarela no responde, el alta
// del usuario NO se deshace. Prefiero un usuario dado de alta y una cantidad
// que se corrige en el siguiente movimiento (o a mano), a un administrador que
// no puede trabajar porque Stripe tuvo un mal minuto. Lo que sí se hace es
// devolver el motivo para poder avisarlo.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { actualizarCantidadUsuarios } from "./pagos/stripe.ts";

export interface ResultadoSincronizacion {
  usuarios: number;
  sincronizado: boolean;
  motivo?: string;
}

export async function sincronizarUsuariosFacturables(
  dbServicio: SupabaseClient,
  grupoId: string,
): Promise<ResultadoSincronizacion> {
  // La versión pública de usuarios_facturables() se acota a la organización
  // de quien consulta, y aquí no hay sesión de usuario: va la interna, que
  // solo puede llamar la service_role key.
  const { data: usuarios, error: errConteo } = await dbServicio.rpc("usuarios_facturables_interno", {
    p_grupo_id: grupoId,
  });
  if (errConteo) return { usuarios: 0, sincronizado: false, motivo: errConteo.message };

  const cantidad = Number(usuarios ?? 0);

  const { data: suscripcion } = await dbServicio
    .from("suscripciones")
    .select("pasarela, pasarela_suscripcion_id")
    .eq("grupo_id", grupoId)
    .maybeSingle();

  // Todavía sin tarjeta registrada: no hay nada que sincronizar y no es un
  // error -- es el estado normal de una organización en prueba.
  if (!suscripcion?.pasarela_suscripcion_id) {
    return { usuarios: cantidad, sincronizado: false, motivo: "La organización todavía no tiene suscripción en la pasarela" };
  }

  const llave = Deno.env.get("STRIPE_SECRET_KEY");
  if (!llave) return { usuarios: cantidad, sincronizado: false, motivo: "STRIPE_SECRET_KEY no está configurado" };

  try {
    await actualizarCantidadUsuarios(llave, suscripcion.pasarela_suscripcion_id, cantidad);
    return { usuarios: cantidad, sincronizado: true };
  } catch (e) {
    return { usuarios: cantidad, sincronizado: false, motivo: e instanceof Error ? e.message : "Error de la pasarela" };
  }
}
