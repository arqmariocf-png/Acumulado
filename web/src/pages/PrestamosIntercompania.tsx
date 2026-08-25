import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

interface FilaPrestamo {
  id: string;
  empresa_id: string;
  empresa_nombre: string;
  empresa_contraparte_id: string | null;
  empresa_contraparte_nombre: string | null;
  fecha_pago: string;
  cargo_total: number | null;
  abono_total: number | null;
  monto: number;
  acreedor_id: string | null;
  deudor_id: string | null;
}

interface SaldoPar {
  aId: string;
  aNombre: string;
  bId: string;
  bNombre: string;
  /** Positivo: b le debe a a. Negativo: a le debe a b. */
  neto: number;
}

function formatoMoneda(v: number): string {
  return Math.abs(v).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

/** Agrupa el detalle por PAR de empresas (sin importar el orden) y suma con
 * signo -- positivo si la primera empresa del par es la acreedora neta,
 * negativo si es al revés. Así un préstamo de A a B y otro de B a A se
 * netean en vez de mostrarse como dos saldos separados. */
function calcularSaldosPorPar(filas: FilaPrestamo[]): SaldoPar[] {
  const nombresPorId = new Map<string, string>();
  for (const f of filas) {
    nombresPorId.set(f.empresa_id, f.empresa_nombre);
    if (f.empresa_contraparte_id) nombresPorId.set(f.empresa_contraparte_id, f.empresa_contraparte_nombre ?? f.empresa_contraparte_id);
  }

  const saldos = new Map<string, SaldoPar>();
  for (const f of filas) {
    if (!f.acreedor_id || !f.deudor_id) continue;
    const [aId, bId] = [f.acreedor_id, f.deudor_id].sort();
    const key = `${aId}|${bId}`;
    const signo = f.acreedor_id === aId ? 1 : -1;
    const existente = saldos.get(key) ?? { aId, aNombre: nombresPorId.get(aId) ?? aId, bId, bNombre: nombresPorId.get(bId) ?? bId, neto: 0 };
    existente.neto += signo * f.monto;
    saldos.set(key, existente);
  }
  return [...saldos.values()].filter((s) => Math.abs(s.neto) > 0.01);
}

export function PrestamosIntercompania() {
  const { veTodasLasEmpresas } = useAuth();

  const { data: prestamos, isLoading } = useQuery({
    queryKey: ["prestamos-intercompania"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_prestamos_intercompania").select("*").order("fecha_pago", { ascending: false });
      if (error) throw error;
      return data as FilaPrestamo[];
    },
  });

  const saldos = prestamos ? calcularSaldosPorPar(prestamos) : [];
  const sinClasificar = prestamos?.filter((p) => !p.empresa_contraparte_id).length ?? 0;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Préstamos entre empresas</h1>
      <p className="mb-6 text-sm text-slate-500">
        Saldos entre las empresas del grupo por transferencias clasificadas como préstamo intercompañía.
      </p>

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}

      {sinClasificar > 0 && (
        <p className="mb-4 max-w-2xl rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {sinClasificar} movimiento(s) todavía sin empresa contraparte -- no entran en el saldo de abajo hasta que se
          clasifiquen en Reportes Especiales → Préstamos.
        </p>
      )}

      {veTodasLasEmpresas && (
        <div className="mb-6 overflow-x-auto rounded border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">Saldo neto entre empresas</p>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Empresa acreedora (le deben)</th>
                <th className="px-3 py-2">Empresa deudora (debe)</th>
                <th className="px-3 py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {saldos.map((s) => {
                const acreedor = s.neto > 0 ? s.aNombre : s.bNombre;
                const deudor = s.neto > 0 ? s.bNombre : s.aNombre;
                return (
                  <tr key={`${s.aId}-${s.bId}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{acreedor}</td>
                    <td className="px-3 py-2">{deudor}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatoMoneda(s.neto)}</td>
                  </tr>
                );
              })}
              {saldos.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-slate-400">
                    Sin saldos todavía -- clasifica la empresa contraparte de al menos un préstamo en Reportes Especiales.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <p className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">Detalle de movimientos</p>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Contraparte</th>
              <th className="px-3 py-2 text-right">Cargo</th>
              <th className="px-3 py-2 text-right">Abono</th>
            </tr>
          </thead>
          <tbody>
            {prestamos?.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{p.fecha_pago}</td>
                <td className="px-3 py-2">{p.empresa_nombre}</td>
                <td className="px-3 py-2">{p.empresa_contraparte_nombre ?? <span className="text-amber-600">Sin clasificar</span>}</td>
                <td className="px-3 py-2 text-right">{p.cargo_total != null ? formatoMoneda(p.cargo_total) : "—"}</td>
                <td className="px-3 py-2 text-right">{p.abono_total != null ? formatoMoneda(p.abono_total) : "—"}</td>
              </tr>
            ))}
            {prestamos && prestamos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                  Sin préstamos entre empresas todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
