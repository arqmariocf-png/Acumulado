// Fotos de la entrega de una remisión de producción (Mario, 30-sep-2026).
//
// POST multipart/form-data: remisionId, file (JPG/PNG/WEBP/HEIC o PDF ≤ 10 MB).
//   Sube quien puede ver la remisión (RLS de remisiones_produccion con su
//   propio token). Archivo al bucket privado "cargas" bajo
//   remisiones-produccion/<empresa>/<remision>/…
// GET ?id=<remision>: lista de fotos con URL firmada (1 h).

import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado, respuestaSoloConsulta } from "../_shared/supabase-clients.ts";

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;
const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();
  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    if (perfil.rol === "pendiente") return jsonResponse({ error: "Tu cuenta no tiene acceso" }, 403);
    const usuario = clienteComoUsuario(req);
    const dbServicio = clienteServicio();

    if (req.method === "GET") {
      const id = new URL(req.url).searchParams.get("id") ?? "";
      if (!id) return jsonResponse({ error: "id requerido" }, 400);
      const { data: fotos, error } = await usuario.from("remisiones_produccion_fotos").select("id, storage_path, nombre, subido_por_nombre, created_at").eq("remision_id", id).order("created_at");
      if (error) return jsonResponse({ error: error.message }, 500);
      const salida = [];
      for (const f of fotos ?? []) {
        const { data } = await dbServicio.storage.from("cargas").createSignedUrl(f.storage_path, 3600);
        salida.push({ id: f.id, nombre: f.nombre, subido_por_nombre: f.subido_por_nombre, created_at: f.created_at, url: data?.signedUrl ?? null });
      }
      return jsonResponse({ fotos: salida });
    }

    if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);
    if (perfil.soloConsulta) return respuestaSoloConsulta();

    const form = await req.formData();
    const remisionId = String(form.get("remisionId") ?? "").trim();
    const archivo = form.get("file") as File | null;
    if (!remisionId) return jsonResponse({ error: "remisionId es requerido" }, 400);
    if (!archivo || archivo.size === 0) return jsonResponse({ error: "Adjunta la foto" }, 400);
    if (archivo.size > TAMANO_MAXIMO_BYTES) return jsonResponse({ error: "La foto excede 10 MB" }, 400);
    if (archivo.type && !TIPOS_PERMITIDOS.includes(archivo.type)) return jsonResponse({ error: "Formato no soportado: usa JPG, PNG, WEBP, HEIC o PDF" }, 400);

    const { data: remision, error: errRem } = await usuario.from("remisiones_produccion").select("id, empresa_id").eq("id", remisionId).maybeSingle();
    if (errRem) return jsonResponse({ error: errRem.message }, 500);
    if (!remision) return jsonResponse({ error: "Remisión no encontrada o sin permiso" }, 404);

    const nombreSeguro = (archivo.name || "foto.jpg").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
    const ruta = `remisiones-produccion/${remision.empresa_id}/${remision.id}/${Date.now()}-${nombreSeguro}`;
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const { error: errUpload } = await dbServicio.storage.from("cargas").upload(ruta, bytes, { contentType: archivo.type || "image/jpeg" });
    if (errUpload) return jsonResponse({ error: `No se pudo guardar la foto: ${errUpload.message}` }, 500);

    const { error: errIns } = await dbServicio.from("remisiones_produccion_fotos").insert({ remision_id: remision.id, storage_path: ruta, nombre: archivo.name || null, subido_por: perfil.id, subido_por_nombre: perfil.nombre });
    if (errIns) return jsonResponse({ error: errIns.message }, 500);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
