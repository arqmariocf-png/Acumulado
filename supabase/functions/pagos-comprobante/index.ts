// Comprobante de pago (Delia, tesorería, 29-sep-2026).
//
// POST multipart/form-data: pagoId (o pagoIds = varios separados por coma),
//   file (JPG/PNG/WEBP/PDF ≤ 10 MB) y, opcional, marcarPagado=1 + referencia.
//   Guarda el archivo UNA vez en el bucket privado "cargas" bajo
//   pagos/<empresa>/… y lo liga a todos los pagos (Mario, 6-oct-2026: "un
//   mismo comprobante cubre varias órdenes de pago"). Con marcarPagado los
//   deja pagados hoy en el mismo paso (con el JWT del usuario: RLS y
//   triggers de la requisición aplican); entonces el archivo es opcional.
//   Pueden subir admin, corporativo y dirección (los que escriben
//   pagos_programados).
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
    const ids = [...new Set(String(form.get("pagoIds") ?? form.get("pagoId") ?? "").split(",").map((x) => x.trim()).filter(Boolean))];
    const archivo = form.get("file") as File | null;
    const marcarPagado = String(form.get("marcarPagado") ?? "") === "1";
    // Confirmar = dirección da por bueno el pago (efectivo: la devolución a
    // quien lo cubrió); también lo deja pagado si seguía pendiente.
    const confirmar = String(form.get("confirmar") ?? "") === "1";
    const referencia = String(form.get("referencia") ?? "").trim() || null;
    const hayArchivo = !!archivo && archivo.size > 0;
    if (ids.length === 0) return jsonResponse({ error: "pagoId es requerido" }, 400);
    if (ids.length > 100) return jsonResponse({ error: "Máximo 100 pagos por comprobante" }, 400);
    if (!hayArchivo && !marcarPagado && !confirmar) return jsonResponse({ error: "Adjunta el comprobante" }, 400);
    if (hayArchivo && archivo!.size > TAMANO_MAXIMO_BYTES) return jsonResponse({ error: "El archivo excede 10 MB" }, 400);
    if (hayArchivo && !TIPOS_PERMITIDOS.includes(archivo!.type)) return jsonResponse({ error: "Formato no soportado: usa JPG, PNG, WEBP o PDF" }, 400);

    // RLS con el JWT de quien sube: solo pagos que puede ver.
    const { data: pagos, error: errPago } = await usuario.from("pagos_programados").select("id, empresa_id").in("id", ids);
    if (errPago) return jsonResponse({ error: errPago.message }, 500);
    if (!pagos || pagos.length !== ids.length) return jsonResponse({ error: "Algún pago no existe o no tienes permiso" }, 404);

    if (marcarPagado || confirmar) {
      const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
      // Primero lo que siga pendiente pasa a pagado hoy (lo ya pagado conserva su fecha).
      const cambios: Record<string, unknown> = { estatus: "pagado", pagado_en: hoy };
      if (referencia) cambios.referencia = referencia;
      const { error: errPagar } = await usuario.from("pagos_programados").update(cambios).in("id", ids).neq("estatus", "pagado");
      if (errPagar) return jsonResponse({ error: errPagar.message }, 500);
      const extra: Record<string, unknown> = confirmar ? { confirmado_en: new Date().toISOString(), confirmado_por: perfil.id } : {};
      if (referencia) extra.referencia = referencia;
      const { data: marcados, error: errConf } = await usuario
        .from("pagos_programados")
        .update({ ...extra, estatus: "pagado" })
        .in("id", ids)
        .select("id");
      if (errConf) return jsonResponse({ error: errConf.message }, 500);
      if ((marcados?.length ?? 0) !== ids.length) return jsonResponse({ error: "No tienes permiso para confirmar todos los pagos elegidos" }, 403);
    }

    let ruta: string | null = null;
    if (hayArchivo) {
      const nombreSeguro = archivo!.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
      ruta = `pagos/${pagos[0].empresa_id}/${Date.now()}-${nombreSeguro}`;
      const bytes = new Uint8Array(await archivo!.arrayBuffer());
      const { error: errUpload } = await dbServicio.storage.from("cargas").upload(ruta, bytes, { contentType: archivo!.type });
      if (errUpload) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUpload.message}` }, 500);
      const { error: errUpd } = await dbServicio
        .from("pagos_programados")
        .update({ comprobante_path: ruta, comprobante_nombre: archivo!.name, comprobante_en: new Date().toISOString(), comprobante_por: perfil.id })
        .in("id", ids);
      if (errUpd) return jsonResponse({ error: errUpd.message }, 500);
    }
    return jsonResponse({ ok: true, pagos: ids.length, pagados: marcarPagado || confirmar, confirmados: confirmar, comprobante_path: ruta });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
