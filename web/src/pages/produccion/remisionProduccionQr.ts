import { supabase } from "../../lib/supabase";
import { abrirParaImprimir, abrirVentanaImpresion, cerrarVentanaImpresion } from "../../lib/imprimir";
import { htmlRemisionProduccion, urlRemisionProduccion, type LineaRemisionProduccion, type RemisionProduccionDoc } from "../../lib/remisionProduccion";

export interface RemisionProduccionFila extends RemisionProduccionDoc {
  id: string;
  empresa_id: string;
  orden_venta_id: string | null;
  orden_compra_id: string | null;
  created_at: string;
  lineas: number;
}

export async function qrSvg(texto: string): Promise<string> {
  const QRCode = await import("qrcode");
  return QRCode.toString(texto, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}

export async function cargarRemisionProduccion(id: string): Promise<{ remision: RemisionProduccionFila; lineas: LineaRemisionProduccion[] }> {
  const { data: r, error } = await supabase.from("v_remisiones_produccion").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!r) throw new Error("Remisión no encontrada o sin permiso para verla.");
  const { data: lineas, error: errL } = await supabase.from("remisiones_produccion_lineas").select("descripcion, cantidad, unidad").eq("remision_id", id).order("orden");
  if (errL) throw errL;
  // Referencia legible (folio de OV/OC) para el documento.
  let referencia: string | null = null;
  if (r.orden_venta_id) {
    const { data } = await supabase.from("ordenes_venta").select("id_ov").eq("id", r.orden_venta_id).maybeSingle();
    referencia = data ? `OV ${data.id_ov}` : null;
  } else if (r.orden_compra_id) {
    const { data } = await supabase.from("ordenes_compra").select("id_orden, tipo").eq("id", r.orden_compra_id).maybeSingle();
    referencia = data ? `${data.tipo} ${data.id_orden}` : null;
  }
  return {
    remision: { ...(r as RemisionProduccionFila), referencia },
    lineas: (lineas ?? []).map((l) => ({ descripcion: l.descripcion, cantidad: Number(l.cantidad), unidad: l.unidad })),
  };
}

export async function imprimirRemisionProduccion(id: string): Promise<boolean> {
  // La pestaña se abre durante el clic (móvil) y se navega al terminar.
  const ventana = abrirVentanaImpresion();
  try {
    const { remision, lineas } = await cargarRemisionProduccion(id);
    const url = urlRemisionProduccion(window.location.origin, id);
    const svg = await qrSvg(url);
    const logo = `/logos/${remision.empresa_codigo.toLowerCase()}.png`;
    return abrirParaImprimir(htmlRemisionProduccion(remision, lineas, svg, url, logo), ventana);
  } catch (err) {
    cerrarVentanaImpresion(ventana);
    throw err;
  }
}
