// Recomprimir lo ya guardado en el bucket `cargas` (17-nov-2026, Mario:
// "ajusta todos al mínimo"). La compresión del navegador (lib/comprimirArchivo)
// solo toca lo nuevo; para el histórico, Sistemas › Almacenamiento baja cada
// archivo pesado, lo comprime en el navegador del director general con la
// misma regla y lo vuelve a subir EN LA MISMA RUTA (así nada en la base cambia:
// expedientes de RH, marcas del checador, tarjetas, pagos siguen apuntando al
// mismo archivo). Solo el admin de la organización maestra.
//
// GET  ?accion=resumen                      → fn_almacenamiento_resumen()
// GET  ?accion=candidatos&carpeta=rh        → lista [{ruta, mime, bytes, creado}]
// GET  ?accion=url&ruta=<ruta>              → { url } firmada 120 s para bajarlo
// POST multipart: ruta, file                → reemplaza el archivo si el nuevo pesa
//                                             menos; { antes, despues }
// Nunca borra: si lo nuevo no es más chico, responde 409 y deja el original.

import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";

const BUCKET = "cargas";
const CARPETAS = ["rh", "checador", "tareas", "pagos", "legal", "comprobaciones", "cotizaciones", "remisiones-produccion", "notas-entrega"];

function carpetaDe(ruta: string): string {
  return ruta.split("/")[0] ?? "";
}

function rutaValida(ruta: string): boolean {
  return !!ruta && !ruta.includes("..") && !ruta.startsWith("/") && CARPETAS.includes(carpetaDe(ruta));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();
  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    const usuario = clienteComoUsuario(req);
    const { data: esDirector } = await usuario.rpc("auth_admin_global");
    if (esDirector !== true) return jsonResponse({ error: "Solo el director general administra el almacenamiento" }, 403);
    const db = clienteServicio();

    if (req.method === "GET") {
      const url = new URL(req.url);
      const accion = url.searchParams.get("accion") ?? "resumen";
      if (accion === "resumen") {
        const { data, error } = await db.rpc("fn_almacenamiento_resumen");
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ resumen: data, carpetas_recomprimibles: CARPETAS });
      }
      if (accion === "candidatos") {
        const carpeta = url.searchParams.get("carpeta") ?? "";
        if (!CARPETAS.includes(carpeta)) return jsonResponse({ error: "Esa carpeta no se recomprime" }, 400);
        const limite = Number(url.searchParams.get("limite") ?? 300);
        const { data, error } = await db.rpc("fn_almacenamiento_candidatos", { p_carpeta: carpeta, p_limite: limite });
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ candidatos: data ?? [] });
      }
      if (accion === "url") {
        const ruta = url.searchParams.get("ruta") ?? "";
        if (!rutaValida(ruta)) return jsonResponse({ error: "Ruta no permitida" }, 400);
        const { data, error } = await db.storage.from(BUCKET).createSignedUrl(ruta, 120);
        if (error || !data) return jsonResponse({ error: error?.message ?? "No se pudo firmar" }, 500);
        return jsonResponse({ url: data.signedUrl });
      }
      return jsonResponse({ error: "Acción desconocida" }, 400);
    }

    if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);
    if (perfil.soloConsulta) return jsonResponse({ error: "Cuenta de solo consulta" }, 403);

    const form = await req.formData();
    const ruta = String(form.get("ruta") ?? "").trim();
    const archivo = form.get("file") as File | null;
    if (!rutaValida(ruta)) return jsonResponse({ error: "Ruta no permitida" }, 400);
    if (!archivo || archivo.size === 0) return jsonResponse({ error: "Falta el archivo" }, 400);

    // Tamaño y tipo actuales, para no reemplazar por algo más grande ni cambiar de tipo.
    const partes = ruta.split("/");
    const nombre = partes.pop()!;
    const { data: lista, error: errLista } = await db.storage.from(BUCKET).list(partes.join("/"), { search: nombre, limit: 100 });
    if (errLista) return jsonResponse({ error: errLista.message }, 500);
    const actual = (lista ?? []).find((o) => o.name === nombre);
    if (!actual) return jsonResponse({ error: "El archivo ya no existe" }, 404);
    const antes = Number(actual.metadata?.size ?? 0);
    const mimeActual = String(actual.metadata?.mimetype ?? "");
    const mimeNuevo = archivo.type || mimeActual;
    const mismaFamilia = (mimeActual.startsWith("image/") && mimeNuevo.startsWith("image/")) || mimeActual === mimeNuevo;
    if (!mismaFamilia) return jsonResponse({ error: `Tipo distinto (${mimeActual} → ${mimeNuevo}); no se reemplaza` }, 400);
    if (antes > 0 && archivo.size >= antes) return jsonResponse({ error: "Lo nuevo no pesa menos; se deja el original", antes, despues: archivo.size }, 409);

    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const { error: errUp } = await db.storage.from(BUCKET).upload(ruta, bytes, { contentType: mimeNuevo, upsert: true });
    if (errUp) return jsonResponse({ error: `No se pudo reemplazar: ${errUp.message}` }, 500);
    return jsonResponse({ ok: true, ruta, antes, despues: archivo.size });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
