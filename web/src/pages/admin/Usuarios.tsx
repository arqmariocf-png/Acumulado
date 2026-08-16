import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { AppRol, Empresa, Profile } from "../../types/database";

const ROLES: AppRol[] = ["pendiente", "empresa", "direccion", "corporativo", "admin"];

// Admin de usuarios (SPEC.md sección 6): asignar rol y empresa es lo único
// que determina qué puede ver/hacer cada usuario -- nunca se hardcodea en
// código. Un usuario nuevo entra en 'pendiente' (sin acceso) hasta que un
// admin lo configura aquí. profiles.nombre no siempre es un email real: solo
// lo es por default hasta que alguien lo cambie (ver trigger handle_new_user).
export function Usuarios() {
  const queryClient = useQueryClient();

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
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw error;
      return data as Pick<Empresa, "id" | "nombre">[];
    },
  });

  const actualizar = useMutation({
    mutationFn: async ({ id, rol, empresa_id }: { id: string; rol?: AppRol; empresa_id?: string | null }) => {
      const { error } = await supabase.from("profiles").update({ rol, empresa_id }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-usuarios"] }),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        rol='empresa' requiere una empresa asignada. rol='pendiente' o sin empresa asignada (salvo corporativo/admin) significa sin acceso a datos.
      </p>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Activo</th>
            </tr>
          </thead>
          <tbody>
            {perfiles?.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{p.nombre}</td>
                <td className="px-3 py-2">
                  <select
                    value={p.rol}
                    onChange={(e) => actualizar.mutate({ id: p.id, rol: e.target.value as AppRol })}
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
                    onChange={(e) => actualizar.mutate({ id: p.id, empresa_id: e.target.value || null })}
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="">— (todas, si corporativo/admin)</option>
                    {empresas?.map((e) => (
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
                    onChange={(e) =>
                      supabase
                        .from("profiles")
                        .update({ activo: e.target.checked })
                        .eq("id", p.id)
                        .then(() => queryClient.invalidateQueries({ queryKey: ["admin-usuarios"] }))
                    }
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
