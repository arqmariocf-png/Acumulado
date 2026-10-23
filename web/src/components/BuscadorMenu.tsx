import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { GRUPOS_MENU, type SeccionMenu } from "../lib/menu";
import { EVENTO_ABRIR_BUSCADOR, buscarMenu, esAtajoBuscador, indiceMenu, itemsObras, type ItemBusqueda } from "../lib/buscadorMenu";

// Buscador de pantallas (23-oct-2026, Mario: "en todos los menús ponles una
// opción de buscador"). Se abre desde "Buscar" en el encabezado, en cada menú
// desplegable y en la barra de la sección, o con Ctrl+K / ⌘K / "/". Busca en
// los menús que ve la persona (pantallas y pestañas) y en las obras activas;
// flechas y Enter abren, Esc cierra.

/** Lo llaman los botones "Buscar" del encabezado, de cada menú y de la barra. */
export function abrirBuscador(): void {
  window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_BUSCADOR));
}

export function BuscadorMenu({ secciones }: { secciones: SeccionMenu[] }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const abrir = () => setAbierto(true);
    const teclas = (e: KeyboardEvent) => {
      if (esAtajoBuscador(e)) {
        e.preventDefault();
        setAbierto(true);
      }
    };
    window.addEventListener(EVENTO_ABRIR_BUSCADOR, abrir);
    window.addEventListener("keydown", teclas);
    return () => {
      window.removeEventListener(EVENTO_ABRIR_BUSCADOR, abrir);
      window.removeEventListener("keydown", teclas);
    };
  }, []);
  useEffect(() => {
    if (abierto) {
      setTexto("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [abierto]);

  const { data: obras } = useQuery({
    queryKey: ["buscador-obras"],
    enabled: abierto,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("proyectos").select("id, nombre, empresas(codigo)").eq("activo", true).order("nombre").limit(500);
      if (error) throw error;
      return (data ?? []).map((p) => ({ id: p.id as string, nombre: p.nombre as string, empresa: (p.empresas as unknown as { codigo: string } | null)?.codigo ?? null }));
    },
  });
  const items = useMemo<ItemBusqueda[]>(() => [...indiceMenu(secciones, GRUPOS_MENU), ...itemsObras(obras ?? [])], [secciones, obras]);
  const resultados = useMemo(() => buscarMenu(items, texto, 12), [items, texto]);
  useEffect(() => setCursor(0), [texto]);

  function ir(item: ItemBusqueda) {
    setAbierto(false);
    navigate(item.ruta);
  }
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]" onMouseDown={() => setAbierto(false)}>
      <div role="dialog" aria-label="Buscar pantalla" className="w-full max-w-xl rounded-xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setAbierto(false);
            else if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, resultados.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            else if (e.key === "Enter" && resultados[cursor]) ir(resultados[cursor]);
          }}
          placeholder="¿A dónde quieres ir? (pantalla, pestaña u obra)"
          className="w-full rounded-t-xl border-b border-slate-200 px-4 py-3 text-base outline-none"
          autoComplete="off"
        />
        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {resultados.map((r, i) => (
            <li key={`${r.ruta}-${r.etiqueta}`}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => ir(r)}
                className={`flex w-full items-start justify-between gap-3 px-4 py-2 text-left ${i === cursor ? "bg-slate-100" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{r.etiqueta}</span>
                  <span className="block truncate text-xs text-slate-500">{r.camino}{r.descripcion ? ` · ${r.descripcion}` : ""}</span>
                </span>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">{r.tipo}</span>
              </button>
            </li>
          ))}
          {resultados.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Nada con "{texto}". Prueba con otra palabra: lo que hace la pantalla, el nombre del menú o de la obra.</li>}
        </ul>
        <div className="flex justify-between rounded-b-xl border-t border-slate-100 px-4 py-1.5 text-[11px] text-slate-400">
          <span>↑↓ para moverte · Enter abre · Esc cierra</span>
          <span>Ctrl+K o ⌘K desde cualquier pantalla</span>
        </div>
      </div>
    </div>
  );
}
