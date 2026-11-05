// Estados de cuenta de clientes para cuentas por cobrar (Mario, 4-nov-2026:
// "poder consultar el archivo que adjunto para tomar esta base para la
// conciliación y de ahí arrancamos de ceros").
//
// POST multipart/form-data: empresaId, corte (AAAA-MM-DD), nota opcional,
//   resumen opcional (JSON con lo que la pantalla leyó del Excel), file
//   (Excel, CSV, PDF o imagen ≤ 25 MB). Sube quien opera cuentas por cobrar
//   (admin, dirección, corporativo) en una empresa de su alcance. Archivo al
//   bucket privado "cargas" bajo cxc/<empresa>/<fecha>-<nombre>; renglón en
//   cxc_archivos (con el token de la persona: RLS decide). Devuelve { id }.
// GET ?id=<archivo>: URL firmada (1 h) si RLS deja ver el renglón (la usa
//   /archivo?f=cxc).
// DELETE ?id=<archivo>: quita el archivo y su renglón si quien pide opera
//   cuentas por cobrar y puede ver el renglón; los saldos iniciales ligados se
//   quedan (solo pierden la liga).

import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado, respuestaSoloConsulta } from "../_shared/supabase-clients.ts";

const TAMANO_MAXIMO_BYTES = 25 * 1024 * 1024;
const TIPOS_PERMITIDOS = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "text/csv",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];
const ROLES_OPERAN = ["admin", "direccion", "corporativo"];

function nombreSeguro(nombre: string): string {
  return (nombre || "estado-de-cuenta.xlsx").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]/g, "_").slice(-90);
}

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
      const { data: fila, error } = await usuario.from("cxc_archivos").select("id, storage_path, nombre").eq("id", id).maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 500);
      if (!fila) return jsonResponse({ error: "Archivo no encontrado o sin permiso" }, 404);
      const { data, error: errUrl } = await dbServicio.storage.from("cargas").createSignedUrl(fila.storage_path, 3600);
      if (errUrl || !data) return jsonResponse({ error: errUrl?.message ?? "No se pudo firmar la URL" }, 500);
      return jsonResponse({ url: data.signedUrl, nombre: fila.nombre });
    }

    if (!ROLES_OPERAN.includes(perfil.rol)) return jsonResponse({ error: "Solo dirección, corporativo o el administrador suben estados de cuenta de clientes" }, 403);
    if (perfil.soloConsulta) return respuestaSoloConsulta();

    if (req.method === "DELETE") {
      const id = new URL(req.url).searchParams.get("id") ?? "";
      if (!id) return jsonResponse({ error: "id requerido" }, 400);
      const { data: fila, error } = await usuario.from("cxc_archivos").select("id, storage_path").eq("id", id).maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 500);
      if (!fila) return jsonResponse({ error: "Archivo no encontrado o sin permiso" }, 404);
      const { error: errDoc } = await dbServicio.from("cxc_documentos").update({ archivo_id: null }).eq("archivo_id", fila.id);
      if (errDoc) return jsonResponse({ error: errDoc.message }, 500);
      const { error: errFila } = await dbServicio.from("cxc_archivos").delete().eq("id", fila.id);
      if (errFila) return jsonResponse({ error: errFila.message }, 500);
      await dbServicio.storage.from("cargas").remove([fila.storage_path]);
      return jsonResponse({ ok: true });
    }

    if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);

    const form = await req.formData();
    const empresaId = String(form.get("empresaId") ?? "").trim();
    const corte = String(form.get("corte") ?? "").trim();
    const nota = String(form.get("nota") ?? "").trim() || null;
    const resumenCrudo = String(form.get("resumen") ?? "").trim();
    const archivo = form.get("file") as File | null;
    if (!empresaId) return jsonResponse({ error: "empresaId es requerido" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(corte)) return jsonResponse({ error: "Indica la fecha de corte del estado de cuenta" }, 400);
    if (!archivo || archivo.size === 0) return jsonResponse({ error: "Adjunta el archivo" }, 400);
    if (archivo.size > TAMANO_MAXIMO_BYTES) return jsonResponse({ error: "El archivo excede 25 MB" }, 400);
    if (archivo.type && !TIPOS_PERMITIDOS.includes(archivo.type) && !/\.(xlsx|xlsm|xls|csv|pdf|jpe?g|png|webp)$/i.test(archivo.name)) {
      return jsonResponse({ error: "Formato no soportado: usa Excel, CSV, PDF o imagen" }, 400);
    }
    let resumen: unknown = null;
    if (resumenCrudo) {
      try {
        resumen = JSON.parse(resumenCrudo);
      } catch {
        return jsonResponse({ error: "El resumen no es JSON válido" }, 400);
      }
    }

    const ruta = `cxc/${empresaId}/${corte}-${Date.now()}-${nombreSeguro(archivo.name)}`;
    const { error: errUpload } = await dbServicio.storage.from("cargas").upload(ruta, new Uint8Array(await archivo.arrayBuffer()), {
      contentType: archivo.type || "application/octet-stream",
    });
    if (errUpload) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUpload.message}` }, 500);

    // Con el token de la persona: RLS (auth_opera_cxc y alcance de empresa) decide.
    const { data: fila, error: errIns } = await usuario
      .from("cxc_archivos")
      .insert({ empresa_id: empresaId, nombre: archivo.name || "estado-de-cuenta", storage_path: ruta, tamano: archivo.size, corte, nota, resumen, subido_por: perfil.id, subido_por_nombre: perfil.nombre })
      .select("id")
      .single();
    if (errIns) {
      await dbServicio.storage.from("cargas").remove([ruta]);
      const sinPermiso = /row-level security|permission denied/i.test(errIns.message);
      return jsonResponse({ error: sinPermiso ? "No puedes subir estados de cuenta en esa empresa" : errIns.message }, sinPermiso ? 403 : 500);
    }
    return jsonResponse({ id: fila.id });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
