// Comprobante de pago (Delia, tesorería, 29-sep-2026).
//
// POST multipart/form-data: pagoId, file (JPG/PNG/WEBP/PDF ≤ 10 MB). Guarda
//   el archivo en el bucket privado "cargas" bajo pagos/<empresa>/… y lo
//   liga al pago. Pueden subir admin, corporativo y dirección (los que
//   escriben pagos_programados).
// GET ?id=<pago>: URL firmada (1 h) del comprobante, si RLS deja ver el pago.

import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado, respuestaSoloConsulta } from "../_shared/supabase-clients.ts";

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;
const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const ROLES_SUBEN = ["admin", "corporativo", "direccion"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();
  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    const usuario = clienteComoUsuario(req);
    const dbServicio = clienteServicio();

    if (req.method === "GET") {
      const id = new URL(req.url).searchParams.get("id") ?? "";
      if (!id) return jsonResponse({ error: "id requerido" }, 400);
      const { data: fila, error } = await usuario.from("pagos_programados").select("id, comprobante_path").eq("id", id).maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 500);
      if (!fila) return jsonResponse({ error: "Pago no encontrado" }, 404);
      if (!fila.comprobante_path) return jsonResponse({ error: "Este pago no tiene comprobante" }, 404);
      const { data, error: errUrl } = await dbServicio.storage.from("cargas").createSignedUrl(fila.comprobante_path, 3600);
      if (errUrl || !data) return jsonResponse({ error: errUrl?.message ?? "No se pudo firmar la URL" }, 500);
      return jsonResponse({ url: data.signedUrl });
    }

    if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);
    if (!ROLES_SUBEN.includes(perfil.rol)) return jsonResponse({ error: "Tu rol no sube comprobantes de pago" }, 403);
    if (perfil.soloConsulta) return respuestaSoloConsulta();

    const form = await req.formData();
    const pagoId = String(form.get("pagoId") ?? "").trim();
    const archivo = form.get("file") as File | null;
    if (!pagoId) return jsonResponse({ error: "pagoId es requerido" }, 400);
    if (!archivo || archivo.size === 0) return jsonResponse({ error: "Adjunta el comprobante" }, 400);
    if (archivo.size > TAMANO_MAXIMO_BYTES) return jsonResponse({ error: "El archivo excede 10 MB" }, 400);
    if (!TIPOS_PERMITIDOS.includes(archivo.type)) return jsonResponse({ error: "Formato no soportado: usa JPG, PNG, WEBP o PDF" }, 400);

    const { data: pago, error: errPago } = await usuario.from("pagos_programados").select("id, empresa_id").eq("id", pagoId).maybeSingle();
    if (errPago) return jsonResponse({ error: errPago.message }, 500);
    if (!pago) return jsonResponse({ error: "Pago no encontrado o sin permiso" }, 404);

    const nombreSeguro = archivo.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
    const ruta = `pagos/${pago.empresa_id}/${Date.now()}-${nombreSeguro}`;
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const { error: errUpload } = await dbServicio.storage.from("cargas").upload(ruta, bytes, { contentType: archivo.type });
    if (errUpload) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUpload.message}` }, 500);

    const { error: errUpd } = await dbServicio.from("pagos_programados").update({ comprobante_path: ruta, comprobante_nombre: archivo.name, comprobante_en: new Date().toISOString(), comprobante_por: perfil.id }).eq("id", pagoId);
    if (errUpd) return jsonResponse({ error: errUpd.message }, 500);
    return jsonResponse({ ok: true, comprobante_path: ruta });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
