import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { abrirParaImprimir } from "../../lib/imprimir";
import { agruparPorEmpresa, htmlSaldosEmpresas, moneda, type FilaSaldoCuenta } from "../../lib/saldosEmpresas";
import { notaSaldoInicial } from "../../lib/hojaPagos";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function fechaTexto(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}
function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useSaldosDia(fecha: string) {
  return useQuery({
    queryKey: ["saldos-dia", fecha],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_saldos_diario_cuenta", { p_fecha: fecha });
      if (error) throw error;
      return (data ?? []) as FilaSaldoCuenta[];
    },
  });
}

/** Hasta qué día está al día cada cuenta (último estado de cuenta cargado,
 * aunque no trajera movimientos nuevos) y su último movimiento
 * (19-nov-2026, Mallas y Clavos: el saldo era correcto pero la pantalla no
 * decía que el estado de cuenta del 17 ya estaba subido). */
export type FechasEstadoCuenta = Map<string, { al: string | null; ultimo: string | null }>;
export function useFechasEstadoCuenta(fecha: string) {
  return useQuery({
    queryKey: ["cuentas-estado-cuenta-al", fecha],
    queryFn: async (): Promise<FechasEstadoCuenta> => {
      const { data, error } = await supabase.rpc("fn_cuentas_estado_cuenta_al", { p_fecha: fecha });
      if (error) throw error;
      return new Map(
        ((data ?? []) as { cuenta_id: string; ultimo_movimiento: string | null; estado_cuenta_al: string | null }[]).map((r) => [r.cuenta_id, { al: r.estado_cuenta_al, ultimo: r.ultimo_movimiento }]),
      );
    },
  });
}

/** Vista simple para Finanzas: saldo inicial y de cierre por empresa y
 * cuenta en una fecha, con impresión y acceso a la programación de pagos. */
export function SaldosEmpresas({ compacto = false }: { compacto?: boolean }) {
  const { perfil } = useAuth();
  const [fecha, setFecha] = useState(hoyIso());
  const [detalle, setDetalle] = useState(!compacto);
  const [aviso, setAviso] = useState<string | null>(null);
  const { data: filas, isLoading, error } = useSaldosDia(fecha);
  const { data: fechas } = useFechasEstadoCuenta(fecha);
  const { grupos, total } = useMemo(() => agruparPorEmpresa(filas ?? []), [filas]);

  function imprimir() {
    setAviso(abrirParaImprimir(htmlSaldosEmpresas(fechaTexto(fecha), grupos, total, perfil?.nombre ?? null)) ? null : "El navegador bloqueó la ventana. Permite ventanas emergentes.");
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Saldos por empresa</h2>
          <input type="date" value={fecha} max={hoyIso()} onChange={(e) => setFecha(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={detalle} onChange={(e) => setDetalle(e.target.checked)} /> ver cuentas
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={imprimir} disabled={grupos.length === 0} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            Imprimir / PDF
          </button>
          <Link to="/finanzas/proveedores" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
            Cuentas por pagar
          </Link>
          <Link to="/finanzas/pagos" className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white">
            Programación de pagos
          </Link>
        </div>
      </div>

      {aviso && <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>}
      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-slate-400">Cargando saldos…</p>}

      {grupos.length > 0 && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Empresa{detalle ? " / cuenta" : ""}</th>
                <th className="px-3 py-2 text-right">Saldo inicial</th>
                <th className="px-3 py-2 text-right">Entradas</th>
                <th className="px-3 py-2 text-right">Salidas</th>
                <th className="px-3 py-2 text-right">Saldo de cierre</th>
                <th className="px-3 py-2">Estado de cuenta</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <GrupoFilas key={g.empresa_id} grupo={g} detalle={detalle} fechas={fechas} fecha={fecha} />
              ))}
            </tbody>
            <tfoot className="bg-slate-100 text-sm font-semibold">
              <tr>
                <td className="px-3 py-2">Total grupo</td>
                <td className="px-3 py-2 text-right tabular-nums">{moneda(total.saldo_inicial)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{moneda(total.entradas)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{moneda(total.salidas)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{moneda(total.saldo_final)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Saldo inicial = cierre del día anterior. Una cuenta sin estado de cuenta cargado ese día muestra su último cierre conocido. Da clic en una empresa o cuenta para ver sus últimos movimientos.
      </p>
    </div>
  );
}

function NotaEstadoCuenta({ f, fecha }: { f: { al: string | null; ultimo: string | null } | undefined; fecha: string }) {
  if (!f) return null;
  const n = notaSaldoInicial(f.al, fecha, f.ultimo);
  if (!n) return null;
  return <span className={n.viejo ? "text-amber-700" : "text-slate-500"}>{n.texto.replace(/^estado de cuenta /, "")}</span>;
}

function GrupoFilas({ grupo: g, detalle, fechas, fecha }: { grupo: ReturnType<typeof agruparPorEmpresa>["grupos"][number]; detalle: boolean; fechas: FechasEstadoCuenta | undefined; fecha: string }) {
  // Resumen por empresa: la cuenta más atrasada manda.
  const masVieja = g.cuentas.map((c) => fechas?.get(c.cuenta_id)).filter((f): f is { al: string | null; ultimo: string | null } => !!f).sort((a, b) => (a.al ?? "") < (b.al ?? "") ? -1 : 1)[0];
  return (
    <>
      <tr className={`border-t border-slate-200 ${detalle ? "bg-slate-50 font-medium" : ""}`}>
        <td className="px-3 py-2 text-slate-900">
          <Link to={`/movimientos?empresa=${g.empresa_id}`} className="hover:underline" title="Ver los últimos movimientos de la empresa">
            {g.empresa_nombre}
          </Link>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{moneda(g.saldo_inicial)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{g.entradas ? moneda(g.entradas) : "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums text-red-700">{g.salidas ? moneda(g.salidas) : "—"}</td>
        <td className="px-3 py-2 text-right font-semibold tabular-nums">{moneda(g.saldo_final)}</td>
        <td className="px-3 py-2 text-xs">{!detalle && <NotaEstadoCuenta f={masVieja} fecha={fecha} />}</td>
      </tr>
      {detalle &&
        g.cuentas.map((c) => (
          <tr key={c.cuenta_id} className="border-t border-slate-100 text-slate-600">
            <td className="px-3 py-1.5 pl-8">
              <Link to={`/movimientos?empresa=${c.empresa_id}&cuenta=${c.cuenta_id}`} className="hover:underline" title="Ver los últimos movimientos de esta cuenta">
                {c.banco} {c.ultimos_4}
              </Link>
              {c.alias && <span className="text-slate-400"> · {c.alias}</span>}
              {!c.tiene_movimientos && <span className="ml-1 text-[10px] text-amber-600">sin carga</span>}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums">{moneda(c.saldo_inicial)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{c.entradas ? moneda(c.entradas) : "—"}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{c.salidas ? moneda(c.salidas) : "—"}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{moneda(c.saldo_final)}</td>
            <td className="px-3 py-1.5 text-xs">
              <NotaEstadoCuenta f={fechas?.get(c.cuenta_id)} fecha={fecha} />
            </td>
          </tr>
        ))}
    </>
  );
}
