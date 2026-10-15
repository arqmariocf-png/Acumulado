import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface OpcionBuscador {
  clave: string;
  titulo: string;
  detalle?: string;
}

/** Campo de texto con lista de coincidencias debajo (proveedores, partidas…).
 * Se puede escribir libre; flechas + Enter o clic eligen. La lista va con
 * posición fija para que no la recorte una tabla con scroll horizontal. */
export function CampoBuscador({
  value,
  onChange,
  opciones,
  onElegir,
  placeholder,
  className,
  vacio,
  autoFocus,
}: {
  value: string;
  onChange: (texto: string) => void;
  opciones: OpcionBuscador[];
  onElegir: (clave: string) => void;
  placeholder?: string;
  className?: string;
  /** Texto cuando no hay coincidencias (no se muestra si no se pasa). */
  vacio?: string;
  autoFocus?: boolean;
}) {
  const [abierta, setAbierta] = useState(false);
  const [activa, setActiva] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const reubicar = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 280) });
  };

  useLayoutEffect(() => {
    if (abierta) reubicar();
  }, [abierta, value]);

  useEffect(() => {
    if (!abierta) return;
    window.addEventListener("scroll", reubicar, true);
    window.addEventListener("resize", reubicar);
    return () => {
      window.removeEventListener("scroll", reubicar, true);
      window.removeEventListener("resize", reubicar);
    };
  }, [abierta]);

  useEffect(() => setActiva(0), [value]);

  function elegir(i: number) {
    const o = opciones[i];
    if (!o) return;
    onElegir(o.clave);
    setAbierta(false);
  }

  const mostrar = abierta && pos && (opciones.length > 0 || (!!vacio && value.trim() !== ""));

  return (
    <>
      <input
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={!!mostrar}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setAbierta(true);
        }}
        onFocus={() => setAbierta(true)}
        onBlur={() => setTimeout(() => setAbierta(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAbierta(true);
            setActiva((a) => Math.min(a + 1, Math.max(opciones.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiva((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && mostrar && opciones.length > 0) {
            e.preventDefault();
            elegir(activa);
          } else if (e.key === "Escape") {
            setAbierta(false);
          }
        }}
        className={className}
      />
      {mostrar && (
        <ul role="listbox" style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 60 }} className="max-h-72 overflow-y-auto rounded border border-slate-300 bg-white py-1 text-left shadow-lg">
          {opciones.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">{vacio}</li>}
          {opciones.map((o, i) => (
            <li
              key={o.clave}
              role="option"
              aria-selected={i === activa}
              // mousedown en vez de click: el input no pierde el foco antes de elegir.
              onMouseDown={(e) => {
                e.preventDefault();
                elegir(i);
              }}
              onMouseEnter={() => setActiva(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === activa ? "bg-slate-100" : ""}`}
            >
              <div className="text-sm text-slate-900">{o.titulo}</div>
              {o.detalle && <div className="text-[11px] text-slate-500">{o.detalle}</div>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
