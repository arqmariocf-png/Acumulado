// Checador con evidencia: la marca de entrada/salida entra por aquí con la
// ubicación GPS y una foto tomada en el momento (pedido 21-sep-2026). Es el
// único camino para insertar en checador_registros -- la policy de insert
// directo se cerró para que nadie marque sin evidencia.
//
// POST multipart/form-data: tipo (entrada|salida), foto (image/*), lat, lng, precision
//   -> { id, tipo, created_at }
// GET ?registroId=<uuid> -> { url } (signed URL 120 s de la foto; solo el
//   dueño de la marca, rh o admin)

import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";

const FOTO_MAXIMA_BYTES = 6 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    if (perfil.rol === "pendiente") return jsonResponse({ error: "Tu cuenta todavía no tiene acceso." }, 403);

    if (req.method === "GET") {
      const registroId = new URL(req.url).searchParams.get("registroId");
      if (!registroId) return jsonResponse({ error: "registroId es requerido" }, 400);
      // RLS de checador_registros: dueño, rh o admin.
      const { data: fila, error } = await clienteComoUsuario(req).from("checador_registros").select("foto_path").eq("id", registroId).maybeSingle();
      if (error || !fila) return jsonResponse({ error: "Marca no encontrada o sin permiso" }, 404);
      if (!fila.foto_path) return jsonResponse({ error: "Esta marca no tiene foto" }, 404);
      const { data: firmada, error: errFirma } = await clienteServicio().storage.from("cargas").createSignedUrl(fila.foto_path, 120);
      if (errFirma || !firmada) return jsonResponse({ error: errFirma?.message ?? "No se pudo firmar la foto" }, 500);
      return jsonResponse({ url: firmada.signedUrl });
    }

    const form = await req.formData();
    const tipo = String(form.get("tipo") ?? "");
    const foto = form.get("foto") as File | null;
    const lat = Number(form.get("lat"));
    const lng = Number(form.get("lng"));
    const precision = Number(form.get("precision"));
    const dispositivo = String(form.get("dispositivo") ?? "").slice(0, 200) || null;

    if (tipo !== "entrada" && tipo !== "salida") return jsonResponse({ error: "tipo debe ser entrada o salida" }, 400);
    if (!foto || foto.size === 0) return jsonResponse({ error: "La foto es obligatoria para marcar." }, 400);
    if (foto.size > FOTO_MAXIMA_BYTES) return jsonResponse({ error: "La foto es demasiado grande (máximo 6 MB)." }, 400);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return jsonResponse({ error: "La ubicación es obligatoria para marcar. Activa el GPS y permite el acceso a tu ubicación." }, 400);
    }

    const dbServicio = clienteServicio();

    // Misma regla que la pantalla: entrada y salida se alternan.
    const { data: ultima } = await dbServicio
      .from("checador_registros")
      .select("tipo")
      .eq("profile_id", perfil.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const esperado = ultima?.tipo === "entrada" ? "salida" : "entrada";
    if (tipo !== esperado) return jsonResponse({ error: `Tu siguiente marca debe ser ${esperado}.` }, 409);

    const ahora = new Date();
    const extension = (foto.type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
    const ruta = `checador/${perfil.id}/${ahora.toISOString().slice(0, 10)}/${ahora.getTime()}-${tipo}.${extension}`;
    const { error: errUpload } = await dbServicio.storage.from("cargas").upload(ruta, new Uint8Array(await foto.arrayBuffer()), {
      contentType: foto.type || "image/jpeg",
    });
    if (errUpload) return jsonResponse({ error: `No se pudo guardar la foto: ${errUpload.message}` }, 500);

    const { data: insertado, error: errInsert } = await dbServicio
      .from("checador_registros")
      .insert({ profile_id: perfil.id, tipo, lat, lng, precision_m: Number.isFinite(precision) ? precision : null, foto_path: ruta, dispositivo })
      .select("id, tipo, created_at")
      .single();
    if (errInsert) return jsonResponse({ error: errInsert.message }, 500);

    return jsonResponse(insertado);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
