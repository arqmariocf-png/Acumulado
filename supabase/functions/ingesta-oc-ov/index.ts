// Edge function: carga manual de Excel/CSV para el catálogo de OC/OS u OV,
// como respaldo mientras se confirma/asegura la API del backoffice
// (ver proxy-backoffice/index.ts).
//
// POST multipart/form-data: file, empresaId, recurso ('oc'|'ov')

import { clienteServicio, obtenerPerfilAutenticado, puedeEscribirEnEmpresa } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { parseCsv, filasAObjetos } from "../_shared/ingesta/csv.ts";
import { hojaAFilas } from "../_shared/ingesta/xlsx-cargador.ts";
import { mapearFilaOrdenCompraExcel, mapearFilaOrdenVentaExcel, normalizarEncabezadoOcOv } from "../_shared/ingesta/oc-ov.ts";

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);

    const form = await req.formData();
    const empresaId = String(form.get("empresaId") ?? "");
    const recurso = String(form.get("recurso") ?? "");
    const archivo = form.get("file") as File | null;

    if (!empresaId || !archivo || (recurso !== "oc" && recurso !== "ov")) {
      return jsonResponse({ error: "empresaId, file y recurso ('oc'|'ov') son requeridos" }, 400);
    }
    if (!puedeEscribirEnEmpresa(perfil, empresaId)) return jsonResponse({ error: "Sin permiso" }, 403);
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return jsonResponse({ error: `El archivo excede el tamaño máximo permitido (${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB)` }, 400);
    }

    const dbServicio = clienteServicio();
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const rutaStorage = `${recurso === "oc" ? "oc-excel" : "ov-excel"}/${empresaId}/${Date.now()}-${archivo.name}`;
    const { error: errUpload } = await dbServicio.storage.from("cargas").upload(rutaStorage, bytes, {
      contentType: archivo.type || "application/octet-stream",
    });
    if (errUpload) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUpload.message}` }, 500);

    const { data: archivoRow, error: errArchivo } = await dbServicio
      .from("archivos_cargados")
      .insert({
        empresa_id: empresaId,
        tipo: recurso === "oc" ? "oc_excel" : "ov_excel",
        nombre_original: archivo.name,
        storage_path: rutaStorage,
        cargado_por: perfil.id,
        estado: "procesando",
      })
      .select("id")
      .single();
    if (errArchivo) return jsonResponse({ error: errArchivo.message }, 500);
    const archivoId = archivoRow.id;

    const filas = archivo.name.toLowerCase().endsWith(".csv")
      ? parseCsv(new TextDecoder("utf-8").decode(bytes))
      : hojaAFilas(bytes);

    const objetos = filasAObjetos(filas, normalizarEncabezadoOcOv);
    const filasProcesadas: any[] = [];
    let descartadas = 0;

    if (recurso === "oc") {
      for (const obj of objetos) {
        const oc = mapearFilaOrdenCompraExcel(obj);
        if (!oc) {
          descartadas++;
          continue;
        }
        filasProcesadas.push({
          id_orden: oc.idOrden,
          tipo: oc.tipo,
          empresa_id: empresaId,
          proyecto: oc.proyecto,
          proveedor: oc.proveedor,
          total: oc.total,
          fecha_creacion: oc.fechaCreacion,
          fuente: "excel",
          archivo_id: archivoId,
        });
      }
      if (filasProcesadas.length > 0) {
        const { error } = await dbServicio.from("ordenes_compra").upsert(filasProcesadas, { onConflict: "id_orden,tipo" });
        if (error) {
          await marcarError(dbServicio, archivoId, error.message);
          return jsonResponse({ error: error.message, archivoId }, 500);
        }
      }
    } else {
      for (const obj of objetos) {
        const ov = mapearFilaOrdenVentaExcel(obj);
        if (!ov) {
          descartadas++;
          continue;
        }
        filasProcesadas.push({
          id_ov: ov.idOv,
          empresa_id: empresaId,
          proyecto: ov.proyecto,
          cliente: ov.cliente,
          total: ov.total,
          fecha_ov: ov.fechaOv,
          fuente: "excel",
          archivo_id: archivoId,
        });
      }
      if (filasProcesadas.length > 0) {
        const { error } = await dbServicio.from("ordenes_venta").upsert(filasProcesadas, { onConflict: "id_ov" });
        if (error) {
          await marcarError(dbServicio, archivoId, error.message);
          return jsonResponse({ error: error.message, archivoId }, 500);
        }
      }
    }

    await dbServicio
      .from("archivos_cargados")
      .update({ estado: "completado", filas_procesadas: filasProcesadas.length, filas_error: descartadas, completed_at: new Date().toISOString() })
      .eq("id", archivoId);

    const mensaje = descartadas > 0
      ? `Archivo cargado. ${filasProcesadas.length} registro(s) guardados, ${descartadas} fila(s) descartadas por datos incompletos.`
      : `Archivo cargado. ${filasProcesadas.length} registro(s) guardados sin pendientes.`;

    return jsonResponse({ archivoId, archivoCargado: true, mensaje, filasProcesadas: filasProcesadas.length, filasDescartadas: descartadas });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});

async function marcarError(dbServicio: ReturnType<typeof clienteServicio>, archivoId: string, mensaje: string) {
  await dbServicio.from("archivos_cargados").update({ estado: "error", detalle_error: mensaje }).eq("id", archivoId);
}
