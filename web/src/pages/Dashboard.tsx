import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

interface FilaEstadoCarga {
  empresa_id: string;
  empresa_nombre: string;
  ultima_carga_estado_cuenta: string | null;
  ultimo_periodo_cfdi_recibidos: string | null;
  ultimo_periodo_cfdi_emitidos: string | null;
  ultimo_periodo_oc: string | null;
  ultimo_periodo_ov: string | null;
}

interface FilaPendientes {
  empresa_id: string;
  ambiguos: number;
  duplicados: number;
  faltantes: number;
}

interface FilaKpiMensual {
  empresa_id: string;
  anio: number;
  mes: number;
  movimientos: number;
  pct_factura_ajustado: number | null;
  total_cargo: number;
  total_abono: number;
}

interface FilaKpiAnual {
  empresa_id: string;
  anio: number;
  movimientos: number;
  pct_factura_ajustado: number | null;
  total_cargo: number;
  total_abono: number;
}

function formatoMoneda(v: number): string {
  return v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

function formatoPeriodo(periodo: string): string {
  const anio = periodo.slice(0, 4);
  const mes = Number(periodo.slice(4, 6));
  return `${MESES[mes - 1]} ${anio}`;
}

/** Chip verde con el último periodo/fecha cargado, o rojo "Sin cargar" si
 * esa categoría nunca tuvo un archivo para esta empresa (valor null). */
function ChipCarga({ valor, formato }: { valor: string | null; formato: (v: string) => string }) {
  if (!valor) {
    return <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">Sin cargar</span>;
  }
  return <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">{formato(valor)}</span>;
}

/** Número en rojo si hay pendientes (>0), gris si está en cero -- para que
 * el ojo vaya directo a las empresas con algo por resolver. */
function Conteo({ valor }: { valor: number }) {
  return <span className={valor > 0 ? "font-semibold text-red-700" : "text-slate-400"}>{valor}</span>;
}

export function Dashboard() {
  const { veTodasLasEmpresas, perfil } = useAuth();

  // Qué le falta cargar a cada empresa, de forma GLOBAL (RLS de
  // v_estado_carga_empresa ya filtra a solo la(s) empresa(s) que el rol
  // puede ver) -- primera pregunta que el Dashboard debe contestar antes de
  // cualquier número (SPEC.md sección 5: "Estatus de carga... primero de
  // manera global"). También sirve como la lista de empresas activas
  // visibles para el resto de las tablas de esta página.
  const { data: estadoCarga, isLoading } = useQuery({
    queryKey: ["estado-carga-empresa"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_estado_carga_empresa").select("*").order("empresa_nombre");
      if (error) throw error;
      return data as FilaEstadoCarga[];
    },
  });

  // Segunda pregunta, ya específica por empresa: cuántos movimientos traen
  // algo por resolver (ambiguo, posible duplicado, o pendiente de revisión
  // sin explicación todavía).
  const { data: pendientes } = useQuery({
    queryKey: ["pendientes-por-empresa"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_pendientes_por_empresa").select("*");
      if (error) throw error;
      return data as FilaPendientes[];
    },
  });

  const { data: kpisMensuales } = useQuery({
    queryKey: ["kpis-mensuales"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_kpis_mensuales").select("empresa_id, anio, mes, movimientos, pct_factura_ajustado, total_cargo, total_abono");
      if (error) throw error;
      return data as FilaKpiMensual[];
    },
  });

  const { data: kpisAnuales } = useQuery({
    queryKey: ["kpis-anuales"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_kpis_anuales").select("*");
      if (error) throw error;
      return data as FilaKpiAnual[];
    },
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

  const pendientesPorEmpresa = new Map((pendientes ?? []).map((p) => [p.empresa_id, p]));

  // Mes actual y mes anterior (hoy: agosto -> julio/agosto), en vez de
  // fijar "julio/agosto" a mano -- así la tabla sigue mostrando los 2 meses
  // relevantes sin tocar código cuando avance el calendario.
  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth() + 1;
  const anioMesAnterior = mesActual === 1 ? anioActual - 1 : anioActual;
  const mesAnterior = mesActual === 1 ? 12 : mesActual - 1;

  const kpiMensualDe = (empresaId: string, anio: number, mes: number) =>
    kpisMensuales?.find((k) => k.empresa_id === empresaId && k.anio === anio && k.mes === mes) ?? null;
  const kpiAnualDe = (empresaId: string) => kpisAnuales?.find((k) => k.empresa_id === empresaId && k.anio === anioActual) ?? null;

  function CeldasMes({ kpi }: { kpi: FilaKpiMensual | FilaKpiAnual | null }) {
    return (
      <>
        <td className="px-3 py-2 text-right">{formatoMoneda(Number(kpi?.total_cargo ?? 0))}</td>
        <td className="px-3 py-2 text-right">{formatoMoneda(Number(kpi?.total_abono ?? 0))}</td>
        <td className="px-3 py-2 text-right">{kpi?.pct_factura_ajustado ?? "—"}%</td>
      </>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Dashboard</h1>
      <p className="mb-6 text-sm text-slate-500">
        {veTodasLasEmpresas ? "Consolidado — las 8 empresas" : `Empresa asignada`} · {perfil?.rol}
      </p>

      {estadoCarga && estadoCarga.length > 0 && (
        <div className="mb-6 overflow-x-auto rounded border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">1. Estado de carga por empresa (global)</p>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Estado de cuenta</th>
                <th className="px-3 py-2">CFDI recibidos</th>
                <th className="px-3 py-2">CFDI emitidos</th>
                <th className="px-3 py-2">Catálogo OC/OS</th>
                <th className="px-3 py-2">Catálogo OV</th>
              </tr>
            </thead>
            <tbody>
              {estadoCarga.map((e) => (
                <tr key={e.empresa_id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{e.empresa_nombre}</td>
                  <td className="px-3 py-2">
                    <ChipCarga valor={e.ultima_carga_estado_cuenta} formato={(v) => new Date(v).toLocaleDateString("es-MX")} />
                  </td>
                  <td className="px-3 py-2">
                    <ChipCarga valor={e.ultimo_periodo_cfdi_recibidos} formato={formatoPeriodo} />
                  </td>
                  <td className="px-3 py-2">
                    <ChipCarga valor={e.ultimo_periodo_cfdi_emitidos} formato={formatoPeriodo} />
                  </td>
                  <td className="px-3 py-2">
                    <ChipCarga valor={e.ultimo_periodo_oc} formato={formatoPeriodo} />
                  </td>
                  <td className="px-3 py-2">
                    <ChipCarga valor={e.ultimo_periodo_ov} formato={formatoPeriodo} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {estadoCarga && estadoCarga.length > 0 && (
        <div className="mb-6 overflow-x-auto rounded border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
            2. Pendientes por empresa (específico) — clic en{" "}
            <Link to="/movimientos" className="underline">
              Movimientos
            </Link>{" "}
            y en el semáforo de la fila para resolver
          </p>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2 text-right">🟣 Ambiguos</th>
                <th className="px-3 py-2 text-right">Posibles duplicados</th>
                <th className="px-3 py-2 text-right">🔴 Faltantes / por revisar</th>
              </tr>
            </thead>
            <tbody>
              {estadoCarga.map((e) => {
                const p = pendientesPorEmpresa.get(e.empresa_id);
                return (
                  <tr key={e.empresa_id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{e.empresa_nombre}</td>
                    <td className="px-3 py-2 text-right">
                      <Conteo valor={p?.ambiguos ?? 0} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Conteo valor={p?.duplicados ?? 0} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Conteo valor={p?.faltantes ?? 0} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {estadoCarga && estadoCarga.length > 0 && (
        <div className="mb-6 overflow-x-auto rounded border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">3. Cargos, abonos y % Factura por empresa</p>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th rowSpan={2} className="px-3 py-2 align-bottom">
                  Empresa
                </th>
                <th colSpan={3} className="border-l border-slate-200 px-3 py-1 text-center">
                  {MESES[mesAnterior - 1]} {anioMesAnterior}
                </th>
                <th colSpan={3} className="border-l border-slate-200 px-3 py-1 text-center">
                  {MESES[mesActual - 1]} {anioActual}
                </th>
                <th colSpan={3} className="border-l border-slate-200 px-3 py-1 text-center">
                  Acumulado {anioActual}
                </th>
              </tr>
              <tr>
                <th className="border-l border-slate-200 px-3 py-2 text-right">Cargo</th>
                <th className="px-3 py-2 text-right">Abono</th>
                <th className="px-3 py-2 text-right">% Factura</th>
                <th className="border-l border-slate-200 px-3 py-2 text-right">Cargo</th>
                <th className="px-3 py-2 text-right">Abono</th>
                <th className="px-3 py-2 text-right">% Factura</th>
                <th className="border-l border-slate-200 px-3 py-2 text-right">Cargo</th>
                <th className="px-3 py-2 text-right">Abono</th>
                <th className="px-3 py-2 text-right">% Factura</th>
              </tr>
            </thead>
            <tbody>
              {estadoCarga.map((e) => (
                <tr key={e.empresa_id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{e.empresa_nombre}</td>
                  <CeldasMes kpi={kpiMensualDe(e.empresa_id, anioMesAnterior, mesAnterior)} />
                  <CeldasMes kpi={kpiMensualDe(e.empresa_id, anioActual, mesActual)} />
                  <CeldasMes kpi={kpiAnualDe(e.empresa_id)} />
                </tr>
              ))}
              {estadoCarga.length > 1 && (
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <CeldasMes
                    kpi={{
                      empresa_id: "",
                      anio: anioMesAnterior,
                      mes: mesAnterior,
                      movimientos: 0,
                      pct_factura_ajustado: null,
                      total_cargo: estadoCarga.reduce((a, e) => a + Number(kpiMensualDe(e.empresa_id, anioMesAnterior, mesAnterior)?.total_cargo ?? 0), 0),
                      total_abono: estadoCarga.reduce((a, e) => a + Number(kpiMensualDe(e.empresa_id, anioMesAnterior, mesAnterior)?.total_abono ?? 0), 0),
                    }}
                  />
                  <CeldasMes
                    kpi={{
                      empresa_id: "",
                      anio: anioActual,
                      mes: mesActual,
                      movimientos: 0,
                      pct_factura_ajustado: null,
                      total_cargo: estadoCarga.reduce((a, e) => a + Number(kpiMensualDe(e.empresa_id, anioActual, mesActual)?.total_cargo ?? 0), 0),
                      total_abono: estadoCarga.reduce((a, e) => a + Number(kpiMensualDe(e.empresa_id, anioActual, mesActual)?.total_abono ?? 0), 0),
                    }}
                  />
                  <CeldasMes
                    kpi={{
                      empresa_id: "",
                      anio: anioActual,
                      movimientos: 0,
                      pct_factura_ajustado: null,
                      total_cargo: estadoCarga.reduce((a, e) => a + Number(kpiAnualDe(e.empresa_id)?.total_cargo ?? 0), 0),
                      total_abono: estadoCarga.reduce((a, e) => a + Number(kpiAnualDe(e.empresa_id)?.total_abono ?? 0), 0),
                    }}
                  />
                </tr>
              )}
              {estadoCarga.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                    Sin datos todavía. Carga un estado de cuenta para empezar.
                  </td>
                </tr>
              )}
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
