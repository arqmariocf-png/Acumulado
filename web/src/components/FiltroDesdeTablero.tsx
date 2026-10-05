import { useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

/** Filtro con el que llega una pantalla desde un pendiente del tablero
 * (?ver=…; Mario, 5-oct-2026: "que los dirijas directo al problema"). */
export function useVer(): [string | null, () => void] {
  const [params, setParams] = useSearchParams();
  const ver = params.get("ver");
  const quitar = () => {
    const sig = new URLSearchParams(params);
    sig.delete("ver");
    setParams(sig, { replace: true });
  };
  return [ver, quitar];
}

/** Aviso arriba de la lista: qué se está mostrando y cómo ver todo. */
export function AvisoFiltro({ texto, total, onQuitar }: { texto: string; total?: number; onQuitar: () => void }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span className="font-medium">Mostrando solo: {texto}</span>
      {typeof total === "number" && <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs">{total}</span>}
      <button type="button" onClick={onQuitar} className="ml-auto text-xs underline">
        Ver todo
      </button>
    </div>
  );
}

/** Con #seccion en la liga, baja a esa sección cuando aparece (las listas
 * cargan después) y la resalta un momento. Va una vez en el Layout. */
export function IrAlAncla() {
  const { hash, pathname } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    let intentos = 0;
    const t = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el || ++intentos > 30) {
        window.clearInterval(t);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          el.classList.add("ring-2", "ring-amber-400");
          window.setTimeout(() => el.classList.remove("ring-2", "ring-amber-400"), 2500);
        }
      }
    }, 200);
    return () => window.clearInterval(t);
  }, [hash, pathname]);
  return null;
}
