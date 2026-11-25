import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { METODOS_PAGO, type MetodoPago, cuentasDeEmpresa, fechaSugerida, metodoSugerido, revisarCambioMetodo, textoCambioMetodo, type CuentaCargoOpcion } from "../lib/cambiarMetodoPago";

// Botón "Cambiar a transferencia" / "Cambiar método" (25-nov-2026, Mario:
// "crea el botón para hacerlo manual"): un pago que quedó en efectivo por
// una devolución equivocada de tesorería (o al revés) se regresa sin SQL.
// Por pago llama fn_pago_cambiar_metodo; por OC (Efectivo por confirmar
// lista OC, no pagos) fn_oc_pagos_cambiar_metodo, que toma todos los pagos
// pendientes de la orden o, si no hay, solo corrige la OC.

interface Props {
  pagoId?: string;
  ocId?: string;
  empresaId: string;
  metodoActual: string | null | undefined;
  beneficiario: string;
  monto: string;
  fechaProgramada?: string | null;
  onHecho: (mensaje: string) => void;
  etiqueta?: string;
  className?: string;
}

function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CambiarMetodoPago({ pagoId, ocId, empresaId, metodoActual, beneficiario, monto, fechaProgramada, onHecho, etiqueta, className }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [metodo, setMetodo] = useState<MetodoPago>(metodoSugerido(metodoActual));
  const [cuentaId, setCuentaId] = useState("");
  const hoy = hoyIso();
  const [fecha, setFecha] = useState(fechaSugerida(fechaProgramada, hoy));
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-bancarias", "activas"],
    enabled: abierto,
    queryFn: async () => {
      const { data, error: err } = await supabase.from("cuentas_bancarias").select("id, empresa_id, banco, ultimos_4, alias, activo").eq("activo", true).order("banco");
      if (err) throw err;
      return data as CuentaCargoOpcion[];
    },
  });
  const cuentasEmpresa = useMemo(() => cuentasDeEmpresa(cuentas, empresaId), [cuentas, empresaId]);
  const cuentaElegida = cuentasEmpresa.length === 1 ? cuentasEmpresa[0].id : cuentaId;
  const ayuda = METODOS_PAGO.find((m) => m.clave === metodo)?.ayuda;
  const texto = etiqueta ?? (metodoActual === "efectivo" ? "Cambiar a transferencia" : "Cambiar método de pago");

  async function enviar() {
    const falta = revisarCambioMetodo(metodoActual, metodo, cuentaElegida || null, cuentasEmpresa);
    if (falta) {
      setError(falta);
      return;
    }
    setOcupado(true);
    setError(null);
    const args = { p_metodo: metodo, p_cuenta_id: metodo === "efectivo" ? null : cuentaElegida || null, p_fecha: fecha || null, p_nota: nota.trim() || null };
    const { error: err } = pagoId
      ? await supabase.rpc("fn_pago_cambiar_metodo", { p_pago: pagoId, ...args })
      : await supabase.rpc("fn_oc_pagos_cambiar_metodo", { p_oc: ocId, ...args });
    setOcupado(false);
    if (err) {
      setError(err.message);
      return;
    }
    setAbierto(false);
    setNota("");
    onHecho(textoCambioMetodo(beneficiario, metodo, cuentasEmpresa.find((c) => c.id === cuentaElegida), metodo === "efectivo" ? null : fecha));
  }

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={className ?? "text-sky-700 underline"} title="Cambiar entre transferencia, cheque y efectivo sin cancelar el pago">
        {texto}
      </button>
      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !ocupado && setAbierto(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-4 text-left shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">Cambiar el método de pago</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {beneficiario} · {monto}. Hoy está en <b>{metodoActual ?? "—"}</b>. El pago no se cancela: queda la nota del cambio.
            </p>
            <label className="mt-3 block text-xs font-medium text-slate-700">Nuevo método</label>
            <select value={metodo} onChange={(e) => setMetodo(e.target.value as MetodoPago)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
              {METODOS_PAGO.map((m) => (
                <option key={m.clave} value={m.clave} disabled={m.clave === metodoActual}>
                  {m.etiqueta}
                  {m.clave === metodoActual ? " (actual)" : ""}
                </option>
              ))}
            </select>
            {ayuda && <p className="mt-1 text-[11px] text-slate-500">{ayuda}</p>}
            {metodo !== "efectivo" && (
              <>
                <label className="mt-3 block text-xs font-medium text-slate-700">De qué cuenta sale</label>
                {cuentasEmpresa.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-700">La empresa no tiene cuentas activas: queda sin cuenta y se elige después en "De qué cuenta sale cada pago".</p>
                ) : (
                  <select value={cuentaElegida} onChange={(e) => setCuentaId(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                    <option value="">Elige la cuenta…</option>
                    {cuentasEmpresa.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.banco} {c.ultimos_4}
                        {c.alias ? ` · ${c.alias}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                <label className="mt-3 block text-xs font-medium text-slate-700">Fecha para pagarlo</label>
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
              </>
            )}
            <label className="mt-3 block text-xs font-medium text-slate-700">Nota (opcional)</label>
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. la devolución a efectivo fue un error" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setAbierto(false)} disabled={ocupado} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={enviar} disabled={ocupado} className="rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
                {ocupado ? "Cambiando…" : "Cambiar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
