import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";
import { csvNomina, resumenNomina, type PedidoComedor } from "../../lib/comedor";
import { hoyMx, mensajeError } from "./comun";

/** RH / finanzas: descuento del comedor por trabajador y periodo (solo lo
 * entregado), para capturarlo en la nómina y marcarlo como aplicado. */
export function NominaComedor() {
  const queryClient = useQueryClient();
  const [desde, setDesde] = useState(hoyMx(-14));
  const [hasta, setHasta] = useState(hoyMx());
  const [aviso, setAviso] = useState<string | null>(null);

  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ["comedor", "nomina", desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_comedor_pedidos").select("*").gte("fecha", desde).lte("fecha", hasta).eq("estado", "entregado");
      if (error) throw error;
      return (data ?? []) as PedidoComedor[];
    },
  });
  const renglones = useMemo(() => resumenNomina(pedidos), [pedidos]);
  const porEmpresa = useMemo(() => {
    const m = new Map<string, { id: string | null; nombre: string; pendiente: number; personas: number }>();
    for (const r of renglones) {
      const k = r.empresa_trabajador_id ?? "—";
      const e = m.get(k) ?? { id: r.empresa_trabajador_id, nombre: r.empresa, pendiente: 0, personas: 0 };
      e.pendiente += r.pendiente;
      e.personas += r.pendiente > 0 ? 1 : 0;
      m.set(k, e);
    }
    return [...m.values()];
  }, [renglones]);

  const descargar = () => {
    const blob = new Blob([csvNomina(renglones, desde, hasta)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `comedor-nomina-${desde}-a-${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const aplicar = useMutation({
    mutationFn: async (empresa: { id: string | null; nombre: string; pendiente: number }) => {
      if (!empresa.id) throw new Error("Esos pedidos no tienen empresa del trabajador; revisa su cuenta en Admin → Usuarios.");
      const referencia = window.prompt(`Marcar como aplicado en nómina ${moneda(empresa.pendiente)} de ${empresa.nombre} (${desde} a ${hasta}).\nReferencia de la nómina (opcional):`, `Nómina ${hasta}`);
      if (referencia === null) return null;
      const { data, error } = await supabase.rpc("fn_comedor_aplicar_descuento", { p_desde: desde, p_hasta: hasta, p_empresa_trabajador: empresa.id, p_referencia: referencia });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      if (n === null) return;
      setAviso(`${n} comidas marcadas como descontadas.`);
      queryClient.invalidateQueries({ queryKey: ["comedor"] });
    },
    onError: (e) => setAviso(mensajeError(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Del
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
        </label>
        <label className="flex items-center gap-2">
          al
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
        </label>
        <button type="button" onClick={descargar} disabled={renglones.length === 0} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50">
          Descargar para nómina (Excel)
        </button>
        {aviso && <span className="text-slate-600">{aviso}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {porEmpresa.map((e) => (
          <div key={e.nombre} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm">
            <div className="font-medium text-slate-900">{e.nombre}</div>
            <div className="tabular-nums text-slate-700">
              {moneda(e.pendiente)} por descontar · {e.personas} personas
            </div>
            {e.pendiente > 0 && (
              <button type="button" onClick={() => aplicar.mutate(e)} disabled={aplicar.isPending} className="mt-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                Marcar aplicado en nómina
              </button>
            )}
          </div>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Trabajador</th>
                <th className="px-3 py-2 text-right">Comidas</th>
                <th className="px-3 py-2 text-right">Por descontar</th>
                <th className="px-3 py-2 text-right">Ya aplicado</th>
              </tr>
            </thead>
            <tbody>
              {renglones.map((r) => (
                <tr key={r.profile_id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-600">{r.empresa}</td>
                  <td className="px-3 py-1.5 font-medium text-slate-900">{r.trabajador}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.comidas}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{moneda(r.pendiente)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{moneda(r.aplicado)}</td>
                </tr>
              ))}
              {renglones.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                    Sin comidas entregadas en el periodo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
