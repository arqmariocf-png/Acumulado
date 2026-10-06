import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase, urlFuncion } from "../lib/supabase";
import { errorDeFuncion } from "../lib/funciones";
import { FUENTES_ARCHIVO, claseArchivo, consultaFirmada, esFuenteArchivo } from "../lib/verArchivo";

// Página propia para ver un archivo privado: pide una liga firmada nueva cada
// vez que se carga, así la pestaña sirve aunque se recargue horas después
// (antes la pestaña tenía la liga de Storage y caducaba: "InvalidJWT").
export function VerArchivo() {
  const [params] = useSearchParams();
  const fuente = params.get("f");
  const id = params.get("id");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    async function cargar() {
      setError(null);
      setUrl(null);
      if (!esFuenteArchivo(fuente) || !id) {
        setError("Liga de archivo incompleta.");
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        const respuesta = await fetch(`${urlFuncion("")}${consultaFirmada(fuente, id)}`, {
          headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        });
        const json = await respuesta.json().catch(() => null);
        if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
        if (vivo) setUrl(json.url);
      } catch (e) {
        if (vivo) setError((e as Error).message);
      }
    }
    cargar();
    return () => {
      vivo = false;
    };
  }, [fuente, id, intento]);

  const titulo = esFuenteArchivo(fuente) ? FUENTES_ARCHIVO[fuente].titulo : "Archivo";
  useEffect(() => {
    document.title = titulo;
  }, [titulo]);

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 text-sm">
        <span className="font-medium text-slate-800">{titulo}</span>
        <span className="flex-1" />
        <button onClick={() => setIntento((n) => n + 1)} className="rounded border border-slate-300 px-2 py-1 text-xs">
          Recargar
        </button>
        {url && (
          <a href={url} target="_blank" rel="noopener" className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white">
            Descargar / abrir aparte
          </a>
        )}
      </div>
      {error && <p className="m-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!error && !url && <p className="m-4 text-sm text-slate-500">Cargando…</p>}
      {url && claseArchivo(url) === "imagen" && (
        <div className="flex flex-1 items-center justify-center overflow-auto p-4">
          <img src={url} alt={titulo} className="max-h-full max-w-full object-contain" />
        </div>
      )}
      {url && claseArchivo(url) === "pdf" && <iframe src={url} title={titulo} className="w-full flex-1 border-0" />}
      {url && claseArchivo(url) === "otro" && (
        <p className="m-4 text-sm text-slate-700">
          Este tipo de archivo no se puede mostrar aquí.{" "}
          <a href={url} className="underline">
            Descárgalo
          </a>
          .
        </p>
      )}
    </div>
  );
}
