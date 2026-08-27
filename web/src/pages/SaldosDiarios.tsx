import { useState } from "react";
import { supabase, urlFuncion } from "../lib/supabase";

/** Descarga el PDF de reporte-saldos-diario -- a diferencia del resto de
 * funciones de este proyecto (que devuelven JSON), esta responde el PDF
 * binario directo, así que se lee como blob y se dispara la descarga con un
 * <a> temporal en vez de mostrar el resultado en pantalla. */
async function descargarReporte(): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const respuesta = await fetch(urlFuncion("reporte-saldos-diario"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!respuesta.ok) {
    let mensaje = `Error ${respuesta.status}`;
    try {
      const json = await respuesta.json();
      if (json.error) mensaje = json.error;
    } catch {
      // La respuesta de error no vino en JSON -- se queda el mensaje genérico.
    }
    throw new Error(mensaje);
  }

  const blob = await respuesta.blob();
  const url = URL.createObjectURL(blob);
  const nombreArchivo = respuesta.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "grupo-loma-saldos.pdf";
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

export function SaldosDiarios() {
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultimaDescarga, setUltimaDescarga] = useState<Date | null>(null);

  async function onGenerar() {
    setError(null);
    setGenerando(true);
    try {
      await descargarReporte();
      setUltimaDescarga(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerando(false);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Saldos bancarios (Grupo Loma)</h1>

      <div className="max-w-2xl space-y-3 rounded border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">
          Genera el PDF consolidado de las 8 empresas con la posición global de cada cuenta bancaria y el desglose de
          entradas/salidas de ayer y de hoy. Es el reporte que tesorería sube para programar los pagos y compras (OS/OV)
          cargados en el backoffice.
        </p>
        <button
          onClick={onGenerar}
          disabled={generando}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {generando ? "Generando…" : "Generar y descargar PDF"}
        </button>
        {ultimaDescarga && !error && (
          <p className="text-xs text-emerald-700">
            ✔ Descargado a las {ultimaDescarga.toLocaleTimeString("es-MX")}.
          </p>
        )}
        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            ❌ No se pudo generar el reporte: {error}
          </p>
        )}
      </div>
    </div>
  );
}
