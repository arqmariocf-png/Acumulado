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
