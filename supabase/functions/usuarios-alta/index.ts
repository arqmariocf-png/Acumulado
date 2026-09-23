// Edge function: el admin de una organización da de alta a su gente desde su
// propio panel, sin que tengan que registrarse solos ni esperar a que alguien
// los autorice.
//
// POST body: { correo, nombre, rol, empresaId? }
//
// Se manda una INVITACIÓN, no una contraseña: el usuario la define él en el
// correo de alta. Así ninguna contraseña viaja por WhatsApp ni queda escrita
// en la bitácora de nadie.
//
// Crear usuarios necesita la Admin API de Auth (service_role), que bypassa
// RLS, así que el permiso se valida aquí a mano y con cuidado: el admin solo
// puede crear dentro de SU organización, y la empresa que asigne tiene que ser
// de esa misma organización.

import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { sincronizarUsuariosFacturables } from "../_shared/usuarios-facturables.ts";

const ROLES_PERMITIDOS = ["empresa", "direccion", "corporativo", "rh", "admin"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const { correo, nombre, rol, empresaId } = await req.json();

    if (!correo || typeof correo !== "string" || !correo.includes("@")) {
      return jsonResponse({ error: "Se requiere un correo válido" }, 400);
    }
    if (!nombre || typeof nombre !== "string") return jsonResponse({ error: "El nombre es requerido" }, 400);
    if (!ROLES_PERMITIDOS.includes(rol)) {
      return jsonResponse({ error: `El rol tiene que ser uno de: ${ROLES_PERMITIDOS.join(", ")}` }, 400);
    }
    // El rol 'empresa' es el único que exige empresa asignada (mismo criterio
    // que el check de la tabla profiles); si no se valida aquí, el insert
    // falla después con un error de base que no dice nada al usuario.
    if (rol === "empresa" && !empresaId) {
      return jsonResponse({ error: "El rol 'empresa' requiere una empresa asignada" }, 400);
    }

    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    if (perfil.rol !== "admin" || !perfil.grupoId) {
      return jsonResponse({ error: "Solo un administrador de la organización puede dar de alta usuarios" }, 403);
    }

    const db = clienteComoUsuario(req);
    const dbServicio = clienteServicio();

    // La empresa se valida con el cliente del USUARIO: si RLS no se la
    // devuelve, es de otra organización (o no existe), y ahí se acaba.
    if (empresaId) {
      const { data: empresa } = await db.from("empresas").select("id").eq("id", empresaId).maybeSingle();
      if (!empresa) return jsonResponse({ error: "La empresa no es de tu organización" }, 403);
    }

    const { data: invitado, error: errInvitacion } = await dbServicio.auth.admin.inviteUserByEmail(correo, {
      data: { nombre },
    });
    if (errInvitacion) {
      const yaExiste = /already|registered|exists/i.test(errInvitacion.message);
      return jsonResponse(
        { error: yaExiste ? "Ya hay un usuario con ese correo" : errInvitacion.message },
        yaExiste ? 409 : 500,
      );
    }

    const usuarioId = invitado?.user?.id;
    if (!usuarioId) return jsonResponse({ error: "La invitación no devolvió un usuario" }, 500);

    // El trigger handle_new_user ya creó el profile en rol 'pendiente' y sin
    // organización; aquí se le asigna lo que el admin eligió.
    const { error: errPerfil } = await dbServicio
      .from("profiles")
      .update({ nombre, rol, grupo_id: perfil.grupoId, empresa_id: empresaId ?? null })
      .eq("id", usuarioId);
    if (errPerfil) return jsonResponse({ error: errPerfil.message }, 500);

    const sincronizacion = await sincronizarUsuariosFacturables(dbServicio, perfil.grupoId);

    return jsonResponse({
      id: usuarioId,
      invitado: true,
      usuariosFacturables: sincronizacion.usuarios,
      cobroSincronizado: sincronizacion.sincronizado,
      avisoCobro: sincronizacion.sincronizado ? undefined : sincronizacion.motivo,
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
