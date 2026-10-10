import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa, useEmpresasAlcance } from "../../components/SelectorEmpresa";
import { dineroMx } from "../../lib/kpisEmpresa";
import { fechaLocal, horaLocal } from "../../lib/reporteChecador";
import { cargasPorDia, diasSinCarga, resumenPorEmpresa, type ExistenciaResumen, type MovimientoResumen } from "../../lib/resumenInventario";

type Mov = MovimientoResumen & { id: string; productos: { nombre: string; sku: string; unidad_medida: string } | null };

const fechaCorta = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Resumen del inventario: qué hay por empresa y qué días se capturó. */
export function Resumen() {
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const [abierto, setAbierto] = useState<string | null>(null);
  const { data: empresas } = useEmpresasAlcance();
  const hoy = fechaLocal(new Date().toISOString());

  const existencias = useQuery({
    queryKey: ["inv-resumen-existencias", empresaId],
    queryFn: async () => {
      let q = supabase.from("existencias").select("empresa_id, producto_id, existencia, valor");
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data, error } = await q.limit(20000);
      if (error) throw error;
      return (data ?? []) as ExistenciaResumen[];
    },
  });

  const movimientos = useQuery({
    queryKey: ["inv-resumen-movimientos", empresaId],
    queryFn: async () => {
      let q = supabase
        .from("movimientos_inventario")
        .select("id, empresa_id, tipo, cantidad, costo_unitario, fecha, es_ajuste, registrado_por, created_at, orden_compra_id, orden_venta_id, remision_id, productos(nombre, sku, unidad_medida)")
        .order("created_at", { ascending: false });
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data, error } = await q.limit(5000);
      if (error) throw error;
      return (data ?? []) as unknown as Mov[];
    },
  });

  const idsPersonas = useMemo(() => [...new Set((movimientos.data ?? []).map((m) => m.registrado_por).filter(Boolean))] as string[], [movimientos.data]);
  const personas = useQuery({
    queryKey: ["inv-resumen-personas", idsPersonas.join(",")],
    enabled: idsPersonas.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("v_directorio").select("id, nombre").in("id", idsPersonas);
      return new Map(((data ?? []) as { id: string; nombre: string }[]).map((p) => [p.id, p.nombre]));
    },
  });

  const nombreEmpresa = (id: string) => empresas?.find((e) => e.id === id)?.codigo ?? "—";
  const nombrePersona = (id: string) => personas.data?.get(id) ?? "—";

  const porEmpresa = useMemo(() => resumenPorEmpresa(existencias.data ?? [], movimientos.data ?? []), [existencias.data, movimientos.data]);
  const dias = useMemo(() => cargasPorDia(movimientos.data ?? []), [movimientos.data]);
  const ultima = dias[0]?.dia ?? null;
  const sinCarga = diasSinCarga(ultima, hoy);
  const totalValor = porEmpresa.reduce((t, e) => t + e.valor, 0);

  const cargando = existencias.isLoading || movimientos.isLoading;
  const error = existencias.error || movimientos.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <SelectorEmpresa value={empresaId} onChange={setEmpresaId} />
        <span className="text-xs text-slate-500">Días de carga = día en que se capturó en el sistema (hora de México).</span>
      </div>

      {cargando && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error: {(error as Error).message}</p>}

      {!cargando && !error && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tarjeta titulo="Valor del inventario" valor={dineroMx(totalValor)} />
            <Tarjeta titulo="Movimientos capturados" valor={String(movimientos.data?.length ?? 0)} />
            <Tarjeta titulo="Días con carga" valor={String(dias.length)} nota={dias.length ? `desde ${fechaCorta(dias[dias.length - 1].dia)}` : undefined} />
            <Tarjeta
              titulo="Última carga"
              valor={ultima ? fechaCorta(ultima) : "Nunca"}
              nota={sinCarga == null ? undefined : sinCarga === 0 ? "hoy" : `${sinCarga} día${sinCarga === 1 ? "" : "s"} hábil${sinCarga === 1 ? "" : "es"} sin capturar`}
              alerta={sinCarga != null && sinCarga >= 3}
            />
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Por empresa</h2>
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Empresa</th>
                    <th className="px-3 py-2 text-right">Productos</th>
                    <th className="px-3 py-2 text-right">Con existencia</th>
                    <th className="px-3 py-2 text-right">Negativos</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2 text-right">Movimientos</th>
                    <th className="px-3 py-2 text-right">Días con carga</th>
                    <th className="px-3 py-2">Primera carga</th>
                    <th className="px-3 py-2">Última carga</th>
                  </tr>
                </thead>
                <tbody>
                  {porEmpresa.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-4 text-center text-slate-500">Sin inventario capturado.</td></tr>
                  )}
                  {porEmpresa.map((e) => {
                    const sc = diasSinCarga(e.ultimaCarga, hoy);
                    return (
                      <tr key={e.empresa_id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium">{nombreEmpresa(e.empresa_id)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.productos}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.conExistencia}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${e.negativos ? "font-medium text-red-600" : ""}`}>{e.negativos}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{dineroMx(e.valor)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.movimientos}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.diasConCarga}</td>
                        <td className="px-3 py-2">{e.primeraCarga ? fechaCorta(e.primeraCarga) : "—"}</td>
                        <td className="px-3 py-2">
                          {e.ultimaCarga ? fechaCorta(e.ultimaCarga) : <span className="text-slate-400">nunca</span>}
                          {sc != null && sc >= 3 && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">{sc} días sin capturar</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Días en que se cargó la información</h2>
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Día de captura</th>
                    <th className="px-3 py-2">Empresas</th>
                    <th className="px-3 py-2 text-right">Entradas</th>
                    <th className="px-3 py-2 text-right">Salidas</th>
                    <th className="px-3 py-2 text-right">Valor entradas</th>
                    <th className="px-3 py-2">Fecha de los movimientos</th>
                    <th className="px-3 py-2">Capturó</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {dias.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-500">Todavía no se ha capturado ningún movimiento.</td></tr>
                  )}
                  {dias.map((d) => (
                    <Fragment key={d.dia}>
                      <tr className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium">{fechaCorta(d.dia)}</td>
                        <td className="px-3 py-2">{d.empresas.map(nombreEmpresa).sort().join(", ")}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{d.entradas}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{d.salidas}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{d.valorEntradas ? dineroMx(d.valorEntradas) : "—"}</td>
                        <td className="px-3 py-2 text-xs">
                          {d.fechaMin === d.fechaMax ? fechaCorta(d.fechaMin) : `${fechaCorta(d.fechaMin)} – ${fechaCorta(d.fechaMax)}`}
                          {d.conOtraFecha > 0 && <span className="ml-1 text-amber-700">({d.conOtraFecha} con otra fecha)</span>}
                          {d.ajustes > 0 && <span className="ml-1 text-slate-500">· {d.ajustes} ajuste{d.ajustes === 1 ? "" : "s"}</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">{d.quienes.map(nombrePersona).join(", ")}</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => setAbierto(abierto === d.dia ? null : d.dia)} className="text-xs text-blue-700 hover:underline">
                            {abierto === d.dia ? "Ocultar" : `Ver ${d.movimientos}`}
                          </button>
                        </td>
                      </tr>
                      {abierto === d.dia && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-3 py-2">
                            <DetalleDia movs={(movimientos.data ?? []).filter((m) => fechaLocal(m.created_at) === d.dia)} empresa={nombreEmpresa} persona={nombrePersona} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, nota, alerta }: { titulo: string; valor: string; nota?: string; alerta?: boolean }) {
  return (
    <div className={`rounded border bg-white p-3 ${alerta ? "border-amber-300" : "border-slate-200"}`}>
      <div className="text-xs text-slate-500">{titulo}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{valor}</div>
      {nota && <div className={`text-xs ${alerta ? "text-amber-700" : "text-slate-500"}`}>{nota}</div>}
    </div>
  );
}

function DetalleDia({ movs, empresa, persona }: { movs: Mov[]; empresa: (id: string) => string; persona: (id: string) => string }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-slate-500">
        <tr>
          <th className="py-1 pr-2">Hora</th>
          <th className="py-1 pr-2">Empresa</th>
          <th className="py-1 pr-2">Tipo</th>
          <th className="py-1 pr-2">Producto</th>
          <th className="py-1 pr-2 text-right">Cantidad</th>
          <th className="py-1 pr-2">Fecha mov.</th>
          <th className="py-1 pr-2">Origen</th>
          <th className="py-1 pr-2">Capturó</th>
        </tr>
      </thead>
      <tbody>
        {movs.map((m) => (
          <tr key={m.id} className="border-t border-slate-200">
            <td className="py-1 pr-2 tabular-nums">{horaLocal(m.created_at)}</td>
            <td className="py-1 pr-2">{empresa(m.empresa_id)}</td>
            <td className={`py-1 pr-2 ${m.tipo === "entrada" ? "text-emerald-700" : "text-slate-700"}`}>{m.tipo}{m.es_ajuste ? " (ajuste)" : ""}</td>
            <td className="py-1 pr-2">{m.productos ? `${m.productos.sku} · ${m.productos.nombre}` : "—"}</td>
            <td className="py-1 pr-2 text-right tabular-nums">{Number(m.cantidad).toLocaleString("es-MX")} {m.productos?.unidad_medida ?? ""}</td>
            <td className="py-1 pr-2">{m.fecha}</td>
            <td className="py-1 pr-2">{m.orden_compra_id ? "OC" : m.orden_venta_id ? "OV" : m.remision_id ? "Remisión" : "Manual"}</td>
            <td className="py-1 pr-2">{m.registrado_por ? persona(m.registrado_por) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
