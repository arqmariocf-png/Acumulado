import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { abrirParaImprimir, abrirVentanaImpresion, cerrarVentanaImpresion } from "../../lib/imprimir";
import { htmlRequisicion, type LineaRequisicionDoc, type ModoRequisicionImpresa } from "../../lib/requisicionImpresa";
import { seguimientoLinea, type EventoLinea } from "../../lib/seguimientoLinea";

const ETIQUETA: Record<ModoRequisicionImpresa, string> = {
  requisicion: "Imprimir / PDF",
  entrega: "Hoja de entrega (almacén)",
};

const AYUDA: Record<ModoRequisicionImpresa, string> = {
  requisicion: "La requisición con sus renglones y firmas, para la cuadrilla",
  entrega: "Para revisar físicamente cada partida: en bodega, en camino, recibido en obra, por entregar y columnas para contar y firmar",
};

/** Abre la requisición imprimible (Mario, 15-oct-2026). La pestaña se abre
 * durante el clic (móvil) y el navegador la guarda como PDF. Lee todo de
 * nuevo para imprimir lo que hay en la base en este momento. */
export function BotonImprimirRequisicion({ requisicionId, modo, etiqueta, className }: { requisicionId: string; modo: ModoRequisicionImpresa; etiqueta?: string; className?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function abrir() {
    setError(null);
    setCargando(true);
    const ventana = abrirVentanaImpresion();
    try {
      const [req, lineas, eventos, entrega] = await Promise.all([
        supabase.from("requisiciones").select("folio, fecha, estado, comentario, solicitante_nombre, empresas(nombre, codigo, rfc), proyectos(nombre)").eq("id", requisicionId).maybeSingle(),
        supabase.from("requisicion_lineas").select("id, cantidad_solicitada, unidad_medida, descripcion, productos(nombre)").eq("requisicion_id", requisicionId).order("created_at"),
        supabase.from("requisicion_linea_eventos").select("id, requisicion_linea_id, tipo, cantidad, nota, created_by, created_by_nombre, created_at").eq("requisicion_id", requisicionId),
        supabase.from("v_requisicion_linea_entrega").select("requisicion_linea_id, comprado, oc_bodega, oc_obra").eq("requisicion_id", requisicionId),
      ]);
      if (req.error) throw req.error;
      if (!req.data) throw new Error("No tienes acceso a esta requisición.");
      if (lineas.error) throw lineas.error;
      if (eventos.error) throw eventos.error;
      const eventosPorLinea = new Map<string, EventoLinea[]>();
      for (const e of (eventos.data ?? []) as EventoLinea[]) eventosPorLinea.set(e.requisicion_linea_id, [...(eventosPorLinea.get(e.requisicion_linea_id) ?? []), e]);
      const extra = new Map(((entrega.data ?? []) as { requisicion_linea_id: string; comprado: number; oc_bodega: number; oc_obra: number }[]).map((x) => [x.requisicion_linea_id, { comprado: Number(x.comprado), ocBodega: Number(x.oc_bodega), ocObra: Number(x.oc_obra) }]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filas: LineaRequisicionDoc[] = ((lineas.data ?? []) as any[]).map((l) => {
        const solicitado = Number(l.cantidad_solicitada);
        const s = seguimientoLinea(solicitado, eventosPorLinea.get(l.id) ?? [], extra.get(l.id));
        return { descripcion: l.descripcion ?? l.productos?.nombre ?? "", unidad: l.unidad_medida ?? "", solicitado, pedido: s.pedido, enBodega: s.enBodega, enCamino: s.enTransito, enObra: s.entregado, porEntregar: s.porEntregar };
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = req.data as any;
      const codigo: string = r.empresas?.codigo ?? "";
      const impreso = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
      const html = htmlRequisicion(
        { folio: r.folio, fecha: r.fecha, empresa_nombre: r.empresas?.nombre ?? "", empresa_rfc: r.empresas?.rfc ?? null, proyecto: r.proyectos?.nombre ?? null, solicitante: r.solicitante_nombre ?? null, estado: r.estado ?? null, comentario: r.comentario ?? null, impreso },
        filas,
        modo,
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
      <button type="button" onClick={abrir} disabled={cargando} title={AYUDA[modo]} className={className ?? "rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"}>
        {cargando ? "Abriendo…" : etiqueta ?? ETIQUETA[modo]}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
