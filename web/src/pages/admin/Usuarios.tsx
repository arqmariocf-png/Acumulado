import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import type { AppRol, Empresa, Profile } from "../../types/database";

const ROLES: AppRol[] = ["pendiente", "responsable", "empresa", "almacen", "direccion", "corporativo", "rh", "rh_documentos", "admin"];

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

  // Desbloqueo cuando el correo no le llega a alguien (caso real: el mailer
  // compartido de Supabase reporta "enviado" pero el servidor de correo del
  // destinatario lo filtra, o se topa con el límite de envíos por hora) --
  // genera un link de acceso directo (magic link) que el admin copia y manda
  // por otro canal (WhatsApp, etc.), sin esperar a que llegue nada por correo.
  const generarLink = useMutation({
    mutationFn: async (userId: string) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const respuesta = await fetch(urlFuncion("generar-link-acceso"), {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
      return json as { link: string; email: string };
    },
    onSuccess: ({ link, email }) => {
      navigator.clipboard?.writeText(link).catch(() => {});
      window.prompt(`Link de acceso para ${email} (ya copiado al portapapeles) -- mándaselo por WhatsApp u otro canal:`, link);
    },
    onError: (err) => alert((err as Error).message),
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
              <th className="px-3 py-2">Acceso</th>
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
                <td className="px-3 py-2">
                  <button
                    type="button"
                    disabled={generarLink.isPending}
                    onClick={() => generarLink.mutate(p.id)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    title="Genera un link de acceso directo (sin correo) para mandarle por otro canal, ej. cuando no le llega el correo de confirmación/recuperación."
                  >
                    Generar link
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
