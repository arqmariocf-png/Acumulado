import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../lib/supabase";
import { errorDeFuncion } from "../lib/funciones";
import { useAuth } from "../lib/auth";
import { rutaVerArchivo } from "../lib/verArchivo";

/** Comprobante de un pago (Delia, 29-sep-2026): subir (admin/corporativo/
 * dirección) y ver (quien ve el pago). Edge `pagos-comprobante`, bucket
 * privado cargas/pagos/… */
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
          <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])} />
        </>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </span>
  );
}
