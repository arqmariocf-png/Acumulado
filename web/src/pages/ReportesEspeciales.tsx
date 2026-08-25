import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { Movimiento } from "../types/database";

// Reportes especiales de SPEC.md sección 4.3: cada categoría N/A- tiene su
// propia vista, no solo la etiqueta en la tabla general.
const CATEGORIAS = [
  { valor: "N/A - TRASPASO ENTRE CUENTAS PROPIAS", etiqueta: "Traspasos" },
  { valor: "N/A - COMISION BANCARIA", etiqueta: "Comisiones" },
  { valor: "N/A - PRESTAMO INTERCOMPAÑIA", etiqueta: "Préstamos" },
  { valor: "N/A - NOMINA (SUELDOS Y SALARIOS)", etiqueta: "Nómina" },
  { valor: "N/A - DEVOLUCION", etiqueta: "Devoluciones" },
];

function formatoMoneda(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function ReportesEspeciales() {
  const [categoria, setCategoria] = useState(CATEGORIAS[0].valor);

  const { data: movimientos, isLoading } = useQuery({
    queryKey: ["reporte-especial", categoria],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movimientos")
        .select("*, empresas(nombre)")
        .eq("factura", categoria)
        .order("fecha_pago", { ascending: false });
      if (error) throw error;
      return data as (Movimiento & { empresas: { nombre: string } | null })[];
    },
  });

  const total = movimientos?.reduce((acc, m) => acc + (m.cargo_total ?? 0) + (m.abono_total ?? 0), 0) ?? 0;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Reportes especiales</h1>

      <div className="mb-4 flex flex-wrap gap-2">
        {CATEGORIAS.map((c) => (
          <button
            key={c.valor}
            onClick={() => setCategoria(c.valor)}
            className={`rounded px-3 py-1.5 text-sm border border-slate-200 ${categoria === c.valor ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
          >
            {c.etiqueta}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}

      {movimientos && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {movimientos.length} movimientos · Total: <strong>{formatoMoneda(total)}</strong>
          </p>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2 text-right">Cargo</th>
                  <th className="px-3 py-2 text-right">Abono</th>
                  <th className="px-3 py-2">Comentarios</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{m.fecha_pago}</td>
                    <td className="px-3 py-2">{m.empresas?.nombre ?? m.empresa_id}</td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(m.cargo_total)}</td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(m.abono_total)}</td>
                    <td className="px-3 py-2">{m.comentarios}</td>
                  </tr>
                ))}
                {movimientos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                      Sin movimientos en esta categoría.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
