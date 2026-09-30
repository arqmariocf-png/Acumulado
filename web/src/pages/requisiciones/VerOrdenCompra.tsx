import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { abrirParaImprimir, abrirVentanaImpresion, cerrarVentanaImpresion } from "../../lib/imprimir";
import { htmlOrdenCompra, type LineaOrdenCompra } from "../../lib/ordenCompraRq";

/** Abre la orden de compra RQ imprimible en una pestaña (almacén, dirección
 * o quien pueda ver la OC). La pestaña se abre durante el clic (móvil). */
export function BotonVerOc({ ocId, etiqueta = "Ver orden", className }: { ocId: string; etiqueta?: string; className?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function abrir() {
    setError(null);
    setCargando(true);
    const ventana = abrirVentanaImpresion();
    try {
      const { data: oc, error: errOc } = await supabase
        .from("ordenes_compra")
        .select("id, id_orden, fecha_creacion, proveedor, proyecto, autorizada_en, empresas(nombre, codigo, rfc), creador:profiles!ordenes_compra_creada_por_fkey(nombre), autorizador:profiles!ordenes_compra_autorizada_por_fkey(nombre)")
        .eq("id", ocId)
        .maybeSingle();
      if (errOc) throw errOc;
      if (!oc) throw new Error("No tienes acceso a esta orden de compra.");
      const { data: lineas, error: errLineas } = await supabase.from("ordenes_compra_lineas").select("item, unidad, cantidad, costo, iva, clave").eq("orden_compra_id", ocId).order("numero");
      if (errLineas) throw errLineas;
      // Requisición y nota: por la necesidad de compra de la primera partida.
      let folio: number | null = null;
      let solicitante: string | null = null;
      let nota: string | null = null;
      const claves = (lineas ?? []).map((l) => l.clave).filter(Boolean);
      if (claves.length > 0) {
        const { data: nec } = await supabase.from("necesidades_compra").select("cotizacion_nota, requisicion_lineas(requisiciones(folio, solicitante_nombre))").in("id", claves).limit(1).maybeSingle();
        const req = (nec as { requisicion_lineas?: { requisiciones?: { folio?: number; solicitante_nombre?: string | null } } } | null)?.requisicion_lineas?.requisiciones;
        folio = req?.folio ?? null;
        solicitante = req?.solicitante_nombre ?? null;
        nota = (nec as { cotizacion_nota?: string | null } | null)?.cotizacion_nota ?? null;
      }
      // Forma de pago y datos bancarios del proveedor (Laura, 29-sep-2026).
      const { data: pago } = await supabase.from("v_oc_pagos").select("condicion_pago, tipo_pago_backoffice, banco_proveedor, clabe, cuenta_proveedor, beneficiario_bancario, proveedor_clave, fuente, autorizacion, autorizacion_origen").eq("id", ocId).maybeSingle();
      // RFC del proveedor e importes (el total del backoffice ya trae IVA).
      const [{ data: bancarios }, { data: importes }] = await Promise.all([
        pago?.proveedor_clave ? supabase.from("proveedores_datos_bancarios").select("rfc").eq("clave", pago.proveedor_clave).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("v_oc_importes").select("subtotal, iva, total").eq("orden_compra_id", ocId).maybeSingle(),
      ]);
      const preciosConIva = pago?.fuente === "api";
      const formaPago = [pago?.condicion_pago ? ({ contado: "Contado", credito: "Crédito", anticipo: "Anticipo", efectivo: "Efectivo" } as Record<string, string>)[pago.condicion_pago] : null, pago?.tipo_pago_backoffice].filter(Boolean).join(" · ") || null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = oc as any;
      const codigo: string = o.empresas?.codigo ?? "";
      const html = htmlOrdenCompra(
        {
          id_orden: o.id_orden,
          fecha: o.fecha_creacion,
          empresa_nombre: o.empresas?.nombre ?? "",
          empresa_rfc: o.empresas?.rfc ?? null,
          empresa_codigo: codigo,
          proveedor: o.proveedor,
          proyecto: o.proyecto,
          requisicion_folio: folio,
          solicitante,
          creada_por: o.creador?.nombre ?? null,
          autorizada_en: o.autorizada_en,
          autorizada_por: o.autorizador?.nombre ?? null,
          nota,
          forma_pago: formaPago,
          banco: pago?.banco_proveedor ?? null,
          clabe: pago?.clabe ?? null,
          cuenta: pago?.cuenta_proveedor ?? null,
          beneficiario: pago?.beneficiario_bancario ?? null,
          rfc_proveedor: (bancarios as { rfc?: string | null } | null)?.rfc ?? null,
          precios_con_iva: preciosConIva,
          autorizada_backoffice: preciosConIva && pago?.autorizacion === "autorizada",
          autorizacion_interna: preciosConIva && pago?.autorizacion_origen === "interna",
          importes: preciosConIva && importes ? { subtotal: Number(importes.subtotal), iva: Number(importes.iva), total: Number(importes.total) } : null,
        },
        (lineas ?? []) as LineaOrdenCompra[],
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
      <button type="button" onClick={abrir} disabled={cargando} className={className ?? "rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"}>
        {cargando ? "Abriendo…" : etiqueta}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
