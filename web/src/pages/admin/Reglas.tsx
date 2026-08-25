import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { ReglaClasificacion } from "../../types/database";

// Admin de reglas_clasificacion (SPEC.md sección 4.3 + 6): editable sin
// tocar código, para que el motor de conciliación las use en la próxima
// corrida (motor-conciliacion se debe re-ejecutar después de cambios aquí).
export function Reglas() {
  const queryClient = useQueryClient();
  const { data: reglas, isLoading } = useQuery({
    queryKey: ["admin-reglas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reglas_clasificacion").select("*").order("orden");
      if (error) throw error;
      return data as ReglaClasificacion[];
    },
  });

  const toggleActivo = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase.from("reglas_clasificacion").update({ activo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-reglas"] }),
  });

  const crear = useMutation({
    mutationFn: async (nueva: { palabra_clave: string; etiqueta: string; orden: number }) => {
      const { error } = await supabase.from("reglas_clasificacion").insert(nueva);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-reglas"] }),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    crear.mutate({
      palabra_clave: String(form.get("palabra_clave")).toUpperCase(),
      etiqueta: String(form.get("etiqueta")),
      orden: Number(form.get("orden")) || 999,
    });
    e.currentTarget.reset();
  }

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        Palabra clave detectada en Comentarios/Referencia → etiqueta N/A-. Orden menor se evalúa primero (reglas específicas antes que genéricas).
      </p>

      <form onSubmit={onSubmit} className="mb-6 flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Palabra clave</label>
          <input name="palabra_clave" required className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Etiqueta (N/A - …)</label>
          <input name="etiqueta" required className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Orden</label>
          <input name="orden" type="number" defaultValue={999} className="w-20 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <button disabled={crear.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          Agregar
        </button>
      </form>

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}

      {reglas && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Orden</th>
                <th className="px-3 py-2">Palabra clave</th>
                <th className="px-3 py-2">Etiqueta</th>
                <th className="px-3 py-2">Activa</th>
              </tr>
            </thead>
            <tbody>
              {reglas.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{r.orden}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.palabra_clave}</td>
                  <td className="px-3 py-2">{r.etiqueta}</td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={r.activo} onChange={(e) => toggleActivo.mutate({ id: r.id, activo: e.target.checked })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
