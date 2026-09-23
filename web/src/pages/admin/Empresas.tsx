import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { Empresa } from "../../types/database";

// Alta y edición de las razones sociales de la organización. Es parte de la
// base (no de un módulo): una organización nueva empieza justo aquí, dando de
// alta sus entidades, antes de que se le abra ningún módulo operativo.
//
// El alta no manda grupo_id: RLS solo deja insertar dentro de la propia
// organización y el formulario toma la del usuario. Un admin de la
// organización maestra puede estar administrando otra, así que se usa
// siempre el grupo del perfil -- ver empresas_insert en
// 20260923090002_grupos_rls.sql.
export function Empresas() {
  const queryClient = useQueryClient();
  const { grupo } = useAuth();
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [rfc, setRfc] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: empresas, isLoading } = useQuery({
    queryKey: ["admin-empresas"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("empresas").select("*").order("nombre");
      if (err) throw err;
      return data as Empresa[];
    },
  });

  const crear = useMutation({
    mutationFn: async () => {
      if (!grupo) throw new Error("Tu usuario no tiene organización asignada");
      const { error: err } = await supabase
        .from("empresas")
        .insert({ nombre: nombre.trim(), codigo: codigo.trim().toUpperCase(), rfc: rfc.trim() || null, grupo_id: grupo.id });
      if (err) throw err;
    },
    onSuccess: () => {
      setNombre("");
      setCodigo("");
      setRfc("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["admin-empresas"] });
      queryClient.invalidateQueries({ queryKey: ["empresas"] });
      queryClient.invalidateQueries({ queryKey: ["inicio-empresas"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const actualizar = useMutation({
    mutationFn: async ({ id, campos }: { id: string; campos: Partial<Empresa> }) => {
      const { error: err } = await supabase.from("empresas").update(campos).eq("id", id);
      if (err) throw err;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-empresas"] });
      queryClient.invalidateQueries({ queryKey: ["empresas"] });
      queryClient.invalidateQueries({ queryKey: ["inicio-empresas"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Razones sociales de {grupo?.marca_comercial ?? grupo?.nombre}. El <span className="font-mono">código</span> es el
        identificador corto con el que se casa la columna "Empresa" de las cargas; es único dentro de la organización.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          crear.mutate();
        }}
        className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-col text-xs text-slate-500">
          Nombre o razón social
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            className="mt-1 w-72 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Código
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            required
            maxLength={10}
            className="mt-1 w-28 rounded border border-slate-300 px-2 py-1 font-mono text-sm uppercase text-slate-900"
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          RFC (opcional)
          <input
            value={rfc}
            onChange={(e) => setRfc(e.target.value)}
            className="mt-1 w-44 rounded border border-slate-300 px-2 py-1 font-mono text-sm uppercase text-slate-900"
          />
        </label>
        <button
          type="submit"
          disabled={crear.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Dar de alta
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">RFC</th>
              <th className="px-3 py-2">Activa</th>
            </tr>
          </thead>
          <tbody>
            {empresas?.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{e.codigo}</td>
                <td className="px-3 py-2">{e.nombre}</td>
                <td className="px-3 py-2">
                  <input
                    defaultValue={e.rfc ?? ""}
                    onBlur={(ev) => {
                      const valor = ev.target.value.trim().toUpperCase() || null;
                      if (valor !== e.rfc) actualizar.mutate({ id: e.id, campos: { rfc: valor } });
                    }}
                    className="w-40 rounded border border-slate-200 px-2 py-1 font-mono text-xs uppercase"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={e.activo}
                    onChange={(ev) => actualizar.mutate({ id: e.id, campos: { activo: ev.target.checked } })}
                  />
                </td>
              </tr>
            ))}
            {empresas?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-500">
                  Todavía no hay razones sociales dadas de alta en esta organización.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
