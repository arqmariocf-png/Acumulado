import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { Existencia } from "../../types/database";

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

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
  const { veTodasLasEmpresas, perfil } = useAuth();
  const { data: empresas } = useEmpresas();
  const [empresaId, setEmpresaId] = useState(perfil?.empresa_id ?? "");
  const [busqueda, setBusqueda] = useState("");

  const { data: existencias, isLoading, error } = useExistencias(empresaId);

  const filtradas = existencias?.filter((e) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return e.producto_nombre.toLowerCase().includes(q) || e.sku.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {veTodasLasEmpresas ? (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Selecciona una empresa…</option>
            {empresas?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-slate-500">Empresa: la asignada a tu usuario.</p>
        )}
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
                <th className="px-3 py-2 text-right">Existencia</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((e) => (
                <tr key={`${e.producto_id}-${e.almacen_id}`} className={`border-t border-slate-100 ${e.existencia < 0 ? "bg-red-50" : ""}`}>
                  <td className="px-3 py-2">{e.sku}</td>
                  <td className="px-3 py-2">{e.producto_nombre}</td>
                  <td className="px-3 py-2">{e.almacen_nombre}</td>
                  <td className="px-3 py-2">{e.unidad_medida}</td>
                  <td className="px-3 py-2 text-right font-medium">{e.existencia}</td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                    Sin productos para mostrar.
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
