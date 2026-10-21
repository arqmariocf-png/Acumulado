import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { normalizarBusqueda } from "../../lib/buscadorCaptura";
import {
  CATEGORIAS_ITEM,
  claveSugerida,
  etiquetaCategoria,
  filtrarCatalogo,
  posiblesDuplicados,
  revisarItem,
  type CategoriaItem,
  type FormItem,
  type ItemCompra,
} from "../../lib/catalogoItems";
import { useItemsCompra } from "./useItemsCompra";
import { BotonImportarBackoffice } from "../../components/BotonImportarBackoffice";

// Catálogo propio de items de compras (21-oct-2026, Mario: "para compras, un
// módulo para agregar nuevos items"). Items sin proveedor (clave, descripción,
// unidad, categoría, IVA, precio de referencia s/IVA) que salen en el buscador
// de OC/OS y de requisiciones; cada proveedor liga su precio al item.

const dinero = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 }));
const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const VACIO: FormItem = { clave: "", descripcion: "", unidad: "", categoria: "material", precio: "" };

const MOSTRAR = 300;

export function CatalogoItems() {
  const { soloConsulta } = useAuth();
  const items = useItemsCompra();
  const [texto, setTexto] = useState("");
  const [categoria, setCategoria] = useState<CategoriaItem | "">("");
  const [inactivos, setInactivos] = useState(false);
  const [editando, setEditando] = useState<ItemCompra | "nuevo" | null>(null);
  const [detalle, setDetalle] = useState<ItemCompra | null>(null);

  const lista = useMemo(() => filtrarCatalogo(items.data ?? [], texto, categoria, inactivos), [items.data, texto, categoria, inactivos]);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Catálogo de items</h1>
      <p className="mb-4 max-w-3xl text-sm text-slate-500">
        Los materiales, consumibles, herramienta y servicios que compramos, sin depender de un proveedor. Salen en el buscador al capturar órdenes de compra o
        servicio y requisiciones; cada proveedor puede ligar su precio al item en Proveedores y artículos. Precios sin IVA.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Buscar
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Descripción o clave" className="mt-1 block w-64 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          Categoría
          <select value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaItem | "")} className="mt-1 block rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Todas</option>
            {CATEGORIAS_ITEM.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 pb-2 text-xs text-slate-600">
          <input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} /> ver desactivados
        </label>
        {!soloConsulta && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <BotonImportarBackoffice funcion="fn_items_importar_backoffice" que="items" invalidar={["compras-items", "ordenes-ia-catalogo"]} />
            <button
              type="button"
              onClick={() => {
                setDetalle(null);
                setEditando("nuevo");
              }}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              + Nuevo item
            </button>
          </div>
        )}
      </div>

      {editando && (
        <EditorItem
          item={editando === "nuevo" ? null : editando}
          items={items.data ?? []}
          onCerrar={() => setEditando(null)}
        />
      )}

      {items.error && <p className="mb-3 text-sm text-red-600">{(items.error as Error).message}</p>}
      {items.isLoading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Clave</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2">Unidad</th>
                <th className="px-3 py-2">Categoría</th>
                <th className="px-3 py-2 text-right">Precio ref. s/IVA</th>
                <th className="px-3 py-2 text-center">IVA</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    {(items.data ?? []).length === 0 ? 'Todavía no hay items. Da de alta el primero con "+ Nuevo item".' : "Sin coincidencias."}
                  </td>
                </tr>
              )}
              {lista.slice(0, MOSTRAR).map((i) => (
                <tr key={i.id} className={`border-t border-slate-100 ${i.activo ? "" : "text-slate-400"} ${detalle?.id === i.id ? "bg-sky-50" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{i.clave}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setDetalle(detalle?.id === i.id ? null : i)} className="text-left text-sky-800 hover:underline">
                      {i.descripcion}
                    </button>
                    {!i.activo && <span className="ml-1 text-xs">(desactivado)</span>}
                  </td>
                  <td className="px-3 py-2">{i.unidad ?? ""}</td>
                  <td className="px-3 py-2">{etiquetaCategoria(i.categoria)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{dinero(i.precio_referencia)}</td>
                  <td className="px-3 py-2 text-center">{i.iva ? "sí" : "no"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {!soloConsulta && (
                      <button type="button" onClick={() => setEditando(i)} className="text-xs text-sky-700 underline">
                        editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lista.length > MOSTRAR && (
            <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
              Se muestran {MOSTRAR} de {lista.length.toLocaleString("es-MX")}; escribe en Buscar para encontrar el resto.
            </p>
          )}
        </div>
      )}

      {detalle && <DetalleItem item={detalle} soloConsulta={soloConsulta} onCerrar={() => setDetalle(null)} />}
    </div>
  );
}

function EditorItem({ item, items, onCerrar }: { item: ItemCompra | null; items: ItemCompra[]; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<FormItem>(
    item
      ? { clave: item.clave, descripcion: item.descripcion, unidad: item.unidad ?? "", categoria: item.categoria, precio: item.precio_referencia == null ? "" : String(item.precio_referencia) }
      : VACIO,
  );
  const [iva, setIva] = useState(item?.iva ?? true);
  const [notas, setNotas] = useState(item?.notas ?? "");
  const [error, setError] = useState<string | null>(null);
  const dup = useMemo(() => posiblesDuplicados(items, f.descripcion, item?.id), [items, f.descripcion, item?.id]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["compras-items"] });
    qc.invalidateQueries({ queryKey: ["ordenes-ia-catalogo"] });
  };
  const guardar = useMutation({
    mutationFn: async () => {
      const problema = revisarItem(f);
      if (problema) throw new Error(problema);
      if (dup.exacto) throw new Error(`Ya existe: ${dup.exacto.clave} · ${dup.exacto.descripcion}.`);
      const fila = {
        clave: f.clave.trim() || null,
        descripcion: f.descripcion.trim(),
        unidad: f.unidad.trim() || null,
        categoria: f.categoria,
        iva,
        precio_referencia: f.precio.trim() === "" ? null : Number(f.precio),
        notas: notas.trim() || null,
      };
      const { error } = item ? await supabase.from("compras_items").update(fila).eq("id", item.id) : await supabase.from("compras_items").insert(fila);
      if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? "Ya hay un item con esa clave o esa descripción." : error.message);
    },
    onSuccess: () => {
      invalidar();
      onCerrar();
    },
    onError: (e: Error) => setError(e.message),
  });
  const activar = useMutation({
    mutationFn: async (activo: boolean) => {
      const { error } = await supabase.from("compras_items").update({ activo }).eq("id", item!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar();
      onCerrar();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        guardar.mutate();
      }}
      className="mb-4 grid grid-cols-1 gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-6"
    >
      <p className="text-sm font-medium text-slate-800 sm:col-span-6">{item ? `Editar ${item.clave}` : "Nuevo item"}</p>
      <label className="text-xs text-slate-600 sm:col-span-3">
        Descripción
        <input value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} autoFocus placeholder="Ej. Cemento gris 50 kg" className={campo} />
      </label>
      <label className="text-xs text-slate-600">
        Clave
        <input value={f.clave} onChange={(e) => setF({ ...f, clave: e.target.value })} placeholder={item ? "" : `${claveSugerida(items)} (sola)`} className={campo} />
      </label>
      <label className="text-xs text-slate-600">
        Unidad
        <input value={f.unidad} onChange={(e) => setF({ ...f, unidad: e.target.value })} placeholder="pza, bulto, m…" className={campo} />
      </label>
      <label className="text-xs text-slate-600">
        Categoría
        <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} className={campo}>
          {CATEGORIAS_ITEM.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.etiqueta}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-600">
        Precio de referencia s/IVA
        <input type="number" min="0" step="0.01" value={f.precio} onChange={(e) => setF({ ...f, precio: e.target.value })} className={campo} />
      </label>
      <label className="flex items-center gap-1 self-end pb-2 text-xs text-slate-600">
        <input type="checkbox" checked={iva} onChange={(e) => setIva(e.target.checked)} /> lleva IVA
      </label>
      <label className="text-xs text-slate-600 sm:col-span-4">
        Notas
        <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Marca, especificación, dónde se usa…" className={campo} />
      </label>
      {(dup.exacto || dup.parecidos.length > 0) && (
        <p className={`text-xs sm:col-span-6 ${dup.exacto ? "text-red-700" : "text-amber-700"}`}>
          {dup.exacto ? `Ya existe: ${dup.exacto.clave} · ${dup.exacto.descripcion}. ` : "Parecidos ya dados de alta: "}
          {dup.parecidos.map((p) => `${p.clave} · ${p.descripcion}`).join(" · ")}
        </p>
      )}
      {error && <p className="text-xs text-red-700 sm:col-span-6">{error}</p>}
      <div className="flex flex-wrap gap-2 sm:col-span-6">
        <button disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {guardar.isPending ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={onCerrar} className="px-2 text-sm text-slate-600 underline">
          Cancelar
        </button>
        {item && (
          <button type="button" onClick={() => activar.mutate(!item.activo)} className="ml-auto text-xs text-red-700 underline">
            {item.activo ? "Desactivar (ya no sale en los buscadores)" : "Reactivar"}
          </button>
        )}
      </div>
    </form>
  );
}

interface ArticuloProveedor {
  id: string;
  descripcion: string;
  unidad: string | null;
  precio: number | null;
  iva: boolean;
  item_id: string | null;
  updated_at: string;
  proveedores: { nombre: string } | null;
}

interface Compra {
  fecha: string;
  folio: string;
  tipo: string | null;
  proveedor: string | null;
  empresa: string | null;
  proyecto: string | null;
  cantidad: number | null;
  unidad: string | null;
  precio: number | null;
}

function DetalleItem({ item, soloConsulta, onCerrar }: { item: ItemCompra; soloConsulta: boolean; onCerrar: () => void }) {
  const qc = useQueryClient();
  const precios = useQuery({
    queryKey: ["compras-items", "precios", item.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proveedor_articulos")
        .select("id, descripcion, unidad, precio, iva, item_id, updated_at, proveedores(nombre)")
        .eq("activo", true);
      if (error) throw error;
      const n = normalizarBusqueda(item.descripcion);
      return ((data ?? []) as unknown as ArticuloProveedor[])
        .filter((a) => a.item_id === item.id || (!a.item_id && normalizarBusqueda(a.descripcion) === n))
        .sort((a, b) => (a.precio ?? Infinity) - (b.precio ?? Infinity));
    },
  });
  const compras = useQuery({
    queryKey: ["compras-items", "compras", item.descripcion],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_item_ultimas_compras", { p_descripcion: item.descripcion });
      if (error) throw error;
      return (data ?? []) as Compra[];
    },
  });
  const ligar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("proveedor_articulos").update({ item_id: item.id }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["compras-items", "precios", item.id] }),
  });

  return (
    <div className="mt-4 space-y-3 rounded border border-sky-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">
            {item.clave} · {item.descripcion}
          </p>
          <p className="text-xs text-slate-500">
            {etiquetaCategoria(item.categoria)} · {item.unidad ?? "sin unidad"} · referencia {dinero(item.precio_referencia)} s/IVA{item.notas ? ` · ${item.notas}` : ""}
          </p>
        </div>
        <button type="button" onClick={onCerrar} className="text-xs text-slate-600 underline">
          cerrar
        </button>
      </div>

      <div>
        <p className="mb-1 text-sm font-semibold text-slate-800">Precio por proveedor</p>
        {precios.isLoading ? (
          <p className="text-xs text-slate-500">Cargando…</p>
        ) : (precios.data ?? []).length === 0 ? (
          <p className="text-xs text-slate-500">Ningún proveedor lo tiene en su lista. Se agrega en Proveedores y artículos, eligiendo este item.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {(precios.data ?? []).map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="py-1 pr-2">{a.proveedores?.nombre ?? "—"}</td>
                  <td className="py-1 pr-2 text-xs text-slate-500">{a.descripcion}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{dinero(a.precio)}</td>
                  <td className="py-1 text-right text-xs">
                    {a.item_id === item.id ? (
                      <span className="text-emerald-700">ligado</span>
                    ) : soloConsulta ? null : (
                      <button type="button" onClick={() => ligar.mutate(a.id)} className="text-sky-700 underline">
                        ligar al item
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <p className="mb-1 text-sm font-semibold text-slate-800">Últimas compras con esta descripción</p>
        {compras.isLoading ? (
          <p className="text-xs text-slate-500">Cargando…</p>
        ) : compras.error ? (
          <p className="text-xs text-red-600">{(compras.error as Error).message}</p>
        ) : (compras.data ?? []).length === 0 ? (
          <p className="text-xs text-slate-500">No hay órdenes con exactamente esta descripción.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 pr-2">Fecha</th>
                  <th className="py-1 pr-2">Orden</th>
                  <th className="py-1 pr-2">Proveedor</th>
                  <th className="py-1 pr-2">Obra</th>
                  <th className="py-1 pr-2 text-right">Cantidad</th>
                  <th className="py-1 text-right">Precio s/IVA</th>
                </tr>
              </thead>
              <tbody>
                {(compras.data ?? []).map((c, k) => (
                  <tr key={`${c.folio}-${k}`} className="border-t border-slate-100">
                    <td className="whitespace-nowrap py-1 pr-2">{c.fecha}</td>
                    <td className="whitespace-nowrap py-1 pr-2">
                      {c.tipo ?? "OC"} {c.folio} <span className="text-xs text-slate-400">{c.empresa}</span>
                    </td>
                    <td className="py-1 pr-2">{c.proveedor ?? "—"}</td>
                    <td className="py-1 pr-2 text-xs">{c.proyecto ?? ""}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {c.cantidad ?? ""} {c.unidad ?? ""}
                    </td>
                    <td className="py-1 text-right tabular-nums">{dinero(c.precio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
