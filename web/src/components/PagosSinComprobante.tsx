import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { moneda } from "../lib/saldosEmpresas";
import { avanceComprobantes, textoComprobantes } from "../lib/comprobantesPago";
import { ComprobantePago } from "./ComprobantePago";

const COLOR = {
  verde: "border-emerald-200 bg-emerald-50 text-emerald-900",
  ambar: "border-amber-200 bg-amber-50 text-amber-900",
  rojo: "border-red-200 bg-red-50 text-red-900",
  gris: "border-slate-200 bg-slate-50 text-slate-600",
} as const;

interface PagoSinComprobante {
  id: string;
  beneficiario: string;
  monto: number;
  pagado_en: string | null;
  empresa_nombre: string;
  id_orden: string | null;
  comprobante_nombre: string | null;
}

/** Aviso a tesorería (Delia): qué porcentaje de los pagos ya pagados no
 * tiene comprobante, y la lista para subirlos ahí mismo (Mario,
 * 30-sep-2026). La llave empieza con "tesoreria": al subir un comprobante
 * se actualiza solo. */
export function PagosSinComprobante({ compacto = false, empresaId = "" }: { compacto?: boolean; empresaId?: string }) {
  const [abierto, setAbierto] = useState(false);
  const { data } = useQuery({
    queryKey: ["tesoreria", "comprobantes", empresaId],
    queryFn: async () => {
      const base = () => {
        let q = supabase.from("pagos_programados").select("id", { count: "exact", head: true }).eq("estatus", "pagado");
        if (empresaId) q = q.eq("empresa_id", empresaId);
        return q;
      };
      let lista = supabase
        .from("v_pagos_programados")
        .select("id, beneficiario, monto, pagado_en, empresa_nombre, id_orden, comprobante_nombre")
        .eq("estatus", "pagado")
        .is("comprobante_path", null)
        .order("pagado_en", { ascending: false })
        .limit(50);
      if (empresaId) lista = lista.eq("empresa_id", empresaId);
      const [todos, sin, filas] = await Promise.all([base(), base().is("comprobante_path", null), lista]);
      if (todos.error) throw todos.error;
      if (sin.error) throw sin.error;
      if (filas.error) throw filas.error;
      return { avance: avanceComprobantes(todos.count ?? 0, sin.count ?? 0), filas: (filas.data ?? []) as PagoSinComprobante[] };
    },
  });

  if (!data || data.avance.pagados === 0) return null;
  const { avance, filas } = data;

  return (
    <div className={`mb-3 rounded border px-3 py-2 text-sm ${COLOR[avance.color]}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">Comprobantes de pago</span>
        <span>{textoComprobantes(avance)}</span>
        {avance.sinComprobante > 0 && <span className="text-xs">Súbelos para que el acumulado se haga en automático.</span>}
        {avance.sinComprobante > 0 &&
          (compacto ? (
            <Link to="/finanzas/tesoreria" className="text-xs underline">
              Subir comprobantes
            </Link>
          ) : (
            <button type="button" onClick={() => setAbierto(!abierto)} className="text-xs underline">
              {abierto ? "Ocultar" : `Ver los ${avance.sinComprobante}`}
            </button>
          ))}
      </div>
      {!compacto && abierto && (
        <ul className="mt-2 space-y-1 text-xs text-slate-700">
          {filas.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded bg-white/70 px-2 py-1">
              <span className="font-medium text-slate-900">{p.beneficiario}</span>
              <span className="tabular-nums">{moneda(Number(p.monto))}</span>
              <span className="text-slate-500">
                {p.empresa_nombre}
                {p.id_orden ? ` · OC ${p.id_orden}` : ""}
                {p.pagado_en ? ` · pagado ${p.pagado_en}` : ""}
              </span>
              <span className="ml-auto">
                <ComprobantePago pagoId={p.id} nombre={p.comprobante_nombre} compacto />
              </span>
            </li>
          ))}
          {avance.sinComprobante > filas.length && <li className="text-slate-500">…y {avance.sinComprobante - filas.length} más.</li>}
        </ul>
      )}
    </div>
  );
}
