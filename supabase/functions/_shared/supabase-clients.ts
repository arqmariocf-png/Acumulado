// Helpers de cliente Supabase para edge functions (Deno). Patrón usado en
// todas las funciones de este proyecto:
//
//   1. clienteComoUsuario(req) -- respeta el JWT de quien llama, así que
//      RLS aplica normalmente. Se usa para LEER datos y para confirmar que
//      el usuario tiene permiso (si la query no falla / trae filas, lo tiene).
//   2. clienteServicio() -- bypassa RLS con la service_role key. Se usa
//      SOLO para las escrituras masivas (insert de un lote de movimientos)
//      después de haber confirmado con el cliente de usuario que el caller
//      puede escribir en esa empresa -- nunca como atajo para saltarse la
//      verificación de permisos.
//
// Nunca exponer SUPABASE_SERVICE_ROLE_KEY al frontend; solo vive en el
// entorno del edge function (Supabase la inyecta automáticamente).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export function clienteComoUsuario(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
}

export function clienteServicio(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

export interface PerfilAutenticado {
  id: string;
  nombre: string | null;
  rol: string;
  empresaId: string | null;
}

/** Lee el profile del usuario autenticado usando su propio JWT (así RLS ya
 * garantiza que solo puede leer su propio profile, ver policy
 * profiles_select_self). Devuelve null si no hay sesión o el profile no
 * existe. */
export async function obtenerPerfilAutenticado(req: Request): Promise<PerfilAutenticado | null> {
  const cliente = clienteComoUsuario(req);
  const {
    data: { user },
  } = await cliente.auth.getUser();
  if (!user) return null;

  const { data: perfil, error } = await cliente.from("profiles").select("id, nombre, rol, empresa_id").eq("id", user.id).single();
  if (error || !perfil) return null;

  return { id: perfil.id, nombre: perfil.nombre, rol: perfil.rol, empresaId: perfil.empresa_id };
}

export function puedeEscribirEnEmpresa(perfil: PerfilAutenticado, empresaId: string): boolean {
  if (perfil.rol === "pendiente" || perfil.rol === "direccion") return false;
  if (perfil.rol === "corporativo" || perfil.rol === "admin") return true;
  return perfil.empresaId === empresaId;
}
