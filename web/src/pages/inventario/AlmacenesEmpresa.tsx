import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { revisarAlmacen, type AlmacenConteo } from "../../lib/conteoInventario";

// Almacenes con nombre (19-nov-2026, Mario: "crea también almacenes con
// nombre para poder dividirlos"). Cada empresa puede tener varios (Bodega de
// material, Zona BBVA, Herrería…); el conteo, los racks y las etiquetas
// cuelgan de ellos. El más viejo ("Almacén principal") sigue siendo el del
// punto de venta y de los movimientos de inventario.

export function useAlmacenes(empresaId: string | null | undefined) {
  return useQuery({
    queryKey: ["almacenes-empresa", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("almacenes").select("id, empresa_id, nombre, descripcion, activo, created_at").eq("empresa_id", empresaId!).order("created_at");
      if (error) throw error;
      return (data ?? []) as AlmacenConteo[];
    },
  });
}

/** Todos los almacenes que la persona puede ver (para nombres en listas y tablero). */
export function useAlmacenesTodos() {
  return useQuery({
    queryKey: ["almacenes-todos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("almacenes").select("id, empresa_id, nombre, descripcion, activo, created_at").order("created_at").limit(2000);
      if (error) throw error;
      return (data ?? []) as AlmacenConteo[];
    },
  });
}

interface Props {
  empresaId: string;
  empresaNombre: string;
  administra: boolean;
  /** Ítems contados por almacén en el conteo actual (almacen_id → cantidad de ítems). */
  contadosPorAlmacen?: Map<string, number>;
}

export function AlmacenesEmpresa({ empresaId, empresaNombre, administra, contadosPorAlmacen }: Props) {
  const qc = useQueryClient();
  const { data: almacenes, isLoading } = useAlmacenes(empresaId);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verInactivos, setVerInactivos] = useState(false);
  const lista = useMemo(() => (almacenes ?? []).filter((a) => verInactivos || a.activo), [almacenes, verInactivos]);
  const inactivos = (almacenes ?? []).filter((a) => !a.activo).length;

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["almacenes-empresa", empresaId] });
    qc.invalidateQueries({ queryKey: ["almacenes-todos"] });
  };
  const agregar = useMutation({
    mutationFn: async () => {
      const falta = revisarAlmacen(nombre, almacenes ?? []);
      if (falta) throw new Error(falta);
      const { error: err } = await supabase.from("almacenes").insert({ empresa_id: empresaId, nombre: nombre.trim(), descripcion: descripcion.trim() || null, activo: true });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      setNombre("");
      setDescripcion("");
      invalidar();
    },
    onError: (e: Error) => setError(e.message),
  });
  const editar = useMutation({
    mutationFn: async (x: { id: string; nombre?: string; descripcion?: string | null; activo?: boolean }) => {
      if (x.nombre !== undefined) {
        const falta = revisarAlmacen(x.nombre, almacenes ?? [], x.id);
        if (falta) throw new Error(falta);
      }
      const { id, ...cambios } = x;
      const { error: err } = await supabase.from("almacenes").update(cambios).eq("id", id);
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      invalidar();
    },
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!agregar.isPending) agregar.mutate();
  }

  return (
    <section className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Almacenes de {empresaNombre}</h2>
          <p className="text-xs text-slate-500">Divide el inventario por almacén con nombre (Bodega de material, Zona BBVA, Herrería…). Cada ítem contado y cada rack dicen a qué almacén pertenecen.</p>
        </div>
        {inactivos > 0 && (
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> ver los {inactivos} dados de baja
          </label>
        )}
      </div>
      {error && <p className="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {administra && (
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3 text-sm" data-sin-borrador>
          <label className="block">
            <span className="block text-xs text-slate-500">Nombre del almacén nuevo</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-56 rounded border border-slate-300 px-2 py-1" placeholder="Bodega de material" />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-500">Descripción (opcional)</span>
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="w-72 rounded border border-slate-300 px-2 py-1" placeholder="qué se guarda ahí, dónde está" />
          </label>
          <button type="submit" disabled={agregar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            + Agregar almacén
          </button>
        </form>
      )}
      {isLoading ? (
        <p className="px-4 py-3 text-sm text-slate-500">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">Esta empresa no tiene almacenes. {administra ? "Agrega el primero arriba." : "Los da de alta almacén o dirección."}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {lista.map((a, idx) => (
            <li key={a.id} className={`flex flex-wrap items-center gap-3 px-4 py-2 text-sm ${a.activo ? "" : "text-slate-400"}`}>
              <span className="font-medium">{a.nombre}</span>
              {idx === 0 && a.activo && <span className="rounded bg-slate-100 px-1.5 text-[10px] uppercase text-slate-600" title="Es el almacén del punto de venta y de los movimientos de inventario">principal</span>}
              {!a.activo && <span className="rounded bg-slate-100 px-1.5 text-[10px] uppercase">baja</span>}
              {a.descripcion && <span className="text-xs text-slate-500">{a.descripcion}</span>}
              {contadosPorAlmacen && <span className="text-xs text-emerald-700">{contadosPorAlmacen.get(a.id) ?? 0} ítem(s) contados</span>}
              {administra && (
                <span className="ml-auto flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const v = window.prompt("Nombre del almacén:", a.nombre);
                      if (v != null && v.trim() && v.trim() !== a.nombre) editar.mutate({ id: a.id, nombre: v.trim() });
                    }}
                    className="text-slate-600 hover:underline"
                  >
                    renombrar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const v = window.prompt("Descripción:", a.descripcion ?? "");
                      if (v != null) editar.mutate({ id: a.id, descripcion: v.trim() || null });
                    }}
                    className="text-slate-600 hover:underline"
                  >
                    descripción
                  </button>
                  {a.activo ? (
                    idx > 0 && (
                      <button type="button" onClick={() => window.confirm(`¿Dar de baja el almacén "${a.nombre}"? Lo ya contado ahí conserva su almacén; solo deja de ofrecerse.`) && editar.mutate({ id: a.id, activo: false })} className="text-red-600 hover:underline">
                        dar de baja
                      </button>
                    )
                  ) : (
                    <button type="button" onClick={() => editar.mutate({ id: a.id, activo: true })} className="text-emerald-700 hover:underline">
                      reactivar
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
