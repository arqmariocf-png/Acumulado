import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { BarcodeScanner } from "../../components/BarcodeScanner";
import type { Producto } from "../../types/database";

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

function useProductos(empresaId: string) {
  return useQuery({
    queryKey: ["productos", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("productos").select("*").eq("empresa_id", empresaId).order("nombre");
      if (error) throw error;
      return data as Producto[];
    },
  });
}

export function Productos() {
  const { veTodasLasEmpresas, perfil } = useAuth();
  const queryClient = useQueryClient();
  const { data: empresas } = useEmpresas();
  const [empresaId, setEmpresaId] = useState(perfil?.empresa_id ?? "");
  const { data: productos, isLoading, error: errorLista } = useProductos(empresaId);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<Producto | null>(null);
  const [codigoBarras, setCodigoBarras] = useState("");
  const [mostrarCamara, setMostrarCamara] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function abrirNuevo() {
    setEditando(null);
    setCodigoBarras("");
    setMostrarForm(true);
    setError(null);
  }

  function abrirEditar(p: Producto) {
    setEditando(p);
    setCodigoBarras(p.codigo_barras ?? "");
    setMostrarForm(true);
    setError(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const form = new FormData(e.currentTarget);
      const payload = {
        empresa_id: empresaId,
        sku: String(form.get("sku") ?? "").trim(),
        codigo_barras: codigoBarras.trim() || null,
        nombre: String(form.get("nombre") ?? "").trim(),
        descripcion: String(form.get("descripcion") ?? "").trim() || null,
        unidad_medida: String(form.get("unidad_medida") ?? "PZA").trim() || "PZA",
        costo_referencia: form.get("costo_referencia") ? Number(form.get("costo_referencia")) : null,
        activo: form.get("activo") === "on",
      };
      if (editando) {
        const { error: errUpdate } = await supabase.from("productos").update(payload).eq("id", editando.id);
        if (errUpdate) throw errUpdate;
      } else {
        const { error: errInsert } = await supabase.from("productos").insert(payload);
        if (errInsert) throw errInsert;
      }
      setMostrarForm(false);
      queryClient.invalidateQueries({ queryKey: ["productos", empresaId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {veTodasLasEmpresas ? (
            <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Selecciona una empresa…</option>
              {empresas?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-slate-500">Empresa: la asignada a tu usuario.</p>
          )}
        </div>
        {empresaId && (
          <button onClick={abrirNuevo} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            + Nuevo producto
          </button>
        )}
      </div>

      {!empresaId && <p className="text-sm text-slate-500">Selecciona una empresa para ver su catálogo.</p>}
      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {errorLista && <p className="text-sm text-red-600">Error: {(errorLista as Error).message}</p>}

      {mostrarForm && (
        <form onSubmit={onSubmit} className="mb-4 max-w-lg space-y-3 rounded border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">{editando ? "Editar producto" : "Nuevo producto"}</h2>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Nombre</label>
            <input name="nombre" defaultValue={editando?.nombre} required className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div className="flex gap-3">
            <div className="w-1/2">
              <label className="mb-1 block text-xs font-medium text-slate-600">SKU</label>
              <input name="sku" defaultValue={editando?.sku} required className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <div className="w-1/2">
              <label className="mb-1 block text-xs font-medium text-slate-600">Unidad de medida</label>
              <input name="unidad_medida" defaultValue={editando?.unidad_medida ?? "PZA"} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Código de barras</label>
            <div className="flex gap-2">
              <input
                value={codigoBarras}
                onChange={(e) => setCodigoBarras(e.target.value)}
                placeholder="Escanea con la cámara o escribe manualmente"
                className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => setMostrarCamara(true)}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Cámara
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Descripción</label>
            <input name="descripcion" defaultValue={editando?.descripcion ?? ""} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Costo de referencia (opcional)</label>
            <input
              name="costo_referencia"
              type="number"
              step="0.01"
              defaultValue={editando?.costo_referencia ?? ""}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" name="activo" defaultChecked={editando ? editando.activo : true} />
            Activo
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button disabled={enviando} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {enviando ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" onClick={() => setMostrarForm(false)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {mostrarCamara && (
        <BarcodeScanner
          onDetectado={(c) => {
            setCodigoBarras(c);
            setMostrarCamara(false);
          }}
          onCerrar={() => setMostrarCamara(false)}
        />
      )}

      {productos && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Código de barras</th>
                <th className="px-3 py-2">Unidad</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{p.sku}</td>
                  <td className="px-3 py-2">{p.nombre}</td>
                  <td className="px-3 py-2">{p.codigo_barras ?? <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2">{p.unidad_medida}</td>
                  <td className="px-3 py-2">{p.activo ? "Activo" : "Inactivo"}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => abrirEditar(p)} className="text-xs text-slate-600 hover:underline">
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
              {productos.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                    Sin productos todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
