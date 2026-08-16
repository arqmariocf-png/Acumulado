// Edge function: recibe un archivo de CFDI Recibidos/Emitidos (sección 3 de
// SPEC.md) y lo inserta en public.cfdi. Mismo patrón que ingesta-estado-cuenta.
//
// POST multipart/form-data: file, empresaId, tipo ('recibido'|'emitido'), rfc, periodo (AAAAMM)

import { clienteServicio, obtenerPerfilAutenticado, puedeEscribirEnEmpresa } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { parseCsv, filasAObjetos } from "../_shared/ingesta/csv.ts";
import { construirIndiceCamposCfdi, encabezadosFaltantesCfdi, mapearFilaCfdi, normalizarEncabezadoCfdi } from "../_shared/ingesta/cfdi.ts";

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);

    const form = await req.formData();
    const empresaId = String(form.get("empresaId") ?? "");
    const tipo = String(form.get("tipo") ?? "");
    const rfc = String(form.get("rfc") ?? "");
    const periodo = String(form.get("periodo") ?? "");
    const archivo = form.get("file") as File | null;

    if (!empresaId || !archivo || (tipo !== "recibido" && tipo !== "emitido") || !/^\d{6}$/.test(periodo)) {
      return jsonResponse({ error: "empresaId, file, tipo ('recibido'|'emitido') y periodo (AAAAMM) son requeridos" }, 400);
    }
    if (!puedeEscribirEnEmpresa(perfil, empresaId)) {
      return jsonResponse({ error: "Sin permiso para cargar archivos de esta empresa" }, 403);
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return jsonResponse({ error: `El archivo excede el tamaño máximo permitido (${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB)` }, 400);
    }

    const dbServicio = clienteServicio();
    const rutaStorage = `cfdi/${empresaId}/${tipo}/${periodo}/${Date.now()}-${archivo.name}`;
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const { error: errUpload } = await dbServicio.storage.from("cargas").upload(rutaStorage, bytes, {
      contentType: archivo.type || "application/octet-stream",
    });
    if (errUpload) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUpload.message}` }, 500);

    const { data: archivoRow, error: errArchivo } = await dbServicio
      .from("archivos_cargados")
      .insert({
        empresa_id: empresaId,
        tipo: tipo === "recibido" ? "cfdi_recibidos" : "cfdi_emitidos",
        nombre_original: archivo.name,
        storage_path: rutaStorage,
        cargado_por: perfil.id,
        estado: "procesando",
      })
      .select("id")
      .single();
    if (errArchivo) return jsonResponse({ error: errArchivo.message }, 500);
    const archivoId = archivoRow.id;

    let filas: string[][];
    if (archivo.name.toLowerCase().endsWith(".csv")) {
      filas = parseCsv(new TextDecoder("utf-8").decode(bytes));
    } else {
      // @ts-ignore -- ver advertencia de seguridad en ingesta-estado-cuenta/index.ts
      const XLSX = await import("npm:xlsx@0.18.5");
      const libro = XLSX.read(bytes, { type: "array" });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "" }) as string[][];
    }

    const objetos = filasAObjetos(filas, normalizarEncabezadoCfdi);
    if (objetos.length === 0) {
      await marcarError(dbServicio, archivoId, "El archivo no tiene filas de datos");
      return jsonResponse({ error: "El archivo no tiene filas de datos", archivoId }, 400);
    }

    const indice = construirIndiceCamposCfdi(Object.keys(objetos[0]));
    const faltantes = encabezadosFaltantesCfdi(indice);
    if (faltantes.length > 0) {
      const msg = `Faltan columnas requeridas: ${faltantes.join(", ")}`;
      await marcarError(dbServicio, archivoId, msg);
      return jsonResponse({ error: msg, archivoId }, 400);
    }

    const filasProcesadas: any[] = [];
    const erroresPorFila: { fila: number; errores: string[] }[] = [];

    objetos.forEach((obj, i) => {
      const resultado = mapearFilaCfdi(obj, indice, tipo as "recibido" | "emitido", i + 1);
      if (resultado.registro) {
        filasProcesadas.push({
          tipo,
          empresa_id: empresaId,
          rfc: resultado.registro.rfcContraparte ?? rfc,
          folio: resultado.registro.folio,
          total: resultado.registro.total,
          periodo,
          contraparte: resultado.registro.nombreContraparte,
          fecha: resultado.registro.fecha,
          archivo_id: archivoId,
        });
      } else {
        erroresPorFila.push({ fila: resultado.fila, errores: resultado.errores });
      }
    });

    if (filasProcesadas.length > 0) {
      // Idempotencia: si el mismo archivo se vuelve a cargar, upsert por la
      // unique (tipo, rfc, folio, periodo) en vez de duplicar filas.
      const { error: errInsert } = await dbServicio.from("cfdi").upsert(filasProcesadas, { onConflict: "tipo,rfc,folio,periodo" });
      if (errInsert) {
        await marcarError(dbServicio, archivoId, errInsert.message);
        return jsonResponse({ error: errInsert.message, archivoId }, 500);
      }
    }

    await dbServicio
      .from("archivos_cargados")
      .update({
        estado: "completado",
        filas_procesadas: filasProcesadas.length,
        filas_error: erroresPorFila.length,
        detalle_error: erroresPorFila.length > 0 ? JSON.stringify(erroresPorFila.slice(0, 50)) : null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", archivoId);

    return jsonResponse({ archivoId, filasProcesadas: filasProcesadas.length, filasConError: erroresPorFila.length, erroresPorFila: erroresPorFila.slice(0, 50) });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});

async function marcarError(dbServicio: ReturnType<typeof clienteServicio>, archivoId: string, mensaje: string) {
  await dbServicio.from("archivos_cargados").update({ estado: "error", detalle_error: mensaje }).eq("id", archivoId);
}
