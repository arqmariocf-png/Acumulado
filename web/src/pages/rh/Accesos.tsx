import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { ETIQUETA_ROL_BASICO, MODULOS_ASIGNABLES, ROLES_BASICOS, numeroWhatsapp } from "../../lib/modulos";
import type { AppRol } from "../../types/database";

interface PersonaAcceso {
  personal_id: string;
  nombre: string;
  puesto: string | null;
  area: string | null;
  telefono: string | null;
  correo: string | null;
  activo: boolean;
  profile_id: string | null;
  rol: AppRol | null;
  empresa_id: string | null;
  supervisor_profile_id: string | null;
  supervisor_nombre: string | null;
  modulos: string[];
  docs_indispensables: number;
  empresa_contratacion_id: string | null;
}

const DOCS_REQUERIDOS = 3;

function usePersonalAccesos() {
  return useQuery({
    queryKey: ["rh-personal-accesos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_personal_accesos").select("*").eq("activo", true).order("nombre");
      if (error) throw error;
      return (data ?? []).map((p: any) => ({ ...p, modulos: (p.modulos ?? []) as string[] })) as PersonaAcceso[];
    },
  });
}

async function llamar(nombre: string, body: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const respuesta = await fetch(urlFuncion(nombre), {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionData.session?.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await respuesta.json();
  if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
  return json;
}

function mandarPorWhatsapp(telefono: string | null, mensaje: string, link: string) {
  navigator.clipboard?.writeText(link).catch(() => {});
  if (telefono) {
    window.open(`https://wa.me/${numeroWhatsapp(telefono)}?text=${encodeURIComponent(mensaje)}`, "_blank");
  } else {
    window.prompt("Sin teléfono registrado. Link (ya copiado al portapapeles) para mandar por otro canal:", link);
  }
}

/** Pestaña "Accesos" de RH (Fernando): crear la cuenta de una persona
 * contratada cuando su expediente tiene INE, CURP y comprobante de
 * domicilio, mandarle el link al celular, y asignarle rol básico, módulos
 * y supervisor. */
export function Accesos() {
  const queryClient = useQueryClient();
  const { data: personas, isLoading } = usePersonalAccesos();
  const [error, setError] = useState<string | null>(null);
  const [rolNuevo, setRolNuevo] = useState<Record<string, AppRol>>({});
  const [busqueda, setBusqueda] = useState("");

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["rh-personal-accesos"] });
    queryClient.invalidateQueries({ queryKey: ["rh-personal"] });
    queryClient.invalidateQueries({ queryKey: ["rh-personal-con-cuenta"] });
  };

  const crearAcceso = useMutation({
    mutationFn: async (p: PersonaAcceso) => {
      const rol = rolNuevo[p.personal_id] ?? "operativo";
      return (await llamar("admin-crear-usuario", { personalId: p.personal_id, rol })) as { email: string; link: string; telefono: string | null };
    },
    onSuccess: ({ email, link, telefono }) => {
      invalidar();
      mandarPorWhatsapp(
        telefono,
        `Hola, ya tienes acceso al sistema de Grupo Loma. Tu usuario es ${email}. Entra con este link desde tu celular para definir tu contraseña: ${link}`,
        link,
      );
    },
    onError: (e) => setError((e as Error).message),
  });

  const reenviar = useMutation({
    mutationFn: async (p: PersonaAcceso) => {
      const r = (await llamar("generar-link-acceso", { userId: p.profile_id, tipo: "recovery" })) as { link: string; email: string };
      return { ...r, telefono: p.telefono };
    },
    onSuccess: ({ email, link, telefono }) => {
      mandarPorWhatsapp(telefono, `Hola, aquí tienes tu link para entrar al sistema de Grupo Loma (usuario ${email}) y definir tu contraseña: ${link}`, link);
    },
    onError: (e) => setError((e as Error).message),
  });

  const cambiarRol = useMutation({
    mutationFn: async ({ profileId, rol }: { profileId: string; rol: AppRol }) => {
      const { error: err } = await supabase.rpc("rh_asignar_rol_basico", { p_profile_id: profileId, p_rol: rol });
      if (err) throw err;
    },
    onSuccess: invalidar,
    onError: (e) => setError((e as Error).message),
  });

  const cambiarModulo = useMutation({
    mutationFn: async ({ profileId, modulo, activar }: { profileId: string; modulo: string; activar: boolean }) => {
      const { data: sesion } = await supabase.auth.getSession();
      if (activar) {
        const { error: err } = await supabase.from("permisos_modulo").insert({ profile_id: profileId, modulo, otorgado_por: sesion.session?.user.id ?? null });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("permisos_modulo").delete().eq("profile_id", profileId).eq("modulo", modulo);
        if (err) throw err;
      }
    },
    onSuccess: invalidar,
    onError: (e) => setError((e as Error).message),
  });

  const cambiarSupervisor = useMutation({
    mutationFn: async ({ personalId, supervisorProfileId }: { personalId: string; supervisorProfileId: string | null }) => {
      const { error: err } = await supabase.from("personal").update({ supervisor_profile_id: supervisorProfileId }).eq("id", personalId);
      if (err) throw err;
    },
    onSuccess: invalidar,
    onError: (e) => setError((e as Error).message),
  });

  const supervisores = (personas ?? []).filter((p) => p.profile_id && (p.rol === "supervisor" || p.rol === "directivo" || p.rol === "rh"));
  const q = busqueda.trim().toLowerCase();
  const filtradas = (personas ?? []).filter((p) => !q || p.nombre.toLowerCase().includes(q) || (p.puesto ?? "").toLowerCase().includes(q));

  if (isLoading) return <p className="text-sm text-slate-400">Cargando…</p>;

  return (
    <div>
      <p className="mb-3 max-w-3xl text-sm text-slate-500">
        La cuenta se crea cuando el expediente ya tiene INE, CURP y comprobante de domicilio. Se genera el correo, se manda el link al
        celular por WhatsApp y la persona entra con rol <b>operativo</b> (solo checador). Los módulos adicionales se asignan aquí uno por uno.
      </p>
      <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar persona…" className="mb-3 w-full max-w-sm rounded border border-slate-300 px-2 py-1.5 text-sm" />
      {error && (
        <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}{" "}
          <button className="underline" onClick={() => setError(null)}>
            cerrar
          </button>
        </p>
      )}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Expediente</th>
              <th className="px-3 py-2">Cuenta</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Módulos asignados</th>
              <th className="px-3 py-2">Supervisor</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((p) => {
              const docsOk = Number(p.docs_indispensables) >= DOCS_REQUERIDOS;
              const rolBasico = !!p.rol && (ROLES_BASICOS as string[]).includes(p.rol);
              const editable = !!p.profile_id && (rolBasico || p.rol === "pendiente");
              return (
                <tr key={p.personal_id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{p.nombre}</div>
                    <div className="text-xs text-slate-500">
                      {p.puesto ?? "—"}
                      {p.telefono ? ` · ${p.telefono}` : " · sin teléfono"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {docsOk ? (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">INE, CURP y domicilio ✓</span>
                    ) : (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">{p.docs_indispensables}/3 documentos indispensables</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.profile_id ? (
                      <div>
                        <div className="text-emerald-700">Cuenta creada{p.correo ? ` · ${p.correo}` : ""}</div>
                        <button onClick={() => reenviar.mutate(p)} disabled={reenviar.isPending} className="mt-1 text-slate-600 underline">
                          Reenviar link al celular
                        </button>
                      </div>
                    ) : docsOk ? (
                      <div className="grid gap-1">
                        <select
                          value={rolNuevo[p.personal_id] ?? "operativo"}
                          onChange={(e) => setRolNuevo((prev) => ({ ...prev, [p.personal_id]: e.target.value as AppRol }))}
                          className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                        >
                          {ROLES_BASICOS.map((r) => (
                            <option key={r} value={r}>
                              {ETIQUETA_ROL_BASICO[r]}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => crearAcceso.mutate(p)}
                          disabled={crearAcceso.isPending}
                          className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {crearAcceso.isPending ? "Creando…" : "Crear acceso y mandar al celular"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-400">Completa el expediente para crear la cuenta</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {editable ? (
                      <select
                        value={rolBasico ? p.rol! : ""}
                        onChange={(e) => cambiarRol.mutate({ profileId: p.profile_id!, rol: e.target.value as AppRol })}
                        className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                      >
                        {!rolBasico && <option value="">pendiente (sin acceso)</option>}
                        {ROLES_BASICOS.map((r) => (
                          <option key={r} value={r}>
                            {ETIQUETA_ROL_BASICO[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-500">{p.rol ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {editable && rolBasico ? (
                      <div className="grid gap-0.5">
                        {MODULOS_ASIGNABLES.map((m) => (
                          <label key={m.clave} className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={!!m.incluido || p.modulos.includes(m.clave)}
                              disabled={!!m.incluido}
                              onChange={(e) => cambiarModulo.mutate({ profileId: p.profile_id!, modulo: m.clave, activar: e.target.checked })}
                            />
                            {m.etiqueta}
                            {m.incluido && <span className="text-slate-400">(todos)</span>}
                          </label>
                        ))}
                        <span className="text-slate-400">Checador, Mis documentos y Tareas siempre.</span>
                      </div>
                    ) : (
                      <span className="text-slate-400">{p.profile_id ? "Rol fijo, lo administra un administrador" : "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <select
                      value={p.supervisor_profile_id ?? ""}
                      onChange={(e) => cambiarSupervisor.mutate({ personalId: p.personal_id, supervisorProfileId: e.target.value || null })}
                      className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                    >
                      <option value="">Sin supervisor</option>
                      {supervisores.map((s) => (
                        <option key={s.profile_id!} value={s.profile_id!}>
                          {s.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Sin personal activo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
