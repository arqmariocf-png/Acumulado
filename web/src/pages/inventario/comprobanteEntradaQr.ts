import { supabase } from "../../lib/supabase";
import { abrirParaImprimir, abrirVentanaImpresion, cerrarVentanaImpresion } from "../../lib/imprimir";
import { htmlComprobanteEntrada, urlAvanceOc, type ComprobanteEntrada, type LineaComprobante } from "../../lib/comprobanteEntrada";
import { qrSvg } from "./remisionQr";

/** Abre el comprobante de una entrada (los movimientos que se guardaron
 * juntos) listo para imprimir o guardar como PDF, con QR al avance de la OC.
 * Regresa false si el navegador bloqueó la ventana. */
export async function imprimirComprobanteEntrada(movimientoIds: string[]): Promise<boolean> {
  if (movimientoIds.length === 0) return false;
  const ventana = abrirVentanaImpresion();
  try {
    return await generarComprobante(movimientoIds, ventana);
  } catch (err) {
    cerrarVentanaImpresion(ventana);
    throw err;
  }
}

async function generarComprobante(movimientoIds: string[], ventana: Window | null): Promise<boolean> {
  const { data: movs, error } = await supabase
    .from("movimientos_inventario")
    .select("id, cantidad, fecha, empresa_id, almacen_id, orden_compra_id, linea_orden_compra_id, nota_entrega_id, registrado_por, productos(nombre, sku, unidad_medida)")
    .in("id", movimientoIds)
    .order("created_at");
  if (error) throw error;
  const filas = (movs ?? []) as any[];
  if (filas.length === 0) throw new Error("No se encontraron los movimientos de la entrada.");
  const primero = filas[0];

  const [empresa, almacen, orden, registro, avance] = await Promise.all([
    supabase.from("empresas").select("nombre").eq("id", primero.empresa_id).maybeSingle(),
    supabase.from("almacenes").select("nombre").eq("id", primero.almacen_id).maybeSingle(),
    primero.orden_compra_id
      ? supabase.from("ordenes_compra").select("id_orden, tipo, proveedor").eq("id", primero.orden_compra_id).maybeSingle()
      : Promise.resolve({ data: null }),
    primero.registrado_por ? supabase.from("v_directorio").select("nombre").eq("id", primero.registrado_por).maybeSingle() : Promise.resolve({ data: null }),
    primero.orden_compra_id
      ? supabase.from("v_oc_lineas_avance").select("linea_id, cantidad, recibido").eq("orden_compra_id", primero.orden_compra_id)
      : Promise.resolve({ data: [] }),
  ]);

  const porLinea = new Map<string, { cantidad: number | null; recibido: number }>();
  for (const l of (avance.data ?? []) as any[]) {
    porLinea.set(String(l.linea_id), { cantidad: l.cantidad == null ? null : Number(l.cantidad), recibido: Number(l.recibido ?? 0) });
  }

  const lineas: LineaComprobante[] = filas.map((m) => {
    const av = m.linea_orden_compra_id ? porLinea.get(String(m.linea_orden_compra_id)) : undefined;
    return {
      nombre: m.productos?.nombre ?? "",
      sku: m.productos?.sku ?? "",
      unidad: m.productos?.unidad_medida ?? "",
      cantidad: Number(m.cantidad),
      pedido: av ? av.cantidad : null,
      recibido_total: av ? av.recibido : null,
    };
  });

  const comprobante: ComprobanteEntrada = {
    folio: `ENT-${String(primero.id).slice(0, 8).toUpperCase()}`,
    fecha: primero.fecha,
    empresa_nombre: (empresa.data as any)?.nombre ?? "",
    almacen_nombre: (almacen.data as any)?.nombre ?? "",
    orden: orden.data ? `${(orden.data as any).tipo} ${(orden.data as any).id_orden}` : null,
    proveedor: (orden.data as any)?.proveedor ?? null,
    registrado_por_nombre: (registro.data as any)?.nombre ?? null,
    con_evidencia_foto: filas.some((m) => !!m.nota_entrega_id),
  };
  const url = primero.orden_compra_id ? urlAvanceOc(window.location.origin, primero.orden_compra_id) : `${window.location.origin}/inventario/movimientos`;
  const svg = await qrSvg(url);
  return abrirParaImprimir(htmlComprobanteEntrada(comprobante, lineas, svg, url), ventana);
}
