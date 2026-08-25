// Edge function: corre el motor de conciliación (supabase/functions/_shared/motor)
// sobre un conjunto de movimientos y persiste el resultado.
//
// POST body: { empresaId: string, archivoId?: string, cuentaId?: string }
// Si se pasa archivoId, solo reclasifica los movimientos de esa carga
// (flujo normal después de una ingesta). Si se omite, reclasifica TODOS los
// movimientos de la empresa (o de la cuenta, si se pasa cuentaId) -- útil
// para cuando el admin edita reglas_clasificacion/excepciones_proveedor y
// se quiere reprocesar el histórico con las reglas nuevas.
//
// No puede probarse en este entorno (no hay Deno disponible); la lógica de
// clasificación en sí ya está cubierta por 16 pruebas en motor.test.ts —
// este archivo es deliberadamente mecánico: cargar, mapear, llamar al motor
// puro, escribir.

import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado, puedeEscribirEnEmpresa } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { clasificarLote } from "../_shared/motor/motor.ts";
import type { ContextoConciliacion, MovimientoEntrada } from "../_shared/motor/types.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const { empresaId, archivoId, cuentaId } = await req.json();
    if (!empresaId) return jsonResponse({ error: "empresaId es requerido" }, 400);

    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    if (!puedeEscribirEnEmpresa(perfil, empresaId)) {
      return jsonResponse({ error: "Sin permiso para reclasificar movimientos de esta empresa" }, 403);
    }

    // Se lee con el cliente del usuario (RLS aplica) y se escribe con el de
    // servicio (para poder actualizar en lote sin pelear con RLS por fila;
    // el permiso ya se validó arriba).
    const db = clienteComoUsuario(req);
    const dbServicio = clienteServicio();

    let query = db.from("movimientos").select("*").eq("empresa_id", empresaId);
    if (archivoId) query = query.eq("archivo_id", archivoId);
    if (cuentaId) query = query.eq("cuenta_id", cuentaId);
    const { data: movimientosDb, error: errMov } = await query;
    if (errMov) return jsonResponse({ error: errMov.message }, 500);
    if (!movimientosDb || movimientosDb.length === 0) {
      return jsonResponse({ procesados: 0, mensaje: "No hay movimientos que clasificar en ese alcance" });
    }

    const [ordenesCompraRes, ordenesVentaRes, cfdiRes, reglasRes, excepcionesRes] = await Promise.all([
      db.from("ordenes_compra").select("id_orden, tipo, empresa_id, proyecto, proveedor, periodo").eq("empresa_id", empresaId),
      db.from("ordenes_venta").select("id_ov, empresa_id, proyecto, cliente, periodo").eq("empresa_id", empresaId),
      db.from("cfdi").select("id, tipo, empresa_id, folio, total, periodo").eq("empresa_id", empresaId),
      db.from("reglas_clasificacion").select("palabra_clave, etiqueta, orden").eq("activo", true),
      db.from("excepciones_proveedor").select("proveedor, descripcion_regla, hasta_mes_siguiente, dias_tolerancia").eq("activo", true),
    ]);
    for (const r of [ordenesCompraRes, ordenesVentaRes, cfdiRes, reglasRes, excepcionesRes]) {
      if (r.error) return jsonResponse({ error: r.error.message }, 500);
    }

    // Movimientos existentes en las mismas cuentas (para dedupe contra la
    // base, no solo dentro del lote que se está reclasificando ahora mismo).
    const cuentasEnLote = [...new Set(movimientosDb.map((m: any) => m.cuenta_id))];
    const idsEnLote = new Set(movimientosDb.map((m: any) => m.id));
    const { data: existentesDb, error: errExistentes } = await db
      .from("movimientos")
      .select("id, cuenta_id, fecha_pago, cargo_total, abono_total, referencia_numero")
      .in("cuenta_id", cuentasEnLote);
    if (errExistentes) return jsonResponse({ error: errExistentes.message }, 500);

    const contexto: ContextoConciliacion = {
      ordenesCompra: (ordenesCompraRes.data ?? []).map((o: any) => ({
        idOrden: o.id_orden,
        tipo: o.tipo,
        empresaId: o.empresa_id,
        proyecto: o.proyecto,
        proveedor: o.proveedor,
        periodo: o.periodo,
      })),
      ordenesVenta: (ordenesVentaRes.data ?? []).map((o: any) => ({
        idOv: o.id_ov,
        empresaId: o.empresa_id,
        proyecto: o.proyecto,
        cliente: o.cliente,
        periodo: o.periodo,
      })),
      cfdi: (cfdiRes.data ?? []).map((c: any) => ({ id: c.id, tipo: c.tipo, empresaId: c.empresa_id, folio: c.folio, total: Number(c.total), periodo: c.periodo })),
      reglas: (reglasRes.data ?? []).map((r: any) => ({ palabraClave: r.palabra_clave, etiqueta: r.etiqueta, orden: r.orden })),
      excepciones: (excepcionesRes.data ?? []).map((e: any) => ({
        proveedor: e.proveedor,
        descripcionRegla: e.descripcion_regla,
        hastaMesSiguiente: e.hasta_mes_siguiente,
        diasTolerancia: e.dias_tolerancia,
      })),
      movimientosExistentes: (existentesDb ?? [])
        .filter((m: any) => !idsEnLote.has(m.id))
        .map((m: any) => ({
          cuentaId: m.cuenta_id,
          fechaPago: m.fecha_pago,
          monto: Number(m.cargo_total ?? m.abono_total),
          referenciaNumero: m.referencia_numero,
        })),
    };

    const movimientosEntrada: MovimientoEntrada[] = movimientosDb.map((m: any) => ({
      idLote: m.id,
      cuentaId: m.cuenta_id,
      empresaId: m.empresa_id,
      fechaPago: m.fecha_pago,
      fechaOrden: m.fecha_orden,
      proyecto: m.proyecto,
      nombreRazonSocial: m.nombre_razon_social,
      cargoTotal: m.cargo_total == null ? null : Number(m.cargo_total),
      abonoTotal: m.abono_total == null ? null : Number(m.abono_total),
      referenciaTipo: m.referencia_tipo,
      referenciaNumero: m.referencia_numero,
      factura: null, // se re-evalúa siempre; si había una captura manual válida, motor.ts la respeta via el campo `factura` de abajo
      comentarios: m.comentarios,
    }));

    // Si el movimiento ya traía FACTURA capturada a mano (no por el motor),
    // se respeta -- ver clasificarMovimiento en motor.ts. Reconstruimos eso
    // aparte porque no queremos que una FACTURA ya asignada POR EL MOTOR en
    // una corrida anterior bloquee una reclasificación (ej. si ahora hay una
    // regla nueva que aplicaría). Solo se preserva si no es un valor que el
    // propio motor pudo haber generado (heurística: no empieza con "F- " ni "N/A -").
    movimientosDb.forEach((m: any, i: number) => {
      const yaEsDelMotor = typeof m.factura === "string" && (m.factura.startsWith("F- ") || m.factura.startsWith("N/A -"));
      movimientosEntrada[i].factura = yaEsDelMotor ? null : m.factura;
    });

    const resultados = clasificarLote(movimientosEntrada, contexto);

    let actualizados = 0;
    const conflictos: string[] = [];
    for (const mov of movimientosDb) {
      const resultado = resultados.get(mov.id)!;
      const { error: errUpdate } = await dbServicio
        .from("movimientos")
        .update({
          proyecto: resultado.proyecto,
          nombre_razon_social: resultado.nombreRazonSocial,
          factura: resultado.factura,
          observacion: resultado.observaciones.join(" | ") || null,
          estado_clasificacion: resultado.estadoClasificacion,
          posible_duplicado: resultado.posibleDuplicado,
          version: mov.version,
          updated_by: perfil.id,
        })
        .eq("id", mov.id);
      if (errUpdate) {
        conflictos.push(mov.id);
      } else {
        actualizados++;
      }
    }

    return jsonResponse({
      procesados: movimientosDb.length,
      actualizados,
      conflictos,
      resumen: resumenPorEstado(resultados),
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});

function resumenPorEstado(resultados: Map<string, { estadoClasificacion: string }>) {
  const resumen: Record<string, number> = {};
  for (const r of resultados.values()) {
    resumen[r.estadoClasificacion] = (resumen[r.estadoClasificacion] ?? 0) + 1;
  }
  return resumen;
}
