import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sincronizarCatalogoOcOv, textoResultadoSincronizacion } from "../lib/sincronizarOcOv";

/** Pide al backoffice las OC/OV autorizadas y espera el resultado (corre
 * en segundo plano, 1-2 min). Se usa en Finanzas → Programación de pagos
 * (Laura, 29-sep-2026) y donde haga falta el catálogo al día. */
export function BotonSincronizarOcOv({ queryKeys = [], className }: { queryKeys?: string[][]; className?: string }) {
  const queryClient = useQueryClient();
  const [corriendo, setCorriendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function sincronizar() {
    setAviso(null);
    setCorriendo(true);
    try {
      const res = await sincronizarCatalogoOcOv();
      for (const k of [["oc-pagos"], ["ordenes-para-match"], ["cxp-proveedores"], ...queryKeys]) queryClient.invalidateQueries({ queryKey: k });
      setAviso(textoResultadoSincronizacion(res));
    } catch (err) {
      setAviso(`No se pudo actualizar: ${(err as Error).message}`);
    } finally {
      setCorriendo(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={sincronizar} disabled={corriendo} className={className ?? "rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"} title="Trae del backoffice las OC y OV autorizadas (tarda 1-2 minutos)">
        {corriendo ? "Actualizando OC/OV…" : "Actualizar OC/OV"}
      </button>
      {aviso && <span className={`text-xs ${aviso.startsWith("No se pudo") ? "text-red-600" : "text-emerald-700"}`}>{aviso}</span>}
    </span>
  );
}
