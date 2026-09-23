import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { AppRol, Empresa, Grupo, Profile } from "../../types/database";

const ROLES: AppRol[] = ["pendiente", "empresa", "direccion", "corporativo", "rh", "admin"];

// Admin de usuarios (SPEC.md sección 6): asignar organización, rol y empresa
// es lo único que determina qué puede ver/hacer cada usuario -- nunca se
// hardcodea en código. Un usuario nuevo entra en 'pendiente' y sin
// organización (sin acceso) hasta que un admin lo configura aquí.
// profiles.nombre no siempre es un email real: solo lo es por default hasta
// que alguien lo cambie (ver trigger handle_new_user).
//
// Un admin de organización cliente solo ve y edita usuarios de la suya (más
// los recién registrados que todavía no tienen organización); el admin de la
// organización maestra los ve todos. Eso lo decide RLS, no esta pantalla.
export function Usuarios() {
  const queryClient = useQueryClient();
  const { esAdminGlobal, grupo: miGrupo } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const { data: perfiles, isLoading } = useQuery({
    queryKey: ["admin-usuarios"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Profile[];
    },
  });

  const { data: empresas } = useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre, grupo_id").order("nombre");
      if (error) throw error;
      return data as Pick<Empresa, "id" | "nombre" | "grupo_id">[];
    },
  });

  const { data: grupos } = useQuery({
    queryKey: ["admin-grupos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("grupos").select("*").order("nombre");
      if (error) throw error;
      return data as Grupo[];
    },
  });

  const actualizar = useMutation({
    mutationFn: async ({ id, campos }: { id: string; campos: Partial<Profile> }) => {
      const { error } = await supabase.from("profiles").update(campos).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["admin-usuarios"] });
    },
    // La base rechaza combinaciones incoherentes (rol='empresa' sin empresa,
    // empresa de otra organización): sin mostrar el motivo, el cambio se veía
    // simplemente "no pasar".
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        Un usuario sin organización no ve nada. rol='empresa' requiere además una empresa asignada, que tiene que ser de su misma
        organización. rol='pendiente' o sin empresa asignada (salvo corporativo/admin) significa sin acceso a datos.
      </p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Organización</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Activo</th>
            </tr>
          </thead>
          <tbody>
            {perfiles?.map((p) => {
              // Al cambiar de organización hay que soltar la empresa: la
              // anterior es de otra organización y la base lo rechaza
              // (trigger profiles_valida_empresa_grupo).
              const empresasDelUsuario = (empresas ?? []).filter((e) => e.grupo_id === p.grupo_id);
              return (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{p.nombre}</td>
                  <td className="px-3 py-2">
                    {esAdminGlobal ? (
                      <select
                        value={p.grupo_id ?? ""}
                        onChange={(e) =>
                          actualizar.mutate({ id: p.id, campos: { grupo_id: e.target.value || null, empresa_id: null } })
                        }
                        className="rounded border border-slate-300 px-2 py-1 text-sm"
                      >
                        <option value="">— sin organización</option>
                        {grupos?.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.marca_comercial ?? g.nombre}
                          </option>
                        ))}
                      </select>
                    ) : p.grupo_id ? (
                      (grupos?.find((g) => g.id === p.grupo_id)?.marca_comercial ?? miGrupo?.marca_comercial ?? miGrupo?.nombre)
                    ) : (
                      <button
                        onClick={() =>
                          miGrupo && actualizar.mutate({ id: p.id, campos: { grupo_id: miGrupo.id, empresa_id: null } })
                        }
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                      >
                        Asignar a mi organización
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={p.rol}
                      onChange={(e) => actualizar.mutate({ id: p.id, campos: { rol: e.target.value as AppRol } })}
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={p.empresa_id ?? ""}
                      onChange={(e) => actualizar.mutate({ id: p.id, campos: { empresa_id: e.target.value || null } })}
                      disabled={!p.grupo_id}
                      className="rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="">— (todas, si corporativo/admin)</option>
                      {empresasDelUsuario.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={p.activo}
                      onChange={(e) => actualizar.mutate({ id: p.id, campos: { activo: e.target.checked } })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
