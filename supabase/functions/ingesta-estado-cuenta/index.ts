// Edge function: recibe un estado de cuenta (CSV, Excel con el formato
// canónico de SPEC.md sección 2, o PDF de BanBajío -- ver _shared/ingesta/
// estado-cuenta.ts y pdf-estado-cuenta.ts), lo parsea, y deja los
// movimientos insertados con estado_clasificacion='pendiente_revision'
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
//
// PDF: BanBajío y BBVA son, hasta ahora, los bancos de Grupo Loma con un
// parser de PDF real -- cada uno tiene su propio layout (ver
// pdf-estado-cuenta.ts y pdf-estado-cuenta-bbva.ts respectivamente,
// validados cada uno contra un PDF real distinto). Qué parser usar se
// decide consultando el banco de la cuenta (cuentas_bancarias.banco), NO el
// contenido del archivo -- Banorte/Santander en PDF todavía no tienen
// parser, y NO se debe intentar adivinar con el mismo regex de otro banco.

import { clienteServicio, obtenerPerfilAutenticado, puedeEscribirEnEmpresa } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { parseCsv, filasAObjetos } from "../_shared/ingesta/csv.ts";
import { hojaAFilas } from "../_shared/ingesta/xlsx-cargador.ts";
import { pdfATexto } from "../_shared/ingesta/pdf-cargador.ts";
import { parsearPdfEstadoCuentaBanBajio } from "../_shared/ingesta/pdf-estado-cuenta.ts";
import { parsearPdfEstadoCuentaBBVA } from "../_shared/ingesta/pdf-estado-cuenta-bbva.ts";
import {
  construirIndiceCampos,
  encabezadosFaltantes,
  filtrarMovimientosNuevos,
  mapearFilaEstadoCuenta,
  normalizarEncabezadoEstadoCuenta,
  type FilaEstadoCuentaMapeada,
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

    const esPdf = archivo.name.toLowerCase().endsWith(".pdf");
    const movimientosMapeados: FilaEstadoCuentaMapeada[] = [];
    const erroresPorFila: { fila: number; errores: string[] }[] = [];

    if (esPdf) {
      const { data: cuentaRow, error: errCuenta } = await dbServicio.from("cuentas_bancarias").select("banco").eq("id", cuentaId).single();
      if (errCuenta || !cuentaRow) {
        await marcarArchivoError(dbServicio, archivoId, "No se encontró la cuenta bancaria seleccionada");
        return jsonResponse({ error: "No se encontró la cuenta bancaria seleccionada", archivoId }, 400);
      }

      const texto = await pdfATexto(bytes);
      const parserPorBanco: Record<string, (t: string) => ReturnType<typeof parsearPdfEstadoCuentaBanBajio>> = {
        BanBajio: parsearPdfEstadoCuentaBanBajio,
        BBVA: parsearPdfEstadoCuentaBBVA,
      };
      const parser = parserPorBanco[cuentaRow.banco];
      if (!parser) {
        const msg = `Carga de PDF todavía no soportada para ${cuentaRow.banco} -- sube el CSV/Excel con el formato canónico mientras tanto, o comparte un PDF real de este banco para agregar soporte.`;
        await marcarArchivoError(dbServicio, archivoId, msg);
        return jsonResponse({ error: msg, archivoId }, 400);
      }

      const resultado = parser(texto);
      if (resultado.errorDocumento) {
        await marcarArchivoError(dbServicio, archivoId, resultado.errorDocumento);
        return jsonResponse({ error: resultado.errorDocumento, archivoId }, 400);
      }
      erroresPorFila.push(...resultado.erroresPorFila);
      movimientosMapeados.push(...resultado.movimientos);
    } else {
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

      objetos.forEach((obj, i) => {
        const resultado = mapearFilaEstadoCuenta(obj, indice, i + 1);
        if (resultado.movimiento) {
          movimientosMapeados.push(resultado.movimiento);
        } else {
          erroresPorFila.push({ fila: resultado.fila, errores: resultado.errores });
        }
      });
    }

    // Evita duplicar movimientos cuando el archivo se traslapa con uno ya
    // cargado antes para esta cuenta (ej. tesorería sube la actualización
    // del mes todos los días, y cada archivo repite los movimientos de días
    // anteriores) -- ver filtrarMovimientosNuevos en estado-cuenta.ts para
    // la llave que se usa (Fecha + Monto + Referencia).
    const { data: existentesDb, error: errExistentes } = await dbServicio
      .from("movimientos")
      .select("fecha_pago, cargo_total, abono_total, referencia_numero")
      .eq("cuenta_id", cuentaId);
    if (errExistentes) {
      await marcarArchivoError(dbServicio, archivoId, errExistentes.message);
      return jsonResponse({ error: errExistentes.message, archivoId }, 500);
    }
    const existentes = (existentesDb ?? [])
      .map((e) => ({ fechaPago: e.fecha_pago as string, monto: (e.cargo_total ?? e.abono_total) as number | null, referenciaNumero: e.referencia_numero as string | null }))
      .filter((e): e is { fechaPago: string; monto: number; referenciaNumero: string | null } => e.monto != null);

    const { nuevos, omitidosPorExistentes } = filtrarMovimientosNuevos(movimientosMapeados, existentes);
    const filasProcesadas = nuevos.map((m) => filaAMovimiento(m, empresaId, cuentaId, archivoId, perfil.id));

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

    const partes = [`${filasProcesadas.length} movimiento(s) nuevo(s) guardados`];
    if (omitidosPorExistentes > 0) partes.push(`${omitidosPorExistentes} ya existían y no se duplicaron`);
    if (erroresPorFila.length > 0) partes.push(`${erroresPorFila.length} pendiente(s) de revisar (no bloquean la carga)`);
    const mensaje = `Archivo cargado. ${partes.join(", ")}.`;

    return jsonResponse({
      archivoId,
      archivoCargado: true,
      mensaje,
      filasProcesadas: filasProcesadas.length,
      filasConError: erroresPorFila.length,
      omitidosPorExistentes,
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

function filaAMovimiento(m: FilaEstadoCuentaMapeada, empresaId: string, cuentaId: string, archivoId: string, creadoPor: string) {
  return {
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
    created_by: creadoPor,
  };
}
