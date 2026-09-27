import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { Proyecto, PuEstado } from "../../types/database";
import { PuntosSemaforoPu } from "./SemaforoPreciosUnitarios";
import { AlmacenPorProyecto, PuntosAlmacen, useRequisicionesPorProyecto } from "./AlmacenProyectos";

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").eq("activo", true).order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

function useProyectos(empresaId: string, busqueda: string, incluirInactivos: boolean) {
  return useQuery({
    queryKey: ["proyectos-ventana", empresaId, busqueda, incluirInactivos],
    queryFn: async () => {
      let q = supabase.from("proyectos").select("*, empresas(nombre)").order("activo", { ascending: false }).order("nombre");
      if (!incluirInactivos) q = q.eq("activo", true);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      if (busqueda.trim()) q = q.ilike("nombre", `%${busqueda.trim()}%`);
      const { data, error } = await q.limit(300);
      if (error) throw error;
      return data as (Proyecto & { empresas: { nombre: string } | null })[];
    },
  });
}

function useSemaforoProyectos(ids: string[]) {
  return useQuery({
    queryKey: ["pu-semaforo-proyectos", ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("pu_analisis").select("proyecto_id, estado, cliente_autorizado_en").in("proyecto_id", ids);
      if (error) throw error;
      const por = new Map<string, { estado: PuEstado; cliente_autorizado_en: string | null }[]>();
      for (const f of (data ?? []) as { proyecto_id: string; estado: PuEstado; cliente_autorizado_en: string | null }[]) {
        const lista = por.get(f.proyecto_id) ?? [];
        lista.push({ estado: f.estado, cliente_autorizado_en: f.cliente_autorizado_en });
        por.set(f.proyecto_id, lista);
      }
      return por;
    },
  });
}

export function Proyectos() {
  const { perfil, veTodasLasEmpresas } = useAuth();
  const queryClient = useQueryClient();
  const { data: empresas } = useEmpresas();
  const [empresaId, setEmpresaId] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: proyectos, isLoading } = useProyectos(empresaId, busqueda, verInactivos);
  // Desactivar deja el proyecto fuera de las listas y de los selectores
  // (requisiciones, PU, tableros) sin borrar nada; se puede reactivar.
  // admin y corporativo en todas; el rol empresa en su empresa.
  const puedeDesactivar = (empresa: string) => !!perfil && (perfil.rol === "admin" || perfil.rol === "corporativo" || (perfil.rol === "empresa" && perfil.empresa_id === empresa));
  const cambiarActivo = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error: err } = await supabase.from("proyectos").update({ activo }).eq("id", id);
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["proyectos-ventana"] });
      queryClient.invalidateQueries({ queryKey: ["proyecto-detalle"] });
    },
    onError: (err) => setError((err as Error).message),
  });
  const { data: semaforos } = useSemaforoProyectos((proyectos ?? []).map((p) => p.id));
  const { data: reqPorProyecto } = useRequisicionesPorProyecto((proyectos ?? []).map((p) => p.id));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Proyectos</h1>

      <div className="mb-4 flex flex-wrap gap-3">
        {veTodasLasEmpresas && (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Todas las empresas</option>
            {empresas?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        )}
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar proyecto por nombre…"
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> ver proyectos desactivados
        </label>
        {proyectos && <span className="text-slate-400">{proyectos.filter((p) => p.activo).length} vivos{verInactivos ? ` · ${proyectos.filter((p) => !p.activo).length} desactivados` : ""}</span>}
      </div>
      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}

      {proyectos && reqPorProyecto && (
        <AlmacenPorProyecto proyectos={proyectos.map((p) => ({ id: p.id, nombre: p.nombre, empresa: veTodasLasEmpresas ? p.empresas?.nombre : null }))} porProyecto={reqPorProyecto} />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {proyectos?.map((p) => (
          <div key={p.id} className={`relative rounded border bg-white p-4 hover:border-slate-400 hover:shadow-sm ${p.activo ? "border-slate-200" : "border-dashed border-slate-300 opacity-70"}`}>
            <Link to={`/proyectos/${p.id}`} className="block">
              <h2 className="font-semibold text-slate-900">
                {p.nombre}
                {!p.activo && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-normal uppercase text-slate-500">desactivado</span>}
              </h2>
              <p className="mt-1 text-xs text-slate-500">{p.empresas?.nombre}</p>
              <p className="mt-2 text-sm text-slate-600">{p.cliente ? `Cliente: ${p.cliente}` : "Sin cliente asignado"}</p>
              {semaforos && <PuntosSemaforoPu filas={semaforos.get(p.id) ?? []} />}
              {reqPorProyecto && <PuntosAlmacen filas={reqPorProyecto.get(p.id) ?? []} />}
            </Link>
            {puedeDesactivar(p.empresa_id) && (
              <button
                onClick={() => {
                  if (p.activo && !window.confirm(`¿Desactivar "${p.nombre}"? Deja de aparecer en las listas y selectores; se puede reactivar después.`)) return;
                  cambiarActivo.mutate({ id: p.id, activo: !p.activo });
                }}
                disabled={cambiarActivo.isPending}
                className="mt-3 text-xs text-slate-400 hover:text-slate-700 hover:underline disabled:opacity-50"
              >
                {p.activo ? "Desactivar proyecto" : "Reactivar proyecto"}
              </button>
            )}
          </div>
        ))}
        {proyectos?.length === 0 && !isLoading && <p className="text-sm text-slate-400">No hay proyectos para este filtro.</p>}
      </div>
    </div>
  );
}
