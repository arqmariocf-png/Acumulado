// Edge function: genera un link de acceso directo para un usuario ya
// existente, sin depender de que le llegue un correo -- para desbloquear a
// alguien cuando el mailer compartido de Supabase no le llega (límite de
// envío por hora, o filtrado por el servidor de correo de su empresa; ver
// caso real Andrea Velázquez, 31-ago/1-sep-2026: mail.send reportó éxito
// dos veces -- recovery y magic_link -- pero nunca llegó a
// andrea.velazquez@ergodinova.com).
//
// Solo 'admin' puede llamarla. El admin copia el link generado y se lo manda
// al usuario por otro canal (WhatsApp, etc.). No crea usuarios ni cambia
// nada del perfil.
//
// tipo "magiclink" (default): entra directo, con la sesión (rol/empresa) que
// ya tenía asignada, sin necesitar contraseña.
// tipo "recovery": entra a una sesión temporal que sólo sirve para definir
// una contraseña nueva (ver web/src/pages/NuevaContrasena.tsx) -- para el
// caso real Mario Contreras, 1-sep-2026: nunca tuvo una contraseña que
// recordara y siempre entraba por magic link; esto le permite dejar una
// definitiva sin depender de que le llegue el correo de recuperación.
//
// tipo "contrasena": pone una contraseña temporal generada aquí y la
// devuelve para que RH o el admin se la pase a la persona (Mario,
// 29-sep-2026: "deja a RH que asigne contraseña temporal"). La persona la
// cambia después desde su cuenta.
//
// Frontera: fuera del admin de la organización maestra, solo se atiende a
// cuentas de la MISMA organización de quien llama (antes un admin de otro
// cliente podía generar un link para alguien de Grupo Loma).
//
// POST { userId: string, tipo?: "magiclink" | "recovery" | "contrasena" }
//   -> { link: string, email: string } | { contrasena: string, email: string }

import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado, respuestaSoloConsulta } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";

// Sin letras ni números que se confundan al dictarla (0/O, 1/l/I).
const LETRAS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGITOS = "23456789";

function elegir(alfabeto: string, n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

/** Ej. "Loma-KXPD-4827": fácil de dictar por teléfono, 8 caracteres al azar. */
function contrasenaTemporal(): string {
  return `Loma-${elegir(LETRAS, 4)}-${elegir(DIGITOS, 4)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    if (perfil.soloConsulta) return respuestaSoloConsulta();
    if (perfil.rol !== "admin" && perfil.rol !== "rh") {
      return jsonResponse({ error: "Solo un administrador o RH pueden generar links de acceso directo." }, 403);
    }

    const { userId, tipo } = await req.json();
    if (!userId) return jsonResponse({ error: "userId es requerido" }, 400);

    // RH solo reenvía el acceso a personal contratado con rol operativo
    // (básicos, supervisor_bbva, responsable, almacén, producción; 2-oct-2026,
    // caso Carlos Sánchez Xilot): nunca a cuentas financieras ni de admin/RH.
    if (perfil.rol === "rh") {
      const { data: ok } = await clienteServicio().rpc("rh_puede_mandar_acceso", { p_profile_id: userId });
      if (!ok) return jsonResponse({ error: "RH solo puede mandar acceso a personal contratado con rol operativo (no a cuentas de dirección, finanzas, RH o administración)." }, 403);
    }
    if (tipo && tipo !== "magiclink" && tipo !== "recovery" && tipo !== "contrasena") {
      return jsonResponse({ error: "tipo debe ser 'magiclink', 'recovery' o 'contrasena'" }, 400);
    }

    const dbServicio = clienteServicio();

    // Frontera de organización: solo el admin maestro atiende a otras.
    const { data: esAdminGlobal } = await clienteComoUsuario(req).rpc("auth_admin_global");
    if (esAdminGlobal !== true) {
      const { data: destino } = await dbServicio.from("profiles").select("grupo_id").eq("id", userId).maybeSingle();
      if (!destino || !perfil.grupoId || destino.grupo_id !== perfil.grupoId) {
        return jsonResponse({ error: "Esa cuenta no es de tu organización." }, 403);
      }
    }

    const { data: userData, error: errUser } = await dbServicio.auth.admin.getUserById(userId);
    if (errUser || !userData.user?.email) {
      return jsonResponse({ error: errUser?.message ?? "Usuario sin correo registrado" }, 404);
    }
    const email = userData.user.email;

    if (tipo === "contrasena") {
      const contrasena = contrasenaTemporal();
      const { error: errPw } = await dbServicio.auth.admin.updateUserById(userId, { password: contrasena, email_confirm: true });
      if (errPw) return jsonResponse({ error: errPw.message }, 500);
      return jsonResponse({ contrasena, email });
    }

    // magiclink: inicia sesión directo, sin pedir/crear contraseña -- el
    // usuario conserva la que ya tenía (o ninguna, si entró por invitación y
    // nunca la usó) y puede seguir usando la app con normalidad.
    // recovery: inicia una sesión temporal de sólo-recuperación; el cliente
    // (ver lib/auth.tsx) detecta el evento PASSWORD_RECOVERY y muestra el
    // formulario para dejar una contraseña definitiva.
    const { data: linkData, error: errLink } = await dbServicio.auth.admin.generateLink({
      type: tipo ?? "magiclink",
      email,
    });
    if (errLink) return jsonResponse({ error: errLink.message }, 500);

    return jsonResponse({ link: linkData.properties.action_link, email });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
