// Edge function: recibe un estado de cuenta (CSV o Excel, formato canónico
// de SPEC.md sección 2 -- ver _shared/ingesta/estado-cuenta.ts), lo parsea,
// y deja los movimientos insertados con estado_clasificacion='pendiente_revision'
// (el default de la tabla). NO corre el motor de conciliación -- eso es un
// paso aparte (llamar a motor-conciliacion con el archivoId que devuelve
// esta función), a propósito: separa "¿el archivo se pudo leer?" de
// "¿qué tan bien clasificó el motor?" como dos resultados distintos que el
// frontend puede mostrar por separado.
//
// POST multipart/form-data: file, empresaId, cuentaId
//
// El parser de Excel usa xlsx@0.18.5 de npm -- ver _shared/ingesta/
// xlsx-cargador.ts para por qué no se pudo usar la distribución parchada
// del CDN de SheetJS (el bundler de edge functions de Supabase la rechaza)
// y qué mitigación queda mientras tanto (límite de tamaño de archivo).

import { clienteServicio, obtenerPerfilAutenticado, puedeEscribirEnEmpresa } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { parseCsv, filasAObjetos } from "../_shared/ingesta/csv.ts";
import { hojaAFilas } from "../_shared/ingesta/xlsx-cargador.ts";
import {
  construirIndiceCampos,
  encabezadosFaltantes,
  mapearFilaEstadoCuenta,
  normalizarEncabezadoEstadoCuenta,
} from "../_shared/ingesta/estado-cuenta.ts";

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10 MB

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);

    const form = await req.formData();
    const empresaId = String(form.get("empresaId") ?? "");
    const cuentaId = String(form.get("cuentaId") ?? "");
    const archivo = form.get("file") as File | null;

    if (!empresaId || !cuentaId || !archivo) {
      return jsonResponse({ error: "empresaId, cuentaId y file son requeridos" }, 400);
    }
    if (!puedeEscribirEnEmpresa(perfil, empresaId)) {
      return jsonResponse({ error: "Sin permiso para cargar archivos de esta empresa" }, 403);
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return jsonResponse({ error: `El archivo excede el tamaño máximo permitido (${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB)` }, 400);
    }

    const dbServicio = clienteServicio();

    const rutaStorage = `estados-cuenta/${empresaId}/${cuentaId}/${Date.now()}-${archivo.name}`;
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const { error: errUpload } = await dbServicio.storage.from("cargas").upload(rutaStorage, bytes, {
      contentType: archivo.type || "application/octet-stream",
    });
    if (errUpload) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUpload.message}` }, 500);

    const { data: archivoRow, error: errArchivo } = await dbServicio
      .from("archivos_cargados")
      .insert({
        empresa_id: empresaId,
        tipo: "estado_cuenta",
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

    const objetos = filasAObjetos(filas, normalizarEncabezadoEstadoCuenta);
    if (objetos.length === 0) {
      await marcarArchivoError(dbServicio, archivoId, "El archivo no tiene filas de datos");
      return jsonResponse({ error: "El archivo no tiene filas de datos", archivoId }, 400);
    }

    const indice = construirIndiceCampos(Object.keys(objetos[0]));
    const faltantes = encabezadosFaltantes(indice);
    if (faltantes.length > 0) {
      const msg = `Faltan columnas requeridas: ${faltantes.join(", ")}`;
      await marcarArchivoError(dbServicio, archivoId, msg);
      return jsonResponse({ error: msg, archivoId }, 400);
    }

    const filasProcesadas: any[] = [];
    const erroresPorFila: { fila: number; errores: string[] }[] = [];

    objetos.forEach((obj, i) => {
      const resultado = mapearFilaEstadoCuenta(obj, indice, i + 1);
      if (resultado.movimiento) {
        const m = resultado.movimiento;
        filasProcesadas.push({
          empresa_id: empresaId,
          cuenta_id: cuentaId,
          archivo_id: archivoId,
          folio: m.folio,
          fecha_pago: m.fechaPago,
          fecha_orden: m.fechaOrden,
          proyecto: m.proyecto,
          nombre_razon_social: m.nombreRazonSocial,
          cargo_total: m.cargoTotal,
          abono_total: m.abonoTotal,
          saldo: m.saldo,
          referencia_tipo: m.referenciaTipo,
          referencia_numero: m.referenciaNumero,
          factura: m.factura,
          comentarios: m.comentarios,
          observacion: m.observacion,
          created_by: perfil.id,
        });
      } else {
        erroresPorFila.push({ fila: resultado.fila, errores: resultado.errores });
      }
    });

    if (filasProcesadas.length > 0) {
      const { error: errInsert } = await dbServicio.from("movimientos").insert(filasProcesadas);
      if (errInsert) {
        await marcarArchivoError(dbServicio, archivoId, errInsert.message);
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

    const mensaje = erroresPorFila.length > 0
      ? `Archivo cargado. ${filasProcesadas.length} movimiento(s) guardados, ${erroresPorFila.length} fila(s) pendientes de revisar -- no bloquean la carga.`
      : `Archivo cargado. ${filasProcesadas.length} movimiento(s) guardados sin pendientes.`;

    return jsonResponse({
      archivoId,
      archivoCargado: true,
      mensaje,
      filasProcesadas: filasProcesadas.length,
      filasConError: erroresPorFila.length,
      erroresPorFila: erroresPorFila.slice(0, 50),
      siguientePaso: "Llamar a motor-conciliacion con { empresaId, archivoId } para clasificar estos movimientos.",
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});

async function marcarArchivoError(dbServicio: ReturnType<typeof clienteServicio>, archivoId: string, mensaje: string) {
  await dbServicio.from("archivos_cargados").update({ estado: "error", detalle_error: mensaje }).eq("id", archivoId);
}
