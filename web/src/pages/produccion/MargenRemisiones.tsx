import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

interface MargenRemision {
  remision_id: string;
  folio: string;
  fecha: string;
  contraparte: string;
  estatus: string;
  condicion_pago: "contado" | "credito" | null;
  dias_credito: number | null;
  partidas: number;
  sin_precio: number;
  venta: number;
  costo: number;
  margen: number | null;
}

interface Partida {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number | null;
  costo_unitario: number | null;
}

const $ = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN" }));

/** Margen cerrado por entrega (Mario, 30-sep-2026): precio de venta contra el
 * costo real del producto terminado (promedio ponderado de los lotes) al
 * emitir la remisión. Solo finanzas y dirección. */
export function MargenRemisiones({ empresaId }: { empresaId: string }) {
  const { perfil } = useAuth();
  const ve = !!perfil && ["admin", "corporativo", "direccion"].includes(perfil.rol);
  const [abierta, setAbierta] = useState<string | null>(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ["margen-remisiones", empresaId],
    enabled: ve,
    queryFn: async () => {
      const { data: d, error } = await supabase.from("v_margen_remisiones_produccion").select("*").eq("empresa_id", empresaId).order("fecha", { ascending: false }).limit(200);
      if (error) throw error;
      return d as MargenRemision[];
    },
  });
  if (!ve) return null;

  const conPrecio = data.filter((r) => r.margen != null);
  const venta = conPrecio.reduce((s, r) => s + Number(r.venta), 0);
  const margen = conPrecio.reduce((s, r) => s + Number(r.margen), 0);

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Margen por entrega (remisiones de salida)</h2>
      <p className="mb-2 text-xs text-slate-500">
        Precio de venta sin IVA contra el costo real del producto al emitir. Con precio: venta {$(venta)} · margen {$(margen)}
        {venta ? ` (${((margen / venta) * 100).toFixed(1)} %)` : ""}. {data.filter((r) => r.sin_precio > 0).length} remisiones con partidas sin precio.
      </p>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Remisión</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Pago</th>
              <th className="px-3 py-2 text-right">Venta</th>
              <th className="px-3 py-2 text-right">Costo real</th>
              <th className="px-3 py-2 text-right">Margen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <FilaRemision key={r.remision_id} r={r} abierta={abierta === r.remision_id} onAbrir={() => setAbierta(abierta === r.remision_id ? null : r.remision_id)} empresaId={empresaId} />
            ))}
            {!isLoading && data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-slate-400">
                  Sin remisiones de salida todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilaRemision({ r, abierta, onAbrir, empresaId }: { r: MargenRemision; abierta: boolean; onAbrir: () => void; empresaId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data: partidas = [] } = useQuery({
    queryKey: ["margen-remision-partidas", r.remision_id],
    enabled: abierta,
    queryFn: async () => {
      const { data, error: e } = await supabase.from("remisiones_produccion_lineas").select("id, descripcion, cantidad, unidad, precio_unitario, costo_unitario").eq("remision_id", r.remision_id).order("orden");
      if (e) throw e;
      return data as Partida[];
    },
  });
  const guardar = useMutation({
    mutationFn: async ({ id, precio }: { id: string; precio: number | null }) => {
      const { error: e } = await supabase.from("remisiones_produccion_lineas").update({ precio_unitario: precio }).eq("id", id);
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["margen-remisiones", empresaId] });
      queryClient.invalidateQueries({ queryKey: ["margen-remision-partidas", r.remision_id] });
    },
    onError: (e) => setError((e as Error).message),
  });
  const pct = r.margen != null && Number(r.venta) ? ((Number(r.margen) / Number(r.venta)) * 100).toFixed(1) + " %" : "";
  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-3 py-2">
          <span className="font-mono">{r.folio}</span> <span className="text-xs text-slate-500">{r.fecha}</span>
        </td>
        <td className="px-3 py-2">{r.contraparte}</td>
        <td className="px-3 py-2 text-xs">{r.condicion_pago === "credito" ? `Crédito${r.dias_credito ? ` ${r.dias_credito} d` : ""}` : r.condicion_pago === "contado" ? "Contado" : "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums">{r.sin_precio === r.partidas ? "—" : $(r.venta)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{$(r.costo)}</td>
        <td className={`px-3 py-2 text-right tabular-nums ${r.margen != null && r.margen < 0 ? "text-red-700" : "text-emerald-700"}`}>
          {r.margen != null ? `${$(r.margen)} ${pct}` : "falta precio"}
          {r.sin_precio > 0 && r.margen != null && <div className="text-[10px] text-amber-700">{r.sin_precio} partida(s) sin precio</div>}
        </td>
        <td className="px-3 py-2 text-right">
          <button type="button" onClick={onAbrir} className="text-xs text-slate-600 underline">
            {abierta ? "cerrar" : r.sin_precio > 0 ? "capturar precio" : "ver partidas"}
          </button>
        </td>
      </tr>
      {abierta && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-3 py-2">
            <table className="w-full text-xs">
              <thead className="text-left uppercase text-slate-400">
                <tr>
                  <th className="py-1">Partida</th>
                  <th className="py-1 text-right">Cantidad</th>
                  <th className="py-1 text-right">Costo real</th>
                  <th className="py-1 text-right">Precio s/IVA</th>
                  <th className="py-1 text-right">Margen</th>
                </tr>
              </thead>
              <tbody>
                {partidas.map((p) => {
                  const m = p.precio_unitario != null && p.costo_unitario != null ? (Number(p.precio_unitario) - Number(p.costo_unitario)) * Number(p.cantidad) : null;
                  return (
                    <tr key={p.id} className="border-t border-slate-200">
                      <td className="py-1">{p.descripcion}</td>
                      <td className="py-1 text-right tabular-nums">
                        {Number(p.cantidad).toLocaleString("es-MX")} {p.unidad}
                      </td>
                      <td className="py-1 text-right tabular-nums">{$(p.costo_unitario)}</td>
                      <td className="py-1 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={p.precio_unitario ?? ""}
                          onBlur={(e) => {
                            const v = e.target.value === "" ? null : Number(e.target.value);
                            if (v !== (p.precio_unitario == null ? null : Number(p.precio_unitario))) guardar.mutate({ id: p.id, precio: v });
                          }}
                          className="w-28 rounded border border-slate-300 px-2 py-0.5 text-right"
                          aria-label="Precio de venta"
                        />
                      </td>
                      <td className={`py-1 text-right tabular-nums ${m != null && m < 0 ? "text-red-700" : ""}`}>{m == null ? "—" : $(m)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
