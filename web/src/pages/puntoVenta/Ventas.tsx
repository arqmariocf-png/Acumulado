import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { abrirVentanaImpresion } from "../../lib/imprimir";
import { dinero, fechaHora, imprimirTicket, type VentaPv } from "./datos";

function hoyMx() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

export function Ventas({ empresaId, supervisa }: { empresaId: string; supervisa: boolean }) {
  const queryClient = useQueryClient();
  const [dia, setDia] = useState(hoyMx());
  const [soloFactura, setSoloFactura] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: ventas = [] } = useQuery({
    queryKey: ["pv-ventas", "dia", empresaId, dia, soloFactura],
    queryFn: async () => {
      let q = supabase.from("v_pv_ventas").select("*").order("fecha", { ascending: false });
      if (empresaId) q = q.eq("empresa_id", empresaId);
      if (soloFactura) q = q.eq("requiere_factura", true).is("factura_folio", null).neq("estado", "cancelada");
      else q = q.gte("fecha", `${dia}T00:00:00-06:00`).lt("fecha", `${dia}T23:59:59.999-06:00`);
      const { data, error: e } = await q.limit(500);
      if (e) throw e;
      return (data ?? []) as VentaPv[];
    },
  });
  const cancelar = useMutation({
    mutationFn: async (v: VentaPv) => {
      const motivo = window.prompt(`Motivo para cancelar ${v.folio} (regresa el material al inventario):`);
      if (!motivo) return;
      const { error: e } = await supabase.rpc("fn_pv_cancelar", { p_venta: v.id, p_motivo: motivo });
      if (e) throw e;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pv-ventas"] }),
    onError: (e) => setError((e as Error).message),
  });
  const facturar = useMutation({
    mutationFn: async (v: VentaPv) => {
      const folio = window.prompt(`Folio de la factura de ${v.folio}:`, v.factura_folio ?? "");
      if (folio == null) return;
      const { error: e } = await supabase.rpc("fn_pv_marcar_facturada", { p_venta: v.id, p_factura: folio });
      if (e) throw e;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pv-ventas"] }),
    onError: (e) => setError((e as Error).message),
  });
  const vivas = ventas.filter((v) => v.estado !== "cancelada");
  const suma = (k: keyof VentaPv) => vivas.reduce((s, v) => s + Number(v[k] ?? 0), 0);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        {!soloFactura && <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={soloFactura} onChange={(e) => setSoloFactura(e.target.checked)} />
          Solo las que piden factura y no se han facturado
        </label>
        <span className="ml-auto text-slate-600">
          {vivas.length} ventas · <b>{dinero(suma("total"))}</b> · utilidad {dinero(suma("utilidad"))} · crédito {dinero(suma("a_credito"))}
        </span>
      </div>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Ticket</th>
              <th className="px-3 py-2">Hora</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Pago</th>
              <th className="px-3 py-2">Entrega</th>
              <th className="px-3 py-2">Factura</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.id} className={`border-t border-slate-100 ${v.estado === "cancelada" ? "text-slate-400 line-through" : ""}`}>
                <td className="px-3 py-1.5 font-medium">{v.folio}</td>
                <td className="px-3 py-1.5">{fechaHora(v.fecha)}</td>
                <td className="px-3 py-1.5">{v.cliente_nombre}</td>
                <td className="px-3 py-1.5 text-right">{dinero(v.total)}</td>
                <td className="px-3 py-1.5 text-xs">
                  {[v.efectivo > 0 && "efectivo", v.tarjeta > 0 && "tarjeta", v.transferencia > 0 && "transferencia", v.a_credito > 0 && "crédito"].filter(Boolean).join(" + ")}
                </td>
                <td className="px-3 py-1.5 text-xs">{v.entrega}</td>
                <td className="px-3 py-1.5 text-xs">{v.requiere_factura ? v.factura_folio ?? <span className="text-amber-700">por facturar</span> : "—"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs">
                  <button type="button" onClick={() => imprimirTicket(v.id, abrirVentanaImpresion())} className="text-sky-700 hover:underline">
                    ticket
                  </button>
                  {v.requiere_factura && v.estado !== "cancelada" && (
                    <button type="button" onClick={() => facturar.mutate(v)} className="ml-2 text-slate-700 hover:underline">
                      factura
                    </button>
                  )}
                  {supervisa && v.estado !== "cancelada" && (
                    <button type="button" onClick={() => cancelar.mutate(v)} className="ml-2 text-red-600 hover:underline">
                      cancelar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {ventas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  Sin ventas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
