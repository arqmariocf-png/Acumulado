import { useCallback, useEffect, useRef, useState } from "react";

/** Recuadro para firmar con el dedo o el mouse. Entrega un PNG (data URL) en
 * cuanto hay trazo, o null si se borra. */
export function FirmaDigital({ onCambio, alto = 160 }: { onCambio: (png: string | null) => void; alto?: number }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const hayTrazo = useRef(false);
  const [vacio, setVacio] = useState(true);

  const ctx = useCallback(() => {
    const c = lienzo.current;
    if (!c) return null;
    const g = c.getContext("2d");
    if (!g) return null;
    g.lineWidth = 2.4;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#0f172a";
    return g;
  }, []);

  useEffect(() => {
    const c = lienzo.current;
    if (!c) return;
    // Resolución fija y chica: la firma pesa poco (cabe sobrada en 150 KB).
    c.width = 560;
    c.height = Math.round((560 * alto) / 400);
  }, [alto]);

  function punto(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = lienzo.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  }

  function terminar() {
    if (!dibujando.current) return;
    dibujando.current = false;
    const c = lienzo.current;
    if (c && hayTrazo.current) onCambio(c.toDataURL("image/png"));
  }

  return (
    <div>
      <canvas
        ref={lienzo}
        className="w-full touch-none rounded border-2 border-dashed border-slate-400 bg-white"
        style={{ height: alto }}
        onPointerDown={(e) => {
          const g = ctx();
          if (!g) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dibujando.current = true;
          const p = punto(e);
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x + 0.1, p.y + 0.1);
          g.stroke();
          hayTrazo.current = true;
          setVacio(false);
        }}
        onPointerMove={(e) => {
          if (!dibujando.current) return;
          const g = ctx();
          if (!g) return;
          const p = punto(e);
          g.lineTo(p.x, p.y);
          g.stroke();
        }}
        onPointerUp={terminar}
        onPointerCancel={terminar}
        onPointerLeave={terminar}
      />
      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>{vacio ? "Firma aquí con tu dedo" : "Así quedará tu firma"}</span>
        <button
          type="button"
          className="text-sky-700 underline"
          onClick={() => {
            const c = lienzo.current;
            c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
            hayTrazo.current = false;
            setVacio(true);
            onCambio(null);
          }}
        >
          Borrar
        </button>
      </div>
    </div>
  );
}
