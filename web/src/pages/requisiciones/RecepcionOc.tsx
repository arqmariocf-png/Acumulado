import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";

interface LineaRecepcion {
  orden_compra_linea_id: string;
  numero: number | null;
  item: string;
  unidad: string | null;
  cantidad: number | null;
  recibido: number;
  pendiente: number;
  estado: "sin_recibir" | "parcial" | "completo";
  ultima_recepcion: string | null;
}

const ESTADO: Record<LineaRecepcion["estado"], [string, string]> = {
  sin_recibir: ["sin recibir", "bg-slate-100 text-slate-600"],
  parcial: ["parcial", "bg-amber-100 text-amber-800"],
  completo: ["completo", "bg-emerald-100 text-emerald-800"],
};

/** Partidas de una OC RQ con lo recibido; almacén confirma cantidades
 * (Mario, 29-sep-2026). Al completar todas las partidas la requisición
 * pasa a 'recibida' sola (trigger oc_recepciones_avanza_requisicion). */
export function RecepcionOc({ ocId, puedeRecibir, onCambio }: { ocId: string; puedeRecibir: boolean; onCambio: () => void }) {
  const queryClient = useQueryClient();
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["oc-recepcion", ocId],
    queryFn: async () => {
      const { data: filas, error: err } = await supabase.from("v_oc_rq_recepcion").select("*").eq("orden_compra_id", ocId).order("numero");
      if (err) throw err;
      return (filas ?? []) as LineaRecepcion[];
    },
  });

  const recibir = useMutation({
    mutationFn: async (l: LineaRecepcion) => {
      const cantidad = Number(cantidades[l.orden_compra_linea_id] ?? l.pendiente);
      if (!(cantidad > 0)) throw new Error("La cantidad recibida debe ser mayor a 0.");
      if (cantidad > Number(l.pendiente) + 0.001) throw new Error(`Solo faltan ${l.pendiente} ${l.unidad ?? ""} de esta partida.`);
      const { data: sesion } = await supabase.auth.getSession();
      const { error: err } = await supabase.from("oc_recepciones").insert({ orden_compra_linea_id: l.orden_compra_linea_id, cantidad, recibido_por: sesion.session?.user.id });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["oc-recepcion", ocId] });
      onCambio();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading) return <p className="text-xs text-slate-400">Cargando partidas…</p>;
  if (!data || data.length === 0) return <p className="text-xs text-slate-400">Esta orden no tiene partidas.</p>;

  return (
    <div className="mt-1 rounded border border-slate-200 bg-white p-2">
      <table className="w-full text-xs">
        <thead className="text-left uppercase text-slate-400">
          <tr>
            <th className="py-1 pr-2">Partida</th>
            <th className="py-1 pr-2 text-right">Pedido</th>
            <th className="py-1 pr-2 text-right">Recibido</th>
            <th className="py-1 pr-2 text-right">Falta</th>
            <th className="py-1 pr-2">Estado</th>
            {puedeRecibir && <th className="py-1" />}
          </tr>
        </thead>
        <tbody>
          {data.map((l) => {
            const [etiqueta, clase] = ESTADO[l.estado];
            return (
              <tr key={l.orden_compra_linea_id} className="border-t border-slate-100">
                <td className="py-1 pr-2 text-slate-800">{l.item}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {l.cantidad ?? "—"} {l.unidad ?? ""}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{l.recibido}</td>
                <td className="py-1 pr-2 text-right tabular-nums font-medium">{l.pendiente}</td>
                <td className="py-1 pr-2">
                  <span className={`rounded-full px-2 py-0.5 ${clase}`}>{etiqueta}</span>
                  {l.ultima_recepcion && <span className="ml-1 text-slate-400">{l.ultima_recepcion}</span>}
                </td>
                {puedeRecibir && (
                  <td className="py-1 text-right">
                    {Number(l.pendiente) > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <input type="number" min="0.001" step="0.001" max={l.pendiente} value={cantidades[l.orden_compra_linea_id] ?? String(l.pendiente)} onChange={(e) => setCantidades((prev) => ({ ...prev, [l.orden_compra_linea_id]: e.target.value }))} className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right text-xs" aria-label="Cantidad recibida" />
                        <button type="button" onClick={() => recibir.mutate(l)} disabled={recibir.isPending} className="rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50">
                          Recibí
                        </button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {puedeRecibir && <p className="mt-1 text-[11px] text-slate-400">Confirma lo que llega por partida. Con todas completas, la requisición queda como recibida.</p>}
    </div>
  );
}
