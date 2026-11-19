import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useItemsCompra } from "../compras/useItemsCompra";
import { cruzarItemsConProductos, filtrarItemsConteo, itemsContables, lotes } from "../../lib/itemsConteo";

// Los items del catálogo de compras en el conteo (19-nov-2026, Laura: "en el
// sistema tenemos más de 4 mil ítems"). `compras_items` es por organización
// (8,263 materiales del backoffice); para etiquetarlos con la clave
// consecutiva de SU empresa (ART-<EMP>-####) se dan de alta como productos de
// esa empresa al imprimir (fn_conteo_alta_productos_desde_items, sin duplicar
// por nombre) y la etiqueta sale con esa clave.

export interface ProductoEtiquetable {
  id: string;
  empresa_id?: string;
  sku: string | null;
  clave_control?: string | null;
  nombre: string;
  unidad_medida: string | null;
  codigo_barras: string | null;
}

interface Props {
  empresaId: string;
  empresaNombre: string;
  /** Productos de la empresa (para saber cuáles items ya tienen clave ART-). */
  productos: ProductoEtiquetable[];
  imprimir: (lista: ProductoEtiquetable[], titulo: string) => void;
  onError: (msg: string | null) => void;
  onAviso: (msg: string) => void;
}

export function ItemsComprasConteo({ empresaId, empresaNombre, productos, imprimir, onError, onAviso }: Props) {
  const qc = useQueryClient();
  const { data: items, isLoading } = useItemsCompra(true);
  const [buscar, setBuscar] = useState("");
  const [soloSin, setSoloSin] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  const contables = useMemo(() => itemsContables(items ?? []), [items]);
  const cruce = useMemo(() => cruzarItemsConProductos(contables, productos), [contables, productos]);
  const filtrados = useMemo(() => filtrarItemsConteo(cruce, buscar, soloSin), [cruce, buscar, soloSin]);
  const sinProducto = useMemo(() => cruce.filter((x) => !x.producto).length, [cruce]);
  const marcadosVisibles = filtrados.filter((x) => marcados.has(x.item.id));

  const darAltaEImprimir = useMutation({
    mutationFn: async (ids: string[]) => {
      const salida: ProductoEtiquetable[] = [];
      for (const lote of lotes(ids, 500)) {
        const { data, error } = await supabase.rpc("fn_conteo_alta_productos_desde_items", { p_empresa_id: empresaId, p_item_ids: lote });
        if (error) throw error;
        for (const r of (data ?? []) as { item_id: string; producto_id: string; sku: string; nombre: string; unidad_medida: string | null; codigo_barras: string | null }[]) {
          salida.push({ id: r.producto_id, empresa_id: empresaId, sku: r.sku, clave_control: r.sku, nombre: r.nombre, unidad_medida: r.unidad_medida, codigo_barras: r.codigo_barras });
        }
      }
      return salida;
    },
    onSuccess: (lista) => {
      onError(null);
      qc.invalidateQueries({ queryKey: ["productos-conteo"] });
      const nuevos = lista.filter((p) => !productos.some((x) => x.id === p.id)).length;
      onAviso(`${lista.length} artículo(s) con clave de ${empresaNombre}${nuevos ? ` (${nuevos} dados de alta ahora)` : ""}. Se abre la hoja de etiquetas.`);
      imprimir(lista, `Etiquetas QR · artículos · ${empresaNombre}`);
      setMarcados(new Set());
    },
    onError: (e: Error) => onError(e.message),
  });

  function alternar(id: string) {
    setMarcados((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <section className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Catálogo de items de compras ({contables.length.toLocaleString("es-MX")}) · etiquetar para {empresaNombre}
          </h2>
          <p className="text-xs text-slate-500">
            Los items de Catálogos › Items (del backoffice). Al imprimir, cada uno queda dado de alta como artículo de {empresaNombre} con su clave consecutiva ART- y el QR lleva esa clave. {sinProducto.toLocaleString("es-MX")} todavía no tienen clave en esta empresa.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="buscar item, clave IT- o ART-…" className="min-w-[12rem] rounded border border-slate-300 px-2 py-1" />
          <label className="flex items-center gap-1 text-slate-600">
            <input type="checkbox" checked={soloSin} onChange={(e) => setSoloSin(e.target.checked)} /> solo sin clave en {empresaNombre}
          </label>
          <button
            type="button"
            onClick={() => darAltaEImprimir.mutate(marcadosVisibles.map((x) => x.item.id))}
            disabled={!marcadosVisibles.length || darAltaEImprimir.isPending}
            className="rounded bg-slate-900 px-3 py-1 font-medium text-white disabled:opacity-50"
          >
            {darAltaEImprimir.isPending ? "Dando de alta…" : `🖨 Dar clave e imprimir marcados (${marcadosVisibles.length})`}
          </button>
        </div>
      </div>
      {isLoading ? (
        <p className="px-4 py-3 text-sm text-slate-500">Cargando el catálogo de items…</p>
      ) : !contables.length ? (
        <p className="px-4 py-3 text-sm text-slate-500">No hay items en el catálogo de compras.</p>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={filtrados.length > 0 && filtrados.slice(0, 500).every((x) => marcados.has(x.item.id))}
                    onChange={(e) => setMarcados(e.target.checked ? new Set(filtrados.slice(0, 500).map((x) => x.item.id)) : new Set())}
                    title="marcar los de la lista (hasta 500)"
                  />
                </th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2">Unidad</th>
                <th className="px-3 py-2">Clave en {empresaNombre}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.slice(0, 500).map(({ item, producto }) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-3 py-1">
                    <input type="checkbox" checked={marcados.has(item.id)} onChange={() => alternar(item.id)} />
                  </td>
                  <td className="px-3 py-1 font-mono text-xs text-slate-500">{item.clave}</td>
                  <td className="px-3 py-1">{item.descripcion}</td>
                  <td className="px-3 py-1 text-slate-600">{item.unidad ?? "—"}</td>
                  <td className="px-3 py-1 font-mono text-xs">{producto?.clave_control ?? <span className="font-sans text-slate-400">sin clave todavía</span>}</td>
                  <td className="px-3 py-1 text-right text-xs">
                    <button type="button" onClick={() => darAltaEImprimir.mutate([item.id])} disabled={darAltaEImprimir.isPending} className="text-slate-600 hover:underline disabled:opacity-50">
                      🖨 QR
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtrados.length > 500 && <p className="px-4 py-2 text-xs text-slate-500">Se muestran 500 de {filtrados.length.toLocaleString("es-MX")}; afina la búsqueda.</p>}
          {filtrados.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">Nada con ese texto.</p>}
        </div>
      )}
    </section>
  );
}
