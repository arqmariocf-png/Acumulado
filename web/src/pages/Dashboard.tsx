import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

interface FilaKpi {
  empresa_id: string;
  anio: number;
  mes: number;
  movimientos: number;
  pct_proyecto: number | null;
  pct_nombre: number | null;
  pct_factura_ajustado: number | null;
  total_cargo: number;
  total_abono: number;
}

function formatoMoneda(v: number): string {
  return v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

function Tarjeta({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase text-slate-500">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{valor}</p>
    </div>
  );
}

export function Dashboard() {
  const { veTodasLasEmpresas, perfil } = useAuth();

  const { data: kpis, isLoading } = useQuery({
    queryKey: ["kpis-mensuales"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_kpis_mensuales").select("*").order("anio").order("mes");
      if (error) throw error;
      return data as FilaKpi[];
    },
  });

  const { data: porEmpresa } = useQuery({
    queryKey: ["kpis-por-empresa"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_movimientos_por_empresa").select("*, empresas(nombre)");
      if (error) throw error;
      return data as any[];
    },
    enabled: veTodasLasEmpresas,
  });

  // Saldo del movimiento más reciente de cada cuenta -- a diferencia de
  // Neto (que es solo el flujo del periodo, entradas menos salidas), esto sí
  // es el mismo número que aparece como "Saldo Actual" en el estado de
  // cuenta real del banco.
  const { data: saldosPorCuenta } = useQuery({
    queryKey: ["saldo-cierre-cuenta"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_saldo_cierre_cuenta")
        .select("*, cuentas_bancarias(banco, ultimos_4), empresas(nombre)")
        .order("fecha_ultimo_movimiento", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

  // Agrupado por empresa (en vez de una tabla plana ordenada solo por fecha)
  // para poder identificar de un vistazo a qué empresa pertenece cada
  // cuenta, sobre todo cuando el usuario ve el consolidado de las 8.
  const gruposPorEmpresa = (() => {
    if (!saldosPorCuenta) return [];
    const mapa = new Map<string, { empresaNombre: string; cuentas: typeof saldosPorCuenta }>();
    for (const s of saldosPorCuenta) {
      const empresaId = s.empresa_id ?? "sin-empresa";
      const empresaNombre = s.empresas?.nombre ?? "Empresa desconocida";
      if (!mapa.has(empresaId)) mapa.set(empresaId, { empresaNombre, cuentas: [] });
      mapa.get(empresaId)!.cuentas.push(s);
    }
    return [...mapa.values()].sort((a, b) => a.empresaNombre.localeCompare(b.empresaNombre, "es"));
  })();

  const ytd = kpis?.reduce(
    (acc, k) => ({
      movimientos: acc.movimientos + k.movimientos,
      cargo: acc.cargo + Number(k.total_cargo),
      abono: acc.abono + Number(k.total_abono),
    }),
    { movimientos: 0, cargo: 0, abono: 0 },
  ) ?? { movimientos: 0, cargo: 0, abono: 0 };

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Dashboard</h1>
      <p className="mb-6 text-sm text-slate-500">
        {veTodasLasEmpresas ? "Consolidado — las 8 empresas" : `Empresa asignada`} · {perfil?.rol}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tarjeta titulo="Movimientos YTD" valor={String(ytd.movimientos)} />
        <Tarjeta titulo="Cargo total YTD" valor={formatoMoneda(ytd.cargo)} />
        <Tarjeta titulo="Abono total YTD" valor={formatoMoneda(ytd.abono)} />
        <Tarjeta titulo="Neto YTD (depósitos − cargos del periodo, no es el saldo del banco)" valor={formatoMoneda(ytd.abono - ytd.cargo)} />
      </div>

      <div className="mb-6 overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Mes</th>
              <th className="px-3 py-2 text-right"># Mov.</th>
              <th className="px-3 py-2 text-right">% Proyecto</th>
              <th className="px-3 py-2 text-right">% Nombre</th>
              <th className="px-3 py-2 text-right">% FACTURA (ajustado)</th>
              <th className="px-3 py-2 text-right">Cargo</th>
              <th className="px-3 py-2 text-right">Abono</th>
            </tr>
          </thead>
          <tbody>
            {kpis?.map((k) => (
              <tr key={`${k.empresa_id}-${k.anio}-${k.mes}`} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  {MESES[k.mes - 1]} {k.anio}
                </td>
                <td className="px-3 py-2 text-right">{k.movimientos}</td>
                <td className="px-3 py-2 text-right">{k.pct_proyecto ?? "—"}%</td>
                <td className="px-3 py-2 text-right">{k.pct_nombre ?? "—"}%</td>
                <td className="px-3 py-2 text-right">{k.pct_factura_ajustado ?? "—"}%</td>
                <td className="px-3 py-2 text-right">{formatoMoneda(Number(k.total_cargo))}</td>
                <td className="px-3 py-2 text-right">{formatoMoneda(Number(k.total_abono))}</td>
              </tr>
            ))}
            {(!kpis || kpis.length === 0) && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  Sin datos todavía. Carga un estado de cuenta para empezar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {veTodasLasEmpresas && porEmpresa && (
        <div className="mb-6 overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2 text-right"># Mov.</th>
                <th className="px-3 py-2 text-right">Cargo</th>
                <th className="px-3 py-2 text-right">Abono</th>
                <th className="px-3 py-2 text-right">Neto</th>
              </tr>
            </thead>
            <tbody>
              {porEmpresa.map((e) => (
                <tr key={e.empresa_id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{e.empresas?.nombre}</td>
                  <td className="px-3 py-2 text-right">{e.movimientos}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(Number(e.total_cargo))}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(Number(e.total_abono))}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(Number(e.neto))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gruposPorEmpresa.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Saldo por cuenta</h2>
          <div className="space-y-4">
            {gruposPorEmpresa.map((grupo) => (
              <div key={grupo.empresaNombre} className="overflow-x-auto rounded border border-slate-200 bg-white">
                {veTodasLasEmpresas && (
                  <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">{grupo.empresaNombre}</p>
                )}
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Cuenta</th>
                      <th className="px-3 py-2">Último movimiento</th>
                      <th className="px-3 py-2 text-right">Saldo (según el banco)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.cuentas.map((s) => (
                      <tr key={s.cuenta_id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          {s.cuentas_bancarias?.banco} ····{s.cuentas_bancarias?.ultimos_4}
                        </td>
                        <td className="px-3 py-2">{s.fecha_ultimo_movimiento}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatoMoneda(Number(s.saldo_cierre))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
