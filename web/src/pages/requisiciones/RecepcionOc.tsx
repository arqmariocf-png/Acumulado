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

export type LugarRecepcion = "bodega" | "obra";

const ESTADO: Record<LineaRecepcion["estado"], [string, string]> = {
  sin_recibir: ["sin recibir", "bg-slate-100 text-slate-600"],
  parcial: ["parcial", "bg-amber-100 text-amber-800"],
  completo: ["completo", "bg-emerald-100 text-emerald-800"],
};

/** Partidas de una OC con lo recibido (confirmaciones + entradas de
 * inventario); almacén u obra confirma cantidades y lugar (Mario,
 * 29-sep-2026). Con todas las partidas completas la requisición ligada pasa
 * a 'recibida' sola. "Recibir todo" cierra la OC de un clic. */
export function RecepcionOc({ ocId, puedeRecibir, onCambio }: { ocId: string; puedeRecibir: boolean; onCambio: () => void }) {
  const queryClient = useQueryClient();
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [lugar, setLugar] = useState<LugarRecepcion>("bodega");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["oc-recepcion", ocId],
    queryFn: async () => {
      const { data: filas, error: err } = await supabase.from("v_oc_recepcion").select("*").eq("orden_compra_id", ocId).order("numero");
      if (err) throw err;
      return (filas ?? []) as LineaRecepcion[];
    },
  });

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ["oc-recepcion", ocId] });
    queryClient.invalidateQueries({ queryKey: ["oc-por-recibir"] });
    queryClient.invalidateQueries({ queryKey: ["oc-pagos"] });
    onCambio();
  };

  const recibir = useMutation({
    mutationFn: async (l: LineaRecepcion) => {
      const cantidad = Number(cantidades[l.orden_compra_linea_id] ?? l.pendiente);
      if (!(cantidad > 0)) throw new Error("La cantidad recibida debe ser mayor a 0.");
      if (cantidad > Number(l.pendiente) + 0.001) throw new Error(`Solo faltan ${l.pendiente} ${l.unidad ?? ""} de esta partida.`);
      const { data: sesion } = await supabase.auth.getSession();
      const { error: err } = await supabase.from("oc_recepciones").insert({ orden_compra_linea_id: l.orden_compra_linea_id, cantidad, lugar, recibido_por: sesion.session?.user.id });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      refrescar();
    },
    onError: (e: Error) => setError(e.message),
  });

  const recibirTodo = useMutation({
    mutationFn: async () => {
      if (!window.confirm(`¿Confirmar que llegó TODO lo que falta de esta orden en ${lugar}?`)) return false;
      const { error: err } = await supabase.rpc("fn_oc_marcar_recibida", { p_oc_id: ocId, p_lugar: lugar, p_nota: null });
      if (err) throw err;
      return true;
    },
    onSuccess: (hecho) => {
      if (!hecho) return;
      setError(null);
      refrescar();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading) return <p className="text-xs text-slate-400">Cargando partidas…</p>;
  const lineas = data ?? [];
  const faltan = lineas.filter((l) => Number(l.pendiente) > 0).length;

  return (
    <div className="mt-1 rounded border border-slate-200 bg-white p-2">
      {puedeRecibir && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">Se recibe en</span>
          <select value={lugar} onChange={(e) => setLugar(e.target.value as LugarRecepcion)} className="rounded border border-slate-300 px-1.5 py-0.5 text-xs">
            <option value="bodega">bodega / almacén</option>
            <option value="obra">obra</option>
          </select>
          {faltan > 0 && (
            <button type="button" onClick={() => recibirTodo.mutate()} disabled={recibirTodo.isPending} className="ml-auto rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
              Recibir todo lo que falta
            </button>
          )}
        </div>
      )}
      {lineas.length === 0 ? (
        <p className="text-xs text-slate-400">
          Esta orden no trae partidas.{" "}
          {puedeRecibir && (
            <button type="button" onClick={() => recibirTodo.mutate()} disabled={recibirTodo.isPending} className="text-emerald-700 underline disabled:opacity-50">
              Marcar recibida completa
            </button>
          )}
        </p>
      ) : (
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
            {lineas.map((l) => {
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
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {puedeRecibir && lineas.length > 0 && <p className="mt-1 text-[11px] text-slate-400">Confirma lo que llega por partida. Con todas completas, la orden (y su requisición) quedan como recibidas.</p>}
    </div>
  );
}
