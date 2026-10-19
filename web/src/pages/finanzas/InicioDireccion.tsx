import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";
import { deudaCxp, semaforoCredito, vencimientosPorProveedor, type FilaCxp, type OcVencimiento } from "../../lib/cuentasPorPagar";
import { fechaLocal } from "../../lib/reporteChecador";
import { MisActividades } from "../tareas/MisActividades";
import { SaldosEmpresas } from "./SaldosEmpresas";
import { FILTRO_OC_EFECTIVO } from "./EfectivoPorConfirmar";
import { PersonajeDelDia } from "../../components/personaje/PersonajeDelDia";

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
        supabase.from("v_oc_pagos").select("id", { count: "exact", head: true }).gt("saldo", 0.009).neq("autorizacion", "rechazada").eq("pagada_backoffice", false).or(FILTRO_OC_EFECTIVO),
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
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Atajo to="/finanzas/por-autorizar" titulo="Órdenes por autorizar" valor={pend?.autorizar} alerta={(pend?.autorizar ?? 0) > 0} />
        <Atajo to="/finanzas/efectivo" titulo="Efectivo por confirmar" valor={pend?.efectivo} alerta={(pend?.efectivo ?? 0) > 0} />
        <Atajo to="/finanzas/historial-pagos" titulo="Base de pagos y comprobantes" valor={null} />
        <Atajo to="/finanzas/obras" titulo="Físico-financiero de obras" valor={null} />
      </div>
      <PersonajeDelDia />
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
  const hoy = fechaLocal(new Date().toISOString());
  const { data: ocsVencen } = useQuery({
    queryKey: ["pagos-programados", "vencen", hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_oc_pagos")
        .select("id, id_orden, empresa_id, proveedor, proveedor_clave, saldo, vence, proximo_pago")
        .gt("saldo", 0.01)
        .eq("pagada_backoffice", false)
        .neq("autorizacion", "rechazada")
        .or(`vence.lte.${hoy},proximo_pago.lte.${hoy}`);
      if (error) throw error;
      return (data ?? []) as OcVencimiento[];
    },
  });
  const vencen = useMemo(() => vencimientosPorProveedor(ocsVencen ?? [], hoy), [ocsVencen, hoy]);
  const totalVencen = vencen.reduce((s, v) => s + v.saldo, 0);

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
      <div className="mb-4">
        <p className="mb-1 text-xs uppercase text-slate-500">
          Vence hoy o ya venció · {vencen.length} proveedor{vencen.length === 1 ? "" : "es"} · {moneda(totalVencen)}
        </p>
        {vencen.length === 0 ? (
          <p className="text-sm text-slate-400">Nada vence hoy ni hay vencidas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1">Empresa</th>
                  <th className="py-1">Proveedor</th>
                  <th className="py-1">OC</th>
                  <th className="py-1">Vence</th>
                  <th className="py-1 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {vencen.map((v) => (
                  <tr key={`${v.empresa_id}|${v.proveedor}`} className="border-t border-slate-100">
                    <td className="py-1.5">{nombre.get(v.empresa_id) ?? "—"}</td>
                    <td className="py-1.5">{v.proveedor}</td>
                    <td className="py-1.5 text-xs text-slate-600">{v.ocs.slice(0, 4).join(", ")}{v.ocs.length > 4 ? ` y ${v.ocs.length - 4} más` : ""}</td>
                    <td className={`py-1.5 text-xs ${v.estado === "vencida" ? "font-medium text-red-700" : "text-amber-700"}`}>
                      {v.estado === "vencida" ? `vencida hace ${v.dias} día${v.dias === 1 ? "" : "s"}` : "hoy"}
                    </td>
                    <td className="py-1.5 text-right font-medium tabular-nums">{moneda(v.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1 text-xs text-slate-400">Vence = fecha de la OC + días de crédito del proveedor, o el pago ya programado si es antes. Para pagar: <Link to="/finanzas/pagos" className="underline">Programación de pagos</Link>.</p>
      </div>
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
