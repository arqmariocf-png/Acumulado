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
//
// Tercera forma (RH, 24-sep-2026): { personalId, rol? } con JWT de rol 'rh'.
// Crea el acceso de una persona contratada cuando su expediente ya tiene
// INE, CURP y comprobante de domicilio: genera el correo
// (nombre.apellido@grupoloma.mx si no tiene uno), liga personal.profile_id,
// toma la empresa de su última contratación y regresa el link para que RH
// lo mande al celular. rol solo puede ser operativo (default),
// administrativo, supervisor o directivo.

import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";
import { sincronizarUsuariosFacturables } from "../_shared/usuarios-facturables.ts";

const ROLES_ASIGNABLES = ["pendiente", "responsable", "empresa", "almacen", "direccion", "corporativo", "rh", "rh_documentos", "produccion", "supervisor_bbva", "operativo", "administrativo", "supervisor", "directivo"];
const ROLES_RH = ["operativo", "administrativo", "supervisor", "directivo"];
const DOCS_INDISPENSABLES = ["INE (copia del original, no fotos)", "CURP", "Comprobante de domicilio"];

function sinAcentos(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
}

/** Base nombre.apellido (primer nombre + primer apellido) para el correo
 * generado; si ya existe una cuenta con ese correo se prueba con sufijo. */
function baseCorreo(nombreCompleto: string): string {
  const partes = sinAcentos(nombreCompleto).split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "usuario";
  if (partes.length === 1) return partes[0];
  // "Juan Carlos Pérez López" -> juan.perez (nombre + primer apellido)
  const apellido = partes.length >= 4 ? partes[partes.length - 2] : partes.length === 3 ? partes[1] : partes[1];
  return `${partes[0]}.${apellido}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const dbServicio = clienteServicio();

    let autorizado = false;
    let perfilLlamador: Awaited<ReturnType<typeof obtenerPerfilAutenticado>> = null;
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
      perfilLlamador = await obtenerPerfilAutenticado(req);
      autorizado = perfilLlamador?.rol === "admin" || perfilLlamador?.rol === "rh";
    }
    if (!autorizado) return jsonResponse({ error: "No autorizado" }, 401);

    const cuerpo = await req.json();
    const esRh = perfilLlamador?.rol === "rh";

    // ---- Alta de personal contratado (RH o admin con personalId) ----
    if (cuerpo.personalId) {
      const rolPedido = String(cuerpo.rol ?? "operativo");
      if (!ROLES_RH.includes(rolPedido)) return jsonResponse({ error: `rol no válido para personal: ${rolPedido}` }, 400);
      const { data: persona, error: errPersona } = await dbServicio
        .from("personal")
        .select("id, nombre, telefono, correo, profile_id, activo")
        .eq("id", cuerpo.personalId)
        .maybeSingle();
      if (errPersona) return jsonResponse({ error: errPersona.message }, 500);
      if (!persona) return jsonResponse({ error: "No existe esa persona en RH" }, 404);
      if (persona.profile_id) return jsonResponse({ error: "Esa persona ya tiene cuenta ligada" }, 409);

      const { data: tipos } = await dbServicio.from("tipos_documento_personal").select("id, nombre").in("nombre", DOCS_INDISPENSABLES);
      const idsTipos = (tipos ?? []).map((t) => t.id);
      const { data: docs } = await dbServicio
        .from("documentos_personal")
        .select("tipo_documento_id, fecha_vigencia")
        .eq("personal_id", persona.id)
        .in("tipo_documento_id", idsTipos);
      const hoy = new Date().toISOString().slice(0, 10);
      const entregados = new Set((docs ?? []).filter((d) => !d.fecha_vigencia || d.fecha_vigencia >= hoy).map((d) => d.tipo_documento_id));
      const faltan = (tipos ?? []).filter((t) => !entregados.has(t.id)).map((t) => t.nombre);
      if (faltan.length > 0) return jsonResponse({ error: `Faltan documentos indispensables: ${faltan.join(", ")}` }, 400);

      const correoPropio = persona.correo && String(persona.correo).includes("@") ? String(persona.correo).trim().toLowerCase() : null;
      const candidatos = correoPropio ? [correoPropio] : Array.from({ length: 20 }, (_, i) => `${baseCorreo(persona.nombre)}${i === 0 ? "" : i + 1}@grupoloma.mx`);
      let correo = "";
      let creadoP: { user: { id: string } } | null = null;
      let ultimoError = "";
      for (const candidato of candidatos) {
        const { data, error: errCrearP } = await dbServicio.auth.admin.createUser({ email: candidato, email_confirm: true });
        if (!errCrearP && data?.user) {
          correo = candidato;
          creadoP = data as { user: { id: string } };
          break;
        }
        ultimoError = errCrearP?.message ?? "";
        if (!/already|exists|registered/i.test(ultimoError)) break;
      }
      if (!creadoP) return jsonResponse({ error: `No se pudo crear la cuenta: ${ultimoError || "correo en uso"}` }, 500);

      const { data: contratacion } = await dbServicio
        .from("contrataciones")
        .select("empresa_id")
        .eq("personal_id", persona.id)
        .order("fecha_inicio", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { error: errPerfilP } = await dbServicio
        .from("profiles")
        .update({ nombre: persona.nombre, telefono: persona.telefono ?? null, rol: rolPedido, empresa_id: contratacion?.empresa_id ?? null })
        .eq("id", creadoP.user.id);
      if (errPerfilP) return jsonResponse({ error: `Cuenta creada pero no se pudo configurar el perfil: ${errPerfilP.message}`, userId: creadoP.user.id }, 500);
      const { error: errLiga } = await dbServicio.from("personal").update({ profile_id: creadoP.user.id, correo: persona.correo ?? correo }).eq("id", persona.id);
      if (errLiga) return jsonResponse({ error: `Cuenta creada pero no se pudo ligar a la persona: ${errLiga.message}`, userId: creadoP.user.id }, 500);

      const { data: linkP, error: errLinkP } = await dbServicio.auth.admin.generateLink({ type: "recovery", email: correo });
      if (errLinkP) return jsonResponse({ error: `Cuenta creada pero no se pudo generar el link: ${errLinkP.message}`, userId: creadoP.user.id }, 500);
      return jsonResponse({ userId: creadoP.user.id, email: correo, link: linkP.properties.action_link, telefono: persona.telefono ?? null, rol: rolPedido });
    }

    if (esRh) return jsonResponse({ error: "RH solo puede crear cuentas de personal contratado (personalId)" }, 403);

    const { email, nombre, telefono, rol } = cuerpo;
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
