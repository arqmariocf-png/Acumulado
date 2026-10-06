import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";
import { deudaCxp, semaforoCredito, type FilaCxp } from "../../lib/cuentasPorPagar";
import { MisActividades } from "../tareas/MisActividades";
import { SaldosEmpresas } from "./SaldosEmpresas";

// Inicio de dirección (Mario con Laura, 6-oct-2026): "Inicio: notificaciones
// (tareas pendientes), saldos por empresa, cuentas por pagar". Arriba lo que
// espera a Laura (OC por autorizar, efectivo por confirmar), luego sus
// actividades, los saldos y lo que se debe por empresa.

function usePendientesDireccion() {
  return useQuery({
    queryKey: ["pagos-programados", "pendientes-direccion"],
    queryFn: async () => {
      const [autorizar, efectivo] = await Promise.all([
        supabase.from("v_oc_pagos").select("id", { count: "exact", head: true }).eq("autorizacion", "pendiente").gt("saldo", 0.01).eq("programado", 0),
        supabase.from("pagos_programados").select("id", { count: "exact", head: true }).eq("metodo", "efectivo").neq("estatus", "cancelado").is("confirmado_en", null),
      ]);
      if (autorizar.error) throw autorizar.error;
      if (efectivo.error) throw efectivo.error;
      return { autorizar: autorizar.count ?? 0, efectivo: efectivo.count ?? 0 };
    },
  });
}

export function InicioDireccion() {
  const { data: pend } = usePendientesDireccion();
  return (
    <div className="space-y-6">
      <div className="grid gap-2 sm:grid-cols-3">
        <Atajo to="/finanzas/pagos#ordenes" titulo="Órdenes por autorizar" valor={pend?.autorizar} alerta={(pend?.autorizar ?? 0) > 0} />
        <Atajo to="/finanzas/pagos#efectivo" titulo="Efectivo por confirmar" valor={pend?.efectivo} alerta={(pend?.efectivo ?? 0) > 0} />
        <Atajo to="/finanzas/historial-pagos" titulo="Base de pagos y comprobantes" valor={null} />
      </div>
      <section>
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Mis pendientes</h2>
        <MisActividades compacto />
      </section>
      <SaldosEmpresas />
      <ResumenCxp />
    </div>
  );
}

function Atajo({ to, titulo, valor, alerta = false }: { to: string; titulo: string; valor: number | null | undefined; alerta?: boolean }) {
  return (
    <Link to={to} className={`rounded border px-3 py-2 hover:shadow-sm ${alerta ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] uppercase text-slate-500">{titulo}</p>
      <p className="text-lg font-semibold tabular-nums text-slate-900">{valor === null ? "Abrir →" : valor ?? "…"}</p>
    </Link>
  );
}

/** Lo que se debe por empresa (cada empresa con sus líneas) y los proveedores más apretados. */
function ResumenCxp() {
  const { data: filas, isLoading } = useQuery({
    queryKey: ["cxp-proveedores", "inicio"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_cxp_empresa").select("*");
      if (error) throw error;
      return (data ?? []) as FilaCxp[];
    },
  });
  const { data: empresas } = useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre, codigo").order("nombre");
      if (error) throw error;
      return data as { id: string; nombre: string; codigo: string }[];
    },
  });
  const nombre = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e.nombre])), [empresas]);

  const porEmpresa = useMemo(() => {
    const m = new Map<string, { deuda: number; saldoOc: number; rojos: number; conLinea: number }>();
    for (const f of filas ?? []) {
      const r = m.get(f.empresa_id) ?? { deuda: 0, saldoOc: 0, rojos: 0, conLinea: 0 };
      r.deuda += deudaCxp(f);
      r.saldoOc += Number(f.saldo_oc || 0);
      if (f.linea_credito != null && Number(f.linea_credito) > 0) r.conLinea += 1;
      if (semaforoCredito(deudaCxp(f), f.linea_credito).color === "rojo") r.rojos += 1;
      m.set(f.empresa_id, r);
    }
    return [...m.entries()].filter(([, r]) => r.deuda > 0.01).sort((a, b) => b[1].deuda - a[1].deuda);
  }, [filas]);

  const apretados = useMemo(
    () =>
      (filas ?? [])
        .filter((f) => f.linea_credito != null && Number(f.linea_credito) > 0)
        .map((f) => ({ f, s: semaforoCredito(deudaCxp(f), f.linea_credito) }))
        .filter((x) => x.s.color === "rojo" || x.s.color === "ambar")
        .sort((a, b) => (b.s.pctUsado ?? 0) - (a.s.pctUsado ?? 0))
        .slice(0, 8),
    [filas],
  );

  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Cuentas por pagar</h2>
        <Link to="/finanzas/proveedores" className="text-sm underline">
          Ver por proveedor
        </Link>
      </div>
      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1">Empresa</th>
              <th className="py-1 text-right">Se debe</th>
              <th className="py-1 text-right">Saldo de OC</th>
              <th className="py-1 text-right">En rojo</th>
            </tr>
          </thead>
          <tbody>
            {porEmpresa.map(([id, r]) => (
              <tr key={id} className="border-t border-slate-100">
                <td className="py-1.5">{nombre.get(id) ?? "—"}</td>
                <td className="py-1.5 text-right font-medium tabular-nums">{moneda(r.deuda)}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-600">{moneda(r.saldoOc)}</td>
                <td className={`py-1.5 text-right tabular-nums ${r.rojos > 0 ? "text-red-700" : "text-slate-400"}`}>{r.rojos || "—"}</td>
              </tr>
            ))}
            {!isLoading && porEmpresa.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-slate-400">
                  Nada por pagar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div>
          <p className="mb-1 text-xs uppercase text-slate-500">Líneas de crédito más apretadas</p>
          {apretados.length === 0 && <p className="text-sm text-slate-400">Ninguna línea al límite.</p>}
          <ul className="space-y-1 text-sm">
            {apretados.map(({ f, s }) => (
              <li key={`${f.empresa_id}|${f.clave}`} className="flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.color === "rojo" ? "bg-red-500" : "bg-amber-400"}`} />
                <span className="flex-1 truncate">
                  {f.proveedor} <span className="text-xs text-slate-400">· {nombre.get(f.empresa_id) ?? ""}</span>
                </span>
                <span className="tabular-nums text-xs text-slate-600">
                  {s.pctUsado} % de {moneda(Number(f.linea_credito))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
