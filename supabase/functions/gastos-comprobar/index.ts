// Comprobación de gastos / caja chica de supervisores.
//
// POST multipart/form-data: file (JPG/PNG/WEBP/PDF ≤ 10 MB), empresaId,
//   proyectoId (obra, opcional), obraTexto (si no hay proyecto), tipo
//   (factura|nota|ticket), monto, fecha (AAAA-MM-DD), concepto, proveedor.
//   Guarda el archivo en el bucket privado "cargas", inserta la comprobación
//   y manda un push a finanzas (admin, dirección, corporativo de esa
//   empresa) como aviso. La lectura de quién puede comprobar es la misma
//   función de la base (auth_puede_comprobar_gasto) que usa RLS.
// GET ?id=<uuid>: URL firmada (1 h) del archivo, si RLS deja ver esa fila.

import webpush from "npm:web-push@3.6.7";
import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;
const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const TIPOS_COMPROBANTE = ["factura", "nota", "ticket"];

function dinero(n: number): string {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
}

/** Push a quienes revisan gastos en esa empresa. Nunca falla la comprobación
 * por un push fallido: es un aviso, no parte del registro. */
async function avisarFinanzas(
  dbServicio: ReturnType<typeof clienteServicio>,
  empresaId: string,
  payload: string,
): Promise<{ avisados: number; enviados: number }> {
  const { data: config } = await dbServicio.from("config_sistema").select("clave, valor").in("clave", ["vapid_public_key", "vapid_private_key", "vapid_subject"]);
  const cfg = Object.fromEntries((config ?? []).map((f: { clave: string; valor: string }) => [f.clave, f.valor]));
  if (!cfg.vapid_public_key || !cfg.vapid_private_key || !cfg.vapid_subject) return { avisados: 0, enviados: 0 };
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public_key, cfg.vapid_private_key);

  const { data: revisores } = await dbServicio
    .from("profiles")
    .select("id, empresa_id")
    .in("rol", ["admin", "direccion", "corporativo"])
    .eq("activo", true);
  const ids = (revisores ?? []).filter((r: { empresa_id: string | null }) => r.empresa_id === null || r.empresa_id === empresaId).map((r: { id: string }) => r.id);
  if (ids.length === 0) return { avisados: 0, enviados: 0 };

  const { data: subs } = await dbServicio.from("push_subscripciones").select("id, endpoint, p256dh, auth").in("profile_id", ids);
  let enviados = 0;
  const borrar: string[] = [];
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      enviados++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) borrar.push(sub.id);
    }
  }
  if (borrar.length > 0) await dbServicio.from("push_subscripciones").delete().in("id", borrar);
  return { avisados: ids.length, enviados };
}

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
      // Con el cliente del usuario: si RLS no le deja ver la fila, no hay URL.
      const { data: fila, error } = await usuario.from("comprobaciones_gasto").select("id, archivo_path").eq("id", id).maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 500);
      if (!fila) return jsonResponse({ error: "Comprobación no encontrada" }, 404);
      const { data, error: errUrl } = await dbServicio.storage.from("cargas").createSignedUrl(fila.archivo_path, 3600);
      if (errUrl || !data) return jsonResponse({ error: errUrl?.message ?? "No se pudo firmar la URL" }, 500);
      return jsonResponse({ url: data.signedUrl });
    }

    if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);

    const { data: puede, error: errPuede } = await usuario.rpc("auth_puede_comprobar_gasto");
    if (errPuede) return jsonResponse({ error: errPuede.message }, 500);
    if (!puede) return jsonResponse({ error: "Tu rol no puede comprobar gastos" }, 403);

    const form = await req.formData();
    const empresaId = String(form.get("empresaId") ?? "");
    const proyectoId = String(form.get("proyectoId") ?? "").trim() || null;
    const obraTexto = String(form.get("obraTexto") ?? "").trim() || null;
    const tipo = String(form.get("tipo") ?? "nota");
    const monto = Number(form.get("monto"));
    const fecha = String(form.get("fecha") ?? "").trim() || new Date().toISOString().slice(0, 10);
    const concepto = String(form.get("concepto") ?? "").trim();
    const proveedor = String(form.get("proveedor") ?? "").trim() || null;
    const archivo = form.get("file") as File | null;

    if (!empresaId || !archivo) return jsonResponse({ error: "empresaId y file son requeridos" }, 400);
    if (!TIPOS_COMPROBANTE.includes(tipo)) return jsonResponse({ error: "tipo debe ser factura, nota o ticket" }, 400);
    if (!Number.isFinite(monto) || monto <= 0) return jsonResponse({ error: "El monto debe ser mayor a cero" }, 400);
    if (!concepto) return jsonResponse({ error: "Escribe el concepto del gasto" }, 400);
    if (!proyectoId && !obraTexto) return jsonResponse({ error: "Indica la obra" }, 400);
    if (perfil.empresaId !== null && perfil.empresaId !== empresaId) return jsonResponse({ error: "Sin permiso para comprobar en esta empresa" }, 403);
    if (archivo.size > TAMANO_MAXIMO_BYTES) return jsonResponse({ error: "El archivo excede 10 MB" }, 400);
    if (!TIPOS_PERMITIDOS.includes(archivo.type)) return jsonResponse({ error: "Formato no soportado: usa JPG, PNG, WEBP o PDF" }, 400);

    const nombreSeguro = archivo.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
    const rutaStorage = `comprobaciones/${empresaId}/${Date.now()}-${nombreSeguro}`;
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const { error: errUpload } = await dbServicio.storage.from("cargas").upload(rutaStorage, bytes, { contentType: archivo.type });
    if (errUpload) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUpload.message}` }, 500);

    const { data: fila, error: errInsert } = await dbServicio
      .from("comprobaciones_gasto")
      .insert({
        empresa_id: empresaId,
        proyecto_id: proyectoId,
        obra_texto: obraTexto,
        supervisor_id: perfil.id,
        tipo,
        monto,
        fecha,
        concepto,
        proveedor,
        archivo_path: rutaStorage,
        archivo_nombre: archivo.name,
      })
      .select("id")
      .single();
    if (errInsert) return jsonResponse({ error: errInsert.message }, 500);

    let obra = obraTexto ?? "";
    if (proyectoId) {
      const { data: pr } = await dbServicio.from("proyectos").select("nombre").eq("id", proyectoId).maybeSingle();
      obra = pr?.nombre ?? obra;
    }
    const payload = JSON.stringify({
      titulo: "Comprobación de gasto por revisar",
      cuerpo: `${perfil.nombre ?? "Un supervisor"} · ${dinero(monto)} · ${obra || "sin obra"} · ${concepto}`,
      url: "/gastos",
    });
    let aviso = { avisados: 0, enviados: 0 };
    try {
      aviso = await avisarFinanzas(dbServicio, empresaId, payload);
    } catch {
      // el aviso es best-effort
    }

    return jsonResponse({ id: fila.id, ...aviso });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
