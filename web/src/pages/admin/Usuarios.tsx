import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import type { AppRol, Empresa, Profile } from "../../types/database";

const ROLES: AppRol[] = ["pendiente", "responsable", "empresa", "almacen", "direccion", "corporativo", "rh", "rh_documentos", "produccion", "supervisor_bbva", "admin"];

/** Deja sólo dígitos y, si parece un celular mexicano de 10 dígitos sin
 * código de país, le antepone 52 -- lo que necesita el link wa.me. Si ya
 * trae más dígitos (con código de país) se respeta tal cual. */
function numeroWhatsapp(telefono: string): string {
  const digitos = telefono.replace(/\D/g, "");
  return digitos.length === 10 ? `52${digitos}` : digitos;
}

// Admin de usuarios (SPEC.md sección 6): asignar rol y empresa es lo único
// que determina qué puede ver/hacer cada usuario -- nunca se hardcodea en
// código. Un usuario nuevo entra en 'pendiente' (sin acceso) hasta que un
// admin lo configura aquí. profiles.nombre no siempre es un email real: solo
// lo es por default hasta que alguien lo cambie (ver trigger handle_new_user).
export function Usuarios() {
  const queryClient = useQueryClient();
  const [busqueda, setBusqueda] = useState("");

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

  const perfilesFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return perfiles;
    return perfiles?.filter((p) => p.nombre.toLowerCase().includes(q) || p.rol.toLowerCase().includes(q));
  }, [perfiles, busqueda]);

  const actualizar = useMutation({
    mutationFn: async ({
      id,
      rol,
      empresa_id,
      telefono,
    }: {
      id: string;
      rol?: AppRol;
      empresa_id?: string | null;
      telefono?: string | null;
    }) => {
      const { error } = await supabase.from("profiles").update({ rol, empresa_id, telefono }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-usuarios"] }),
  });

  // Desbloqueo cuando el correo no le llega a alguien (caso real: el mailer
  // compartido de Supabase reporta "enviado" pero el servidor de correo del
  // destinatario lo filtra, o se topa con el límite de envíos por hora) --
  // genera un link de acceso directo. Si hay teléfono guardado, se abre
  // WhatsApp con el mensaje y el link ya listos para mandar en un clic; si
  // no, cae al flujo anterior (copiar y pegar a mano en cualquier canal).
  // tipo "magiclink": entra directo con la sesión que ya tenía.
  // tipo "recovery": entra a definir una contraseña nueva (ver
  // NuevaContrasena.tsx) -- caso real Mario Contreras, 1-sep-2026: nunca
  // tuvo una que recordara, siempre entraba por magic link.
  const generarLink = useMutation({
    mutationFn: async ({ userId, tipo }: { userId: string; tipo: "magiclink" | "recovery"; telefono: string | null }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const respuesta = await fetch(urlFuncion("generar-link-acceso"), {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId, tipo }),
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
      return json as { link: string; email: string };
    },
    onSuccess: ({ link, email }, variables) => {
      navigator.clipboard?.writeText(link).catch(() => {});
      if (variables.telefono) {
        const mensaje =
          variables.tipo === "recovery"
            ? `Hola, aquí tienes tu link para definir tu contraseña de Grupo Loma: ${link}`
            : `Hola, aquí tienes tu link de acceso a Grupo Loma: ${link}`;
        window.open(`https://wa.me/${numeroWhatsapp(variables.telefono)}?text=${encodeURIComponent(mensaje)}`, "_blank");
      } else {
        window.prompt(`Link de acceso para ${email} (ya copiado al portapapeles) -- mándaselo por WhatsApp u otro canal:`, link);
      }
    },
    onError: (err) => alert((err as Error).message),
  });

  // Alta directa sin correo: el mailer de Supabase rebota "email rate limit
  // exceeded" en "Crear cuenta" cuando varias personas se registran el
  // mismo día (Luis Gutiérrez, 21-sep-2026). admin-crear-usuario crea la
  // cuenta ya confirmada, le pone rol/nombre/teléfono y regresa el link
  // para definir contraseña, que se manda por WhatsApp igual que arriba.
  const [mostrarAlta, setMostrarAlta] = useState(false);
  const crearCuenta = useMutation({
    mutationFn: async (p: { email: string; nombre: string | null; telefono: string | null; rol: AppRol }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const respuesta = await fetch(urlFuncion("admin-crear-usuario"), {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
      return json as { link: string; email: string; userId: string };
    },
    onSuccess: ({ link, email }, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-usuarios"] });
      setMostrarAlta(false);
      navigator.clipboard?.writeText(link).catch(() => {});
      if (variables.telefono) {
        const mensaje = `Hola, ya tienes tu cuenta en el sistema de Grupo Loma (${email}). Entra con este link para definir tu contraseña: ${link}`;
        window.open(`https://wa.me/${numeroWhatsapp(variables.telefono)}?text=${encodeURIComponent(mensaje)}`, "_blank");
      } else {
        window.prompt(`Cuenta creada para ${email}. Link para definir contraseña (ya copiado al portapapeles):`, link);
      }
    },
    onError: (err) => alert((err as Error).message),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        rol='empresa' requiere una empresa asignada. rol='pendiente' o sin empresa asignada (salvo corporativo/admin) significa sin acceso a datos.
      </p>

      <div className="mb-4">
        {!mostrarAlta ? (
          <button type="button" onClick={() => setMostrarAlta(true)} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            Crear cuenta sin correo
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              crearCuenta.mutate({
                email: String(fd.get("email") ?? "").trim(),
                nombre: String(fd.get("nombre") ?? "").trim() || null,
                telefono: String(fd.get("telefono") ?? "").trim() || null,
                rol: String(fd.get("rol") ?? "pendiente") as AppRol,
              });
            }}
            className="grid gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-[2fr_2fr_1fr_1fr_auto_auto]"
          >
            <input name="email" type="email" required placeholder="correo@grupoloma.mx" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
            <input name="nombre" placeholder="Nombre" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
            <input name="telefono" placeholder="WhatsApp (10 dígitos)" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
            <select name="rol" defaultValue="pendiente" className="rounded border border-slate-300 px-2 py-1.5 text-sm">
              {ROLES.filter((r) => r !== "admin").map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button disabled={crearCuenta.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {crearCuenta.isPending ? "Creando…" : "Crear y mandar link"}
            </button>
            <button type="button" onClick={() => setMostrarAlta(false)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
              Cancelar
            </button>
          </form>
        )}
        <p className="mt-1 text-xs text-slate-500">
          La cuenta queda confirmada sin pasar por el correo de Supabase. Si pones WhatsApp, se abre el mensaje con el link para definir contraseña.
        </p>
      </div>

      <input
        type="text"
        placeholder="Buscar por nombre o rol…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="mb-3 w-full max-w-xs rounded border border-slate-300 px-3 py-2 text-sm"
      />

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Nombre</th>
              <th className="px-2 py-2">Rol</th>
              <th className="px-2 py-2">Empresa</th>
              <th className="px-2 py-2">Activo</th>
              <th className="px-2 py-2">Teléfono (WhatsApp)</th>
              <th className="px-2 py-2">Acceso</th>
            </tr>
          </thead>
          <tbody>
            {perfilesFiltrados?.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="max-w-[140px] truncate px-2 py-2" title={p.nombre}>
                  {p.nombre}
                </td>
                <td className="px-2 py-2">
                  <select
                    value={p.rol}
                    onChange={(e) => actualizar.mutate({ id: p.id, rol: e.target.value as AppRol })}
                    className="max-w-[110px] rounded border border-slate-300 px-1 py-1 text-sm"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <select
                    value={p.empresa_id ?? ""}
                    onChange={(e) => actualizar.mutate({ id: p.id, empresa_id: e.target.value || null })}
                    className="max-w-[110px] rounded border border-slate-300 px-1 py-1 text-sm"
                  >
                    <option value="">— (todas)</option>
                    {empresas?.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
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
                <td className="px-2 py-2">
                  <input
                    type="tel"
                    key={p.telefono ?? ""}
                    defaultValue={p.telefono ?? ""}
                    placeholder="10 dígitos"
                    onBlur={(e) => {
                      const valor = e.target.value.trim() || null;
                      if (valor !== (p.telefono ?? null)) actualizar.mutate({ id: p.id, telefono: valor });
                    }}
                    className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      disabled={generarLink.isPending}
                      onClick={() => generarLink.mutate({ userId: p.id, tipo: "magiclink", telefono: p.telefono })}
                      className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      title="Genera un link de acceso directo (sin correo). Con teléfono guardado, abre WhatsApp listo para enviar; si no, lo copia para pegarlo en cualquier canal."
                    >
                      Generar link
                    </button>
                    <button
                      type="button"
                      disabled={generarLink.isPending}
                      onClick={() => generarLink.mutate({ userId: p.id, tipo: "recovery", telefono: p.telefono })}
                      className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      title="Genera un link para que la persona defina una contraseña nueva. Con teléfono guardado, abre WhatsApp listo para enviar; si no, lo copia para pegarlo en cualquier canal."
                    >
                      Nueva contraseña
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
