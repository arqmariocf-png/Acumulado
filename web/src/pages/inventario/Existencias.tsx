import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import type { Existencia } from "../../types/database";
import { dineroMx } from "../../lib/kpisEmpresa";

const pu = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 }));


function useExistencias(empresaId: string) {
  return useQuery({
    queryKey: ["existencias", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("existencias").select("*").eq("empresa_id", empresaId).order("producto_nombre");
      if (error) throw error;
      return data as Existencia[];
    },
  });
}

export function Existencias() {
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const [busqueda, setBusqueda] = useState("");

  const { data: existencias, isLoading, error } = useExistencias(empresaId);

  const filtradas = existencias?.filter((e) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return e.producto_nombre.toLowerCase().includes(q) || e.sku.toLowerCase().includes(q);
  });
  const conExistencia = (filtradas ?? []).filter((e) => Number(e.existencia) !== 0);
  const totalValor = (filtradas ?? []).reduce((s, e) => s + Number(e.valor ?? 0), 0);
  const totalPiezas = (filtradas ?? []).reduce((s, e) => s + Number(e.existencia ?? 0), 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SelectorEmpresa value={empresaId} onChange={setEmpresaId} vacio="Selecciona una empresa…" />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o SKU…"
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>

      {!empresaId && <p className="text-sm text-slate-500">Selecciona una empresa para ver sus existencias.</p>}
      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error: {(error as Error).message}</p>}

      {filtradas && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Almacén</th>
                <th className="px-3 py-2">Unidad</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right" title="Promedio ponderado de las entradas con costo; si no hay, el costo de referencia">P.U. ponderado</th>
                <th className="px-3 py-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((e) => (
                <tr key={`${e.producto_id}-${e.almacen_id}`} className={`border-t border-slate-100 ${e.existencia < 0 ? "bg-red-50" : ""}`}>
                  <td className="px-3 py-2">{e.sku}</td>
                  <td className="px-3 py-2">{e.producto_nombre}</td>
                  <td className="px-3 py-2">{e.almacen_nombre}</td>
                  <td className="px-3 py-2">{e.unidad_medida}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{e.existencia}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {pu(e.costo_promedio ?? e.costo_referencia)}
                    {e.costo_promedio == null && e.costo_referencia != null && <span className="ml-1 text-[10px] text-slate-400">ref.</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{dineroMx(Number(e.valor ?? 0))}</td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    Sin productos para mostrar.
                  </td>
                </tr>
              )}
            </tbody>
            {filtradas.length > 0 && (
              <tfoot className="bg-slate-50 text-sm font-semibold text-slate-900">
                <tr>
                  <td colSpan={4} className="px-3 py-2">
                    Total · {conExistencia.length} producto(s) con existencia
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{totalPiezas.toLocaleString("es-MX")}</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2 text-right tabular-nums">{dineroMx(totalValor)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
