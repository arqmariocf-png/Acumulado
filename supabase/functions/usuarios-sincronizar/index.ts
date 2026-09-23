// Edge function: vuelve a mandarle a la pasarela cuántos usuarios se están
// cobrando. El alta de usuarios ya lo hace sola (`usuarios-alta`); esto es
// para los otros movimientos, que sí pasan directo por RLS sin tocar un edge
// function: desactivar a alguien, reactivarlo o cambiarle el rol.
//
// POST sin cuerpo. Responde con la cantidad resultante.

import { clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { sincronizarUsuariosFacturables } from "../_shared/usuarios-facturables.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    if (perfil.rol !== "admin" || !perfil.grupoId) {
      return jsonResponse({ error: "Solo un administrador de la organización puede sincronizar el cobro" }, 403);
    }

    const resultado = await sincronizarUsuariosFacturables(clienteServicio(), perfil.grupoId);
    return jsonResponse({
      usuariosFacturables: resultado.usuarios,
      cobroSincronizado: resultado.sincronizado,
      aviso: resultado.sincronizado ? undefined : resultado.motivo,
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
