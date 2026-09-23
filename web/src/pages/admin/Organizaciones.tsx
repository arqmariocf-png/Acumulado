import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { TIPOS_LOGOTIPO, subirLogotipo, urlPublicaDelLogo } from "../../lib/marca";
import type { Grupo, Modulo, ModuloClave } from "../../types/database";

// Panel de la organización maestra: dar de alta clientes y abrirles módulos
// conforme los vayan ocupando. Solo lo ve el admin de la organización
// maestra -- un admin de organización cliente administra su gente y sus
// entidades, pero no se abre módulos solo (ver grupo_modulos_update en
// 20260923090002_grupos_rls.sql: RLS lo bloquea aunque alguien llegue a la
// ruta a mano).
export function Organizaciones() {
  const queryClient = useQueryClient();
  const { esAdminGlobal, perfil, grupo: miGrupo, recargarOrganizacion } = useAuth();
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [marca, setMarca] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: grupos, isLoading } = useQuery({
    queryKey: ["admin-grupos"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("grupos").select("*").order("es_maestro", { ascending: false }).order("nombre");
      if (err) throw err;
      return data as Grupo[];
    },
  });

  const { data: modulos } = useQuery({
    queryKey: ["catalogo-modulos"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("modulos").select("*").order("orden");
      if (err) throw err;
      return data as Modulo[];
    },
  });

  const { data: habilitados } = useQuery({
    queryKey: ["admin-grupo-modulos"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("grupo_modulos").select("grupo_id, modulo_clave, habilitado");
      if (err) throw err;
      return data as { grupo_id: string; modulo_clave: ModuloClave; habilitado: boolean }[];
    },
  });

  const crearGrupo = useMutation({
    mutationFn: async () => {
      const { data: nuevo, error: err } = await supabase
        .from("grupos")
        .insert({ nombre: nombre.trim(), codigo: codigo.trim().toUpperCase(), marca_comercial: marca.trim() || null })
        .select("id")
        .single();
      if (err) throw err;

      // Una organización nueva arranca con todos los módulos cerrados: solo
      // la base. Las filas se crean aquí (en false) para que el interruptor
      // exista desde el primer día.
      const { error: errModulos } = await supabase
        .from("grupo_modulos")
        .insert((modulos ?? []).map((m) => ({ grupo_id: nuevo.id, modulo_clave: m.clave, habilitado: false })));
      if (errModulos) throw errModulos;
    },
    onSuccess: () => {
      setNombre("");
      setCodigo("");
      setMarca("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["admin-grupos"] });
      queryClient.invalidateQueries({ queryKey: ["admin-grupo-modulos"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // El logotipo de un cliente lo sube la organización maestra: el admin del
  // cliente puede hacerlo desde Admin → Marca, pero esa pantalla solo edita SU
  // organización -- sin esto, dar de alta a un cliente llave en mano obligaba
  // a entrar con un usuario suyo.
  const cambiarLogo = useMutation({
    mutationFn: async ({ grupoId, archivo }: { grupoId: string; archivo: File }) => {
      await subirLogotipo(grupoId, archivo);
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["admin-grupos"] });
      void recargarOrganizacion();
    },
    onError: (e: Error) => setError(e.message),
  });

  const alternarModulo = useMutation({
    mutationFn: async ({ grupoId, clave, habilitado }: { grupoId: string; clave: ModuloClave; habilitado: boolean }) => {
      const { error: err } = await supabase.from("grupo_modulos").upsert(
        {
          grupo_id: grupoId,
          modulo_clave: clave,
          habilitado,
          habilitado_at: habilitado ? new Date().toISOString() : null,
          habilitado_por: habilitado ? perfil?.id ?? null : null,
        },
        { onConflict: "grupo_id,modulo_clave" },
      );
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["admin-grupo-modulos"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!esAdminGlobal) {
    return (
      <p className="text-sm text-slate-500">
        Esta sección la administra {miGrupo?.es_maestro ? "un admin" : "la organización que opera la plataforma"}. Si necesitas
        abrir un módulo para tu organización, pídelo por ahí.
      </p>
    );
  }

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

  const estaHabilitado = (grupoId: string, clave: ModuloClave) =>
    habilitados?.some((h) => h.grupo_id === grupoId && h.modulo_clave === clave && h.habilitado) ?? false;

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Cada organización es un cliente con sus propias entidades, usuarios y datos, aislados de los demás. Los módulos se abren
        conforme se ocupen: una organización nueva arranca solo con la base (entidades, usuarios y administración).
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          crearGrupo.mutate();
        }}
        className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-col text-xs text-slate-500">
          Nombre
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            className="mt-1 w-64 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
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
          Marca comercial (opcional)
          <input
            value={marca}
            onChange={(e) => setMarca(e.target.value)}
            className="mt-1 w-56 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
          />
        </label>
        <button
          type="submit"
          disabled={crearGrupo.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Dar de alta organización
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Organización</th>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Logotipo</th>
              {modulos?.map((m) => (
                <th key={m.clave} className="px-3 py-2" title={m.descripcion ?? undefined}>
                  {m.nombre}
                </th>
              ))}
              <th className="px-3 py-2">Activa</th>
            </tr>
          </thead>
          <tbody>
            {grupos?.map((g) => (
              <tr key={g.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  {g.marca_comercial ?? g.nombre}
                  {g.es_maestro && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">maestra</span>}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{g.codigo}</td>
                <td className="px-3 py-2">
                  <label className="flex cursor-pointer items-center gap-2" title="Subir o reemplazar el logotipo">
                    {g.logo_path ? (
                      <img
                        src={urlPublicaDelLogo(g.logo_path) ?? ""}
                        alt={`Logotipo de ${g.marca_comercial ?? g.nombre}`}
                        className="h-8 w-8 object-contain"
                      />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400">
                        —
                      </span>
                    )}
                    <span className="text-xs text-slate-500 underline">{g.logo_path ? "Cambiar" : "Subir"}</span>
                    <input
                      type="file"
                      accept={TIPOS_LOGOTIPO.join(",")}
                      className="hidden"
                      onChange={(e) => {
                        const archivo = e.target.files?.[0];
                        if (archivo) cambiarLogo.mutate({ grupoId: g.id, archivo });
                      }}
                    />
                  </label>
                </td>
                {modulos?.map((m) => (
                  <td key={m.clave} className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={estaHabilitado(g.id, m.clave)}
                      onChange={(e) => alternarModulo.mutate({ grupoId: g.id, clave: m.clave, habilitado: e.target.checked })}
                    />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={g.activo}
                    disabled={g.es_maestro}
                    onChange={async (e) => {
                      const { error: err } = await supabase.from("grupos").update({ activo: e.target.checked }).eq("id", g.id);
                      if (err) setError(err.message);
                      queryClient.invalidateQueries({ queryKey: ["admin-grupos"] });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
