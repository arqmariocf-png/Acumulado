import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";
import { armarTesoreria, semaforoTesoreria, type ColorTesoreria } from "../../lib/tesoreria";
import { useSaldosDia } from "./SaldosEmpresas";
import { DatosBancariosProveedor } from "../../components/DatosBancariosProveedor";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";
import { ComprobantePago } from "../../components/ComprobantePago";

interface PagoVista {
  id: string;
  empresa_id: string;
  empresa_nombre: string;
  cuenta_id: string | null;
  orden_compra_id: string | null;
  id_orden: string | null;
  oc_proyecto: string | null;
  beneficiario: string;
  concepto: string | null;
  monto: number;
  fecha_programada: string;
  estatus: "pendiente" | "pagado" | "cancelado";
  pagado_en: string | null;
  referencia: string | null;
  notas: string | null;
  metodo: "transferencia" | "efectivo" | "cheque";
  clave: string | null;
  beneficiario_bancario: string | null;
  banco_proveedor: string | null;
  clabe: string | null;
  cuenta_proveedor: string | null;
  rfc_proveedor: string | null;
  correo_proveedor: string | null;
  comprobante_nombre: string | null;
}

interface Cuenta {
  id: string;
  empresa_id: string;
  banco: string;
  ultimos_4: string;
  alias: string | null;
}

const COLOR: Record<ColorTesoreria, string> = {
  verde: "border-emerald-300 bg-emerald-50",
  ambar: "border-amber-300 bg-amber-50",
  rojo: "border-red-300 bg-red-50",
  gris: "border-slate-200 bg-white",
};
const PUNTO: Record<ColorTesoreria, string> = { verde: "bg-emerald-500", ambar: "bg-amber-500", rojo: "bg-red-500", gris: "bg-slate-300" };

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Tesorería (Delia, 29-sep-2026): lo que hay que pagar HOY por empresa
 * contra el saldo del banco, con los datos bancarios del beneficiario a la
 * mano. Dirección programa; tesorería paga y marca. Al cierre, saldo del
 * banco menos lo que falta debe cuadrar con lo que ella sube. */
export function Tesoreria({ compacto = false }: { compacto?: boolean }) {
  const queryClient = useQueryClient();
  const hoy = hoyIso();
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const { data: saldos } = useSaldosDia(hoy);
  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-bancarias-todas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cuentas_bancarias").select("id, empresa_id, banco, ultimos_4, alias").eq("activo", true).order("banco");
      if (error) throw error;
      return (data ?? []) as Cuenta[];
    },
  });
  const { data: pagos, isLoading, error } = useQuery({
    queryKey: ["tesoreria", hoy],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("v_pagos_programados")
        .select("*")
        .or(`estatus.eq.pendiente,and(estatus.eq.pagado,pagado_en.eq.${hoy})`)
        .order("fecha_programada")
        .order("beneficiario");
      if (err) throw err;
      return (data ?? []) as PagoVista[];
    },
  });

  const empresas = useMemo(
    () =>
      armarTesoreria(
        (saldos ?? []).map((s) => ({ empresa_id: s.empresa_id, empresa_nombre: s.empresa_nombre, saldo_final: Number(s.saldo_final), salidas: Number(s.salidas) })),
        pagos ?? [],
        hoy,
      ).filter((e) => !filtroEmpresa || e.empresa_id === filtroEmpresa),
    [saldos, pagos, hoy, filtroEmpresa],
  );
  const cuentaTexto = useMemo(() => new Map((cuentas ?? []).map((c) => [c.id, `${c.banco} ${c.ultimos_4}${c.alias ? ` · ${c.alias}` : ""}`])), [cuentas]);

  const marcar = useMutation({
    mutationFn: async ({ p, pagado }: { p: PagoVista; pagado: boolean }) => {
      let referencia: string | null = p.referencia;
      if (pagado) {
        const r = window.prompt(`Marcar como pagado ${moneda(Number(p.monto))} a ${p.beneficiario}.\nReferencia del banco (opcional):`, p.referencia ?? "");
        if (r === null) return false;
        referencia = r.trim() || p.referencia;
      }
      const { error: err } = await supabase.from("pagos_programados").update(pagado ? { estatus: "pagado", pagado_en: hoy, referencia } : { estatus: "pendiente", pagado_en: null }).eq("id", p.id);
      if (err) throw err;
      return true;
    },
    onSuccess: (hecho, v) => {
      if (!hecho) return;
      setAviso(v.pagado ? `Pago a ${v.p.beneficiario} marcado como pagado.` : `Pago a ${v.p.beneficiario} reabierto.`);
      for (const k of [["tesoreria"], ["pagos-programados"], ["oc-pagos"], ["requisiciones"]]) queryClient.invalidateQueries({ queryKey: k });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const pendientes = (pagos ?? []).filter((p) => p.estatus === "pendiente" && p.fecha_programada <= hoy && (!filtroEmpresa || p.empresa_id === filtroEmpresa));
  // Todo lo que dirección dejó "programado a pago" para después: Delia lo ve
  // venir aunque no sea de hoy (Mario, 29-sep-2026).
  const proximos = (pagos ?? []).filter((p) => p.estatus === "pendiente" && p.fecha_programada > hoy && (!filtroEmpresa || p.empresa_id === filtroEmpresa));
  const pagadosHoy = (pagos ?? []).filter((p) => p.estatus === "pagado" && (!filtroEmpresa || p.empresa_id === filtroEmpresa));
  const porEmpresa = (lista: PagoVista[]) => {
    const m = new Map<string, PagoVista[]>();
    for (const p of lista) m.set(p.empresa_nombre, [...(m.get(p.empresa_nombre) ?? []), p]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={`${compacto ? "text-base" : "text-xl"} font-semibold text-slate-900`}>Tesorería · pagos de hoy</h1>
          <p className="text-sm text-slate-500">
            Lo programado por dirección para hoy (y lo vencido) contra el saldo del banco por empresa.{" "}
            <Link to="/carga" className="underline">
              Subir estado de cuenta
            </Link>
            {" · "}
            <Link to="/finanzas/pagos" className="underline">
              Programación completa
            </Link>
          </p>
        </div>
        {!compacto && (
          <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Todas las empresas</option>
            {empresas.map((e) => (
              <option key={e.empresa_id} value={e.empresa_id}>
                {e.empresa_nombre}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {empresas.map((e) => {
          const s = semaforoTesoreria(e);
          return (
            <div key={e.empresa_id} className={`rounded border p-3 ${COLOR[s.color]}`}>
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${PUNTO[s.color]}`} />
                <p className="truncate text-sm font-semibold text-slate-900">{e.empresa_nombre}</p>
              </div>
              <p className="mt-1 text-xs text-slate-700">{s.texto}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                <dt>Saldo banco</dt>
                <dd className="text-right tabular-nums">{moneda(e.saldo_final)}</dd>
                <dt>Por pagar hoy</dt>
                <dd className="text-right tabular-nums">{e.pendientes_hoy ? moneda(e.pendientes_hoy) : "—"}</dd>
                <dt>Pagado hoy</dt>
                <dd className="text-right tabular-nums">{e.pagados_hoy ? moneda(e.pagados_hoy) : "—"}</dd>
                {e.efectivo_hoy > 0 && (
                  <>
                    <dt>Efectivo</dt>
                    <dd className="text-right tabular-nums">{moneda(e.efectivo_hoy)}</dd>
                  </>
                )}
                <dt className="font-medium text-slate-800">Saldo al cierre</dt>
                <dd className={`text-right font-medium tabular-nums ${s.disponible < 0 ? "text-red-700" : "text-slate-900"}`}>{moneda(s.disponible)}</dd>
              </dl>
            </div>
          );
        })}
        {!isLoading && empresas.length === 0 && <p className="text-sm text-slate-400">Sin saldos ni pagos para hoy.</p>}
      </div>

      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>}
      {aviso && <p className={`mb-3 text-xs ${aviso.startsWith("Pago") ? "text-emerald-800" : "text-red-700"}`}>{aviso}</p>}

      {compacto ? (
        <p className="text-xs text-slate-500">
          {pendientes.length} pago(s) por hacer hoy · {proximos.length} programado(s) para después.{" "}
          <Link to="/finanzas/tesoreria" className="underline">
            Abrir tesorería
          </Link>
        </p>
      ) : (
        <>
          <Seccion titulo="Por pagar hoy" grupos={porEmpresa(pendientes)} vacio="No hay pagos pendientes para hoy." render={(p) => <FilaPago p={p} cuenta={p.cuenta_id ? cuentaTexto.get(p.cuenta_id) ?? null : null} hoy={hoy} onMarcar={(pagado) => marcar.mutate({ p, pagado })} ocupado={marcar.isPending} />} />
          <Seccion titulo="Pagados hoy" grupos={porEmpresa(pagadosHoy)} vacio="Todavía no se marca ningún pago hoy." render={(p) => <FilaPago p={p} cuenta={p.cuenta_id ? cuentaTexto.get(p.cuenta_id) ?? null : null} hoy={hoy} onMarcar={(pagado) => marcar.mutate({ p, pagado })} ocupado={marcar.isPending} />} />
          <Seccion titulo="Programados a pago para después" grupos={porEmpresa(proximos)} vacio="Dirección no ha programado pagos para los próximos días." render={(p) => <FilaPago p={p} cuenta={p.cuenta_id ? cuentaTexto.get(p.cuenta_id) ?? null : null} hoy={hoy} onMarcar={(pagado) => marcar.mutate({ p, pagado })} ocupado={marcar.isPending} />} />
        </>
      )}
    </div>
  );
}

function Seccion({ titulo, grupos, vacio, render }: { titulo: string; grupos: [string, PagoVista[]][]; vacio: string; render: (p: PagoVista) => React.ReactNode }) {
  const total = grupos.reduce((s, [, l]) => s + l.reduce((t, p) => t + Number(p.monto), 0), 0);
  return (
    <div className="mb-4 rounded border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <p className="text-sm font-semibold text-slate-700">{titulo}</p>
        <p className="text-sm tabular-nums text-slate-600">{total ? moneda(total) : ""}</p>
      </div>
      {grupos.length === 0 && <p className="px-3 py-4 text-sm text-slate-400">{vacio}</p>}
      {grupos.map(([empresa, lista]) => (
        <div key={empresa}>
          <p className="bg-slate-50 px-3 py-1 text-xs font-medium uppercase text-slate-500">
            {empresa} · {moneda(lista.reduce((t, p) => t + Number(p.monto), 0))}
          </p>
          <table className="w-full text-sm">
            <tbody>{lista.map(render)}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function FilaPago({ p, cuenta, hoy, onMarcar, ocupado }: { p: PagoVista; cuenta: string | null; hoy: string; onMarcar: (pagado: boolean) => void; ocupado: boolean }) {
  const vencido = p.estatus === "pendiente" && p.fecha_programada < hoy;
  return (
    <tr key={p.id} className={`border-t border-slate-100 ${p.estatus === "pagado" ? "text-slate-500" : ""}`}>
      <td className="px-3 py-2 align-top">
        <div className="font-medium text-slate-900">{p.beneficiario}</div>
        <div className="text-xs text-slate-500">
          {p.concepto}
          {p.id_orden && (
            <>
              {" "}
              · OC <span className="font-mono">{p.id_orden}</span>{" "}
              {p.orden_compra_id && <BotonVerOc ocId={p.orden_compra_id} etiqueta="ver" className="text-slate-500 underline" />}
            </>
          )}
          {p.notas && ` · ${p.notas}`}
        </div>
        <div className="mt-0.5">
          <DatosBancariosProveedor datos={{ clave: p.clave, nombre: p.beneficiario, beneficiario_bancario: p.beneficiario_bancario, banco_proveedor: p.banco_proveedor, clabe: p.clabe, cuenta_proveedor: p.cuenta_proveedor, rfc_proveedor: p.rfc_proveedor, correo_proveedor: p.correo_proveedor }} compacto />
        </div>
        <div className="mt-0.5">
          <ComprobantePago pagoId={p.id} nombre={p.comprobante_nombre} compacto />
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-slate-500">
        {p.metodo === "efectivo" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">efectivo</span> : cuenta ? `desde ${cuenta}` : <span className="text-amber-700">cuenta por definir</span>}
        <div className={vencido ? "text-red-700" : ""}>{vencido ? `vencido ${p.fecha_programada}` : p.fecha_programada}</div>
        {p.estatus === "pagado" && p.referencia && <div>ref. {p.referencia}</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right align-top font-medium tabular-nums">{moneda(Number(p.monto))}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right align-top text-xs">
        {p.estatus === "pendiente" ? (
          <button type="button" onClick={() => onMarcar(true)} disabled={ocupado} className="rounded bg-emerald-700 px-2.5 py-1 font-medium text-white disabled:opacity-50">
            Pagado
          </button>
        ) : (
          <button type="button" onClick={() => onMarcar(false)} disabled={ocupado} className="text-slate-500 underline disabled:opacity-50">
            Reabrir
          </button>
        )}
      </td>
    </tr>
  );
}
