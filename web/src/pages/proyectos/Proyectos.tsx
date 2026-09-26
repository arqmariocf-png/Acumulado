import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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

function useProyectos(empresaId: string, busqueda: string) {
  return useQuery({
    queryKey: ["proyectos-ventana", empresaId, busqueda],
    queryFn: async () => {
      let q = supabase.from("proyectos").select("*, empresas(nombre)").eq("activo", true).order("nombre");
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
  const { veTodasLasEmpresas } = useAuth();
  const { data: empresas } = useEmpresas();
  const [empresaId, setEmpresaId] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const { data: proyectos, isLoading } = useProyectos(empresaId, busqueda);
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

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}

      {proyectos && reqPorProyecto && (
        <AlmacenPorProyecto proyectos={proyectos.map((p) => ({ id: p.id, nombre: p.nombre, empresa: veTodasLasEmpresas ? p.empresas?.nombre : null }))} porProyecto={reqPorProyecto} />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {proyectos?.map((p) => (
          <Link key={p.id} to={`/proyectos/${p.id}`} className="block rounded border border-slate-200 bg-white p-4 hover:border-slate-400 hover:shadow-sm">
            <h2 className="font-semibold text-slate-900">{p.nombre}</h2>
            <p className="mt-1 text-xs text-slate-500">{p.empresas?.nombre}</p>
            <p className="mt-2 text-sm text-slate-600">{p.cliente ? `Cliente: ${p.cliente}` : "Sin cliente asignado"}</p>
            {semaforos && <PuntosSemaforoPu filas={semaforos.get(p.id) ?? []} />}
            {reqPorProyecto && <PuntosAlmacen filas={reqPorProyecto.get(p.id) ?? []} />}
          </Link>
        ))}
        {proyectos?.length === 0 && !isLoading && <p className="text-sm text-slate-400">No hay proyectos para este filtro.</p>}
      </div>
    </div>
  );
}
