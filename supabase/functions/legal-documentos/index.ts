// Documentos del módulo Legal (Mario, 1-oct-2026): demandas, acuerdos,
// convenios, contratos firmados escaneados.
//
// POST multipart/form-data: asuntoId o contratoId, file (PDF, imagen, Word o
//   Excel ≤ 25 MB), descripcion opcional. Sube quien puede ver el asunto o el
//   contrato (RLS con su propio token). Archivo al bucket privado "cargas"
//   bajo legal/<empresa>/<asunto|contrato>/…
// GET ?asunto=<id> | ?contrato=<id>: lista con URL firmada (1 h).
//
// Expediente legal de la empresa (2-oct-2026): POST con empresaDocumentoId
// sube el archivo del documento (acta, poder, opinión de cumplimiento…) a
// legal/<empresa>/expediente/<id>/… y lo deja en legal_empresa_documentos;
// GET ?empresaDocumento=<id> regresa su URL firmada.

import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado, respuestaSoloConsulta } from "../_shared/supabase-clients.ts";

const TAMANO_MAXIMO_BYTES = 25 * 1024 * 1024;
const TIPOS_PERMITIDOS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();
  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    if (perfil.rol === "pendiente") return jsonResponse({ error: "Tu cuenta no tiene acceso" }, 403);
    const usuario = clienteComoUsuario(req);
    const dbServicio = clienteServicio();

    if (req.method === "GET") {
      const url = new URL(req.url);
      const empresaDocumento = url.searchParams.get("empresaDocumento");
      if (empresaDocumento) {
        const { data: doc, error } = await usuario.from("legal_empresa_documentos").select("storage_path").eq("id", empresaDocumento).maybeSingle();
        if (error) return jsonResponse({ error: error.message }, 500);
        if (!doc?.storage_path) return jsonResponse({ error: "Documento sin archivo o sin permiso" }, 404);
        const { data } = await dbServicio.storage.from("cargas").createSignedUrl(doc.storage_path, 3600);
        return jsonResponse({ url: data?.signedUrl ?? null });
      }
      const asunto = url.searchParams.get("asunto");
      const contrato = url.searchParams.get("contrato");
      if (!asunto && !contrato) return jsonResponse({ error: "asunto o contrato requerido" }, 400);
      let consulta = usuario.from("legal_documentos").select("id, storage_path, nombre, descripcion, subido_por_nombre, created_at").order("created_at", { ascending: false });
      consulta = asunto ? consulta.eq("asunto_id", asunto) : consulta.eq("contrato_id", contrato!);
      const { data: docs, error } = await consulta;
      if (error) return jsonResponse({ error: error.message }, 500);
      const salida = [];
      for (const d of docs ?? []) {
        const { data } = await dbServicio.storage.from("cargas").createSignedUrl(d.storage_path, 3600);
        salida.push({ id: d.id, nombre: d.nombre, descripcion: d.descripcion, subido_por_nombre: d.subido_por_nombre, created_at: d.created_at, url: data?.signedUrl ?? null });
      }
      return jsonResponse({ documentos: salida });
    }

    if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);
    if (perfil.soloConsulta) return respuestaSoloConsulta();

    const form = await req.formData();
    const empresaDocumentoId = String(form.get("empresaDocumentoId") ?? "").trim() || null;
    if (empresaDocumentoId) {
      const archivoDoc = form.get("file") as File | null;
      if (!archivoDoc || archivoDoc.size === 0) return jsonResponse({ error: "Adjunta el archivo" }, 400);
      if (archivoDoc.size > TAMANO_MAXIMO_BYTES) return jsonResponse({ error: "El archivo excede 25 MB" }, 400);
      if (archivoDoc.type && !TIPOS_PERMITIDOS.includes(archivoDoc.type)) return jsonResponse({ error: "Formato no soportado: usa PDF, imagen, Word o Excel" }, 400);
      const { data: doc, error: errDoc } = await usuario.from("legal_empresa_documentos").select("id, empresa_id").eq("id", empresaDocumentoId).maybeSingle();
      if (errDoc) return jsonResponse({ error: errDoc.message }, 500);
      if (!doc) return jsonResponse({ error: "Documento no encontrado o sin permiso" }, 404);
      const nombreDoc = (archivoDoc.name || "documento.pdf").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
      const rutaDoc = `legal/${doc.empresa_id}/expediente/${doc.id}/${Date.now()}-${nombreDoc}`;
      const { error: errUp } = await dbServicio.storage.from("cargas").upload(rutaDoc, new Uint8Array(await archivoDoc.arrayBuffer()), { contentType: archivoDoc.type || "application/octet-stream" });
      if (errUp) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUp.message}` }, 500);
      const { error: errAct } = await usuario.from("legal_empresa_documentos").update({ storage_path: rutaDoc, archivo_nombre: archivoDoc.name || null }).eq("id", doc.id);
      if (errAct) return jsonResponse({ error: errAct.message }, 500);
      return jsonResponse({ ok: true });
    }
    const asuntoId = String(form.get("asuntoId") ?? "").trim() || null;
    const contratoId = String(form.get("contratoId") ?? "").trim() || null;
    const descripcion = String(form.get("descripcion") ?? "").trim() || null;
    const archivo = form.get("file") as File | null;
    if (!asuntoId && !contratoId) return jsonResponse({ error: "asuntoId o contratoId es requerido" }, 400);
    if (!archivo || archivo.size === 0) return jsonResponse({ error: "Adjunta el archivo" }, 400);
    if (archivo.size > TAMANO_MAXIMO_BYTES) return jsonResponse({ error: "El archivo excede 25 MB" }, 400);
    if (archivo.type && !TIPOS_PERMITIDOS.includes(archivo.type)) return jsonResponse({ error: "Formato no soportado: usa PDF, imagen, Word o Excel" }, 400);

    // Que la persona vea el asunto/contrato con su propio permiso (RLS) y,
    // para un asunto, que opere legal.
    const tabla = asuntoId ? "legal_asuntos" : "legal_contratos";
    const { data: padre, error: errPadre } = await usuario.from(tabla).select("id, empresa_id").eq("id", asuntoId ?? contratoId!).maybeSingle();
    if (errPadre) return jsonResponse({ error: errPadre.message }, 500);
    if (!padre) return jsonResponse({ error: "No encontrado o sin permiso" }, 404);

    const nombreSeguro = (archivo.name || "documento.pdf").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
    const ruta = `legal/${padre.empresa_id}/${padre.id}/${Date.now()}-${nombreSeguro}`;
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const { error: errUpload } = await dbServicio.storage.from("cargas").upload(ruta, bytes, { contentType: archivo.type || "application/octet-stream" });
    if (errUpload) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUpload.message}` }, 500);

    const { error: errIns } = await dbServicio.from("legal_documentos").insert({
      empresa_id: padre.empresa_id,
      asunto_id: asuntoId,
      contrato_id: contratoId,
      storage_path: ruta,
      nombre: archivo.name || null,
      descripcion,
      subido_por: perfil.id,
      subido_por_nombre: perfil.nombre,
    });
    if (errIns) return jsonResponse({ error: errIns.message }, 500);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
