// Edge function: genera un magic link de acceso directo para un usuario ya
// existente, sin depender de que le llegue un correo -- para desbloquear a
// alguien cuando el mailer compartido de Supabase no le llega (límite de
// envío por hora, o filtrado por el servidor de correo de su empresa; ver
// caso real Andrea Velázquez, 31-ago/1-sep-2026: mail.send reportó éxito
// dos veces -- recovery y magic_link -- pero nunca llegó a
// andrea.velazquez@ergodinova.com).
//
// Solo 'admin' puede llamarla. El admin copia el link generado y se lo manda
// al usuario por otro canal (WhatsApp, etc.) -- al abrirlo entra directo,
// con la sesión (rol/empresa) que ya tenía asignada, sin necesitar
// contraseña. No crea usuarios ni cambia nada del perfil.
//
// POST { userId: string } -> { link: string, email: string }

import { clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    if (perfil.rol !== "admin") {
      return jsonResponse({ error: "Solo un administrador puede generar links de acceso directo." }, 403);
    }

    const { userId } = await req.json();
    if (!userId) return jsonResponse({ error: "userId es requerido" }, 400);

    const dbServicio = clienteServicio();

    const { data: userData, error: errUser } = await dbServicio.auth.admin.getUserById(userId);
    if (errUser || !userData.user?.email) {
      return jsonResponse({ error: errUser?.message ?? "Usuario sin correo registrado" }, 404);
    }
    const email = userData.user.email;

    // magiclink: inicia sesión directo, sin pedir/crear contraseña -- el
    // usuario conserva la que ya tenía (o ninguna, si entró por invitación y
    // nunca la usó) y puede seguir usando la app con normalidad.
    const { data: linkData, error: errLink } = await dbServicio.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (errLink) return jsonResponse({ error: errLink.message }, 500);

    return jsonResponse({ link: linkData.properties.action_link, email });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
