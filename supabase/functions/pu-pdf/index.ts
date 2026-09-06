// Genera en PDF la tarjeta de análisis de precio unitario.
//
// Se llama CON la sesión del usuario (verify_jwt) y consulta con su propio
// token, no con la service_role: así RLS decide qué PU puede ver cada quien y
// esta función no tiene que reimplementar el permiso. Un supervisor que pida el
// id de un PU de otra obra simplemente no encuentra la fila.

import { createClient } from "npm:@supabase/supabase-js@2";
import { construirTarjeta } from "./tarjeta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function leerAnalisisId(req: Request): Promise<string | null> {
  const desdeQuery = new URL(req.url).searchParams.get("analisis_id");
  if (desdeQuery) return desdeQuery;
  if (req.method !== "POST") return null;
  try {
    const cuerpo = await req.json();
    return cuerpo?.analisis_id ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Método no soportado, usa GET o POST" }, 405);
  }

  const analisisId = await leerAnalisisId(req);
  if (!analisisId) return jsonResponse({ error: "Falta analisis_id" }, 400);

  const autorizacion = req.headers.get("Authorization") ?? "";
  if (!autorizacion) return jsonResponse({ error: "Falta sesión" }, 401);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: autorizacion } } },
  );

  const { data: pu, error: errorPu } = await db
    .from("v_pu_analisis_costeo")
    .select("*")
    .eq("analisis_id", analisisId)
    .maybeSingle();

  if (errorPu) return jsonResponse({ error: errorPu.message }, 500);
  if (!pu) return jsonResponse({ error: "El análisis no existe o no tienes acceso a él" }, 404);

  const { data: renglones, error: errorRenglones } = await db
    .from("v_pu_analisis_detalle")
    .select("*")
    .eq("analisis_id", analisisId)
    .order("orden", { ascending: true });

  if (errorRenglones) return jsonResponse({ error: errorRenglones.message }, 500);

  // La bitácora de autorizaciones ya no se consulta: el PDF es el entregable
  // al cliente y el circuito de firmas es gobierno interno. Quién firmó y qué
  // falta se ve en la pantalla del análisis.
  const pdf = await construirTarjeta(pu as any, (renglones ?? []) as any);

  // El nombre baja al carrete del celular tal cual, así que se limita a
  // caracteres que ni Android ni iOS reescriben.
  const archivo = `PU-${String(pu.codigo).replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
  const adjuntar = new URL(req.url).searchParams.get("descarga") === "1";

  return new Response(pdf, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `${adjuntar ? "attachment" : "inline"}; filename="${archivo}"`,
      "Cache-Control": "no-store",
    },
  });
});
