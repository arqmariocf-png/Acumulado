import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { moneda } from "../../lib/saldosEmpresas";

/** Compra en un solo paso desde el renglón de la requisición (Alma,
 * 28-sep-2026): cantidad, proveedor, costo, cotización y listo: se crea la
 * necesidad de compra y la orden RQ en la misma operación, y la orden le
 * llega a dirección para autorizar. */
export function CompraEnUnPaso({ lineaId, sinResolver, unidad, onListo, onCancelar }: { lineaId: string; sinResolver: number; unidad: string; onListo: (folio: string) => void; onCancelar: () => void }) {
  const queryClient = useQueryClient();
  const [cantidad, setCantidad] = useState(String(sinResolver));
  const [proveedor, setProveedor] = useState("");
  const [costo, setCosto] = useState("");
  const [conIva, setConIva] = useState(true);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [nota, setNota] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cant = Number(cantidad);
  const costoNum = Number(costo.replace(/[^0-9.]/g, ""));
  const total = cant > 0 && costoNum > 0 ? cant * costoNum * (conIva ? 1.16 : 1) : 0;

  const generar = useMutation({
    mutationFn: async () => {
      if (!(cant > 0) || cant > sinResolver + 0.001) throw new Error(`La cantidad debe ser mayor a 0 y hasta ${sinResolver} ${unidad}.`);
      if (!proveedor.trim()) throw new Error("Indica el proveedor.");
      if (!(costoNum >= 0)) throw new Error("El costo unitario no es válido.");
      const { data, error } = await supabase.rpc("fn_oc_desde_lineas", {
        p_lineas: [{ linea_id: lineaId, cantidad: cant, costo: costoNum }],
        p_proveedor: proveedor.trim(),
        p_fecha: fecha,
        p_iva: conIva,
        p_nota: nota.trim() || null,
      });
      if (error) throw error;
      const r = data as { id_orden: string; necesidad_ids: string[] };
      if (archivo && r.necesidad_ids?.[0]) {
        const { data: sessionData } = await supabase.auth.getSession();
        const fd = new FormData();
        fd.append("necesidadId", r.necesidad_ids[0]);
        fd.append("file", archivo, archivo.name);
        const respuesta = await fetch(urlFuncion("requisiciones-cotizacion"), { method: "POST", headers: { Authorization: `Bearer ${sessionData.session?.access_token}` }, body: fd });
        if (!respuesta.ok) {
          const json = await respuesta.json().catch(() => null);
          throw new Error(`La orden ${r.id_orden} se generó, pero la cotización no se pudo adjuntar: ${(await errorDeFuncion(respuesta, json)).message}`);
        }
      }
      return r;
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["avance-resolucion-linea"] });
      queryClient.invalidateQueries({ queryKey: ["requisicion-lineas-pendientes"] });
      queryClient.invalidateQueries({ queryKey: ["necesidades-compra-pendientes"] });
      queryClient.invalidateQueries({ queryKey: ["oc-desde-requisicion"] });
      onListo(r.id_orden);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        generar.mutate();
      }}
      className="mt-3 border-t border-slate-100 pt-3"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Comprar en un paso</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Cantidad ({unidad})</label>
          <input type="number" min="0.001" step="0.001" max={sinResolver} value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="w-28 rounded border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Proveedor</label>
          <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Razón social" required className="w-56 rounded border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Costo unitario (sin IVA)</label>
          <input value={costo} onChange={(e) => setCosto(e.target.value)} inputMode="decimal" placeholder="0.00" required className="w-28 rounded border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-slate-600">
          <input type="checkbox" checked={conIva} onChange={(e) => setConIva(e.target.checked)} /> con IVA
        </label>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Cotización (PDF o foto)</label>
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} className="text-xs" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Nota</label>
          <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="vigencia, condiciones" className="w-40 rounded border border-slate-300 px-2 py-1 text-sm" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={generar.isPending} className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {generar.isPending ? "Generando…" : "Generar orden de compra RQ"}
        </button>
        <button type="button" onClick={onCancelar} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
          Cancelar
        </button>
        {total > 0 && (
          <span className="text-sm text-slate-600">
            Total {conIva ? "con IVA" : "sin IVA"}: <b>{moneda(total)}</b>
          </span>
        )}
        <span className="text-xs text-slate-400">La orden le llega a dirección para autorizar y programar el pago.</span>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </form>
  );
}
