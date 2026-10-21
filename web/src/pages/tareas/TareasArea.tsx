import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { avancePorTablero, buscarTableros, esAreaTareas, nombreArea, tablerosDondeParticipa, type TarjetaAvance } from "../../lib/tareasArea";
import { TableroDetalle } from "./TableroDetalle";

// Tareas por área (21-oct-2026, Mario: "agrega una barra de tareas a cada una
// de las áreas… para que sea más fácil para las áreas llevar el control en su
// propio menú"). Cada sección del menú trae "Tareas de <área>": con un solo
// tablero se abre directo; con varios (Operación: uno por obra) sale la lista
// con su avance. fn_tablero_area crea el tablero del área si aún no existe.

interface TableroArea {
  id: string;
  nombre: string;
  empresa_id: string | null;
  empresa_nombre: string | null;
  proyecto_id: string | null;
  creado: boolean;
}

export function TareasArea() {
  const { area } = useParams<{ area: string }>();
  const { perfil } = useAuth();
  const [soloMios, setSoloMios] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const valida = esAreaTareas(area);

  const tableros = useQuery({
    queryKey: ["tareas-area", area],
    enabled: valida,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_tablero_area", { p_area: area });
      if (error) throw error;
      return (data ?? []) as TableroArea[];
    },
  });
  const ids = (tableros.data ?? []).map((t) => t.id);
  const avance = useQuery({
    queryKey: ["tareas-area-avance", area, ids.join(",")],
    enabled: ids.length > 1,
    queryFn: async () => {
      const [cols, tarjetas, info] = await Promise.all([
        supabase.from("tablero_columnas").select("id, tablero_id, orden").in("tablero_id", ids),
        supabase
          .from("tarjetas")
          .select("tablero_id, columna_id, asignado_a, supervisor_id, corresponsables, creado_por")
          .in("tablero_id", ids)
          .eq("archivada", false)
          .is("eliminada_en", null),
        supabase.from("tableros").select("id, nombre, creado_por, proyecto_id, proyectos(nombre, responsable_id, comprador_id)").in("id", ids),
      ]);
      if (cols.error) throw cols.error;
      if (tarjetas.error) throw tarjetas.error;
      if (info.error) throw info.error;
      const filas = (tarjetas.data ?? []) as (TarjetaAvance & { creado_por: string | null })[];
      const tabs = (info.data ?? []) as unknown as {
        id: string;
        nombre: string;
        creado_por: string | null;
        proyecto_id: string | null;
        proyectos: { nombre: string; responsable_id: string | null; comprador_id: string | null } | null;
      }[];
      // Donde la persona está activa (Mario, 21-oct-2026: "a todos solamente
      // muéstrales los tableros en los que estén activos").
      const mios = tablerosDondeParticipa(
        tabs.map((t) => ({ ...t, obra_encargados: [t.proyectos?.responsable_id ?? null, t.proyectos?.comprador_id ?? null] })),
        filas,
        perfil?.id,
      );
      const obra = new Map(tabs.map((t) => [t.id, t.proyectos?.nombre ?? ""]));
      return { porTablero: avancePorTablero(cols.data ?? [], filas, perfil?.id), mios, obra };
    },
  });

  if (!valida) return <p className="p-8 text-center text-sm text-slate-500">Esa área no tiene tablero de tareas.</p>;
  if (tableros.isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (tableros.error) return <p className="text-sm text-red-700">{(tableros.error as Error).message}</p>;
  const lista = tableros.data ?? [];
  if (lista.length === 1) return <TableroDetalle key={lista[0].id} tableroId={lista[0].id} />;

  const mios = avance.data?.mios ?? new Set<string>();
  const textoTablero = (t: TableroArea) => `${t.nombre} ${avance.data?.obra.get(t.id) ?? ""} ${t.empresa_nombre ?? ""}`;
  const base = soloMios
    ? lista.filter((t) => (avance.data?.porTablero.get(t.id)?.mias ?? 0) > 0)
    : verTodos
      ? lista
      : lista.filter((t) => mios.has(t.id));
  const visibles = buscarTableros(base, busqueda, textoTablero);
  const fuera = soloMios || verTodos ? 0 : buscarTableros(lista, busqueda, textoTablero).length - visibles.length;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">Tareas de {nombreArea(area).toLowerCase()}</h1>
        <label className="flex items-center gap-1 text-sm text-slate-600">
          <input type="checkbox" checked={soloMios} onChange={(e) => setSoloMios(e.target.checked)} /> solo donde tengo actividades
        </label>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar tablero por proyecto u obra…"
          className="w-full max-w-sm rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        {!soloMios && (
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> ver también los tableros donde no tengo actividades
            {fuera > 0 ? ` (${fuera})` : ""}
          </label>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibles.map((t) => {
          const a = avance.data?.porTablero.get(t.id);
          return (
            <Link key={t.id} to={`/tareas/${t.id}`} className="block rounded border border-slate-200 bg-white p-4 hover:border-slate-400 hover:shadow-sm">
              <h2 className="font-semibold text-slate-900">{t.nombre}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {t.empresa_nombre ?? "Corporativo · todas las empresas"}
                {t.proyecto_id ? " · obra" : ""}
              </p>
              {a ? (
                <>
                  <div className="mt-3 h-1.5 rounded bg-slate-100">
                    <div className="h-1.5 rounded bg-emerald-500" style={{ width: `${a.pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {a.hechas} de {a.total} terminadas ({a.pct} %){a.mias ? ` · ${a.mias} tuyas` : ""}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-xs text-slate-400">{avance.isLoading ? "…" : "Sin actividades"}</p>
              )}
            </Link>
          );
        })}
        {visibles.length === 0 && !avance.isLoading && (
          <p className="text-sm text-slate-400">{busqueda.trim() ? "Ningún tablero coincide con la búsqueda." : "No tienes actividades en los tableros de esta área."}</p>
        )}
      </div>
    </div>
  );
}
