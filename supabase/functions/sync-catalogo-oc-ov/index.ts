// Edge function: sincroniza el catálogo de OC/OS y OV con la API del
// backoffice para LAS 8 EMPRESAS DE UNA SOLA VEZ -- confirmado contra la
// respuesta real (2026-08-25) que los endpoints api_ocs_aut/api_ov_aut ya
// traen el catálogo completo, cada registro con el nombre de su propia
// empresa adentro, así que ya no hace falta pedirlo empresa por empresa (ver
// _shared/ingesta/oc-ov.ts para el detalle de los campos confirmados).
//
// La lógica de fetch+mapeo+upsert vive en la función de Postgres
// public.sincronizar_catalogo_oc_ov() (ver supabase/migrations/
// 20260825010000_sync_catalogo_oc_ov.sql) para poder reusarla después desde
// pg_cron sin duplicar código -- este edge function es solo el wrapper que
// valida el permiso del usuario antes de invocarla vía RPC con el cliente de
// servicio (esa función está revocada de authenticated/anon a propósito).
//
// POST body: {} (no requiere empresaId -- sincroniza todas)

import { clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    // Escribe en las 8 empresas a la vez -- no aplica el permiso "por
    // empresa" (puedeEscribirEnEmpresa), se requiere el rol que ya ve el
    // consolidado de todas ellas.
    if (perfil.rol !== "admin" && perfil.rol !== "corporativo") {
      return jsonResponse({ error: "Solo corporativo/admin pueden sincronizar el catálogo de todas las empresas" }, 403);
    }

    const dbServicio = clienteServicio();
    const { data, error } = await dbServicio.rpc("sincronizar_catalogo_oc_ov");
    if (error) return jsonResponse({ error: error.message }, 500);

    return jsonResponse({ sincronizado: true, ...(data as Record<string, unknown>) });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
