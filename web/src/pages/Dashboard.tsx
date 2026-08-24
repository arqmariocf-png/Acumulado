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

interface FilaCosteoMensual {
  producto_id: string;
  producto_nombre: string;
  anio: number;
  mes: number;
  lotes: number;
  cantidad_producida: number;
  costo_total: number;
  costo_unitario_promedio: number | null;
}

export function Dashboard() {
  const { veTodasLasEmpresas, perfil } = useAuth();
  // El costeo de producción de Clavicón solo lo ve quien ya tiene acceso al
  // módulo (rls de v_costeo_mensual_clavicon: produccion/admin/corporativo)
  // -- se evita disparar la consulta para el resto de roles.
  const veCosteoClavicon = perfil?.rol === "produccion" || perfil?.rol === "corporativo" || perfil?.rol === "admin";

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

  const { data: costeoClavicon } = useQuery({
    queryKey: ["costeo-mensual-clavicon-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_costeo_mensual_clavicon").select("*").order("anio").order("mes");
      if (error) throw error;
      return data as FilaCosteoMensual[];
    },
    enabled: veCosteoClavicon,
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

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

      {saldosPorCuenta && saldosPorCuenta.length > 0 && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Cuenta</th>
                {veTodasLasEmpresas && <th className="px-3 py-2">Empresa</th>}
                <th className="px-3 py-2">Último movimiento</th>
                <th className="px-3 py-2 text-right">Saldo (según el banco)</th>
              </tr>
            </thead>
            <tbody>
              {saldosPorCuenta.map((s) => (
                <tr key={s.cuenta_id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    {s.cuentas_bancarias?.banco} ····{s.cuentas_bancarias?.ultimos_4}
                  </td>
                  {veTodasLasEmpresas && <td className="px-3 py-2">{s.empresas?.nombre}</td>}
                  <td className="px-3 py-2">{s.fecha_ultimo_movimiento}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatoMoneda(Number(s.saldo_cierre))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {veCosteoClavicon && costeoClavicon && costeoClavicon.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Producción — Mallas y Clavos Clavicón</h2>
          <p className="mb-3 text-sm text-slate-500">Costo real de los lotes terminados, por producto y mes.</p>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2">Periodo</th>
                  <th className="px-3 py-2 text-right">Lotes</th>
                  <th className="px-3 py-2 text-right">Cant. producida</th>
                  <th className="px-3 py-2 text-right">Costo total</th>
                  <th className="px-3 py-2 text-right">Costo unitario prom.</th>
                </tr>
              </thead>
              <tbody>
                {costeoClavicon.map((c) => (
                  <tr key={`${c.producto_id}-${c.anio}-${c.mes}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">{c.producto_nombre}</td>
                    <td className="px-3 py-2">
                      {c.mes}/{c.anio}
                    </td>
                    <td className="px-3 py-2 text-right">{c.lotes}</td>
                    <td className="px-3 py-2 text-right">{c.cantidad_producida}</td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(Number(c.costo_total))}</td>
                    <td className="px-3 py-2 text-right">{c.costo_unitario_promedio !== null ? formatoMoneda(Number(c.costo_unitario_promedio)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
