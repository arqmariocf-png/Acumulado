// Planos (PDF/DWG) de un proyecto. Mismo patrón que tareas-archivos: el
// bucket "cargas" es privado y sin policies de Storage para authenticated,
// así que subir/descargar pasa por aquí con la service_role key -- la
// visibilidad del proyecto se confirma primero con el cliente del propio
// usuario, que sí respeta RLS.
//
// DWG no tiene forma de previsualizarse en el navegador (no hay visor ni
// parser disponible en este runtime) -- solo se sube/descarga como archivo,
// igual que un PDF, pero sin abrir inline.
//
// POST multipart/form-data: proyectoId, file    -> sube y registra el plano
// GET  ?planoId=<uuid>                           -> signed URL de descarga (60s)
// DELETE json: { planoId }                       -> borra el registro (RLS decide permiso) y el objeto

import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado, respuestaSoloConsulta } from "../_shared/supabase-clients.ts";

const TAMANO_MAXIMO_BYTES = 50 * 1024 * 1024;

// Además de PDF y DWG, una foto o captura del plano (lo que hay a la mano en
// obra desde el celular) entra como "imagen".
const EXT_IMAGEN = ["jpg", "jpeg", "png", "webp", "heic", "heif"];

function tipoDeArchivo(nombre: string, mime: string): "pdf" | "dwg" | "imagen" | null {
  const ext = nombre.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "dwg") return "dwg";
  if (EXT_IMAGEN.includes(ext) || mime.startsWith("image/")) return "imagen";
  return null;
}

/** Storage rechaza llaves con acentos, ñ o símbolos: la ruta va en ASCII
 * plano; el nombre original se guarda tal cual en la tabla. */
function nombreSeguro(nombre: string): string {
  const base = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (base || "archivo").slice(0, 120);
}

async function proyectoVisible(req: Request, proyectoId: string): Promise<boolean> {
  const cliente = clienteComoUsuario(req);
  const { data, error } = await cliente.from("proyectos").select("id").eq("id", proyectoId).maybeSingle();
  return !error && !!data;
}

async function subir(req: Request): Promise<Response> {
  const perfil = await obtenerPerfilAutenticado(req);
  if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
  if (perfil.soloConsulta) return respuestaSoloConsulta();

  const form = await req.formData();
  const proyectoId = String(form.get("proyectoId") ?? "");
  const archivo = form.get("file") as File | null;
  if (!proyectoId || !archivo) return jsonResponse({ error: "proyectoId y file son requeridos" }, 400);

  const tipoArchivo = tipoDeArchivo(archivo.name, archivo.type || "");
  if (!tipoArchivo) return jsonResponse({ error: "Solo se aceptan PDF, DWG o imágenes (JPG, PNG, WEBP, HEIC)" }, 400);

  if (!(await proyectoVisible(req, proyectoId))) return jsonResponse({ error: "Sin acceso a este proyecto" }, 403);
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    return jsonResponse({ error: `El archivo excede el tamaño máximo permitido (${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB)` }, 400);
  }

  const dbServicio = clienteServicio();
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const rutaStorage = `planos/${proyectoId}/${Date.now()}-${nombreSeguro(archivo.name)}`;

  const { error: errUpload } = await dbServicio.storage.from("cargas").upload(rutaStorage, bytes, {
    contentType: archivo.type || "application/octet-stream",
  });
  if (errUpload) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUpload.message}` }, 500);

  const { data: fila, error: errInsert } = await dbServicio
    .from("proyecto_planos")
    .insert({ proyecto_id: proyectoId, storage_path: rutaStorage, nombre_original: archivo.name, tipo_archivo: tipoArchivo, subido_por: perfil.id })
    .select("*")
    .single();
  if (errInsert) return jsonResponse({ error: errInsert.message }, 500);

  return jsonResponse({ plano: fila });
}

async function descargar(req: Request, planoId: string): Promise<Response> {
  const cliente = clienteComoUsuario(req);
  const { data: fila, error } = await cliente.from("proyecto_planos").select("storage_path").eq("id", planoId).maybeSingle();
  if (error || !fila) return jsonResponse({ error: "Plano no encontrado o sin acceso" }, 404);

  const dbServicio = clienteServicio();
  const { data: firmada, error: errFirma } = await dbServicio.storage.from("cargas").createSignedUrl(fila.storage_path, 60);
  if (errFirma || !firmada) return jsonResponse({ error: errFirma?.message ?? "No se pudo generar el link" }, 500);

  return jsonResponse({ url: firmada.signedUrl });
}

async function borrar(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const planoId = body?.planoId as string | undefined;
  if (!planoId) return jsonResponse({ error: "planoId es requerido" }, 400);

  const cliente = clienteComoUsuario(req);
  const { data: fila, error: errSelect } = await cliente.from("proyecto_planos").select("storage_path").eq("id", planoId).maybeSingle();
  if (errSelect || !fila) return jsonResponse({ error: "Plano no encontrado o sin acceso" }, 404);

  const { error: errDelete, count } = await cliente.from("proyecto_planos").delete({ count: "exact" }).eq("id", planoId);
  if (errDelete) return jsonResponse({ error: errDelete.message }, 500);
  if (!count) return jsonResponse({ error: "Sin permiso para borrar este plano" }, 403);

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
      const planoId = url.searchParams.get("planoId");
      if (!planoId) return jsonResponse({ error: "planoId es requerido" }, 400);
      return await descargar(req, planoId);
    }

    if (req.method === "DELETE") return await borrar(req);

    return jsonResponse({ error: "Método no soportado" }, 405);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
