import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { abrirVentanaImpresion } from "../../lib/imprimir";
import { botonPrimario, botonSecundario, dinero, fechaHora, imprimirTicket, type LineaVenta, type VentaPv } from "./datos";

// Despacho en almacén (Mario, 10-oct-2026: "código de barras … para entregar
// al cliente"): se escanea el ticket, se ve qué falta por entregar y se marca
// entregado todo o por partida.

export function Despachar({ empresaId }: { empresaId: string }) {
  const queryClient = useQueryClient();
  const [codigo, setCodigo] = useState("");
  const [ventaId, setVentaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: pendientes = [] } = useQuery({
    queryKey: ["pv-ventas", "por-entregar", empresaId],
    queryFn: async () => {
      let q = supabase.from("v_pv_ventas").select("*").neq("estado", "cancelada").neq("entrega", "entregada").order("fecha", { ascending: false }).limit(100);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data, error: e } = await q;
      if (e) throw e;
      return (data ?? []) as VentaPv[];
    },
  });

  async function buscar() {
    setError(null);
    const folio = codigo.trim().toUpperCase();
    if (!folio) return;
    const { data, error: e } = await supabase.from("pv_ventas").select("id").eq("folio", folio).limit(1).maybeSingle();
    if (e) setError(e.message);
    else if (!data) setError(`No se encontró el ticket ${folio}.`);
    else setVentaId(data.id as string);
    setCodigo("");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <input
          autoFocus
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              buscar();
            }
          }}
          placeholder="Escanea el código de barras del ticket (PV-…)"
          className="w-full rounded-lg border-2 border-slate-300 px-3 py-2.5 text-base focus:border-slate-900 focus:outline-none"
        />
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <h3 className="mb-1 mt-4 text-xs font-semibold uppercase text-slate-500">Por entregar ({pendientes.length})</h3>
        <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
          {pendientes.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => setVentaId(v.id)} className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${ventaId === v.id ? "bg-sky-50" : ""}`}>
                <span>
                  <span className="font-medium">{v.folio}</span> · {v.cliente_nombre}
                  <span className="block text-xs text-slate-500">
                    {fechaHora(v.fecha)} · {Number(v.por_entregar).toLocaleString("es-MX")} pzas por entregar {v.entrega === "parcial" ? "(parcial)" : ""}
                  </span>
                </span>
                <span className="text-slate-700">{dinero(v.total)}</span>
              </button>
            </li>
          ))}
          {pendientes.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-400">Nada pendiente de entregar.</li>}
        </ul>
      </div>
      {ventaId && <DetalleDespacho ventaId={ventaId} onListo={() => queryClient.invalidateQueries({ queryKey: ["pv-ventas"] })} />}
    </div>
  );
}

function DetalleDespacho({ ventaId, onListo }: { ventaId: string; onListo: () => void }) {
  const queryClient = useQueryClient();
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["pv-venta", ventaId],
    queryFn: async () => {
      const [v, l] = await Promise.all([
        supabase.from("v_pv_ventas").select("*").eq("id", ventaId).single(),
        supabase.from("pv_venta_lineas").select("id, descripcion, sku, unidad, cantidad, precio_unitario, descuento_pct, entregado").eq("venta_id", ventaId).order("orden"),
      ]);
      if (v.error) throw v.error;
      if (l.error) throw l.error;
      return { venta: v.data as VentaPv, lineas: (l.data ?? []) as LineaVenta[] };
    },
  });
  const entregar = useMutation({
    mutationFn: async (todo: boolean) => {
      const lineas = todo ? null : Object.entries(cantidades).filter(([, c]) => Number(c) > 0).map(([linea_id, c]) => ({ linea_id, cantidad: Number(c) }));
      const { error: e } = await supabase.rpc("fn_pv_entregar", { p_venta: ventaId, p_lineas: lineas });
      if (e) throw e;
    },
    onSuccess: () => {
      setCantidades({});
      queryClient.invalidateQueries({ queryKey: ["pv-venta", ventaId] });
      onListo();
    },
    onError: (e) => setError((e as Error).message),
  });
  if (!data) return <p className="text-sm text-slate-500">Cargando ticket…</p>;
  const { venta, lineas } = data;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold">{venta.folio}</p>
          <p className="text-xs text-slate-500">
            {fechaHora(venta.fecha)} · {venta.cliente_nombre} · {dinero(venta.total)} · {venta.estado === "credito" ? "a crédito" : venta.estado}
          </p>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${venta.entrega === "entregada" ? "bg-emerald-100 text-emerald-800" : venta.entrega === "parcial" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{venta.entrega}</span>
      </div>
      {venta.estado === "cancelada" && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-sm text-red-700">Venta cancelada: no se entrega.</p>}
      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="py-1">Producto</th>
            <th className="py-1 text-right">Vendido</th>
            <th className="py-1 text-right">Entregado</th>
            <th className="py-1 text-right">Entregar ahora</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            const falta = Math.max(Number(l.cantidad) - Number(l.entregado), 0);
            return (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-1">
                  {l.descripcion}
                  {l.sku && <span className="text-xs text-slate-400"> · {l.sku}</span>}
                </td>
                <td className="py-1 text-right">
                  {Number(l.cantidad).toLocaleString("es-MX")} {l.unidad ?? ""}
                </td>
                <td className="py-1 text-right">{Number(l.entregado).toLocaleString("es-MX")}</td>
                <td className="py-1 text-right">
                  {falta > 0 && venta.estado !== "cancelada" ? (
                    <input type="number" min="0" max={falta} step="any" value={cantidades[l.id] ?? ""} placeholder={String(falta)} onChange={(e) => setCantidades((c) => ({ ...c, [l.id]: e.target.value }))} className="w-20 rounded border px-1 py-0.5 text-right" />
                  ) : (
                    <span className="text-xs text-emerald-700">✓</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {venta.estado !== "cancelada" && venta.entrega !== "entregada" && (
          <>
            <button type="button" disabled={entregar.isPending} onClick={() => entregar.mutate(true)} className={botonPrimario}>
              Entregar todo
            </button>
            <button type="button" disabled={entregar.isPending || !Object.values(cantidades).some((c) => Number(c) > 0)} onClick={() => entregar.mutate(false)} className={botonSecundario}>
              Entregar solo lo capturado
            </button>
          </>
        )}
        <button type="button" onClick={() => imprimirTicket(ventaId, abrirVentanaImpresion())} className={botonSecundario}>
          Reimprimir ticket
        </button>
      </div>
    </div>
  );
}
