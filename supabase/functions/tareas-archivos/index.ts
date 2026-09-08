// Archivos adjuntos de una tarjeta del módulo Tareas. El bucket "cargas" es
// privado y sin policies de Storage para authenticated (ver
// supabase/migrations/20260816090011_storage.sql), así que subir/descargar
// siempre pasa por aquí con la service_role key -- la visibilidad de la
// tarjeta (¿el usuario ve el tablero al que pertenece?) se confirma primero
// con el cliente del propio usuario, que sí respeta RLS.
//
// POST multipart/form-data: tarjetaId, file            -> sube y registra el archivo
// GET  ?archivoId=<uuid>                                -> signed URL de descarga (60s)
// DELETE json: { archivoId }                            -> borra el registro (RLS decide permiso) y el objeto

import { corsHeaders, respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";

const TAMANO_MAXIMO_BYTES = 25 * 1024 * 1024;

async function tarjetaVisible(req: Request, tarjetaId: string): Promise<boolean> {
  const cliente = clienteComoUsuario(req);
  const { data, error } = await cliente.from("tarjetas").select("id").eq("id", tarjetaId).maybeSingle();
  return !error && !!data;
}

async function subir(req: Request): Promise<Response> {
  const perfil = await obtenerPerfilAutenticado(req);
  if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);

  const form = await req.formData();
  const tarjetaId = String(form.get("tarjetaId") ?? "");
  const archivo = form.get("file") as File | null;
  if (!tarjetaId || !archivo) return jsonResponse({ error: "tarjetaId y file son requeridos" }, 400);

  if (!(await tarjetaVisible(req, tarjetaId))) return jsonResponse({ error: "Sin acceso a esta tarjeta" }, 403);
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    return jsonResponse({ error: `El archivo excede el tamaño máximo permitido (${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB)` }, 400);
  }

  const dbServicio = clienteServicio();
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const rutaStorage = `tareas/${tarjetaId}/${Date.now()}-${archivo.name}`;

  const { error: errUpload } = await dbServicio.storage.from("cargas").upload(rutaStorage, bytes, {
    contentType: archivo.type || "application/octet-stream",
  });
  if (errUpload) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUpload.message}` }, 500);

  const { data: fila, error: errInsert } = await dbServicio
    .from("tarjeta_archivos")
    .insert({ tarjeta_id: tarjetaId, storage_path: rutaStorage, nombre_original: archivo.name, subido_por: perfil.id })
    .select("*")
    .single();
  if (errInsert) return jsonResponse({ error: errInsert.message }, 500);

  await dbServicio.from("tarjeta_actividad").insert({
    tarjeta_id: tarjetaId,
    tipo: "editada",
    detalle: { accion: "archivo_agregado", nombre_original: archivo.name },
    actor_id: perfil.id,
  });

  return jsonResponse({ archivo: fila });
}

async function descargar(req: Request, archivoId: string): Promise<Response> {
  const cliente = clienteComoUsuario(req);
  const { data: fila, error } = await cliente.from("tarjeta_archivos").select("storage_path").eq("id", archivoId).maybeSingle();
  if (error || !fila) return jsonResponse({ error: "Archivo no encontrado o sin acceso" }, 404);

  const dbServicio = clienteServicio();
  const { data: firmada, error: errFirma } = await dbServicio.storage.from("cargas").createSignedUrl(fila.storage_path, 60);
  if (errFirma || !firmada) return jsonResponse({ error: errFirma?.message ?? "No se pudo generar el link" }, 500);

  return jsonResponse({ url: firmada.signedUrl });
}

async function borrar(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const archivoId = body?.archivoId as string | undefined;
  if (!archivoId) return jsonResponse({ error: "archivoId es requerido" }, 400);

  // Con el cliente del propio usuario: la policy tarjeta_archivos_delete
  // decide si puede (autor o admin) -- si no puede, el delete afecta 0 filas.
  const cliente = clienteComoUsuario(req);
  const { data: fila, error: errSelect } = await cliente.from("tarjeta_archivos").select("storage_path").eq("id", archivoId).maybeSingle();
  if (errSelect || !fila) return jsonResponse({ error: "Archivo no encontrado o sin acceso" }, 404);

  const { error: errDelete, count } = await cliente.from("tarjeta_archivos").delete({ count: "exact" }).eq("id", archivoId);
  if (errDelete) return jsonResponse({ error: errDelete.message }, 500);
  if (!count) return jsonResponse({ error: "Sin permiso para borrar este archivo" }, 403);

  const dbServicio = clienteServicio();
  await dbServicio.storage.from("cargas").remove([fila.storage_path]);

  return jsonResponse({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    if (req.method === "POST") return await subir(req);

    if (req.method === "GET") {
      const url = new URL(req.url);
      const archivoId = url.searchParams.get("archivoId");
      if (!archivoId) return jsonResponse({ error: "archivoId es requerido" }, 400);
      return await descargar(req, archivoId);
    }

    if (req.method === "DELETE") return await borrar(req);

    return jsonResponse({ error: "Método no soportado" }, 405);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
