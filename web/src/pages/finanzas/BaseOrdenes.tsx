import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";
import { normalizarTexto } from "../../lib/cuentasPorPagar";
import { ETIQUETA_ETAPA_OC, etapaOc, ordenarOcs, saldoOc, type EtapaOc } from "../../lib/pagosOc";
import { rutaVerArchivo } from "../../lib/verArchivo";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";
import type { OcPago } from "./OrdenesPorPagar";

// Base de órdenes de compra (Mario con Laura, 6-oct-2026: "base de datos en
// donde salga OC · proveedor · fecha · estatus · detalle · comprobante"). Las
// OC del periodo por fecha de la OC, con su etapa, lo pagado, la orden
// impresa (detalle) y los comprobantes de sus pagos.

interface PagoOc {
  id: string;
  orden_compra_id: string;
  monto: number;
  estatus: string;
  pagado_en: string | null;
  metodo: string;
  comprobante_path: string | null;
  comprobante_nombre: string | null;
  confirmado_en: string | null;
}

const COLOR_ETAPA: Record<EtapaOc, string> = {
  por_autorizar: "bg-amber-50 text-amber-800",
  rechazada: "bg-slate-100 text-slate-500",
  por_programar: "bg-red-50 text-red-700",
  programada: "bg-sky-50 text-sky-800",
  pagada: "bg-emerald-50 text-emerald-800",
  recibida: "bg-emerald-100 text-emerald-900",
};

const celda = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function BaseOrdenes({ desde, hasta, empresaId, nombreEmpresa }: { desde: string; hasta: string; empresaId: string; nombreEmpresa: Map<string, string> }) {
  const [texto, setTexto] = useState("");
  const [etapa, setEtapa] = useState<"" | EtapaOc>("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["oc-pagos", "base", desde, hasta, empresaId],
    queryFn: async () => {
      let q = supabase
        .from("v_oc_pagos")
        .select("id, id_orden, empresa_id, proveedor, proyecto, total, fecha_creacion, fuente, autorizacion, pagado, programado, saldo, estatus_backoffice, pagada_backoffice, recepcion_estado, tipo_pago_backoffice")
        .gte("fecha_creacion", desde)
        .lte("fecha_creacion", hasta)
        .limit(2000);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data: ocs, error: err } = await q;
      if (err) throw err;
      const lista = (ocs ?? []) as unknown as OcPago[];
      const pagos = new Map<string, PagoOc[]>();
      const ids = lista.map((o) => o.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data: ps, error: e2 } = await supabase
          .from("pagos_programados")
          .select("id, orden_compra_id, monto, estatus, pagado_en, metodo, comprobante_path, comprobante_nombre, confirmado_en")
          .in("orden_compra_id", ids.slice(i, i + 200))
          .neq("estatus", "cancelado");
        if (e2) throw e2;
        for (const p of (ps ?? []) as PagoOc[]) pagos.set(p.orden_compra_id, [...(pagos.get(p.orden_compra_id) ?? []), p]);
      }
      return { ocs: lista, pagos };
    },
  });

  const filas = useMemo(() => {
    const q = normalizarTexto(texto);
    const res = (data?.ocs ?? []).filter((o) => {
      if (etapa && etapaOc(o) !== etapa) return false;
      if (q && !normalizarTexto(`${o.id_orden} ${o.proveedor ?? ""} ${o.proyecto ?? ""}`).includes(q)) return false;
      return true;
    });
    return ordenarOcs(res, "fecha_desc");
  }, [data, texto, etapa]);

  const total = filas.reduce((s, o) => s + Number(o.total ?? 0), 0);
  const saldo = filas.reduce((s, o) => s + saldoOc(o), 0);

  function descargar() {
    const enc = ["OC", "Fecha", "Empresa", "Proveedor", "Proyecto", "Estatus", "Backoffice", "Total", "Pagado", "Saldo", "Comprobantes"];
    const lineas = filas.map((o) =>
      [
        o.id_orden,
        o.fecha_creacion ?? "",
        nombreEmpresa.get(o.empresa_id) ?? "",
        o.proveedor ?? "",
        o.proyecto ?? "",
        ETIQUETA_ETAPA_OC[etapaOc(o)],
        o.estatus_backoffice ?? "",
        Number(o.total ?? 0).toFixed(2),
        Number(o.pagado ?? 0).toFixed(2),
        saldoOc(o).toFixed(2),
        String((data?.pagos.get(o.id) ?? []).filter((p) => p.comprobante_path).length),
      ]
        .map((v) => celda(String(v)))
        .join(","),
    );
    const url = URL.createObjectURL(new Blob(["﻿" + [enc.join(","), ...lineas].join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ordenes-${desde}-a-${hasta}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select value={etapa} onChange={(e) => setEtapa(e.target.value as "" | EtapaOc)} className="rounded border border-slate-300 px-2 py-1.5">
          <option value="">Todo estatus</option>
          {(Object.keys(ETIQUETA_ETAPA_OC) as EtapaOc[]).map((k) => (
            <option key={k} value={k}>
              {ETIQUETA_ETAPA_OC[k]}
            </option>
          ))}
        </select>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="OC, proveedor u obra" className="min-w-[14rem] flex-1 rounded border border-slate-300 px-2 py-1.5" />
        <span className="text-xs text-slate-500">
          {filas.length} OC · total {moneda(total)} · saldo {moneda(saldo)}
        </span>
        <button onClick={descargar} disabled={filas.length === 0} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-50">
          Descargar (Excel)
        </button>
      </div>
      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {!isLoading && filas.length === 0 && <p className="text-sm text-slate-500">No hay órdenes en este periodo.</p>}
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">OC</th>
                <th className="px-3 py-2">Proveedor</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Estatus</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-3 py-2">Detalle</th>
                <th className="px-3 py-2">Comprobante</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((o) => {
                const e = etapaOc(o);
                const pagos = data?.pagos.get(o.id) ?? [];
                const conArchivo = pagos.filter((p) => p.comprobante_path);
                return (
                  <tr key={o.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-1.5 font-medium">
                      {o.id_orden}
                      <div className="text-[11px] font-normal text-slate-400">{nombreEmpresa.get(o.empresa_id) ?? ""}</div>
                    </td>
                    <td className="px-3 py-1.5">
                      {o.proveedor ?? "—"}
                      {o.proyecto && <div className="text-[11px] text-slate-500">{o.proyecto}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{o.fecha_creacion ?? "—"}</td>
                    <td className="px-3 py-1.5 text-xs">
                      <span className={`rounded px-1.5 py-0.5 ${COLOR_ETAPA[e]}`}>{ETIQUETA_ETAPA_OC[e]}</span>
                      {o.estatus_backoffice && <div className="mt-0.5 text-[11px] text-slate-400">backoffice: {o.estatus_backoffice}</div>}
                      {pagos.some((p) => p.confirmado_en) && <div className="text-[11px] text-emerald-700">pago confirmado</div>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{moneda(Number(o.total ?? 0))}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${saldoOc(o) > 0.01 ? "text-slate-900" : "text-slate-400"}`}>{moneda(saldoOc(o))}</td>
                    <td className="px-3 py-1.5">
                      <BotonVerOc ocId={o.id} className="text-xs underline" />
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      {conArchivo.length === 0 ? (
                        <span className="text-slate-400">{pagos.some((p) => p.estatus === "pagado") ? "sin comprobante" : "—"}</span>
                      ) : (
                        conArchivo.map((p) => (
                          <button key={p.id} onClick={() => window.open(rutaVerArchivo("pago", p.id), "_blank")} className="block underline" title={p.comprobante_nombre ?? undefined}>
                            {p.pagado_en ?? "comprobante"} · {moneda(Number(p.monto))}
                          </button>
                        ))
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
