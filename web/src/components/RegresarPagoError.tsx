import { useState } from "react";
import { supabase } from "../lib/supabase";
import { TIPOS_ERROR_PAGO, revisarDevolucion, type TipoErrorPago } from "../lib/regresarPago";

// Botón "Regresar con error" de Tesorería (5-nov-2026, Mario: "Delia me
// comenta que se agregue un botón en los pagos porque hay errores y le
// llegan en transferencia cuando debería ser en efectivo; con esto regresa
// el error y lo documenta"). Abre un panel con el tipo de error y el motivo
// y llama fn_pago_regresar_error: el pago queda documentado, sale de
// Tesorería y dirección recibe el aviso.

interface Resultado {
  pasa_a_efectivo?: boolean;
  oc_a_efectivo?: boolean;
  avisados?: number;
}

export function RegresarPagoError({ pagoId, beneficiario, monto, onHecho, className }: { pagoId: string; beneficiario: string; monto: string; onHecho: (mensaje: string) => void; className?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<TipoErrorPago>("efectivo");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ayuda = TIPOS_ERROR_PAGO.find((t) => t.clave === tipo)?.ayuda;

  async function enviar() {
    const falta = revisarDevolucion(tipo, motivo);
    if (falta) {
      setError(falta);
      return;
    }
    setOcupado(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("fn_pago_regresar_error", { p_pago: pagoId, p_tipo: tipo, p_motivo: motivo.trim() || null });
    setOcupado(false);
    if (err) {
      setError(err.message);
      return;
    }
    const r = (data ?? {}) as Resultado;
    setAbierto(false);
    setMotivo("");
    onHecho(
      r.pasa_a_efectivo
        ? `Pago a ${beneficiario} regresado: pasó a efectivo y dirección lo confirma en Efectivo por confirmar${r.avisados ? " (ya tiene el aviso)" : ""}.`
        : `Pago a ${beneficiario} regresado a dirección con el motivo${r.avisados ? " (ya tiene el aviso)" : ""}.`,
    );
  }

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={className ?? "text-amber-700 underline"} title="Regresar este pago a dirección documentando el error">
        Regresar con error
      </button>
      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !ocupado && setAbierto(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-4 text-left shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">Regresar el pago con error</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {beneficiario} · {monto}. El pago no se cancela: queda documentado y dirección recibe el aviso para corregirlo.
            </p>
            <label className="mt-3 block text-xs font-medium text-slate-700">¿Qué está mal?</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoErrorPago)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
              {TIPOS_ERROR_PAGO.map((t) => (
                <option key={t.clave} value={t.clave}>
                  {t.etiqueta}
                </option>
              ))}
            </select>
            {ayuda && <p className="mt-1 text-[11px] text-slate-500">{ayuda}</p>}
            <label className="mt-3 block text-xs font-medium text-slate-700">Motivo {tipo === "efectivo" ? "(opcional)" : "(obligatorio)"}</label>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} placeholder={tipo === "efectivo" ? "Ej. la OC dice efectivo y llegó como transferencia" : "Explica qué hay que corregir"} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setAbierto(false)} disabled={ocupado} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={enviar} disabled={ocupado} className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                {ocupado ? "Regresando…" : "Regresar a dirección"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
