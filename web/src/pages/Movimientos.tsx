import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Semaforo } from "../components/Semaforo";
import type { EstadoClasificacion, Movimiento } from "../types/database";

const ESTADOS: { valor: EstadoClasificacion | "todos"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos los estados" },
  { valor: "pendiente_revision", etiqueta: "🔴 Revisión" },
  { valor: "pendiente_esperado", etiqueta: "🟡 Esperado" },
  { valor: "ambiguo", etiqueta: "🟣 Ambiguo" },
  { valor: "resuelto", etiqueta: "Resuelto" },
];

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre, codigo").order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

function formatoMoneda(valor: number | null): string {
  if (valor == null) return "—";
  return valor.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function Movimientos() {
  const { veTodasLasEmpresas, perfil } = useAuth();
  const { data: empresas } = useEmpresas();

  const [empresaId, setEmpresaId] = useState<string>("");
  const [estado, setEstado] = useState<EstadoClasificacion | "todos">("todos");
  const [soloDuplicados, setSoloDuplicados] = useState(false);

  const empresaFiltro = veTodasLasEmpresas ? empresaId : (perfil?.empresa_id ?? "");

  const { data: movimientos, isLoading, error } = useQuery({
    queryKey: ["movimientos", empresaFiltro, estado, soloDuplicados],
    queryFn: async () => {
      let query = supabase.from("movimientos").select("*").order("fecha_pago", { ascending: false }).limit(200);
      if (empresaFiltro) query = query.eq("empresa_id", empresaFiltro);
      if (estado !== "todos") query = query.eq("estado_clasificacion", estado);
      if (soloDuplicados) query = query.eq("posible_duplicado", true);
      const { data, error } = await query;
      if (error) throw error;
      return data as Movimiento[];
    },
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Movimientos</h1>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {veTodasLasEmpresas && (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Todas las empresas</option>
            {empresas?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        )}
        <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoClasificacion | "todos")} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          {ESTADOS.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={soloDuplicados} onChange={(e) => setSoloDuplicados(e.target.checked)} />
          Solo posibles duplicados
        </label>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error: {(error as Error).message}</p>}

      {movimientos && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Proyecto</th>
                <th className="px-3 py-2">Nombre / Razón Social</th>
                <th className="px-3 py-2 text-right">Cargo</th>
                <th className="px-3 py-2 text-right">Abono</th>
                <th className="px-3 py-2">Referencia</th>
                <th className="px-3 py-2">FACTURA</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr key={m.id} className={`border-t border-slate-100 ${m.posible_duplicado ? "bg-orange-50" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2">{m.fecha_pago}</td>
                  <td className="px-3 py-2">{m.proyecto ?? <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2">{m.nombre_razon_social ?? <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(m.cargo_total)}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(m.abono_total)}</td>
                  <td className="px-3 py-2">
                    {m.referencia_tipo ? `${m.referencia_tipo} ${m.referencia_numero}` : "—"}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2" title={m.factura ?? undefined}>
                    {m.factura ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Semaforo estado={m.estado_clasificacion} />
                    {m.posible_duplicado && <span className="ml-1 text-xs text-orange-600">dup.</span>}
                  </td>
                </tr>
              ))}
              {movimientos.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                    Sin movimientos para este filtro.
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
