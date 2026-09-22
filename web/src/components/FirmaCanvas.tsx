import { useEffect, useRef, useState } from "react";

/** Lienzo para dibujar la firma con el dedo o el mouse. `onCambio` recibe
 * el PNG (data URL) cada vez que se termina un trazo, o null si está vacío. */
export function FirmaCanvas({ onCambio, alto = 160 }: { onCambio: (png: string | null) => void; alto?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const [vacio, setVacio] = useState(true);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const escala = window.devicePixelRatio || 1;
    const anchoCss = c.clientWidth;
    c.width = Math.round(anchoCss * escala);
    c.height = Math.round(alto * escala);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(escala, escala);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, [alto]);

  function punto(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function inicio(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    dibujando.current = true;
    const p = punto(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function mover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return;
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    e.preventDefault();
    const p = punto(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function fin(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return;
    dibujando.current = false;
    e.preventDefault();
    setVacio(false);
    onCambio(ref.current!.toDataURL("image/png"));
  }
  function limpiar() {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setVacio(true);
    onCambio(null);
  }

  return (
    <div>
      <canvas
        ref={ref}
        style={{ height: alto, touchAction: "none" }}
        className="w-full rounded border border-dashed border-slate-400 bg-white"
        onPointerDown={inicio}
        onPointerMove={mover}
        onPointerUp={fin}
        onPointerCancel={fin}
        onPointerLeave={fin}
      />
      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>{vacio ? "Firma aquí con el dedo o el mouse" : "Firma capturada"}</span>
        <button type="button" onClick={limpiar} className="underline">
          Borrar y volver a firmar
        </button>
      </div>
    </div>
  );
}
