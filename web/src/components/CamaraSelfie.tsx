import { useEffect, useRef, useState } from "react";

/** Cámara dentro de la página (getUserMedia) para la selfie del checador.
 * Salir a la app de cámara del teléfono con <input capture> perdía la foto
 * en algunos Android (Christian, 28-sep-2026): el navegador descarga la
 * pestaña mientras la cámara está abierta y al volver no hay archivo. Aquí
 * la foto nunca sale de la página. Si el navegador no da cámara (permiso
 * negado, sin cámara, WebView viejo) se avisa con `onSinCamara` y el padre
 * cae al selector de archivo. */
export function CamaraSelfie({ abierta, onCaptura, onCerrar, onSinCamara }: { abierta: boolean; onCaptura: (foto: Blob) => void; onCerrar: () => void; onSinCamara: (motivo: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [lista, setLista] = useState(false);
  const [capturando, setCapturando] = useState(false);

  useEffect(() => {
    if (!abierta) return;
    let cancelado = false;
    setLista(false);
    const media = navigator.mediaDevices?.getUserMedia;
    if (!media) {
      onSinCamara("Este navegador no permite abrir la cámara desde la página.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1024 }, height: { ideal: 1024 } }, audio: false })
      .then((s) => {
        if (cancelado) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => undefined);
        }
        setLista(true);
      })
      .catch((e: DOMException) => {
        if (cancelado) return;
        onSinCamara(e?.name === "NotAllowedError" ? "No se dio permiso a la cámara. Elige la foto con el otro botón." : "No se pudo abrir la cámara. Elige la foto con el otro botón.");
      });
    return () => {
      cancelado = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [abierta, onSinCamara]);

  if (!abierta) return null;

  function capturar() {
    const v = video.current;
    if (!v || !lista || capturando) return;
    setCapturando(true);
    const ancho = v.videoWidth || 640;
    const alto = v.videoHeight || 480;
    const escala = Math.min(1, 1024 / Math.max(ancho, alto));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(ancho * escala);
    lienzo.height = Math.round(alto * escala);
    const ctx = lienzo.getContext("2d");
    if (!ctx) {
      setCapturando(false);
      onSinCamara("No se pudo procesar la imagen. Elige la foto con el otro botón.");
      return;
    }
    ctx.drawImage(v, 0, 0, lienzo.width, lienzo.height);
    lienzo.toBlob(
      (b) => {
        setCapturando(false);
        if (b) onCaptura(b);
        else onSinCamara("No se pudo guardar la foto. Elige la foto con el otro botón.");
      },
      "image/jpeg",
      0.82,
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4" role="dialog" aria-label="Tomar foto">
      <video ref={video} playsInline muted autoPlay className="max-h-[70vh] w-full max-w-md rounded-lg bg-black object-cover" style={{ transform: "scaleX(-1)" }} />
      {!lista && <p className="mt-3 text-sm text-slate-200">Abriendo la cámara… si el teléfono pregunta, permite el acceso.</p>}
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={onCerrar} className="rounded border border-slate-400 px-4 py-3 text-sm font-medium text-slate-100">
          Cancelar
        </button>
        <button type="button" onClick={capturar} disabled={!lista || capturando} className="rounded bg-emerald-600 px-6 py-3 text-lg font-semibold text-white disabled:opacity-50">
          {capturando ? "Guardando…" : "Tomar foto"}
        </button>
      </div>
    </div>
  );
}
