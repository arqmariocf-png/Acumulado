import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { abrirParaImprimir, abrirVentanaImpresion, cerrarVentanaImpresion } from "../../lib/imprimir";
import { htmlOrdenCompra, type LineaOrdenCompra } from "../../lib/ordenCompraRq";

/** Orden de venta imprimible (mismo formato que la OC, con cliente y sin
 * sello de autorización). La pestaña se abre durante el clic (móvil). */
export function BotonVerOv({ ovId, etiqueta = "Ver orden" }: { ovId: string; etiqueta?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function abrir() {
    setError(null);
    setCargando(true);
    const ventana = abrirVentanaImpresion();
    try {
      const { data: ov, error: e1 } = await supabase
        .from("ordenes_venta")
        .select("id, id_ov, fecha_ov, cliente, proyecto, total, subtotal, iva, notas, forma_pago, condicion_pago, fecha_entrega, lugar_entrega, cancelada_en, cancelacion_motivo, creada_por, empresas(nombre, codigo, rfc)")
        .eq("id", ovId)
        .maybeSingle();
      if (e1) throw e1;
      if (!ov) throw new Error("No tienes acceso a esta orden de venta.");
      const { data: lineas, error: e2 } = await supabase.from("ordenes_venta_lineas").select("concepto, unidad, cantidad, precio_base, iva").eq("orden_venta_id", ovId).order("numero");
      if (e2) throw e2;
      const { data: autor } = ov.creada_por ? await supabase.from("v_directorio").select("nombre").eq("id", ov.creada_por).maybeSingle() : { data: null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = ov as any;
      const codigo: string = o.empresas?.codigo ?? "";
      const condicion = o.condicion_pago ? ({ contado: "Contado", credito: "Crédito", anticipo: "Anticipo", efectivo: "Efectivo" } as Record<string, string>)[o.condicion_pago] : null;
      const html = htmlOrdenCompra(
        {
          id_orden: o.id_ov,
          fecha: o.fecha_ov,
          empresa_nombre: o.empresas?.nombre ?? "",
          empresa_rfc: o.empresas?.rfc ?? null,
          empresa_codigo: codigo,
          proveedor: o.cliente,
          proyecto: o.proyecto,
          requisicion_folio: null,
          solicitante: null,
          creada_por: (autor as { nombre?: string } | null)?.nombre ?? null,
          autorizada_en: null,
          autorizada_por: null,
          nota: [o.cancelada_en ? `CANCELADA: ${o.cancelacion_motivo ?? ""}` : null, o.notas].filter(Boolean).join(" · ") || null,
          forma_pago: [condicion, o.forma_pago].filter(Boolean).join(" · ") || null,
          titulo: "ORDEN DE VENTA",
          etiqueta_contraparte: "Cliente",
          sin_autorizacion: true,
          entrega: [o.fecha_entrega, o.lugar_entrega].filter(Boolean).join(" · ") || null,
          importes: o.subtotal != null ? { subtotal: Number(o.subtotal), iva: Number(o.iva ?? 0), total: Number(o.total ?? 0) } : null,
        },
        (lineas ?? []).map((l) => ({ item: l.concepto, unidad: l.unidad, cantidad: l.cantidad, costo: l.precio_base, iva: l.iva ?? true })) as LineaOrdenCompra[],
        codigo ? `${window.location.origin}/logos/${codigo.toLowerCase()}.png` : null,
      );
      if (!abrirParaImprimir(html, ventana)) setError("El navegador bloqueó la ventana. Permite ventanas emergentes.");
    } catch (e) {
      cerrarVentanaImpresion(ventana);
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={abrir} disabled={cargando} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50">
        {cargando ? "Abriendo…" : etiqueta}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
