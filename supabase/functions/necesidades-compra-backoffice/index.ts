// API de salida (no de entrada) para el backoffice: expone en JSON las
// necesidades de compra pendientes que salieron de una requisición, para
// que el equipo de Compras las lea y dé de alta la OC real en su ERP. Ver
// SPEC.md sección 10 (Requisiciones) sobre por qué esto NO inserta directo
// en ordenes_compra -- esa tabla se sincroniza sola desde el backoffice
// (sincronizar_catalogo_oc_ov), así que aquí solo se expone la "necesidad".
//
// Quien llama es un sistema externo, no un usuario con sesión de Supabase
// -- por eso esta función se despliega con verify_jwt=false y hace su
// propia autenticación por token estático (secret BACKOFFICE_OUTBOUND_TOKEN,
// nunca en el código ni en el repo). Mismo criterio de "nunca exponer la
// service_role key al llamante" que el resto de las funciones: el token de
// autorización es uno propio, generado para este endpoint, no la
// service_role key ni el token que usamos para llamar AL backoffice
// (BACKOFFICE_API_TOKEN, ver proxy-backoffice) -- son dos secrets
// distintos para dos direcciones distintas de la integración.

import { clienteServicio } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();
  if (req.method !== "GET") return jsonResponse({ error: "Método no soportado, usa GET" }, 405);

  const tokenEsperado = Deno.env.get("BACKOFFICE_OUTBOUND_TOKEN");
  if (!tokenEsperado) return jsonResponse({ error: "BACKOFFICE_OUTBOUND_TOKEN no está configurado" }, 500);

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (token !== tokenEsperado) return jsonResponse({ error: "No autorizado" }, 401);

  const db = clienteServicio();

  const { data, error } = await db
    .from("necesidades_compra")
    .select(
      `
      id,
      cantidad,
      proveedor_sugerido,
      created_at,
      requisicion_lineas (
        unidad_medida,
        productos ( sku, nombre, descripcion ),
        requisiciones (
          folio,
          fecha,
          proyectos ( id_backoffice, nombre ),
          empresas ( codigo, nombre )
        )
      )
    `,
    )
    .eq("estado", "pendiente")
    .order("created_at", { ascending: true });

  if (error) return jsonResponse({ error: error.message }, 500);

  const necesidades = (data ?? []).map((n: any) => {
    const linea = n.requisicion_lineas;
    const requisicion = linea?.requisiciones;
    return {
      necesidad_compra_id: n.id,
      cantidad: n.cantidad,
      unidad_medida: linea?.unidad_medida ?? null,
      proveedor_sugerido: n.proveedor_sugerido,
      concepto_sku: linea?.productos?.sku ?? null,
      concepto_nombre: linea?.productos?.nombre ?? null,
      concepto_descripcion: linea?.productos?.descripcion ?? null,
      requisicion_folio: requisicion?.folio ?? null,
      requisicion_fecha: requisicion?.fecha ?? null,
      proyecto_id_backoffice: requisicion?.proyectos?.id_backoffice ?? null,
      proyecto_nombre: requisicion?.proyectos?.nombre ?? null,
      empresa_codigo: requisicion?.empresas?.codigo ?? null,
      empresa_nombre: requisicion?.empresas?.nombre ?? null,
      creada_en: n.created_at,
    };
  });

  return jsonResponse({ necesidades_compra: necesidades, total: necesidades.length });
});
