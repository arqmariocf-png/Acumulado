import { useEffect, useRef, useState } from "react";

// @zxing/browser se carga dinámico (import()) para que el chunk de esta
// librería (decodificación de códigos de barras) no vaya en el bundle
// principal -- solo se descarga cuando alguien realmente abre la cámara,
// igual que las páginas se cargan lazy en App.tsx.
type ZxingBrowser = typeof import("@zxing/browser");

interface Props {
  onDetectado: (codigo: string) => void;
  onCerrar: () => void;
}

/** Modal de escaneo por cámara -- complemento del lector físico USB/Bluetooth
 * (que ya funciona con cualquier <input> de texto porque esos lectores
 * simplemente "escriben" el código + Enter, no necesitan este componente). */
export function BarcodeScanner({ onDetectado, onCerrar }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;

    import("@zxing/browser").then(async (zxing: ZxingBrowser) => {
      if (!activo || !videoRef.current) return;
      try {
        const lector = new zxing.BrowserMultiFormatReader();
        const controles = await lector.decodeFromVideoDevice(undefined, videoRef.current, (resultado, _err, controles) => {
          if (resultado) {
            controles.stop();
            onDetectado(resultado.getText());
          }
        });
        if (!activo) {
          controles.stop();
          return;
        }
        controlsRef.current = controles;
      } catch (err) {
        if (activo) setError((err as Error).message || "No se pudo acceder a la cámara.");
      }
    });

    return () => {
      activo = false;
      controlsRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Escanear código de barras</h2>
          <button onClick={onCerrar} className="text-sm text-slate-500 hover:text-slate-700">
            Cerrar
          </button>
        </div>
        {error ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            No se pudo abrir la cámara: {error}. Verifica los permisos del navegador o usa un lector físico.
          </p>
        ) : (
          <video ref={videoRef} className="w-full rounded bg-slate-900" muted />
        )}
        <p className="mt-2 text-xs text-slate-500">Apunta la cámara al código de barras del producto.</p>
      </div>
    </div>
  );
}
