import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";
import { armarHojaPagos, csvHojaPagos, htmlHojaPagos, type PagoHoja } from "../../lib/hojaPagos";
import { abrirParaImprimir, abrirVentanaImpresion } from "../../lib/imprimir";
import { useSaldosDia } from "./SaldosEmpresas";

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}.${m}.${a.slice(2)}`;
}

/** Hoja de pagos del día por empresa, como el Excel de Laura ("PAGOS
 * 30.09.26"): saldo inicial por cuenta, pagos del día con OC, forma de pago
 * y proyecto, y saldo corrido (30-sep-2026). */
export function HojaPagosDia({ filtroEmpresa, hoy }: { filtroEmpresa: string; hoy: string }) {
  const [fecha, setFecha] = useState(hoy);
  const [abierta, setAbierta] = useState(true);
  const { data: saldos, isLoading: cargandoSaldos } = useSaldosDia(fecha);
  const { data: pagos, isLoading: cargandoPagos, error } = useQuery({
    queryKey: ["hoja-pagos", fecha],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("v_pagos_programados")
        .select("empresa_id, empresa_nombre, id_orden, beneficiario, concepto, monto, fecha_programada, estatus, metodo, tipo_pago_backoffice, oc_proyecto, notas, referencia")
        .neq("estatus", "cancelado")
        .or(`fecha_programada.eq.${fecha},and(estatus.eq.pendiente,fecha_programada.lt.${fecha})`);
      if (err) throw err;
      return (data ?? []) as PagoHoja[];
    },
  });

  const hojas = useMemo(
    () =>
      armarHojaPagos(
        (saldos ?? []).map((s) => ({ empresa_id: s.empresa_id, empresa_nombre: s.empresa_nombre, banco: s.banco, ultimos_4: s.ultimos_4, alias: s.alias, saldo_inicial: Number(s.saldo_inicial) })),
        pagos ?? [],
        fecha,
      ).filter((h) => !filtroEmpresa || h.empresa_id === filtroEmpresa),
    [saldos, pagos, fecha, filtroEmpresa],
  );

  function imprimir() {
    const ventana = abrirVentanaImpresion();
    abrirParaImprimir(htmlHojaPagos(fechaCorta(fecha), hojas), ventana);
  }

  function excel() {
    const url = URL.createObjectURL(new Blob([csvHojaPagos(hojas)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `pagos-${fecha}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mb-4 rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <button type="button" onClick={() => setAbierta((v) => !v)} className="text-sm font-semibold text-slate-700">
          {abierta ? "▾" : "▸"} Hoja de pagos del día por empresa
        </button>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value || hoy)} className="rounded border border-slate-300 px-2 py-1 text-xs" />
        <span className="text-xs text-slate-500">saldo inicial de cada cuenta, menos los pagos del día (y los vencidos sin pagar)</span>
        <span className="ml-auto flex gap-2">
          <button type="button" onClick={imprimir} disabled={hojas.length === 0} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            Imprimir
          </button>
          <button type="button" onClick={excel} disabled={hojas.length === 0} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            Excel
          </button>
        </span>
      </div>
      {abierta && (
        <div className="space-y-4 p-3">
          {(cargandoSaldos || cargandoPagos) && <p className="text-sm text-slate-400">Cargando…</p>}
          {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
          {!cargandoSaldos && !cargandoPagos && hojas.length === 0 && <p className="text-sm text-slate-400">Sin saldos ni pagos para esta fecha.</p>}
          {hojas.map((h) => (
            <div key={h.empresa_id} className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-left text-white">
                    <th colSpan={8} className="px-2 py-1.5 text-sm font-semibold">
                      {h.empresa_nombre}
                    </th>
                  </tr>
                  <tr className="bg-slate-800 text-[10px] uppercase text-slate-200">
                    <th className="px-2 py-1 text-left">OC</th>
                    <th className="px-2 py-1 text-left">Proveedor</th>
                    <th className="px-2 py-1 text-right">Abono</th>
                    <th className="px-2 py-1 text-right">Cargo</th>
                    <th className="px-2 py-1 text-right">Saldo</th>
                    <th className="px-2 py-1 text-left">Forma de pago</th>
                    <th className="px-2 py-1 text-left">Proyecto</th>
                    <th className="px-2 py-1 text-left">Comentarios</th>
                  </tr>
                </thead>
                <tbody>
                  {h.renglones.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-2 py-1 font-mono">{r.oc ?? ""}</td>
                      <td className="px-2 py-1">{r.proveedor}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.abono != null ? moneda(r.abono) : ""}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.cargo != null ? moneda(r.cargo) : ""}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${r.saldo < 0 ? "font-medium text-red-700" : ""}`}>{moneda(r.saldo)}</td>
                      <td className="px-2 py-1 text-slate-600">{r.forma_pago ?? ""}</td>
                      <td className="px-2 py-1 text-slate-600">{r.proyecto ?? ""}</td>
                      <td className="px-2 py-1 text-slate-600">{r.comentarios ?? ""}</td>
                    </tr>
                  ))}
                  <tr className="bg-sky-50 font-semibold">
                    <td className="px-2 py-1" />
                    <td className="px-2 py-1">Total</td>
                    <td className="px-2 py-1 text-right tabular-nums">{moneda(h.abonos)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{moneda(h.cargos)}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${h.saldo < 0 ? "text-red-700" : ""}`}>{moneda(h.saldo)}</td>
                    <td colSpan={3} className="px-2 py-1 font-normal text-slate-600">
                      {h.n_efectivo > 0 && `Efectivo aparte (no sale del banco): ${h.n_efectivo} · ${moneda(h.efectivo)}`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
