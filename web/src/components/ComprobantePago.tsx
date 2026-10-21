import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../lib/supabase";
import { errorDeFuncion } from "../lib/funciones";
import { useAuth } from "../lib/auth";
import { rutaVerArchivo } from "../lib/verArchivo";

/** Comprobante de un pago (Delia, 29-sep-2026): subir (admin/corporativo/
 * dirección) y ver (quien ve el pago). Edge `pagos-comprobante`, bucket
 * privado cargas/pagos/… "quitar" (21-oct-2026) deshace un comprobante
 * subido al pago equivocado con fn_pago_quitar_comprobante: también quita la
 * confirmación y, si la OC es en efectivo, el pago pasa a Efectivo por
 * confirmar. */
export function ComprobantePago({ pagoId, nombre, compacto = false }: { pagoId: string; nombre: string | null; compacto?: boolean }) {
  const { perfil, soloConsulta } = useAuth();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const puedeSubir = !soloConsulta && (perfil?.rol === "admin" || perfil?.rol === "corporativo" || perfil?.rol === "direccion");

  function ver() {
    // Página propia que pide la liga firmada al cargar (no caduca en la pestaña).
    window.open(rutaVerArchivo("pago", pagoId), "_blank");
  }

  async function subir(archivo: File) {
    setError(null);
    setOcupado(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const fd = new FormData();
      fd.append("pagoId", pagoId);
      fd.append("file", archivo, archivo.name);
      const respuesta = await fetch(urlFuncion("pagos-comprobante"), { method: "POST", headers: { Authorization: `Bearer ${sessionData.session?.access_token}` }, body: fd });
      if (!respuesta.ok) {
        const json = await respuesta.json().catch(() => null);
        throw new Error((await errorDeFuncion(respuesta, json)).message);
      }
      for (const k of [["tesoreria"], ["pagos-programados"]]) queryClient.invalidateQueries({ queryKey: k });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function quitar() {
    const motivo = window.prompt(`¿Por qué se quita el comprobante "${nombre}"? (por ejemplo: era de otro pago)`);
    if (motivo == null) return;
    if (!motivo.trim()) {
      setError("Escribe por qué se quita.");
      return;
    }
    setError(null);
    setOcupado(true);
    try {
      const { data, error: err } = await supabase.rpc("fn_pago_quitar_comprobante", { p_pago: pagoId, p_motivo: motivo.trim() });
      if (err) throw err;
      for (const k of [["tesoreria"], ["pagos-programados"], ["oc-pagos"], ["efectivo-por-confirmar"]]) queryClient.invalidateQueries({ queryKey: k });
      if ((data as { pasa_a_efectivo?: boolean } | null)?.pasa_a_efectivo) {
        window.alert("Comprobante quitado. Esta OC es en efectivo: el pago pasó a Efectivo por confirmar (lo confirma dirección).");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const clase = compacto ? "text-[11px]" : "text-xs";
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${clase}`}>
      {nombre ? (
        <button type="button" onClick={ver} className="text-emerald-700 underline" title={nombre}>
          comprobante
        </button>
      ) : (
        <span className="text-slate-400">sin comprobante</span>
      )}
      {puedeSubir && (
        <>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={ocupado} className="text-slate-500 underline disabled:opacity-50">
            {ocupado ? "subiendo…" : nombre ? "reemplazar" : "subir"}
          </button>
          {nombre && (
            <button type="button" onClick={quitar} disabled={ocupado} className="text-red-700 underline disabled:opacity-50" title="Si se subió al pago equivocado">
              quitar
            </button>
          )}
          <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])} />
        </>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </span>
  );
}
