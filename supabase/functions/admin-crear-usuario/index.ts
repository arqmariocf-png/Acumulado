// Crea una cuenta de acceso para alguien que todavía no se ha registrado
// (en vez de esperar a que use "Crear cuenta"), y genera un link de
// recuperación para que defina su contraseña -- se manda por otro canal
// (correo/WhatsApp), no depende del mailer compartido de Supabase, que ya
// ha tenido problemas de entrega reales (ver generar-link-acceso).
//
// Pensada para dispararse desde una tarea administrativa puntual (no desde
// el navegador), por eso no valida un JWT de Supabase (verify_jwt=false) y
// en su lugar exige un secreto propio en el header `x-admin-ops-secret`,
// guardado en config_sistema.
//
// POST json: { email }, header: x-admin-ops-secret: <el secreto>
// -> { userId, email, link }

import { corsHeaders, respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteServicio } from "../_shared/supabase-clients.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const dbServicio = clienteServicio();

    const { data: config, error: errConfig } = await dbServicio
      .from("config_sistema")
      .select("clave, valor")
      .eq("clave", "admin_ops_secret")
      .maybeSingle();
    if (errConfig) throw new Error(errConfig.message);

    const secretoRecibido = req.headers.get("x-admin-ops-secret");
    if (!config?.valor || secretoRecibido !== config.valor) {
      return jsonResponse({ error: "No autorizado" }, 401);
    }

    const { email } = await req.json();
    if (!email || typeof email !== "string") return jsonResponse({ error: "email es requerido" }, 400);

    const { data: creado, error: errCrear } = await dbServicio.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (errCrear) return jsonResponse({ error: `No se pudo crear la cuenta: ${errCrear.message}` }, 500);

    const { data: linkData, error: errLink } = await dbServicio.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    if (errLink) return jsonResponse({ error: `Cuenta creada pero no se pudo generar el link: ${errLink.message}` }, 500);

    return jsonResponse({ userId: creado.user.id, email, link: linkData.properties.action_link });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
