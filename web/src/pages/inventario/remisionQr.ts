import { supabase } from "../../lib/supabase";
import { abrirParaImprimir } from "../../lib/imprimir";
import { htmlRemision, urlRemision, type LineaRemision } from "../../lib/remision";
import type { RemisionSalida } from "../../types/database";

/** QR como SVG inline (la librería se carga bajo demanda: solo pesa cuando
 * alguien imprime o abre una remisión). */
export async function qrSvg(texto: string): Promise<string> {
  const QRCode = await import("qrcode");
  return QRCode.toString(texto, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}

export async function cargarRemision(id: string): Promise<{ remision: RemisionSalida; lineas: LineaRemision[] }> {
  const { data: remision, error } = await supabase.from("v_remisiones_salida").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!remision) throw new Error("Remisión no encontrada o sin permiso para verla.");
  const { data: movs, error: errMovs } = await supabase
    .from("movimientos_inventario")
    .select("cantidad, productos(nombre, sku, unidad_medida)")
    .eq("remision_id", id)
    .order("created_at");
  if (errMovs) throw errMovs;
  const lineas: LineaRemision[] = (movs ?? []).map((m: any) => ({
    nombre: m.productos?.nombre ?? "",
    sku: m.productos?.sku ?? "",
    unidad: m.productos?.unidad_medida ?? "",
    cantidad: Number(m.cantidad),
  }));
  return { remision: remision as RemisionSalida, lineas };
}

/** Abre la remisión lista para imprimir. Regresa false si el navegador
 * bloqueó la ventana. */
export async function imprimirRemision(id: string): Promise<boolean> {
  const { remision, lineas } = await cargarRemision(id);
  const url = urlRemision(window.location.origin, id);
  const svg = await qrSvg(url);
  return abrirParaImprimir(htmlRemision(remision, lineas, svg, url));
}
