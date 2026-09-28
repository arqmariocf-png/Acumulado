// Cotización de una necesidad de compra (Alma, almacén, 28-sep-2026).
//
// POST multipart/form-data: necesidadId, file (JPG/PNG/WEBP/PDF ≤ 10 MB,
//   opcional si ya hay una), proveedor, costoUnitario (sin IVA, opcional),
//   nota. Guarda el archivo en el bucket privado "cargas" bajo
//   cotizaciones/<empresa>/… y actualiza la necesidad. Pueden cotizar
//   admin, corporativo y almacén (misma regla que necesidades_compra_write).
// GET ?id=<necesidad>: URL firmada (1 h) del archivo, si RLS deja ver la fila.

import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;
const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const ROLES_COTIZAN = ["admin", "corporativo", "almacen"];

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
      const { data: fila, error } = await usuario.from("necesidades_compra").select("id, cotizacion_path").eq("id", id).maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 500);
      if (!fila) return jsonResponse({ error: "Necesidad no encontrada" }, 404);
      if (!fila.cotizacion_path) return jsonResponse({ error: "Esta necesidad no tiene cotización" }, 404);
      const { data, error: errUrl } = await dbServicio.storage.from("cargas").createSignedUrl(fila.cotizacion_path, 3600);
      if (errUrl || !data) return jsonResponse({ error: errUrl?.message ?? "No se pudo firmar la URL" }, 500);
      return jsonResponse({ url: data.signedUrl });
    }

    if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);
    if (!ROLES_COTIZAN.includes(perfil.rol)) return jsonResponse({ error: "Tu rol no cotiza compras" }, 403);

    const form = await req.formData();
    const necesidadId = String(form.get("necesidadId") ?? "").trim();
    const proveedor = String(form.get("proveedor") ?? "").trim() || null;
    const costoCrudo = String(form.get("costoUnitario") ?? "").trim();
    const costoUnitario = costoCrudo ? Number(costoCrudo.replace(/[^0-9.]/g, "")) : null;
    const nota = String(form.get("nota") ?? "").trim() || null;
    const archivo = form.get("file") as File | null;
    if (!necesidadId) return jsonResponse({ error: "necesidadId es requerido" }, 400);
    if (costoUnitario !== null && (!Number.isFinite(costoUnitario) || costoUnitario < 0)) return jsonResponse({ error: "El costo unitario no es válido" }, 400);

    // Con el cliente del usuario: RLS decide si puede ver (y por tanto tocar) la necesidad.
    const { data: necesidad, error: errNec } = await usuario
      .from("necesidades_compra")
      .select("id, estado, cotizacion_path, requisicion_lineas(requisiciones(empresa_id))")
      .eq("id", necesidadId)
      .maybeSingle();
    if (errNec) return jsonResponse({ error: errNec.message }, 500);
    if (!necesidad) return jsonResponse({ error: "Necesidad no encontrada o sin permiso" }, 404);
    // 'vinculada' también: en el flujo de un paso la orden se crea primero y
    // la cotización se adjunta justo después.
    if (necesidad.estado === "cancelada") return jsonResponse({ error: "Esta necesidad está cancelada" }, 400);
    const empresaId = (necesidad as { requisicion_lineas?: { requisiciones?: { empresa_id?: string } } }).requisicion_lineas?.requisiciones?.empresa_id ?? "sin-empresa";

    let rutaStorage: string | null = necesidad.cotizacion_path ?? null;
    let nombre: string | null = null;
    if (archivo && archivo.size > 0) {
      if (archivo.size > TAMANO_MAXIMO_BYTES) return jsonResponse({ error: "El archivo excede 10 MB" }, 400);
      if (!TIPOS_PERMITIDOS.includes(archivo.type)) return jsonResponse({ error: "Formato no soportado: usa JPG, PNG, WEBP o PDF" }, 400);
      const nombreSeguro = archivo.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
      rutaStorage = `cotizaciones/${empresaId}/${Date.now()}-${nombreSeguro}`;
      nombre = archivo.name;
      const bytes = new Uint8Array(await archivo.arrayBuffer());
      const { error: errUpload } = await dbServicio.storage.from("cargas").upload(rutaStorage, bytes, { contentType: archivo.type });
      if (errUpload) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUpload.message}` }, 500);
    }
    if (!rutaStorage && !proveedor && costoUnitario === null && !nota) return jsonResponse({ error: "Adjunta la cotización o captura proveedor y costo" }, 400);

    const cambios: Record<string, unknown> = { cotizacion_en: new Date().toISOString(), cotizacion_por: perfil.id };
    if (rutaStorage) cambios.cotizacion_path = rutaStorage;
    if (nombre) cambios.cotizacion_nombre = nombre;
    if (proveedor !== null) cambios.cotizacion_proveedor = proveedor;
    if (costoUnitario !== null) cambios.cotizacion_costo_unitario = costoUnitario;
    if (nota !== null) cambios.cotizacion_nota = nota;
    const { error: errUpd } = await dbServicio.from("necesidades_compra").update(cambios).eq("id", necesidadId);
    if (errUpd) return jsonResponse({ error: errUpd.message }, 500);
    return jsonResponse({ ok: true, cotizacion_path: rutaStorage });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
