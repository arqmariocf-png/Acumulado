// Carga del export "PEDIDOS RECIBIDOS" de Adquira (portal de proveedores
// de BBVA): lee la hoja "Órdenes", arma un registro por pedido (ver
// _shared/bbva-adquira.ts) y lo guarda/actualiza en bbva_adquira_pedidos.
// A diferencia del maestro de folios no se guarda como snapshot: un pedido
// es un pedido, y cada export trae la foto más reciente de todos.
//
// POST multipart/form-data: file
// -> { ok: true, pedidos, importe_total, fecha_exportacion }

import { clienteComoUsuario, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { XLSX } from "../_shared/ingesta/xlsx-cargador.ts";
import { fechaExportacionDeNombre, procesarFilasAdquira } from "../_shared/bbva-adquira.ts";

const TAMANO_MAXIMO_BYTES = 15 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    // Mismo criterio que bbva_adquira_pedidos_insert: contabilidad
    // (corporativo, ej. Belén) o admin.
    if (perfil.rol !== "admin" && perfil.rol !== "corporativo") {
      return jsonResponse({ error: "Sin permiso para cargar pedidos de Adquira" }, 403);
    }

    const form = await req.formData();
    const archivo = form.get("file") as File | null;
    if (!archivo) return jsonResponse({ error: "file es requerido" }, 400);
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return jsonResponse({ error: `El archivo excede el tamaño máximo permitido (${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB)` }, 400);
    }

    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const libro = XLSX.read(bytes, { type: "array" });
    const nombreHoja = libro.SheetNames.find((n: string) => n.trim().toLowerCase().startsWith("órdenes") || n.trim().toLowerCase().startsWith("ordenes")) ?? libro.SheetNames[0];
    const filas: unknown[][] = XLSX.utils.sheet_to_json(libro.Sheets[nombreHoja], { header: 1, raw: true, defval: null });

    const pedidos = procesarFilasAdquira(filas);
    if (pedidos.length === 0) return jsonResponse({ error: 'No se encontró ningún pedido en la hoja -- ¿es el export "Pedidos recibidos" de Adquira?' }, 400);

    const fechaExportacion = fechaExportacionDeNombre(archivo.name);
    const cliente = clienteComoUsuario(req);
    const filasTabla = pedidos.map((p) => ({
      id_pedido: p.id_pedido,
      fecha: p.fecha,
      fecha_publicacion: p.fecha_publicacion,
      importe_total: p.importe_total,
      base_imponible: p.base_imponible,
      impuestos: p.impuestos,
      estado: p.estado,
      lineas: p.lineas,
      solicitante: p.solicitante,
      contrato: p.contrato,
      lineas_detalle: p.lineas_detalle,
      fecha_exportacion: fechaExportacion,
      archivo_origen: archivo.name,
      subido_por: perfil.id,
      subido_en: new Date().toISOString(),
    }));
    const { error: errUpsert } = await cliente.from("bbva_adquira_pedidos").upsert(filasTabla, { onConflict: "id_pedido" });
    if (errUpsert) return jsonResponse({ error: `No se pudieron guardar los pedidos: ${errUpsert.message}` }, 500);

    return jsonResponse({
      ok: true,
      pedidos: pedidos.length,
      importe_total: Math.round(pedidos.reduce((s, p) => s + p.importe_total, 0) * 100) / 100,
      fecha_exportacion: fechaExportacion,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
