import { type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { ExcepcionProveedor } from "../../types/database";

// Admin de excepciones_proveedor (SPEC.md sección 4.4 + 6): proveedores con
// crédito que no cuentan como "falta factura" mientras están en su ventana
// de tolerancia. Editable para agregar proveedores nuevos sin tocar código.
export function Excepciones() {
  const queryClient = useQueryClient();
  const { data: excepciones, isLoading } = useQuery({
    queryKey: ["admin-excepciones"],
    queryFn: async () => {
      const { data, error } = await supabase.from("excepciones_proveedor").select("*").order("proveedor");
      if (error) throw error;
      return data as ExcepcionProveedor[];
    },
  });

  const toggleActivo = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase.from("excepciones_proveedor").update({ activo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-excepciones"] }),
  });

  const crear = useMutation({
    mutationFn: async (nueva: { proveedor: string; descripcion_regla: string; hasta_mes_siguiente: boolean; dias_tolerancia: number | null }) => {
      const { error } = await supabase.from("excepciones_proveedor").insert(nueva);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-excepciones"] }),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const diasTexto = String(form.get("dias_tolerancia") ?? "");
    crear.mutate({
      proveedor: String(form.get("proveedor")),
      descripcion_regla: String(form.get("descripcion_regla")),
      hasta_mes_siguiente: form.get("hasta_mes_siguiente") === "on",
      dias_tolerancia: diasTexto ? Number(diasTexto) : null,
    });
    e.currentTarget.reset();
  }

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        Movimientos de estos proveedores no se marcan 🔴 por falta de factura mientras estén dentro de la ventana de tolerancia; quedan 🟡 pendiente esperado.
      </p>

      <form onSubmit={onSubmit} className="mb-6 flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Proveedor</label>
          <input name="proveedor" required className="w-56 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Descripción de la regla</label>
          <input name="descripcion_regla" required className="w-80 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Días de tolerancia</label>
          <input name="dias_tolerancia" type="number" className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-slate-600">
          <input type="checkbox" name="hasta_mes_siguiente" /> Hasta el mes siguiente
        </label>
        <button disabled={crear.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          Agregar
        </button>
      </form>

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}

      {excepciones && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Proveedor</th>
                <th className="px-3 py-2">Regla</th>
                <th className="px-3 py-2">Tolerancia</th>
                <th className="px-3 py-2">Activa</th>
              </tr>
            </thead>
            <tbody>
              {excepciones.map((ex) => (
                <tr key={ex.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{ex.proveedor}</td>
                  <td className="px-3 py-2">{ex.descripcion_regla}</td>
                  <td className="px-3 py-2">{ex.hasta_mes_siguiente ? "Mes siguiente" : ex.dias_tolerancia ? `${ex.dias_tolerancia} días` : "—"}</td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={ex.activo} onChange={(e) => toggleActivo.mutate({ id: ex.id, activo: e.target.checked })} />
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
