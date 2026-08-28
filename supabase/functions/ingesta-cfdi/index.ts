// Edge function: recibe un archivo de CFDI Recibidos/Emitidos (sección 3 de
// SPEC.md) y lo inserta en public.cfdi. Mismo patrón que ingesta-estado-cuenta.
//
// POST multipart/form-data: file, empresaId, tipo ('recibido'|'emitido')
//
// El periodo (AAAAMM) y el RFC de cada CFDI ya NO se piden en el formulario:
// se derivan de los propios datos del archivo, fila por fila (el periodo de
// la Fecha/FechaPago del CFDI, el RFC del Emisor/Receptor según tipo) -- un
// mismo archivo puede traer documentos de más de un mes, y pedir un periodo
// fijo para todo el archivo era, en el mejor caso, redundante con lo que ya
// trae cada fila, y en el peor, una fuente de error si no coincidía.

import { clienteServicio, obtenerPerfilAutenticado, puedeEscribirEnEmpresa } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { parseCsv, filasAObjetos } from "../_shared/ingesta/csv.ts";
import { todasLasHojas } from "../_shared/ingesta/xlsx-cargador.ts";
import { construirIndiceCamposCfdi, deduplicarFilasCfdi, encabezadosFaltantesCfdi, mapearFilaCfdi, normalizarEncabezadoCfdi } from "../_shared/ingesta/cfdi.ts";
import { periodoDeFecha } from "../_shared/motor/normalizar.ts";

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);

    const form = await req.formData();
    const empresaId = String(form.get("empresaId") ?? "");
    const tipo = String(form.get("tipo") ?? "");
    const archivo = form.get("file") as File | null;

    if (!empresaId || !archivo || (tipo !== "recibido" && tipo !== "emitido")) {
      return jsonResponse({ error: "empresaId, file y tipo ('recibido'|'emitido') son requeridos" }, 400);
    }
    if (!puedeEscribirEnEmpresa(perfil, empresaId)) {
      return jsonResponse({ error: "Sin permiso para cargar archivos de esta empresa" }, 403);
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return jsonResponse({ error: `El archivo excede el tamaño máximo permitido (${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB)` }, 400);
    }

    const dbServicio = clienteServicio();
    const rutaStorage = `cfdi/${empresaId}/${tipo}/${Date.now()}-${archivo.name}`;
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

    // Un export real de Compac (RecibidosAEL131023CS1202607.xls) trae DOS
    // hojas con estructura distinta: la de CFDI normales y "RecibosDePago"
    // (complementos de pago) -- hay que leerlas todas o se pierden en
    // silencio los complementos de pago completos, no solo algunas filas.
    const hojas = archivo.name.toLowerCase().endsWith(".csv")
      ? [{ nombre: archivo.name, filas: parseCsv(new TextDecoder("utf-8").decode(bytes)) }]
      : todasLasHojas(bytes);

    const filasProcesadas: any[] = [];
    const erroresPorFila: { hoja: string; fila: number; errores: string[] }[] = [];

    for (const hoja of hojas) {
      const objetos = filasAObjetos(hoja.filas, normalizarEncabezadoCfdi);
      if (objetos.length === 0) continue; // hoja vacía (p.ej. una hoja de notas)

      const indice = construirIndiceCamposCfdi(Object.keys(objetos[0]));
      const faltantes = encabezadosFaltantesCfdi(indice);
      if (faltantes.length > 0) {
        // No tumba el archivo completo: una hoja sin las columnas de CFDI
        // (resumen, notas) no debe impedir procesar las demás hojas que sí
        // las traen.
        erroresPorFila.push({ hoja: hoja.nombre, fila: 0, errores: [`Faltan columnas requeridas: ${faltantes.join(", ")}`] });
        continue;
      }

      objetos.forEach((obj, i) => {
        const resultado = mapearFilaCfdi(obj, indice, tipo as "recibido" | "emitido", i + 1);
        if (resultado.registro) {
          // El periodo y el RFC ya no vienen del formulario -- se derivan de
          // la propia fila. Sin fecha no hay periodo que calcular, y sin RFC
          // de la contraparte no se puede satisfacer la columna rfc (NOT
          // NULL) con un valor real -- en ambos casos es un dato genuino
          // faltante en el archivo, se reporta como pendiente, no se inventa.
          if (!resultado.registro.fecha) {
            erroresPorFila.push({ hoja: hoja.nombre, fila: resultado.fila, errores: ["Fecha inválida o vacía -- no se puede determinar el periodo (AAAAMM)"] });
            return;
          }
          if (!resultado.registro.rfcContraparte) {
            erroresPorFila.push({ hoja: hoja.nombre, fila: resultado.fila, errores: ["RFC de la contraparte vacío"] });
            return;
          }
          filasProcesadas.push({
            tipo,
            empresa_id: empresaId,
            rfc: resultado.registro.rfcContraparte,
            folio: resultado.registro.folio,
            total: resultado.registro.total,
            periodo: periodoDeFecha(resultado.registro.fecha),
            contraparte: resultado.registro.nombreContraparte,
            fecha: resultado.registro.fecha,
            archivo_id: archivoId,
            es_complemento_pago: resultado.registro.esComplementoPago,
          });
        } else if (!resultado.omitida) {
          // Filas sin UUID (relleno del Excel) se descartan en silencio --
          // solo se reportan errores reales (UUID presente pero sin monto).
          erroresPorFila.push({ hoja: hoja.nombre, fila: resultado.fila, errores: resultado.errores });
        }
      });
    }

    // A propósito NO se bloquea la carga completa por filas con UUID faltante
    // (sin datos) o sin Total/ImpPagado: se insertan las filas que sí se
    // pudieron mapear y las demás quedan listadas en detalle_error para
    // resolverlas después -- el archivo siempre llega a 'completado', nunca
    // a 'error', por un problema de datos en algunas filas.
    //
    // Deduplicar ANTES de mandar el batch a upsert: visto en producción con
    // un archivo real de emitidos, si dos filas del mismo batch comparten
    // tipo+rfc+folio+periodo Postgres rechaza el upsert completo con "ON
    // CONFLICT DO UPDATE command cannot affect row a second time".
    const filasParaInsertar = deduplicarFilasCfdi(filasProcesadas);
    if (filasParaInsertar.length > 0) {
      // Idempotencia: si el mismo archivo se vuelve a cargar, upsert por la
      // unique (tipo, rfc, folio, periodo) en vez de duplicar filas.
      const { error: errInsert } = await dbServicio.from("cfdi").upsert(filasParaInsertar, { onConflict: "tipo,rfc,folio,periodo" });
      if (errInsert) {
        await marcarError(dbServicio, archivoId, errInsert.message);
        return jsonResponse({ error: errInsert.message, archivoId }, 500);
      }
    }

    const duplicadosDescartados = filasProcesadas.length - filasParaInsertar.length;

    await dbServicio
      .from("archivos_cargados")
      .update({
        estado: "completado",
        filas_procesadas: filasParaInsertar.length,
        filas_error: erroresPorFila.length,
        detalle_error: erroresPorFila.length > 0 ? JSON.stringify(erroresPorFila.slice(0, 50)) : null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", archivoId);

    const mensaje = erroresPorFila.length > 0
      ? `Archivo cargado. ${filasParaInsertar.length} CFDI guardados, ${erroresPorFila.length} fila(s) pendientes de revisar (sin UUID legible o sin Total/ImpPagado) -- no bloquean la carga, corrígelas cuando tengas el dato.`
      : `Archivo cargado. ${filasParaInsertar.length} CFDI guardados sin pendientes.`;

    return jsonResponse({
      archivoId,
      archivoCargado: true,
      mensaje,
      filasProcesadas: filasParaInsertar.length,
      filasConError: erroresPorFila.length,
      duplicadosDescartados,
      erroresPorFila: erroresPorFila.slice(0, 50),
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});

async function marcarError(dbServicio: ReturnType<typeof clienteServicio>, archivoId: string, mensaje: string) {
  await dbServicio.from("archivos_cargados").update({ estado: "error", detalle_error: mensaje }).eq("id", archivoId);
}
