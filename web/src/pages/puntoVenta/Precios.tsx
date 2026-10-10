import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { filtrarProductos } from "../../lib/puntoVenta";
import { dinero, useProductosVenta } from "./datos";

/** Precio de venta (con IVA) y código de barras por producto. */
export function Precios({ empresaId }: { empresaId: string }) {
  const queryClient = useQueryClient();
  const { data: productos = [] } = useProductosVenta(empresaId);
  const [texto, setTexto] = useState("");
  const [soloSinPrecio, setSoloSinPrecio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = useMutation({
    mutationFn: async ({ id, campo, valor }: { id: string; campo: "precio_venta" | "codigo_barras"; valor: string }) => {
      const v = valor.trim() === "" ? null : campo === "precio_venta" ? Number(valor) : valor.trim();
      const { error: e } = await supabase.from("productos").update({ [campo]: v }).eq("id", id);
      if (e) throw e;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pv-productos", empresaId] }),
    onError: (e) => setError((e as Error).message),
  });
  const lista = filtrarProductos(productos, texto).filter((p) => !soloSinPrecio || p.precio_venta == null);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar producto" className="w-64 rounded border border-slate-300 px-2 py-1.5" />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={soloSinPrecio} onChange={(e) => setSoloSinPrecio(e.target.checked)} />
          Solo sin precio ({productos.filter((p) => p.precio_venta == null).length})
        </label>
        <span className="text-xs text-slate-500">El precio va con IVA incluido. Escanea en "Código de barras" para ligar el código del producto.</span>
      </div>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Código de barras</th>
              <th className="px-3 py-2 text-right">Existencia</th>
              <th className="px-3 py-2 text-right">Precio c/IVA</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-1">{p.nombre}</td>
                <td className="px-3 py-1 text-xs text-slate-500">{p.sku}</td>
                <td className="px-3 py-1">
                  <input
                    defaultValue={p.codigo_barras ?? ""}
                    onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                    onBlur={(e) => e.target.value.trim() !== (p.codigo_barras ?? "") && guardar.mutate({ id: p.id, campo: "codigo_barras", valor: e.target.value })}
                    className="w-40 rounded border border-slate-200 px-1 py-0.5 text-xs"
                  />
                </td>
                <td className="px-3 py-1 text-right">
                  {Number(p.existencia).toLocaleString("es-MX")} {p.unidad_medida ?? ""}
                </td>
                <td className="px-3 py-1 text-right">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={p.precio_venta ?? ""}
                    onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                    onBlur={(e) => e.target.value !== String(p.precio_venta ?? "") && guardar.mutate({ id: p.id, campo: "precio_venta", valor: e.target.value })}
                    className={`w-24 rounded border px-1 py-0.5 text-right ${p.precio_venta == null ? "border-amber-300" : "border-slate-200"}`}
                    title={p.precio_venta != null ? `Sin IVA ${dinero(Number(p.precio_venta) / (1 + p.iva_tasa))}` : "Sin precio"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
