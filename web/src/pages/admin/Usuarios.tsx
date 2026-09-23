import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { AppRol, Empresa, Grupo, PlanEscalon, Profile } from "../../types/database";

const ROLES: AppRol[] = ["pendiente", "empresa", "direccion", "corporativo", "rh", "admin"];

/** Los que un admin puede asignar al invitar. 'pendiente' no se ofrece: darlo
 * de alta así sería invitarlo a una cuenta que no puede entrar a nada. */
const ROLES_ALTA: AppRol[] = ["empresa", "direccion", "corporativo", "rh", "admin"];

const dinero = (centavos: number, moneda = "MXN") =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda }).format(centavos / 100);

/** Lo que costaría el siguiente usuario. No es el precio unitario cuando ese
 * usuario cruza a un paquete más barato: ahí el alta puede costar mucho menos.
 * Mismo criterio que costoDeAgregarUsuario() en _shared/pagos/precios.ts. */
function costoDelSiguienteUsuario(escalones: PlanEscalon[], usuarios: number): number | null {
  if (escalones.length === 0) return null;
  const precioPara = (n: number) =>
    [...escalones]
      .sort((a, b) => a.desde_usuarios - b.desde_usuarios)
      .filter((e) => e.desde_usuarios <= Math.max(n, 1))
      .pop()?.precio_unitario_centavos ?? 0;
  return (usuarios + 1) * precioPara(usuarios + 1) - usuarios * precioPara(usuarios);
}

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
  const { esAdminGlobal, grupo: miGrupo, suscripcion, recargarOrganizacion } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [alta, setAlta] = useState(false);
  const [correo, setCorreo] = useState("");
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [rolNuevo, setRolNuevo] = useState<AppRol>("empresa");
  const [empresaNueva, setEmpresaNueva] = useState("");

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

  const { data: escalones } = useQuery({
    queryKey: ["plan-escalones", suscripcion?.plan_clave],
    enabled: !!suscripcion,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_escalones")
        .select("*")
        .eq("plan_clave", suscripcion!.plan_clave)
        .order("desde_usuarios");
      if (error) throw error;
      return data as PlanEscalon[];
    },
  });

  // Activar, desactivar o cambiar el rol de alguien mueve cuántos usuarios se
  // cobran, y eso hay que avisárselo a la pasarela. El alta lo hace sola
  // (usuarios-alta); estos movimientos pasan directo por RLS, así que la
  // sincronización se pide aparte.
  async function sincronizarCobro() {
    const { data, error } = await supabase.functions.invoke("usuarios-sincronizar", { body: {} });
    await recargarOrganizacion();
    if (error) return;
    if (data?.aviso) setAviso(`Usuarios cobrados: ${data.usuariosFacturables}. ${data.aviso}`);
    else setAviso(null);
  }

  const invitar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("usuarios-alta", {
        body: {
          correo: correo.trim().toLowerCase(),
          nombre: nombreNuevo.trim(),
          rol: rolNuevo,
          empresaId: empresaNueva || null,
        },
      });
      if (error) throw new Error(data?.error ?? error.message);
      if (data?.error) throw new Error(data.error);
      return data as { usuariosFacturables: number; avisoCobro?: string };
    },
    onSuccess: (data) => {
      setCorreo("");
      setNombreNuevo("");
      setEmpresaNueva("");
      setAlta(false);
      setError(null);
      setAviso(
        data.avisoCobro
          ? `Invitación enviada. Usuarios cobrados: ${data.usuariosFacturables}. ${data.avisoCobro}`
          : "Invitación enviada. El usuario define su contraseña desde el correo que le llegó.",
      );
      queryClient.invalidateQueries({ queryKey: ["admin-usuarios"] });
      void recargarOrganizacion();
    },
    onError: (e: Error) => setError(e.message),
  });

  const actualizar = useMutation({
    mutationFn: async ({ id, campos }: { id: string; campos: Partial<Profile> }) => {
      const { error } = await supabase.from("profiles").update(campos).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["admin-usuarios"] });
      void sincronizarCobro();
    },
    // La base rechaza combinaciones incoherentes (rol='empresa' sin empresa,
    // empresa de otra organización): sin mostrar el motivo, el cambio se veía
    // simplemente "no pasar".
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

  const siguienteCuesta = escalones ? costoDelSiguienteUsuario(escalones, suscripcion?.usuarios_facturables ?? 0) : null;
  const empresasDeMiOrganizacion = (empresas ?? []).filter((e) => e.grupo_id === miGrupo?.id);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          Un usuario sin organización no ve nada. rol='empresa' requiere además una empresa asignada, que tiene que ser de su
          misma organización. rol='pendiente' o sin empresa asignada (salvo corporativo/admin) significa sin acceso a datos.
        </p>
        {!esAdminGlobal && (
          <button onClick={() => setAlta((v) => !v)} className="shrink-0 rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
            {alta ? "Cancelar" : "Invitar usuario"}
          </button>
        )}
      </div>

      {suscripcion && (
        <p className="mb-4 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Se cobran <strong>{suscripcion.usuarios_facturables}</strong>{" "}
          {suscripcion.usuarios_facturables === 1 ? "usuario" : "usuarios"} a{" "}
          {dinero(suscripcion.precio_unitario_centavos, suscripcion.moneda)} c/u ={" "}
          <strong>{dinero(suscripcion.total_mensual_centavos, suscripcion.moneda)}</strong> al mes.
          {siguienteCuesta !== null && (
            <> El siguiente usuario cuesta {dinero(siguienteCuesta, suscripcion.moneda)} más al mes.</>
          )}{" "}
          Solo cuentan los activos con rol asignado: desactivar a alguien baja la factura.
        </p>
      )}

      {alta && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            invitar.mutate();
          }}
          className="mb-4 flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4"
        >
          <label className="flex flex-col text-xs text-slate-500">
            Correo
            <input
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              required
              className="mt-1 w-64 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Nombre
            <input
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              required
              className="mt-1 w-56 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Rol
            <select
              value={rolNuevo}
              onChange={(e) => setRolNuevo(e.target.value as AppRol)}
              className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
            >
              {ROLES_ALTA.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Empresa {rolNuevo === "empresa" && <span className="text-red-500">*</span>}
            <select
              value={empresaNueva}
              onChange={(e) => setEmpresaNueva(e.target.value)}
              required={rolNuevo === "empresa"}
              className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">— (todas, si corporativo/admin)</option>
              {empresasDeMiOrganizacion.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={invitar.isPending}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {invitar.isPending ? "Enviando…" : "Enviar invitación"}
          </button>
          <p className="w-full text-xs text-slate-500">
            Le llega un correo para que defina su contraseña. Nunca se le manda una contraseña hecha por alguien más.
          </p>
        </form>
      )}

      {aviso && <p className="mb-3 text-sm text-emerald-700">{aviso}</p>}
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
