// "De qué cuenta sale cada pago" (9-nov-2026, Mario: "en programación de
// pagos necesito un apartado visible para tesorería (Delia) para ver a qué
// cuenta se va a pagar de manera específica"). Mismo bloque en Programación
// de pagos (dirección asigna la cuenta a lo que no la tiene) y en Tesorería
// (Delia ve por cuenta cuánto sale, contra el saldo del banco).
import { Link } from "react-router-dom";
import { moneda } from "../lib/saldosEmpresas";
import { agruparPorCuenta, quedaEnCuenta, textoCuenta, type CuentaCargo, type PagoConCuenta } from "../lib/cuentaCargo";

export interface PagoCuentaVista extends PagoConCuenta {
  beneficiario: string;
  concepto?: string | null;
  id_orden?: string | null;
}

export function CuentasDeCargo({
  id = "cuenta-cargo",
  titulo = "De qué cuenta sale cada pago",
  pagos,
  cuentas,
  nombreEmpresa,
  hoy,
  saldos,
  onAsignar,
  ocupado = false,
}: {
  id?: string;
  titulo?: string;
  pagos: PagoCuentaVista[];
  cuentas: CuentaCargo[];
  nombreEmpresa: Map<string, string>;
  hoy: string;
  /** Saldo del banco por cuenta (último estado de cuenta), si se tiene. */
  saldos?: Map<string, number>;
  /** Dirección asigna la cuenta a los pagos que no la tienen; sin esto solo se ve. */
  onAsignar?: (pagoId: string, cuentaId: string) => void;
  ocupado?: boolean;
}) {
  const { grupos, sinCuenta, total } = agruparPorCuenta(pagos, cuentas);
  if (grupos.length === 0 && sinCuenta.length === 0) return null;
  const totalSin = sinCuenta.reduce((s, g) => s + g.total, 0);
  const nSin = sinCuenta.reduce((s, g) => s + g.n, 0);
  return (
    <div id={id} className={`mb-4 scroll-mt-20 rounded border bg-white ${nSin > 0 ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div>
          <p className="text-sm font-semibold text-slate-700">{titulo}</p>
          <p className="text-xs text-slate-500">Transferencias y cheques pendientes agrupados por la cuenta bancaria de la que salen. El efectivo no entra aquí.</p>
        </div>
        <p className="text-sm tabular-nums text-slate-600">{moneda(total)}</p>
      </div>
      {grupos.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-1">Empresa</th>
              <th className="px-3 py-1">Cuenta de cargo</th>
              <th className="px-3 py-1 text-right">Pagos</th>
              <th className="px-3 py-1 text-right">Hoy y vencidos</th>
              <th className="px-3 py-1 text-right">Total programado</th>
              {saldos && <th className="px-3 py-1 text-right">Saldo banco</th>}
              {saldos && <th className="px-3 py-1 text-right">Queda</th>}
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => {
              const hoyVenc = g.pagos.filter((p) => p.fecha_programada <= hoy).reduce((s, p) => s + Number(p.monto), 0);
              const saldo = saldos ? saldos.get(g.cuenta!.id) ?? null : null;
              const queda = saldos ? quedaEnCuenta(saldo, g.total) : null;
              return (
                <tr key={g.cuenta!.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{nombreEmpresa.get(g.empresa_id) ?? ""}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-slate-900">{textoCuenta(g.cuenta)}</span>
                    <details className="text-xs text-slate-500">
                      <summary className="cursor-pointer select-none">ver los {g.n} pago(s)</summary>
                      <ul className="mt-1 space-y-0.5">
                        {g.pagos.map((p) => (
                          <li key={p.id}>
                            {p.fecha_programada} · {p.beneficiario}
                            {p.id_orden ? ` · OC ${p.id_orden}` : ""} · <span className="tabular-nums">{moneda(Number(p.monto))}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{g.n}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{hoyVenc ? moneda(hoyVenc) : "—"}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{moneda(g.total)}</td>
                  {saldos && <td className="px-3 py-2 text-right tabular-nums text-slate-600">{saldo == null ? <span className="text-slate-400">sin estado de cuenta</span> : moneda(saldo)}</td>}
                  {saldos && <td className={`px-3 py-2 text-right font-medium tabular-nums ${queda != null && queda < 0 ? "text-red-700" : "text-slate-900"}`}>{queda == null ? "—" : moneda(queda)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {nSin > 0 && (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-sm font-medium text-amber-900">
            Sin cuenta definida: {nSin} pago(s) · {moneda(totalSin)}
            {!onAsignar && (
              <>
                {" "}
                ·{" "}
                <Link to="/finanzas/pagos#cuenta-cargo" className="underline">
                  dirección la define en Programación de pagos
                </Link>
              </>
            )}
          </p>
          <ul className="mt-1 space-y-1 text-xs text-amber-900">
            {sinCuenta.flatMap((g) =>
              g.pagos.map((p) => {
                const opciones = cuentas.filter((c) => c.empresa_id === p.empresa_id);
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {nombreEmpresa.get(p.empresa_id) ?? ""} · {p.fecha_programada} · {p.beneficiario}
                      {p.id_orden ? ` · OC ${p.id_orden}` : ""} · <span className="tabular-nums">{moneda(Number(p.monto))}</span>
                    </span>
                    {onAsignar &&
                      (opciones.length === 0 ? (
                        <span className="text-amber-700">(la empresa no tiene cuentas bancarias activas)</span>
                      ) : (
                        <select defaultValue="" disabled={ocupado} onChange={(e) => e.target.value && onAsignar(p.id, e.target.value)} className="rounded border border-amber-300 bg-white px-1.5 py-0.5 text-xs" aria-label={`Cuenta de cargo para ${p.beneficiario}`}>
                          <option value="">Elegir cuenta…</option>
                          {opciones.map((c) => (
                            <option key={c.id} value={c.id}>
                              {textoCuenta(c)}
                            </option>
                          ))}
                        </select>
                      ))}
                  </li>
                );
              }),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
