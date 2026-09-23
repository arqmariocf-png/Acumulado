// Crea una cuenta de acceso para alguien que todavía no se ha registrado
// (en vez de esperar a que use "Crear cuenta"), y genera un link de
// recuperación para que defina su contraseña -- se manda por otro canal
// (correo/WhatsApp), no depende del mailer compartido de Supabase, que ya
// ha tenido problemas de entrega reales (ver generar-link-acceso) y que
// además rebota "email rate limit exceeded" en el formulario de registro
// cuando varias personas se dan de alta el mismo día (caso real Luis
// Gutiérrez, 21-sep-2026).
//
// Dos formas de autorizarse:
//   - desde Admin > Usuarios: JWT de un perfil con rol 'admin' (Authorization: Bearer ...)
//   - desde una tarea administrativa puntual: header x-admin-ops-secret
//     con el secreto guardado en config_sistema (verify_jwt=false por esto).
//
// POST json: { email, nombre?, telefono?, rol? } -> { userId, email, link }
// rol se aplica al profile que crea el trigger handle_new_user (queda
// 'pendiente' si no se manda); solo se aceptan roles del enum app_rol y
// nunca 'admin' por esta vía.

import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";
import { sincronizarUsuariosFacturables } from "../_shared/usuarios-facturables.ts";

const ROLES_ASIGNABLES = ["pendiente", "responsable", "empresa", "almacen", "direccion", "corporativo", "rh", "rh_documentos", "produccion", "supervisor_bbva"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const dbServicio = clienteServicio();

    let autorizado = false;
    const secretoRecibido = req.headers.get("x-admin-ops-secret");
    if (secretoRecibido) {
      const { data: config, error: errConfig } = await dbServicio
        .from("config_sistema")
        .select("clave, valor")
        .eq("clave", "admin_ops_secret")
        .maybeSingle();
      if (errConfig) throw new Error(errConfig.message);
      autorizado = !!config?.valor && secretoRecibido === config.valor;
    } else {
      const perfil = await obtenerPerfilAutenticado(req);
      autorizado = perfil?.rol === "admin";
    }
    if (!autorizado) return jsonResponse({ error: "No autorizado" }, 401);

    const { email, nombre, telefono, rol } = await req.json();
    if (!email || typeof email !== "string") return jsonResponse({ error: "email es requerido" }, 400);
    if (rol != null && !ROLES_ASIGNABLES.includes(String(rol))) {
      return jsonResponse({ error: `rol no válido: ${rol}` }, 400);
    }

    const { data: creado, error: errCrear } = await dbServicio.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      email_confirm: true,
    });
    if (errCrear) return jsonResponse({ error: `No se pudo crear la cuenta: ${errCrear.message}` }, 500);

    const cambios: Record<string, unknown> = {};
    if (nombre && typeof nombre === "string" && nombre.trim()) cambios.nombre = nombre.trim();
    if (telefono && typeof telefono === "string" && telefono.trim()) cambios.telefono = telefono.trim();
    if (rol && rol !== "pendiente") cambios.rol = rol;
    // El usuario nuevo entra a la organización de quien lo dio de alta. Sin
    // esto quedaría sin organización y, por RLS, sin acceso a nada -- que es
    // justo lo que no quiere el admin que acaba de crearlo.
    if (perfil?.grupoId) cambios.grupo_id = perfil.grupoId;
    if (Object.keys(cambios).length > 0) {
      const { error: errPerfil } = await dbServicio.from("profiles").update(cambios).eq("id", creado.user.id);
      if (errPerfil) return jsonResponse({ error: `Cuenta creada pero no se pudo actualizar el perfil: ${errPerfil.message}`, userId: creado.user.id }, 500);
    }

    const { data: linkData, error: errLink } = await dbServicio.auth.admin.generateLink({
      type: "recovery",
      email: email.trim().toLowerCase(),
    });
    if (errLink) return jsonResponse({ error: `Cuenta creada pero no se pudo generar el link: ${errLink.message}`, userId: creado.user.id }, 500);

    // Un usuario más mueve lo que se le cobra a la organización. Es tolerante
    // a fallas a propósito: si la pasarela no responde, la cuenta ya quedó
    // creada y la cantidad se corrige en el siguiente movimiento -- no se
    // deshace un alta por un mal minuto de Stripe.
    const cobro = perfil?.grupoId
      ? await sincronizarUsuariosFacturables(dbServicio, perfil.grupoId)
      : null;

    return jsonResponse({
      userId: creado.user.id,
      email: email.trim().toLowerCase(),
      link: linkData.properties.action_link,
      usuariosFacturables: cobro?.usuarios,
      avisoCobro: cobro && !cobro.sincronizado ? cobro.motivo : undefined,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
