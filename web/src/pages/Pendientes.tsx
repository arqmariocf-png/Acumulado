import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

interface FilaPendiente {
  empresa_id: string;
  nombre_razon_social: string;
  movimientos_pendientes: number;
  monto_total: number;
  empresas: { nombre: string } | null;
}

function formatoMoneda(v: number): string {
  return v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

// SPEC.md sección 5.4: concentrado de proveedores/clientes con movimientos
// sin factura real (excluyendo excepciones documentadas), para seguimiento.
export function Pendientes() {
  const { data, isLoading } = useQuery({
    queryKey: ["concentrado-pendientes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_concentrado_pendientes").select("*, empresas(nombre)").order("monto_total", { ascending: false });
      if (error) throw error;
      return data as FilaPendiente[];
    },
  });

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Concentrado de pendientes</h1>
      <p className="mb-4 text-sm text-slate-500">Proveedores/clientes con movimientos sin factura real, sin contar excepciones ya documentadas.</p>

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}

      {data && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Nombre / Razón Social</th>
                <th className="px-3 py-2 text-right"># Movimientos</th>
                <th className="px-3 py-2 text-right">Monto total</th>
              </tr>
            </thead>
            <tbody>
              {data.map((fila) => (
                <tr key={`${fila.empresa_id}-${fila.nombre_razon_social}`} className="border-t border-slate-100">
                  <td className="px-3 py-2">{fila.empresas?.nombre ?? fila.empresa_id}</td>
                  <td className="px-3 py-2">{fila.nombre_razon_social}</td>
                  <td className="px-3 py-2 text-right">{fila.movimientos_pendientes}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatoMoneda(Number(fila.monto_total))}</td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                    Sin pendientes 🎉
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
