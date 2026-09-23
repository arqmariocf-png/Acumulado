import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { COLOR_ESTATUS, ESTATUS_PROYECTO, ETIQUETA_ESTATUS } from "./estatus";
import type { EstatusProyecto, Proyecto } from "../../types/database";

export function Proyectos() {
  const queryClient = useQueryClient();
  const { suscripcionPermiteEscribir } = useAuth();
  const [filtro, setFiltro] = useState<EstatusProyecto | "">("");
  const [alta, setAlta] = useState(false);
  const [clave, setClave] = useState("");
  const [nombre, setNombre] = useState("");
  const [cliente, setCliente] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: proyectos, isLoading } = useQuery({
    queryKey: ["proyectos"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("proyectos").select("*").order("created_at", { ascending: false });
      if (err) throw err;
      return data as Proyecto[];
    },
  });

  const crear = useMutation({
    mutationFn: async () => {
      // grupo_id no se manda: lo pone el trigger proyectos_set_grupo con la
      // organización del usuario, y RLS verifica que sea la suya.
      const { error: err } = await supabase
        .from("proyectos")
        .insert({ clave: clave.trim().toUpperCase(), nombre: nombre.trim(), cliente: cliente.trim() || null });
      if (err) throw err;
    },
    onSuccess: () => {
      setClave("");
      setNombre("");
      setCliente("");
      setAlta(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["proyectos"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

  const visibles = (proyectos ?? []).filter((p) => !filtro || p.estatus === filtro);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Proyectos</h1>
        <div className="flex items-center gap-2">
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as EstatusProyecto | "")}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">Todos los estatus</option>
            {ESTATUS_PROYECTO.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.etiqueta}
              </option>
            ))}
          </select>
          {suscripcionPermiteEscribir && (
            <button onClick={() => setAlta((v) => !v)} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
              {alta ? "Cancelar" : "Nuevo proyecto"}
            </button>
          )}
        </div>
      </div>

      {alta && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            crear.mutate();
          }}
          className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4"
        >
          <label className="flex flex-col text-xs text-slate-500">
            Clave
            <input
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              required
              placeholder="P-001"
              className="mt-1 w-28 rounded border border-slate-300 px-2 py-1 font-mono text-sm uppercase text-slate-900"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Nombre del proyecto
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
              className="mt-1 w-80 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Cliente
            <input
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              className="mt-1 w-64 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
            />
          </label>
          <button
            type="submit"
            disabled={crear.isPending}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Crear
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Clave</th>
              <th className="px-3 py-2">Proyecto</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Estatus</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link to={`/proyectos/${p.id}`} className="text-slate-900 underline">
                    {p.clave}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <Link to={`/proyectos/${p.id}`}>{p.nombre}</Link>
                </td>
                <td className="px-3 py-2 text-slate-600">{p.cliente ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${COLOR_ESTATUS[p.estatus]}`}>
                    {ETIQUETA_ESTATUS[p.estatus]}
                  </span>
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-500">
                  {proyectos?.length ? "Ningún proyecto con ese estatus." : "Todavía no hay proyectos dados de alta."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
