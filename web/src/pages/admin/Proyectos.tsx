import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { Proyecto } from "../../types/database";

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

function useProyectos(empresaId: string, busqueda: string) {
  return useQuery({
    queryKey: ["admin-proyectos", empresaId, busqueda],
    queryFn: async () => {
      let query = supabase.from("proyectos").select("*").eq("activo", true).order("nombre");
      if (empresaId) query = query.eq("empresa_id", empresaId);
      if (busqueda.trim()) query = query.ilike("nombre", `%${busqueda.trim()}%`);
      const { data, error } = await query.limit(300);
      if (error) throw error;
      return data as Proyecto[];
    },
  });
}

function usePerfiles() {
  return useQuery({
    queryKey: ["admin-perfiles-para-proyectos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, nombre, rol").order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

// Da de alta a los proyectos activos (Excel maestro, 2026-08-27) importaron
// responsable_nombre/comprador_nombre como texto crudo -- aquí se vincula
// esa persona a su cuenta real (profiles) en cuanto la tenga, para que
// pueda entrar y ver/capturar solo sus proyectos.
export function Proyectos() {
  const queryClient = useQueryClient();
  const { data: empresas } = useEmpresas();
  const { data: perfiles } = usePerfiles();
  const [empresaId, setEmpresaId] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const { data: proyectos, isLoading } = useProyectos(empresaId, busqueda);

  const vincular = useMutation({
    mutationFn: async ({ id, campo, valor }: { id: string; campo: "responsable_id" | "comprador_id"; valor: string | null }) => {
      const { error } = await supabase.from("proyectos").update({ [campo]: valor }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-proyectos"] }),
  });

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Vincula el responsable/comprador de cada proyecto a su cuenta real una vez que la tenga -- solo entonces podrá
        entrar a capturar requisiciones de ese proyecto.
      </p>

      <div className="mb-4 flex flex-wrap gap-3">
        <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">Todas las empresas</option>
          {empresas?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar proyecto por nombre…"
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}

      {proyectos && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Proyecto</th>
                <th className="px-3 py-2">Responsable</th>
                <th className="px-3 py-2">Comprador</th>
              </tr>
            </thead>
            <tbody>
              {proyectos.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{p.nombre}</td>
                  <td className="px-3 py-2">
                    <p className="mb-1 text-xs text-slate-500">{p.responsable_nombre ?? "—"}</p>
                    <select
                      value={p.responsable_id ?? ""}
                      onChange={(e) => vincular.mutate({ id: p.id, campo: "responsable_id", valor: e.target.value || null })}
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="">Sin vincular</option>
                      {perfiles?.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre} ({u.rol})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <p className="mb-1 text-xs text-slate-500">{p.comprador_nombre ?? "—"}</p>
                    <select
                      value={p.comprador_id ?? ""}
                      onChange={(e) => vincular.mutate({ id: p.id, campo: "comprador_id", valor: e.target.value || null })}
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="">Sin vincular</option>
                      {perfiles?.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre} ({u.rol})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {proyectos.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-slate-400">
                    Sin proyectos para este filtro.
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
