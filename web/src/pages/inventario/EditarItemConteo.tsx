import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { revisarItem, UNIDADES_CONTEO, type ItemConteo } from "../../lib/conteoInventario";
import { lugaresParaContar, nombreUbicacion } from "../../lib/ubicacionesBodega";
import { useUbicaciones } from "./RacksNiveles";
import { useAlmacenes } from "./AlmacenesEmpresa";

// Editar todos los campos de un ítem ya contado (19-nov-2026, Mario: "agrega
// un botón para editar también los campos"): descripción, cantidad, unidad,
// almacén, lugar o ubicación a mano, código de barras y notas. Lo guarda quien
// lo contó o quien administra el conteo (la policy de update de conteo_items).
// Un renglón que es herramienta (HE-) se queda en 1 pza y conserva su folio.

interface Props {
  item: ItemConteo;
  empresaNombre: string;
  onCerrar: () => void;
  onGuardado: (item: ItemConteo) => void;
}

export function EditarItemConteo({ item, empresaNombre, onCerrar, onGuardado }: Props) {
  const qc = useQueryClient();
  const esHerramienta = !!item.herramienta_id;
  const [descripcion, setDescripcion] = useState(item.descripcion);
  const [cantidad, setCantidad] = useState(String(item.cantidad));
  const [unidad, setUnidad] = useState(item.unidad);
  const [almacenId, setAlmacenId] = useState(item.almacen_id ?? "");
  const [ubicacionId, setUbicacionId] = useState(item.ubicacion_id ?? "");
  const [ubicacion, setUbicacion] = useState(item.ubicacion_id ? "" : (item.ubicacion ?? ""));
  const [codigoBarras, setCodigoBarras] = useState(item.codigo_barras ?? "");
  const [notas, setNotas] = useState(item.notas ?? "");
  const [error, setError] = useState<string | null>(null);
  const { data: almacenes } = useAlmacenes(item.empresa_id);
  const { data: ubicaciones } = useUbicaciones(item.empresa_id);
  const almacenesActivos = useMemo(() => (almacenes ?? []).filter((a) => a.activo || a.id === item.almacen_id), [almacenes, item.almacen_id]);
  const lugares = useMemo(() => {
    const todos = lugaresParaContar(ubicaciones ?? []);
    return almacenId ? todos.filter((u) => !u.almacen_id || u.almacen_id === almacenId || u.id === item.ubicacion_id) : todos;
  }, [ubicaciones, almacenId, item.ubicacion_id]);
  const nombreLugar = useMemo(() => new Map((ubicaciones ?? []).map((u) => [u.id, u])), [ubicaciones]);

  useEffect(() => {
    // Al cambiar el lugar, el ítem toma el almacén del rack (igual que la base).
    const u = ubicacionId ? nombreLugar.get(ubicacionId) : null;
    if (u?.almacen_id) setAlmacenId(u.almacen_id);
  }, [ubicacionId, nombreLugar]);

  const guardar = useMutation({
    mutationFn: async () => {
      if (!esHerramienta) {
        const falta = revisarItem({ empresa_id: item.empresa_id, descripcion, cantidad, unidad });
        if (falta) throw new Error(falta);
      } else if (!descripcion.trim()) {
        throw new Error("Escribe qué herramienta es.");
      }
      const cambios = {
        descripcion: descripcion.trim(),
        cantidad: esHerramienta ? 1 : Number(cantidad.replace(/,/g, "")),
        unidad: esHerramienta ? "pza" : unidad.trim() || "pza",
        almacen_id: almacenId || null,
        ubicacion_id: ubicacionId || null,
        ubicacion: ubicacionId ? null : ubicacion.trim() || null,
        codigo_barras: esHerramienta ? item.codigo_barras : codigoBarras.trim() || null,
        notas: notas.trim() || null,
      };
      const { data, error: err } = await supabase
        .from("conteo_items")
        .update(cambios)
        .eq("id", item.id)
        .select("id, conteo_id, empresa_id, codigo, descripcion, cantidad, unidad, ubicacion, ubicacion_id, almacen_id, codigo_barras, notas, producto_id, herramienta_id, contado_por, contado_por_nombre, created_at")
        .single();
      if (err) throw err;
      if (!data) throw new Error("No se pudo guardar: no tienes permiso para editar este ítem.");
      if (esHerramienta && descripcion.trim() !== item.descripcion) {
        // El nombre de la herramienta sigue al renglón (si la policy lo deja; si no, se queda).
        await supabase.from("herramientas").update({ nombre: descripcion.trim().slice(0, 200) }).eq("id", item.herramienta_id!);
      }
      return { ...(data as ItemConteo), cantidad: Number((data as ItemConteo).cantidad) };
    },
    onSuccess: (it) => {
      qc.invalidateQueries({ queryKey: ["conteo-items", item.conteo_id] });
      onGuardado(it);
    },
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!guardar.isPending) guardar.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={onCerrar}>
      <form onSubmit={onSubmit} onClick={(e) => e.stopPropagation()} className="mt-8 w-full max-w-2xl rounded border border-slate-200 bg-white p-4 shadow-lg" data-sin-borrador>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            Editar {item.codigo} · {empresaNombre}
            {esHerramienta && <span className="ml-2 rounded bg-violet-100 px-1.5 text-[10px] text-violet-800">🔧 herramienta {item.codigo_barras}</span>}
          </h2>
          <button type="button" onClick={onCerrar} className="text-sm text-slate-500 hover:underline">
            cerrar
          </button>
        </div>
        {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="grid gap-3 md:grid-cols-6">
          <label className="block text-sm md:col-span-6">
            <span className="block text-xs text-slate-500">Descripción</span>
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5" autoFocus />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="block text-xs text-slate-500">Cantidad</span>
            <input value={cantidad} onChange={(e) => setCantidad(e.target.value)} inputMode="decimal" disabled={esHerramienta} className="w-full rounded border border-slate-300 px-2 py-1.5 text-right disabled:bg-slate-100" />
            {esHerramienta && <span className="block text-xs text-slate-500">Una pieza por renglón; para más piezas, da de alta otra.</span>}
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="block text-xs text-slate-500">Unidad</span>
            <input value={unidad} onChange={(e) => setUnidad(e.target.value)} list="unidades-editar-conteo" disabled={esHerramienta} className="w-full rounded border border-slate-300 px-2 py-1.5 disabled:bg-slate-100" />
            <datalist id="unidades-editar-conteo">
              {UNIDADES_CONTEO.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="block text-xs text-slate-500">Almacén</span>
            <select value={almacenId} onChange={(e) => setAlmacenId(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5">
              <option value="">— sin almacén —</option>
              {almacenesActivos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                  {a.activo ? "" : " (baja)"}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm md:col-span-3">
            <span className="block text-xs text-slate-500">{lugares.length ? "Lugar (rack · nivel) o ubicación a mano" : "Ubicación (bodega, rack, obra…)"}</span>
            {lugares.length > 0 && (
              <select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)} className="mb-1 w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="">— escribir la ubicación a mano —</option>
                {lugares.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.codigo} · {nombreUbicacion(u)}
                  </option>
                ))}
              </select>
            )}
            {!ubicacionId && <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5" placeholder="bodega, rack, obra…" />}
          </label>
          <label className="block text-sm md:col-span-3">
            <span className="block text-xs text-slate-500">Código de barras</span>
            <input value={codigoBarras} onChange={(e) => setCodigoBarras(e.target.value)} disabled={esHerramienta} className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono disabled:bg-slate-100" />
          </label>
          <label className="block text-sm md:col-span-6">
            <span className="block text-xs text-slate-500">Notas</span>
            <input value={notas} onChange={(e) => setNotas(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5" />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Guardar cambios
          </button>
          <button type="button" onClick={onCerrar} className="text-sm text-slate-600 hover:underline">
            Cancelar
          </button>
          <span className="text-xs text-slate-500">Contó {item.contado_por_nombre ?? "—"}. El código {item.codigo} y su QR no cambian.</span>
        </div>
      </form>
    </div>
  );
}
